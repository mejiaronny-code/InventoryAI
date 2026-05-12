"""
app/services/notifications.py
Servicio de notificaciones por email usando Resend (o SMTP fallback).
Resend: https://resend.com — plan gratis tiene 3,000 emails/mes.

Para activar, añade al .env:
RESEND_API_KEY=re_...
NOTIFICATION_FROM_EMAIL=noreply@tudominio.com
"""
import httpx
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

# Opcional — solo si configuras Resend
RESEND_API_KEY = getattr(settings, 'resend_api_key', None)
FROM_EMAIL = getattr(settings, 'notification_from_email', 'noreply@inventoryai.app')


async def send_reservation_email(
    to_email: str,
    client_name: str,
    product_name: str,
    reservation_code: str,
    quantity: int,
    expires_at: str,
    company_name: str,
):
    """
    Envía email de confirmación de reserva al cliente.
    Solo se ejecuta si RESEND_API_KEY está configurado.
    """
    if not RESEND_API_KEY or not to_email:
        logger.info(f"Email omitido (sin RESEND_API_KEY o sin email): reserva {reservation_code}")
        return False

    html_body = f"""
    <div style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
      <div style="background: #f97316; padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">⚡ InventoryAI</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">{company_name}</p>
      </div>
      <div style="background: white; padding: 32px; border: 1px solid #e4e4e4; border-top: none; border-radius: 0 0 16px 16px;">
        <h2 style="color: #171717; margin: 0 0 16px;">✅ Reserva confirmada</h2>
        <p style="color: #525252;">Hola <strong>{client_name}</strong>,</p>
        <p style="color: #525252;">Tu reserva ha sido registrada exitosamente.</p>
        
        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0; color: #9a3412; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Código de reserva</p>
          <p style="margin: 8px 0 0; color: #f97316; font-size: 28px; font-weight: 800; font-family: monospace; letter-spacing: 2px;">{reservation_code}</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #737373; border-bottom: 1px solid #f0f0f0;">Producto</td>
            <td style="padding: 8px 0; color: #171717; font-weight: 600; text-align: right; border-bottom: 1px solid #f0f0f0;">{product_name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #737373; border-bottom: 1px solid #f0f0f0;">Cantidad</td>
            <td style="padding: 8px 0; color: #171717; font-weight: 600; text-align: right; border-bottom: 1px solid #f0f0f0;">{quantity} unidades</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #737373;">Expira</td>
            <td style="padding: 8px 0; color: #ef4444; font-weight: 600; text-align: right;">{expires_at}</td>
          </tr>
        </table>
        
        <p style="color: #737373; font-size: 13px; margin-top: 24px;">
          Guarda este código para consultar el estado de tu reserva en cualquier momento.
        </p>
      </div>
    </div>
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"InventoryAI <{FROM_EMAIL}>",
                    "to": [to_email],
                    "subject": f"✅ Reserva {reservation_code} — {company_name}",
                    "html": html_body,
                },
                timeout=10,
            )
            if response.status_code in (200, 201):
                logger.info(f"Email enviado a {to_email} para reserva {reservation_code}")
                return True
            else:
                logger.warning(f"Error Resend {response.status_code}: {response.text}")
                return False
    except Exception as e:
        logger.error(f"Error enviando email: {e}")
        return False


async def send_low_stock_alert(
    to_email: str,
    product_name: str,
    current_stock: int,
    company_name: str,
):
    """Alerta de stock bajo al admin de la empresa."""
    if not RESEND_API_KEY or not to_email:
        return False

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={
                    "from": f"InventoryAI <{FROM_EMAIL}>",
                    "to": [to_email],
                    "subject": f"⚠️ Stock bajo: {product_name} — {company_name}",
                    "html": f"""
                    <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 480px;">
                      <h2 style="color: #f97316;">⚠️ Alerta de stock bajo</h2>
                      <p>El producto <strong>{product_name}</strong> tiene solo <strong style="color: #ef4444;">{current_stock} unidades</strong> disponibles.</p>
                      <p style="color: #737373;">Empresa: {company_name}</p>
                    </div>
                    """,
                },
                timeout=10,
            )
        return True
    except Exception as e:
        logger.error(f"Error enviando alerta de stock: {e}")
        return False
