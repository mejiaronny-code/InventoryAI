"""
app/routers/dashboard.py
Métricas del dashboard para admin y super admin.
Queries paralelas con asyncio.to_thread para máximo rendimiento.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timedelta
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

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0).isoformat()
    cutoff_30d = (now + timedelta(days=30)).isoformat()

    # ── Ronda 1: obtener IDs de productos (necesario para las demás queries) ──
    products_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id", count="exact")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()
    )
    total_products = products_res.count or 0
    product_ids = [p["id"] for p in (products_res.data or [])]

    if not product_ids:
        return {
            "total_products": 0, "total_stock": 0, "active_reservations": 0,
            "low_stock_products": 0, "expiring_soon": 0, "monthly_ai_cost": 0.0,
            "monthly_reservations": 0, "recent_reservations": [], "recent_notifications": [],
        }

    # ── Ronda 2: todas las queries restantes en paralelo ──
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
        asyncio.to_thread(lambda: supabase.table("product_warehouse_stock")
            .select("quantity, min_stock_alert, nearest_expiry")
            .in_("product_id", product_ids)
            .execute()),
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
        asyncio.to_thread(lambda: supabase.table("ai_usage_log")
            .select("cost_usd")
            .eq("company_id", company_id)
            .gte("created_at", month_start)
            .execute()),
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

    # ── Calcular métricas ──
    stock_data = stock_res.data or []
    total_stock = sum(s["quantity"] for s in stock_data)
    low_stock = sum(1 for s in stock_data if s["quantity"] <= (s.get("min_stock_alert") or 5))
    expiring_soon = sum(
        1 for s in stock_data
        if s.get("nearest_expiry") and s["nearest_expiry"] <= cutoff_30d
    )
    # Costo real de DeepInfra × margen → lo que se le muestra a la empresa.
    # El costo crudo (cost_usd) se conserva intacto para las métricas del super admin.
    monthly_ai_cost_raw = sum(float(u.get("cost_usd", 0)) for u in (ai_res.data or []))
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

    # Queries en paralelo
    product_ids_res, notifs_res = await asyncio.gather(
        asyncio.to_thread(lambda: supabase.table("products")
            .select("id").eq("company_id", company_id).execute()),
        asyncio.to_thread(lambda: supabase.table("notifications")
            .select("id, type, message, created_at")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()),
    )

    product_ids = [p["id"] for p in (product_ids_res.data or [])]
    activities = []

    if product_ids:
        movements_res = await asyncio.to_thread(
            lambda: supabase.table("stock_movements")
                .select("id, type, quantity, notes, created_at, products(name), warehouses(name)")
                .in_("product_id", product_ids)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
        )
        type_labels = {
            "entrada": "Entrada de stock", "salida": "Salida de stock",
            "ajuste": "Ajuste de stock",   "transferencia": "Transferencia",
        }
        for m in (movements_res.data or []):
            product_name  = (m.get("products")   or {}).get("name", "Producto")
            warehouse_name = (m.get("warehouses") or {}).get("name", "Almacén")
            activities.append({
                "id": m["id"], "category": "stock", "type": m["type"],
                "message": f"{type_labels.get(m['type'], m['type'].capitalize())}: {product_name} × {m['quantity']} — {warehouse_name}",
                "notes": m.get("notes"), "created_at": m["created_at"],
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
    now = datetime.utcnow()
    if month:
        year, mon = int(month[:4]), int(month[5:7])
        month_start = datetime(year, mon, 1)
    else:
        month_start = now.replace(day=1, hour=0, minute=0, second=0)
    month_start_iso = month_start.isoformat()

    # AI cost por empresa y por día
    ai_logs = supabase.table("ai_usage_log")\
        .select("company_id, cost_usd, created_at")\
        .gte("created_at", month_start_iso)\
        .execute()

    cost_by_company: dict = {}
    cost_by_day: dict = {}
    for log in (ai_logs.data or []):
        cid = log["company_id"]
        cost = float(log.get("cost_usd", 0))
        cost_by_company[cid] = cost_by_company.get(cid, 0) + cost
        day = log["created_at"][:10]
        cost_by_day[day] = cost_by_day.get(day, 0) + cost

    # Reservas por empresa este mes
    reservations = supabase.table("reservations")\
        .select("company_id")\
        .gte("created_at", month_start_iso)\
        .execute()

    res_by_company: dict = {}
    for r in (reservations.data or []):
        cid = r["company_id"]
        res_by_company[cid] = res_by_company.get(cid, 0) + 1

    total_reservations = sum(res_by_company.values())
    most_active_id = max(res_by_company, key=res_by_company.get) if res_by_company else None
    most_active = next((c["name"] for c in all_companies if c["id"] == most_active_id), "—")

    # Serializar cost_by_day como lista ordenada para el gráfico
    ai_by_day_chart = [
        {"date": d, "cost": round(v, 5)}
        for d, v in sorted(cost_by_day.items())
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
