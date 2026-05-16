"""
app/services/notifications.py
Servicio de emails transaccionales usando Resend.
https://resend.com — plan gratis: 3,000 emails/mes.

Variables de entorno necesarias:
  RESEND_API_KEY=re_xxxxxxxxxxxx
  NOTIFICATION_FROM_EMAIL=noreply@tudominio.com
  SUPPORT_EMAIL=soporte@tudominio.com        (para solicitudes de eliminación)
  FRONTEND_URL=https://tuapp.com             (para links en emails)
"""
import httpx
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

_API_URL   = "https://api.resend.com/emails"
_API_KEY   = settings.resend_api_key
_FROM      = f"InventoryAI <{settings.notification_from_email}>"
_FRONT_URL = settings.frontend_url.rstrip("/")

# ── Helpers ───────────────────────────────────────────────────────────────────

def _enabled() -> bool:
    return bool(_API_KEY)

async def _send(to: str, subject: str, html: str) -> bool:
    """Envía un email via Resend. Retorna True si OK, False si falla (no lanza)."""
    if not _enabled():
        logger.info(f"Email omitido (sin RESEND_API_KEY): {subject} → {to}")
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                _API_URL,
                headers={"Authorization": f"Bearer {_API_KEY}", "Content-Type": "application/json"},
                json={"from": _FROM, "to": [to], "subject": subject, "html": html},
                timeout=10,
            )
        if r.status_code in (200, 201):
            logger.info(f"Email enviado → {to} | {subject}")
            return True
        logger.warning(f"Resend {r.status_code}: {r.text}")
        return False
    except Exception as e:
        logger.error(f"Error enviando email a {to}: {e}")
        return False


def _base_layout(header_html: str, body_html: str) -> str:
    """Plantilla base con header naranja y body blanco."""
    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#fff;border:1px solid #e4e4e4;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#ea6c0a,#f97316);padding:28px 32px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⚡ InventoryAI</h1>
            {header_html}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">{body_html}</td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0;color:#a3a3a3;font-size:12px;">InventoryAI · Si no esperabas este correo, ignóralo.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _btn(url: str, label: str) -> str:
    return f"""<table cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:#f97316;border-radius:10px;padding:13px 28px;">
    <a href="{url}" style="color:#fff;text-decoration:none;font-weight:600;font-size:15px;">{label}</a>
  </td></tr>
</table>"""


# ── 1. Confirmación de reserva ────────────────────────────────────────────────

async def send_reservation_email(
    to_email: str,
    client_name: str,
    product_name: str,
    reservation_code: str,
    quantity: int,
    expires_at: str,
    company_name: str,
):
    """Email de confirmación al cliente cuando hace una reserva."""
    header = f'<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{company_name}</p>'
    body = f"""
      <h2 style="margin:0 0 12px;color:#171717;font-size:18px;">✅ Reserva confirmada</h2>
      <p style="color:#525252;margin:0 0 8px;">Hola <strong>{client_name}</strong>, tu reserva fue registrada exitosamente.</p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
        <p style="margin:0;color:#9a3412;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Código de reserva</p>
        <p style="margin:8px 0 0;color:#f97316;font-size:30px;font-weight:800;font-family:monospace;letter-spacing:3px;">{reservation_code}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
        <tr>
          <td style="padding:8px 0;color:#737373;border-bottom:1px solid #f0f0f0;">Producto</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">{product_name}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#737373;border-bottom:1px solid #f0f0f0;">Cantidad</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">{quantity} unidades</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#737373;">Expira</td>
          <td style="padding:8px 0;color:#ef4444;font-weight:600;text-align:right;">{expires_at}</td>
        </tr>
      </table>
      <p style="color:#737373;font-size:13px;margin:0;">Guarda este código para consultar el estado de tu reserva en cualquier momento.</p>"""

    await _send(
        to_email,
        f"✅ Reserva {reservation_code} confirmada — {company_name}",
        _base_layout(header, body),
    )


# ── 2. Bienvenida de usuario nuevo ────────────────────────────────────────────

async def send_welcome_email(
    to_email: str,
    full_name: str,
    company_name: str,
):
    """Email de bienvenida cuando el admin o superadmin crea un usuario."""
    first = full_name.split()[0] if full_name else "Usuario"
    header = '<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Tu cuenta está lista</p>'
    body = f"""
      <h2 style="margin:0 0 12px;color:#171717;font-size:18px;">¡Hola, {first}! 👋</h2>
      <p style="color:#525252;margin:0 0 12px;">
        Tu cuenta en <strong>{company_name}</strong> ha sido creada exitosamente.
        Ya puedes iniciar sesión con el correo y la contraseña que te proporcionó tu administrador.
      </p>
      {_btn(f"{_FRONT_URL}/login", "Iniciar sesión →")}
      <p style="color:#a3a3a3;font-size:13px;margin:0;">Si tienes problemas para acceder, contacta a tu administrador.</p>"""

    await _send(
        to_email,
        f"¡Bienvenido a InventoryAI! — {company_name}",
        _base_layout(header, body),
    )


