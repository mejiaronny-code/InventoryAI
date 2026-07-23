"""
app/routers/reservations.py
Gestión de reservas para staff y operaciones públicas del cliente.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import secrets
import string
import asyncio
import json
import threading
import logging

from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase
from app.core.company_features import get_active_company, require_public_catalog
from app.core.net import client_ip as _client_ip
from app.services.notifications import send_reservation_email
from app.models.schemas import ReservationCreate, ReservationUpdate

router = APIRouter(prefix="/reservations", tags=["reservations"])
logger = logging.getLogger(__name__)

# ── Anti-abuso: consulta pública "mis reservas" por email ────────────
# Sin este límite, cualquiera con un email ajeno podía enumerar su historial
# de reservas (nombre, teléfono, productos). Ahora también exige el código de
# UNA reserva propia como prueba de que es el dueño del email.
_MAX_BY_EMAIL_PER_IP_HOUR = 10
_ip_by_email_lookups: dict[str, dict[str, int]] = defaultdict(dict)
_by_email_lock = threading.Lock()


def _check_by_email_rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    with _by_email_lock:
        bucket = _ip_by_email_lookups[ip]
        for h in [h for h in bucket if h != hour]:
            del bucket[h]
        if bucket.get(hour, 0) >= _MAX_BY_EMAIL_PER_IP_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas consultas en poco tiempo. Intenta más tarde.",
            )
        bucket[hour] = bucket.get(hour, 0) + 1


# ── Anti-abuso: creación pública de reservas ──────────────────────────
# Mismo patrón que _check_booking_rate_limit en bookings.py. Sin esto,
# cualquiera podía crear reservas ilimitadas desde el catálogo público
# (agotar disponibilidad, saturar notificaciones/emails, inflar la BD).
_MAX_RESERVATIONS_PER_IP_HOUR = 10
_ip_reservations: dict[str, dict[str, int]] = defaultdict(dict)
_reservations_lock = threading.Lock()


def _check_reservation_rate_limit(request: Request) -> None:
    """Lanza 429 si una IP crea demasiadas reservas por hora."""
    ip = _client_ip(request)
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    with _reservations_lock:
        bucket = _ip_reservations[ip]
        for h in [h for h in bucket if h != hour]:
            del bucket[h]
        if bucket.get(hour, 0) >= _MAX_RESERVATIONS_PER_IP_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas reservas en poco tiempo. Intenta más tarde.",
            )
        bucket[hour] = bucket.get(hour, 0) + 1


def _generate_code(length: int = 8) -> str:
    """Genera un código de reserva alfanumérico en mayúsculas."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@router.post("/public/{company_slug}")
async def create_public_reservation(company_slug: str, data: ReservationCreate, request: Request):
    """Reserva pública creada por el cliente desde el catálogo."""
    _check_reservation_rate_limit(request)

    # 1. Verificar empresa
    company = await get_active_company(company_slug, "id, name, features")
    require_public_catalog(company)

    company_id = company["id"]
    company_name = company["name"]

    # 2. Verificar producto. La operación bloqueante corre en threadpool.
    product = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id, name, reservation_time_hours, categories(reservation_time_hours)")
            .eq("id", str(data.product_id))
            .eq("company_id", company_id)
            .eq("is_active", True)
            .maybe_single()
            .execute()
    )

    if not product.data:
        raise HTTPException(404, "Producto no disponible")

    # 3. Calcular expiración
    p = product.data
    hours = (
        p.get("reservation_time_hours")
        or (p.get("categories") or {}).get("reservation_time_hours")
        or 48
    )
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

    # 4. Crear la reserva bajo lock del stock. El RPC descuenta las reservas
    # activas de la disponibilidad y serializa solicitudes concurrentes para
    # impedir sobre-reserva. Ver 019_inventory_integrity.sql.
    result = None
    code = None
    for _ in range(5):
        code = _generate_code()
        try:
            result = await asyncio.to_thread(
                lambda reservation_code=code: supabase.rpc(
                    "create_reservation_if_available",
                    {
                        "p_company_id": company_id,
                        "p_product_id": str(data.product_id),
                        "p_warehouse_id": str(data.warehouse_id),
                        "p_quantity": data.quantity,
                        "p_client_name": data.client_name,
                        "p_client_email": str(data.client_email),
                        "p_client_phone": data.client_phone,
                        "p_notes": data.notes,
                        "p_reservation_code": reservation_code,
                        "p_expires_at": expires_at,
                    },
                ).execute()
            )
            break
        except Exception as e:
            message = str(e)
            if "reservations_reservation_code_key" in message or "duplicate key" in message:
                continue
            if "INSUFFICIENT_AVAILABLE_STOCK:" in message:
                available = message.split("INSUFFICIENT_AVAILABLE_STOCK:", 1)[1].split('"', 1)[0]
                raise HTTPException(400, f"Stock disponible insuficiente. Disponible: {available}")
            if "MAX_RESERVATION_QTY:" in message:
                maximum = message.split("MAX_RESERVATION_QTY:", 1)[1].split('"', 1)[0]
                raise HTTPException(400, f"La cantidad máxima por reserva es {maximum}")
            if "WAREHOUSE_NOT_FOUND" in message:
                raise HTTPException(404, "Almacén no disponible")
            if "PGRST202" in message or (
                "create_reservation_if_available" in message and "schema cache" in message
            ):
                raise HTTPException(503, "La migración de integridad de reservas está pendiente")
            raise

    if not (result and result.data):
        raise HTTPException(500, "No se pudo generar un código de reserva único")
    reservation_id = result.data[0]["reservation_id"]

    # 5. La reserva ya está confirmada en DB. Una falla secundaria de
    # notificación no debe convertirla en un 500 que invite a duplicarla.
    try:
        await asyncio.to_thread(
            lambda: supabase.table("notifications").insert({
                "company_id": company_id,
                "type": "new_reservation",
                "message": f"📋 Nueva reserva de {data.client_name}: {p['name']} x{data.quantity} (Código: {code})",
                "target_role": "all",
                "metadata": {
                    "reservation_id": reservation_id,
                    "reservation_code": code,
                    "client_name": data.client_name,
                    "product_name": p["name"],
                },
            }).execute()
        )
    except Exception:
        logger.exception("Reserva %s creada, pero falló su notificación", reservation_id)

    # Email de confirmación al cliente
    asyncio.create_task(send_reservation_email(
        to_email=data.client_email,
        client_name=data.client_name,
        product_name=p["name"],
        reservation_code=code,
        quantity=data.quantity,
        expires_at=expires_at,
        company_name=company_name,
    ))

    return {
        "reservation_code": code,
        "expires_at": expires_at,
        "message": "Reserva creada correctamente",
    }


