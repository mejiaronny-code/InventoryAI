"""
app/routers/dashboard.py
Métricas del dashboard para admin y super admin.
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timedelta
from app.core.auth import require_staff, require_super_admin
from app.core.supabase_client import supabase

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics")
async def get_dashboard_metrics(user: dict = Depends(require_staff)):
    company_id = user["company_id"]
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0).isoformat()

    # Productos activos
    products = supabase.table("products").select("id", count="exact").eq("company_id", company_id).eq("is_active", True).execute()
    total_products = products.count or 0

    # Stock total (solo productos de esta empresa)
    product_ids_res = supabase.table("products").select("id").eq("company_id", company_id).eq("is_active", True).execute()
    product_ids = [p["id"] for p in (product_ids_res.data or [])]

    if product_ids:
        stock = supabase.table("product_warehouse_stock")\
            .select("quantity")\
            .in_("product_id", product_ids)\
            .execute()
        total_stock = sum(s["quantity"] for s in (stock.data or []))
    else:
        total_stock = 0

    # Reservas activas
    active_res = supabase.table("reservations").select("id", count="exact")\
        .eq("company_id", company_id)\
        .in_("status", ["pending", "confirmed"])\
        .execute()
    active_reservations = active_res.count or 0

    # Reservas del mes
    monthly_res = supabase.table("reservations").select("id", count="exact")\
        .eq("company_id", company_id)\
        .gte("created_at", month_start)\
        .execute()
    monthly_reservations = monthly_res.count or 0

    # Costo IA del mes
    ai_usage = supabase.table("ai_usage_log")\
        .select("cost_usd")\
        .eq("company_id", company_id)\
        .gte("created_at", month_start)\
        .execute()
    monthly_ai_cost = sum(float(u.get("cost_usd", 0)) for u in (ai_usage.data or []))

    # Productos con stock bajo (solo de esta empresa)
    if product_ids:
        stock_all = supabase.table("product_warehouse_stock")\
            .select("quantity, min_stock_alert, product_id")\
            .in_("product_id", product_ids)\
            .execute()
        low_stock = sum(1 for s in (stock_all.data or []) if s["quantity"] <= (s.get("min_stock_alert") or 5))
    else:
        low_stock = 0

    # Reservas recientes
    recent_res = supabase.table("reservations")\
        .select("id, reservation_code, client_name, status, created_at, products(name)")\
        .eq("company_id", company_id)\
        .order("created_at", desc=True)\
        .limit(10)\
        .execute()

    # Notificaciones recientes
    recent_notifs = supabase.table("notifications")\
        .select("*")\
        .eq("company_id", company_id)\
        .eq("read", False)\
        .order("created_at", desc=True)\
        .limit(10)\
        .execute()

    return {
        "total_products": total_products,
        "total_stock": total_stock,
        "active_reservations": active_reservations,
        "low_stock_products": low_stock,
        "monthly_ai_cost": round(monthly_ai_cost, 4),
        "monthly_reservations": monthly_reservations,
        "recent_reservations": recent_res.data or [],
        "recent_notifications": recent_notifs.data or [],
    }


@router.get("/superadmin")
async def get_superadmin_metrics(
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
