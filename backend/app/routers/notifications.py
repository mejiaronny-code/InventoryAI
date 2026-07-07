"""
app/routers/notifications.py
Centro de notificaciones en tiempo real para admin y empleados.
"""
from fastapi import APIRouter, Depends
from app.core.auth import require_staff
from app.core.supabase_client import supabase

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/")
def list_notifications(user: dict = Depends(require_staff)):
    result = supabase.table("notifications")\
        .select("*")\
        .eq("company_id", user["company_id"])\
        .order("created_at", desc=True)\
        .limit(50)\
        .execute()
    return result.data or []


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, user: dict = Depends(require_staff)):
    supabase.table("notifications")\
        .update({"read": True})\
        .eq("id", notification_id)\
        .eq("company_id", user["company_id"])\
        .execute()
    return {"message": "Marcada como leída"}


@router.patch("/read-all")
def mark_all_read(user: dict = Depends(require_staff)):
    supabase.table("notifications")\
        .update({"read": True})\
        .eq("company_id", user["company_id"])\
        .execute()
    return {"message": "Todas marcadas como leídas"}


@router.delete("/{notification_id}")
def delete_notification(notification_id: str, user: dict = Depends(require_staff)):
    supabase.table("notifications")\
        .delete()\
        .eq("id", notification_id)\
        .eq("company_id", user["company_id"])\
        .execute()
    return {"message": "Notificación eliminada"}


@router.delete("/")
def delete_read_notifications(user: dict = Depends(require_staff)):
    supabase.table("notifications")\
        .delete()\
        .eq("company_id", user["company_id"])\
        .eq("read", True)\
        .execute()
    return {"message": "Notificaciones leídas eliminadas"}
