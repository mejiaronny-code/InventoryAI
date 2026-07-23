"""
app/routers/dashboard.py
Métricas del dashboard para admin y super admin.
Queries paralelas con asyncio.to_thread para máximo rendimiento.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timedelta, timezone
import asyncio
from app.core.auth import require_staff, require_super_admin
from app.core.supabase_client import supabase
from app.core.config import settings

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics")
async def get_dashboard_metrics(user: dict = Depends(require_staff)):
    company_id = user["company_id"]
    if not company_id:
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene empresa asignada")

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0).isoformat()
    cutoff_30d = (now + timedelta(days=30)).isoformat()

    # ── Ronda 1: total de productos (solo el count, no descarga filas) ──
    products_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()
    )
    total_products = products_res.count or 0

    if total_products == 0:
        return {
            "total_products": 0, "total_stock": 0, "active_reservations": 0,
            "low_stock_products": 0, "expiring_soon": 0, "monthly_ai_cost": 0.0,
            "monthly_reservations": 0, "recent_reservations": [], "recent_notifications": [],
        }

    # ── Ronda 2: todas las queries restantes en paralelo ──
    # stock_res y ai_res usan RPCs con SUM/COUNT en Postgres (ver
    # 018_dashboard_aggregates.sql) en vez de descargar todas las filas de
    # product_warehouse_stock/ai_usage_log y sumarlas en Python — con
    # suficiente volumen, PostgREST trunca la respuesta en silencio y la
    # métrica salía mal sin ningún error visible.
    (
        stock_res,
        active_res,
        monthly_res,
        ai_res,
        recent_res_data,
        notifs_res,
        active_bk,
        monthly_bk,
        recent_bk,
    ) = await asyncio.gather(
        asyncio.to_thread(lambda: supabase.rpc("company_stock_metrics", {
            "p_company_id": company_id,
            "p_expiry_cutoff": cutoff_30d,
        }).execute()),
        asyncio.to_thread(lambda: supabase.table("reservations")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .in_("status", ["pending", "confirmed"])
            .execute()),
        asyncio.to_thread(lambda: supabase.table("reservations")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .gte("created_at", month_start)
            .execute()),
        asyncio.to_thread(lambda: supabase.rpc("company_ai_cost_sum", {
            "p_company_id": company_id,
            "p_since": month_start,
        }).execute()),
        asyncio.to_thread(lambda: supabase.table("reservations")
            .select("id, reservation_code, client_name, status, created_at, products(name)")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()),
        asyncio.to_thread(lambda: supabase.table("notifications")
            .select("*")
            .eq("company_id", company_id)
            .eq("read", False)
            .order("created_at", desc=True)
            .limit(10)
            .execute()),
        # Reservas de restaurante (bookings) — activas, del mes y recientes
        asyncio.to_thread(lambda: supabase.table("bookings")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .in_("status", ["pending", "confirmed", "seated", "ready"])
            .execute()),
        asyncio.to_thread(lambda: supabase.table("bookings")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .gte("created_at", month_start)
            .execute()),
        asyncio.to_thread(lambda: supabase.table("bookings")
            .select("id, code, client_name, status, created_at, booking_items(products(name))")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()),
    )

    # ── Leer métricas agregadas por Postgres ──
    stock_row = (stock_res.data or [{}])[0]
    total_stock = stock_row.get("total_stock") or 0
    low_stock = stock_row.get("low_stock_count") or 0
    expiring_soon = stock_row.get("expiring_soon_count") or 0
    # Costo real de DeepInfra × margen → lo que se le muestra a la empresa.
    # El costo crudo (cost_usd) se conserva intacto para las métricas del super admin.
    monthly_ai_cost_raw = float(ai_res.data or 0)
    monthly_ai_cost = monthly_ai_cost_raw * settings.ai_cost_multiplier

    # Normalizar bookings de restaurante al mismo formato que las reservas
    # para mostrarlos juntos en "Reservas recientes".
    booking_recent = []
    for b in (recent_bk.data or []):
        items = b.get("booking_items") or []
        names = [ (i.get("products") or {}).get("name") for i in items if i.get("products") ]
        if names:
            label = names[0] + (f" +{len(names) - 1}" if len(names) > 1 else "")
        else:
            label = "Reserva de mesa"
        booking_recent.append({
            "reservation_code": b.get("code"),
            "client_name": b.get("client_name"),
            "status": b.get("status"),
            "created_at": b.get("created_at"),
            "products": {"name": label},
        })

    recent_combined = sorted(
        (recent_res_data.data or []) + booking_recent,
        key=lambda r: r.get("created_at") or "",
        reverse=True,
    )[:10]

    return {
        "total_products": total_products,
        "total_stock": total_stock,
        "active_reservations": (active_res.count or 0) + (active_bk.count or 0),
        "low_stock_products": low_stock,
        "expiring_soon": expiring_soon,
        "monthly_ai_cost": round(monthly_ai_cost, 4),
        "monthly_reservations": (monthly_res.count or 0) + (monthly_bk.count or 0),
        "recent_reservations": recent_combined,
        "recent_notifications": notifs_res.data or [],
    }


@router.get("/activity")
async def get_activity(
    limit: int = Query(100, le=200),
    user: dict = Depends(require_staff),
):
    """Historial de actividad de la empresa: movimientos de stock + eventos."""
    company_id = user["company_id"]
    if not company_id:
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene empresa asignada")

    # Queries en paralelo. El filtro de stock_movements va vía join embebido
    # (products!inner) en vez de descargar TODOS los product_id de la empresa
    # y luego filtrar con .in_() — con muchos productos, esa lista podía
    # truncarse silenciosamente por el límite de fila de PostgREST y algunos
    # movimientos desaparecían de la actividad sin ningún aviso.
    movements_res, notifs_res = await asyncio.gather(
        # warehouses(name) requiere indicar la FK: stock_movements tiene DOS
        # relaciones con warehouses (warehouse_id y to_warehouse_id, agregada
        # por 017_transfer_stock.sql) y PostgREST no puede desambiguar solo.
        asyncio.to_thread(lambda: supabase.table("stock_movements")
            .select(
                "id, type, quantity, notes, created_at, created_by, products!inner(name, company_id), "
                "warehouses!stock_movements_warehouse_id_fkey(name)"
            )
            .eq("products.company_id", company_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()),
        asyncio.to_thread(lambda: supabase.table("notifications")
            .select("id, type, message, created_at")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()),
    )

    activities = []
    movements = movements_res.data or []
    if movements:

        # created_by referencia auth.users, no user_profiles directamente —
        # no se puede pedir como embed de Postgrest. Se resuelve el nombre
        # con una consulta aparte, para saber QUIÉN hizo cada movimiento
        # (trazabilidad ante robos/faltantes de stock).
        creator_ids = list({m["created_by"] for m in movements if m.get("created_by")})
        creator_names = {}
        if creator_ids:
            profiles_res = await asyncio.to_thread(
                lambda: supabase.table("user_profiles")
                    .select("id, full_name")
                    .in_("id", creator_ids)
                    .execute()
            )
            creator_names = {p["id"]: p.get("full_name") for p in (profiles_res.data or [])}

        type_labels = {
            "entrada": "Entrada de stock", "salida": "Salida de stock",
            "ajuste": "Ajuste de stock",   "transferencia": "Transferencia",
        }
        for m in movements:
            product_name  = (m.get("products")   or {}).get("name", "Producto")
            warehouse_name = (m.get("warehouses") or {}).get("name", "Almacén")
            created_by_name = creator_names.get(m.get("created_by")) or None
            activities.append({
                "id": m["id"], "category": "stock", "type": m["type"],
                "message": f"{type_labels.get(m['type'], m['type'].capitalize())}: {product_name} × {m['quantity']} — {warehouse_name}",
                "notes": m.get("notes"), "created_at": m["created_at"],
                "created_by_name": created_by_name,
            })

    for n in (notifs_res.data or []):
        activities.append({
            "id": n["id"], "category": "event", "type": n["type"],
            "message": n["message"], "notes": None, "created_at": n["created_at"],
        })

    # Fusionar y ordenar por fecha descendente
    activities.sort(key=lambda x: x["created_at"], reverse=True)
    return activities[:limit]


@router.get("/superadmin")
def get_superadmin_metrics(
    month: str = None,
    user: dict = Depends(require_super_admin)
):
    companies = supabase.table("companies").select("id, name, slug, is_active, subscriptions(plan, status)").execute()
    all_companies = companies.data or []

    total_companies = len(all_companies)
    active_companies = sum(1 for c in all_companies if c.get("is_active"))

    # Calcular rango del mes seleccionado
    now = datetime.now(timezone.utc)
    if month:
        year, mon = int(month[:4]), int(month[5:7])
        month_start = datetime(year, mon, 1)
    else:
        month_start = now.replace(day=1, hour=0, minute=0, second=0)
    month_start_iso = month_start.isoformat()

    # AI cost por empresa y por día, y reservas por empresa — agregado en
    # Postgres (ver 018_dashboard_aggregates.sql) en vez de descargar TODOS
    # los registros de uso de IA / reservas de TODAS las empresas del mes y
    # sumarlos en Python. Con suficiente volumen esa descarga se truncaba en
    # silencio por el límite de fila de PostgREST y las métricas de
    # plataforma salían mal sin ningún error visible.
    ai_by_company_res = supabase.rpc("ai_cost_by_company", {"p_since": month_start_iso}).execute()
    ai_by_day_res = supabase.rpc("ai_cost_by_day", {"p_since": month_start_iso}).execute()
    res_by_company_res = supabase.rpc("reservations_count_by_company", {"p_since": month_start_iso}).execute()

    cost_by_company = {row["company_id"]: float(row["total_cost"]) for row in (ai_by_company_res.data or [])}
    res_by_company = {row["company_id"]: row["total_count"] for row in (res_by_company_res.data or [])}

    total_reservations = sum(res_by_company.values())
    most_active_id = max(res_by_company, key=res_by_company.get) if res_by_company else None
    most_active = next((c["name"] for c in all_companies if c["id"] == most_active_id), "—")

    # El RPC ya devuelve los días ordenados
    ai_by_day_chart = [
        {"date": str(row["day"]), "cost": round(float(row["total_cost"]), 5)}
        for row in (ai_by_day_res.data or [])
    ]

    # Reservas por empresa para el gráfico (usar nombre corto)
    company_name_map = {c["id"]: c["name"] for c in all_companies}
    res_by_company_chart = [
        {"empresa": company_name_map.get(cid, cid[:8]), "reservas": count}
        for cid, count in sorted(res_by_company.items(), key=lambda x: -x[1])
    ]

    return {
        "total_companies": total_companies,
        "active_companies": active_companies,
        "total_reservations": total_reservations,
        "most_active_company": most_active,
        "total_monthly_ai_cost": round(sum(cost_by_company.values()), 5),
        "companies": all_companies,
        "monthly_ai_cost_by_company": cost_by_company,
        "ai_by_day_chart": ai_by_day_chart,
        "res_by_company_chart": res_by_company_chart,
    }