@router.get("/public/by-email")
async def get_reservations_by_email(
    company_slug: str,
    email: str,
    code: str,
    request: Request,
):
    """
    Historial de reservas de un cliente por email (sin login).
    Exige además el código de UNA reserva propia como prueba de que el email
    es suyo — solo quien recibió el email de confirmación de al menos una
    reserva conoce un código válido. Sin esto, cualquiera podía consultar el
    historial completo de otra persona solo sabiendo su email.
    """
    _check_by_email_rate_limit(request)

    company = supabase.table("companies")\
        .select("id")\
        .eq("slug", company_slug)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    company_id = company.data["id"]
    email_clean = email.lower().strip()

    ownership_check = supabase.table("reservations")\
        .select("id")\
        .eq("company_id", company_id)\
        .eq("client_email", email_clean)\
        .eq("reservation_code", code.upper().strip())\
        .maybe_single()\
        .execute()

    if not (ownership_check and ownership_check.data):
        raise HTTPException(
            404,
            "No encontramos ninguna reserva con ese email y código. "
            "Usa el código que recibiste por email en la confirmación.",
        )

    result = supabase.table("reservations")\
        .select("*, products(name, unit, price), warehouses(name)")\
        .eq("company_id", company_id)\
        .eq("client_email", email_clean)\
        .order("created_at", desc=True)\
        .limit(50)\
        .execute()

    return result.data or []


@router.get("/public/{reservation_code}")
async def get_public_reservation(reservation_code: str, company_slug: str):
    """Consulta pública de reserva por código (para el cliente sin login)."""
    company = supabase.table("companies")\
        .select("id")\
        .eq("slug", company_slug)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    result = supabase.table("reservations")\
        .select("*, products(name, unit, price), warehouses(name)")\
        .eq("reservation_code", reservation_code.upper())\
        .eq("company_id", company.data["id"])\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(404, "Reserva no encontrada")

    return result.data


@router.get("/")
async def list_reservations(
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(require_staff),
):
    query = supabase.table("reservations")\
        .select("*, products(name, unit), warehouses(name)")\
        .eq("company_id", user["company_id"])\
        .order("created_at", desc=True)

    if status:
        query = query.eq("status", status)

    result = query.range(offset, offset + limit - 1).execute()
    return result.data or []


