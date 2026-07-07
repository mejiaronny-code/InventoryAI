"""
app/routers/bookings.py
Reservas de mesa + pre-orden de platillos (sector restaurantes).

- POST /bookings/public/{slug}  → crea reserva (cliente, sin login)
- GET  /bookings/public/{code}  → consulta por código
- GET  /bookings/               → lista para staff (agenda)
- PATCH /bookings/{id}          → cambia estado; al completar descuenta insumos
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import threading
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase, run_with_retry
from app.core.company_features import get_active_company, require_public_catalog
from app.models.schemas import BookingCreate, BookingUpdate
from app.routers.reservations import _generate_code
from app.routers.recipes import _deplete_ingredient
from app.services.notifications import send_reservation_email

router = APIRouter(prefix="/bookings", tags=["bookings"])

VALID_STATUSES = {"pending", "confirmed", "preparing", "ready", "completed",
                  "cancelled", "no_show", "seated"}  # 'seated' se mantiene por compatibilidad

# ── Anti-abuso ────────────────────────────────────────────────────────
_MAX_BOOKINGS_PER_IP_HOUR = 5    # reservas por IP por hora
_MAX_PREORDER_LINES       = 30   # líneas de platillos distintas
_MAX_PREORDER_QTY         = 50   # cantidad por platillo
_MAX_DAYS_AHEAD           = 90   # cuán a futuro se puede reservar

# Contador en memoria por IP: { ip: { "YYYY-MM-DDTHH": count } }
_ip_bookings: dict[str, dict[str, int]] = defaultdict(dict)
_ip_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_booking_rate_limit(request: Request) -> None:
    """Lanza 429 si una IP crea demasiadas reservas por hora."""
    ip = _client_ip(request)
    hour = datetime.utcnow().strftime("%Y-%m-%dT%H")
    with _ip_lock:
        bucket = _ip_bookings[ip]
        for h in [h for h in bucket if h != hour]:
            del bucket[h]
        if bucket.get(hour, 0) >= _MAX_BOOKINGS_PER_IP_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas reservas en poco tiempo. Intenta más tarde.",
            )
        bucket[hour] = bucket.get(hour, 0) + 1


def _write_booking_sync(data: BookingCreate, company_id: str) -> str:
    """Código único + insert de booking/items/notificación. Corre en threadpool."""
    code = _generate_code()
    for _ in range(5):
        existing = supabase.table("bookings").select("id").eq("code", code).execute()
        if not existing.data:
            break
        code = _generate_code()

    booking_row = {
        "company_id":   company_id,
        "code":         code,
        "service_type": data.service_type,
        "party_size":   data.party_size if data.service_type == "dine_in" else None,
        "reserved_at":  data.reserved_at.isoformat(),
        "zone":         data.zone,
        "table_id":     str(data.table_id) if data.table_id else None,
        "client_name":  data.client_name,
        "client_email": data.client_email,
        "client_phone": data.client_phone,
        "status":       "pending",
        "notes":        data.notes,
    }
    result = supabase.table("bookings").insert(booking_row).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear la reserva")
    booking_id = result.data[0]["id"]

    # Pre-orden de platillos
    ordered_names: list[str] = []
    if data.items:
        item_rows = []
        for it in data.items:
            dish = supabase.table("products")\
                .select("name, price")\
                .eq("id", str(it.dish_id))\
                .eq("company_id", company_id)\
                .maybe_single().execute()
            d = dish.data if dish and dish.data else {}
            item_rows.append({
                "booking_id": booking_id,
                "dish_id":    str(it.dish_id),
                "quantity":   it.quantity,
                "modifiers":  it.modifiers or {},
                "unit_price": d.get("price"),
            })
            if d.get("name"):
                ordered_names.append(f"{it.quantity}× {d['name']}")
        if item_rows:
            supabase.table("booking_items").insert(item_rows).execute()

    # Notificación al staff — con detalle útil (mesa/zona + platillos)
    tipo = "Mesa" if data.service_type == "dine_in" else "Para recoger"
    partes = [f"🍽️ {tipo} — {data.client_name}"]
    if data.service_type == "dine_in" and data.party_size:
        partes.append(f"{data.party_size} pers.")
    if data.zone:
        partes.append(f"📍 {data.zone}")
    if ordered_names:
        partes.append("· " + ", ".join(ordered_names))
    partes.append(f"(Código: {code})")
    supabase.table("notifications").insert({
        "company_id": company_id,
        "type": "new_reservation",
        "message": " ".join(partes),
        "target_role": "all",
        "metadata": {"booking_id": booking_id, "code": code, "client_name": data.client_name},
    }).execute()

    return code


@router.post("/public/{company_slug}")
async def create_public_booking(company_slug: str, data: BookingCreate, request: Request):
    """Reserva de mesa / pedido para recoger, creada por el cliente."""
    # Honeypot: un humano nunca llena este campo oculto → si viene, es bot.
    # Respondemos "ok" falso para no darle pistas al atacante.
    if data.website:
        return {"code": "OK", "message": "Reserva creada"}

    # Rate limit por IP (anti-spam de reservas)
    _check_booking_rate_limit(request)

    company = await get_active_company(company_slug, "id, name, features")
    require_public_catalog(company)
    company_id = company["id"]
    company_name = company["name"]

    if data.service_type not in ("dine_in", "pickup"):
        raise HTTPException(400, "Tipo de servicio inválido")

    # Validar que el tipo de servicio esté habilitado para esta empresa
    features = company.get("features") or {}
    if data.service_type == "dine_in" and not features.get("table_reservations"):
        raise HTTPException(400, "Este negocio no acepta reservas de mesa")
    if data.service_type == "pickup" and not features.get("pickup_orders"):
        raise HTTPException(400, "Este negocio no acepta pedidos para recoger")

    # Requerir al menos un dato de contacto (sube la fricción a trolls)
    if not (data.client_phone and data.client_phone.strip()) and \
       not (data.client_email and str(data.client_email).strip()):
        raise HTTPException(400, "Proporciona un teléfono o email de contacto")

    # Validar fecha/hora: ni en el pasado ni demasiado a futuro
    reserved = data.reserved_at
    now = datetime.now(timezone.utc)
    if reserved.tzinfo is None:
        reserved = reserved.replace(tzinfo=timezone.utc)
    if reserved < now - timedelta(minutes=10):
        raise HTTPException(400, "La fecha de la reserva no puede ser en el pasado")
    if reserved > now + timedelta(days=_MAX_DAYS_AHEAD):
        raise HTTPException(400, f"Solo se puede reservar hasta {_MAX_DAYS_AHEAD} días a futuro")

    # Topar la pre-orden (anti "9999× pizza")
    if len(data.items) > _MAX_PREORDER_LINES:
        raise HTTPException(400, "Demasiados platillos en la pre-orden")
    for it in data.items:
        if it.quantity > _MAX_PREORDER_QTY:
            raise HTTPException(400, f"Cantidad máxima por platillo: {_MAX_PREORDER_QTY}")

    # Todo el trabajo de escritura en Supabase se corre en threadpool para no
    # bloquear el event loop (código único, insert de booking/items/notificación).
    code = await asyncio.to_thread(_write_booking_sync, data, company_id)

    # Email de confirmación al cliente (reutiliza la plantilla de reservas)
    if data.client_email:
        label = "Reserva de mesa" if data.service_type == "dine_in" else "Pedido para recoger"
        asyncio.create_task(send_reservation_email(
            to_email=data.client_email,
            client_name=data.client_name,
            product_name=label,
            reservation_code=code,
            quantity=data.party_size or 1,
            expires_at=data.reserved_at.isoformat(),
            company_name=company_name,
        ))

    return {"code": code, "reserved_at": data.reserved_at.isoformat(), "message": "Reserva creada"}


@router.get("/public/{code}")
async def get_public_booking(code: str, company_slug: str):
    company = await get_active_company(company_slug, "id")
    query = supabase.table("bookings")\
        .select("*, restaurant_tables(name, zone), booking_items(quantity, modifiers, products(name, price))")\
        .eq("code", code.upper())\
        .eq("company_id", company["id"])\
        .maybe_single()
    result = await run_with_retry(lambda: query.execute())
    if not (result and result.data):
        raise HTTPException(404, "Reserva no encontrada")
    return result.data


@router.get("/")
def list_bookings(
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(100, le=300),
    user: dict = Depends(require_staff),
):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    query = supabase.table("bookings")\
        .select("*, restaurant_tables(name, zone), booking_items(quantity, modifiers, products(name, price))")\
        .eq("company_id", company_id)\
        .order("reserved_at", desc=False)

    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("reserved_at", date_from)
    if date_to:
        query = query.lte("reserved_at", date_to)

    result = query.limit(limit).execute()
    return result.data or []


@router.delete("/cleanup")
def cleanup_bookings(user: dict = Depends(require_admin)):
    """Elimina las reservas terminadas (completadas / canceladas / no-show)."""
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")
    result = supabase.table("bookings")\
        .delete()\
        .eq("company_id", company_id)\
        .in_("status", ["completed", "cancelled", "no_show"])\
        .execute()
    count = len(result.data or [])
    return {"message": f"{count} reservas eliminadas"}


@router.patch("/{booking_id}")
def update_booking(booking_id: str, data: BookingUpdate, user: dict = Depends(require_staff)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    current = supabase.table("bookings")\
        .select("status")\
        .eq("id", booking_id)\
        .eq("company_id", company_id)\
        .maybe_single().execute()
    if not (current and current.data):
        raise HTTPException(404, "Reserva no encontrada")

    update_data: dict = {"updated_at": datetime.utcnow().isoformat()}
    if data.status is not None:
        if data.status not in VALID_STATUSES:
            raise HTTPException(400, "Estado inválido")
        update_data["status"] = data.status
    if data.table_id is not None:
        update_data["table_id"] = str(data.table_id)
    if data.notes is not None:
        update_data["notes"] = data.notes

    result = supabase.table("bookings")\
        .update(update_data)\
        .eq("id", booking_id)\
        .eq("company_id", company_id)\
        .execute()

    # Al completar: descontar insumos de los platillos pre-ordenados vía receta
    if data.status == "completed" and current.data["status"] != "completed":
        _deplete_booking_items(company_id, booking_id, user["id"])

    return result.data[0] if result.data else {"message": "Actualizado"}


def _deplete_booking_items(company_id: str, booking_id: str, created_by: str) -> None:
    """Descuenta los insumos de cada platillo pre-ordenado de la reserva."""
    items = supabase.table("booking_items")\
        .select("dish_id, quantity, products(name)")\
        .eq("booking_id", booking_id)\
        .execute()
    for it in (items.data or []):
        dish_id = it["dish_id"]
        qty = it["quantity"]
        dish_name = (it.get("products") or {}).get("name", "platillo")
        recipe = supabase.table("recipes")\
            .select("ingredient_id, quantity")\
            .eq("dish_id", dish_id)\
            .eq("company_id", company_id)\
            .execute()
        note = f"Reserva completada: {qty}× {dish_name}"
        for r in (recipe.data or []):
            needed = int(round(float(r["quantity"]) * qty))
            if needed > 0:
                _deplete_ingredient(company_id, r["ingredient_id"], needed, created_by, None, note)