# ── 3. Recuperar contraseña ───────────────────────────────────────────────────

async def send_password_reset_email(
    to_email: str,
    full_name: str,
    reset_link: str,
):
    """Email con enlace para restablecer contraseña (el link lo genera Supabase)."""
    first = full_name.split()[0] if full_name else "Usuario"
    header = '<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Recuperación de contraseña</p>'
    body = f"""
      <h2 style="margin:0 0 12px;color:#171717;font-size:18px;">🔑 Restablecer contraseña</h2>
      <p style="color:#525252;margin:0 0 12px;">
        Hola <strong>{first}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta.
      </p>
      {_btn(reset_link, "Restablecer contraseña →")}
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-top:4px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          ⏱ Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, ignora este correo.
        </p>
      </div>"""

    await _send(
        to_email,
        "🔑 Restablecer tu contraseña — InventoryAI",
        _base_layout(header, body),
    )


# ── 4. Alerta de stock bajo ───────────────────────────────────────────────────

async def send_low_stock_alert(
    to_email: str,
    product_name: str,
    current_stock: int,
    company_name: str,
    min_stock: int = 5,
):
    """Email de alerta al admin cuando el stock baja del mínimo."""
    header = '<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Alerta de inventario</p>'
    body = f"""
      <h2 style="margin:0 0 12px;color:#171717;font-size:18px;">⚠️ Stock bajo detectado</h2>
      <p style="color:#525252;margin:0 0 20px;">
        El producto <strong>{product_name}</strong> en <strong>{company_name}</strong>
        bajó del mínimo configurado.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <tr>
          <td style="padding:8px 0;color:#737373;border-bottom:1px solid #f0f0f0;">Stock actual</td>
          <td style="padding:8px 0;color:#ef4444;font-weight:700;text-align:right;border-bottom:1px solid #f0f0f0;">{current_stock} unidades</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#737373;">Mínimo configurado</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;">{min_stock} unidades</td>
        </tr>
      </table>
      {_btn(f"{_FRONT_URL}/admin/stock", "Ver inventario →")}"""

    await _send(
        to_email,
        f"⚠️ Stock bajo: {product_name} — {company_name}",
        _base_layout(header, body),
    )


# ── 5. Solicitud de eliminación de cuenta ────────────────────────────────────

async def send_deletion_request_email(
    company_name: str,
    requested_by: str,
    admin_email: str,
):
    """
    Envía dos emails al solicitar eliminación de empresa:
    - Al soporte (SUPPORT_EMAIL) para gestionar la solicitud.
    - Al admin solicitante, confirmando recibo.
    """
    support_dest = settings.support_email or settings.notification_from_email

    # Email al soporte
    body_sup = f"""
      <h2 style="margin:0 0 12px;color:#ef4444;font-size:18px;">🗑️ Solicitud de eliminación</h2>
      <p style="color:#525252;margin:0 0 20px;">
        Se recibió una solicitud para <strong>eliminar permanentemente</strong> una empresa.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <tr>
          <td style="padding:8px 0;color:#737373;border-bottom:1px solid #f0f0f0;">Empresa</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">{company_name}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#737373;border-bottom:1px solid #f0f0f0;">Solicitado por</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">{requested_by}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#737373;">Email de contacto</td>
          <td style="padding:8px 0;color:#171717;font-weight:600;text-align:right;">{admin_email}</td>
        </tr>
      </table>
      <p style="color:#737373;font-size:13px;margin:0;">Revisa el panel de super-admin y procesa la solicitud.</p>"""

    await _send(
        support_dest,
        f"🗑️ Solicitud de eliminación: {company_name}",
        _base_layout('<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Panel de soporte</p>', body_sup),
    )

    # Confirmación al admin
    body_adm = f"""
      <h2 style="margin:0 0 12px;color:#171717;font-size:18px;">Solicitud recibida ✓</h2>
      <p style="color:#525252;margin:0 0 12px;">
        Hemos recibido tu solicitud para eliminar la empresa <strong>{company_name}</strong>.
      </p>
      <p style="color:#525252;margin:0 0 20px;">
        Nuestro equipo la revisará y se pondrá en contacto contigo en las próximas 24-48 horas.
        Mientras tanto, tu cuenta sigue activa normalmente.
      </p>
      <p style="color:#a3a3a3;font-size:13px;margin:0;">
        Si cambiaste de opinión, simplemente ignora este correo.
      </p>"""

    await _send(
        admin_email,
        "Solicitud de eliminación recibida — InventoryAI",
        _base_layout('<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Confirmación</p>', body_adm),
    )
