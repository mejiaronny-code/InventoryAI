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

    # Stock total
    stock = supabase.table("product_warehouse_stock")\
        .select("quantity")\
        .execute()
    total_stock = sum(s["quantity"] for s in (stock.data or []))

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

    # Productos con stock bajo
    stock_all = supabase.table("product_warehouse_stock")\
        .select("quantity, min_stock_alert, product_id")\
        .execute()
    low_stock = sum(1 for s in (stock_all.data or []) if s["quantity"] <= (s.get("min_stock_alert") or 5))

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
async def get_superadmin_metrics(user: dict = Depends(require_super_admin)):
    companies = supabase.table("companies").select("id, name, slug, is_active, subscriptions(plan, status)").execute()
    
    total_companies = len(companies.data or [])
    active_companies = sum(1 for c in (companies.data or []) if c.get("is_active"))

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0).isoformat()
    
    ai_costs = supabase.table("ai_usage_log").select("company_id, cost_usd").gte("created_at", month_start).execute()
    
    cost_by_company: dict = {}
    for log in (ai_costs.data or []):
        cid = log["company_id"]
        cost_by_company[cid] = cost_by_company.get(cid, 0) + float(log.get("cost_usd", 0))

    return {
        "total_companies": total_companies,
        "active_companies": active_companies,
        "companies": companies.data or [],
        "monthly_ai_cost_by_company": cost_by_company,
        "total_monthly_ai_cost": sum(cost_by_company.values()),
    }