@router.patch("/{reservation_id}")
async def update_reservation(
    reservation_id: str,
    data: ReservationUpdate,
    user: dict = Depends(require_staff),
):
    company_id = user["company_id"]

    # Leer las notas solo para convertir la variante elegida a JSON. El RPC
    # vuelve a validar y bloquea la reserva: esta lectura NO decide el estado.
    current = await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .select("status, notes")
            .eq("id", reservation_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
    )

    if not current.data:
        raise HTTPException(404, "Reserva no encontrada")

    notes_for_variant = data.notes if data.notes is not None else current.data.get("notes")
    combination = _parse_variant_combination(notes_for_variant or "")

    try:
        result = await asyncio.to_thread(
            lambda: supabase.rpc("transition_reservation", {
                "p_company_id": company_id,
                "p_reservation_id": reservation_id,
                "p_new_status": data.status.value,
                "p_notes": data.notes,
                "p_created_by": user["id"],
                "p_variant_combination": combination or None,
            }).execute()
        )
    except Exception as e:
        message = str(e)
        if "RESERVATION_NOT_FOUND" in message:
            raise HTTPException(404, "Reserva no encontrada")
        if "INVALID_STATUS_TRANSITION" in message:
            raise HTTPException(409, "La reserva cambió de estado; actualiza la página e intenta de nuevo")
        if "INSUFFICIENT_STOCK" in message:
            raise HTTPException(409, "No hay stock suficiente para completar la reserva")
        if "PGRST202" in message or "transition_reservation" in message and "schema cache" in message:
            raise HTTPException(503, "La migración de integridad de reservas está pendiente")
        raise

    if not result.data:
        raise HTTPException(404, "Reserva no encontrada")
    return result.data[0]


def _parse_variant_combination(notes: str) -> dict:
    """Convierte las opciones guardadas en notas a la combinación JSON exacta."""
    if not notes:
        return {}
    options_part = notes.split(" — ")[0]
    combination: dict = {}
    normalized = options_part.replace(",", "·")
    for part in normalized.split("·"):
        part = part.strip()
        if ":" in part:
            key, value = part.split(":", 1)
            key, value = key.strip(), value.strip()
            if key:
                combination[key] = value
    return combination


def decrement_variant_stock_from_notes(product_id: str, warehouse_id: str, qty: int, notes: str) -> None:
    """
    Descuenta el stock por variante (color/talla) cuando la reserva/pedido
    tenía una opción elegida en sus notas (ej. "Color: Verde"). Se llama al
    completar cualquier flujo que descuenta stock general de un producto con
    variantes — reservas (aquí mismo) y picking (`routers/picking.py`) —
    para que el desglose por color no se desincronice del total general.
    """
    combination = _parse_variant_combination(notes)
    if not combination:
        return

    # Buscar la combinación en variant stock
    vs_rows = supabase.table("product_variants_stock")\
        .select("id, quantity, combination")\
        .eq("product_id", product_id)\
        .eq("warehouse_id", warehouse_id)\
        .execute()

    for vs in (vs_rows.data or []):
        db_combo = vs.get("combination") or {}
        # Si combination llegó como string (edge case), parsear
        if isinstance(db_combo, str):
            try:
                db_combo = json.loads(db_combo)
            except Exception:
                db_combo = {}
        # Match case-insensitive: todas las claves de combination presentes
        if all(
            str(db_combo.get(k, "")).strip().lower() == v.lower()
            for k, v in combination.items()
        ):
            new_vs_qty = max(0, vs["quantity"] - qty)
            supabase.table("product_variants_stock")\
                .update({"quantity": new_vs_qty})\
                .eq("id", vs["id"])\
                .execute()
            break


@router.delete("/cancelled")
async def delete_cancelled_reservations(user: dict = Depends(require_admin)):
    """Elimina todas las reservas completadas, canceladas y expiradas de la empresa."""
    company_id = user["company_id"]
    result = supabase.table("reservations")\
        .delete()\
        .eq("company_id", company_id)\
        .in_("status", ["cancelled", "expired", "completed"])\
        .execute()
    count = len(result.data or [])
    return {"message": f"{count} reservas eliminadas"}


@router.post("/expire-all")
async def expire_reservations(user: dict = Depends(require_staff)):
    """Expira las reservas vencidas y genera notificaciones."""
    now = datetime.now(timezone.utc).isoformat()
    company_id = user["company_id"]

    # Buscar reservas pendientes vencidas ANTES de expirarlas para poder notificar
    expiring = supabase.table("reservations")\
        .select("id, reservation_code, client_name, products(name)")\
        .eq("company_id", company_id)\
        .eq("status", "pending")\
        .lt("expires_at", now)\
        .execute()

    # Llamar al RPC para actualizar status en la DB — acotado a esta empresa
    # (ver migración 015_expire_reservations_scoped.sql).
    supabase.rpc("expire_reservations", {"p_company_id": company_id}).execute()

    # Generar notificación por cada reserva expirada de esta empresa
    for r in (expiring.data or []):
        product_name = (r.get("products") or {}).get("name", "producto")
        supabase.table("notifications").insert({
            "company_id": company_id,
            "type": "reservation_expired",
            "message": f"⌛ Reserva expirada: {product_name} — {r['client_name']} (Código: {r['reservation_code']})",
            "target_role": "all",
            "metadata": {
                "reservation_id": r["id"],
                "reservation_code": r["reservation_code"],
            },
        }).execute()

    count = len(expiring.data or [])
    return {"message": f"Reservas expiradas procesadas: {count}"}
