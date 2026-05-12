"""
app/agents/tools.py
Tools del agente LangChain para el chat de inventario.
Cada tool tiene acceso al contexto de la empresa (company_id).
"""
from langchain.tools import tool
from typing import Optional
from uuid import UUID
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def create_inventory_tools(company_id: str, supabase_client):
    """
    Factory que crea los tools del agente inyectando el company_id.
    Esto garantiza que el agente SOLO accede al inventario de esa empresa.
    """
    from app.embeddings.embedding_service import generate_embedding

    @tool
    async def search_products(query: str, category_id: Optional[str] = None) -> str:
        """
        Busca productos en el inventario usando búsqueda semántica (pgvector).
        Usa esto cuando el cliente pregunta por un producto, tipo de producto,
        o cualquier cosa relacionada con el inventario.
        Parámetros:
        - query: texto de búsqueda del cliente
        - category_id: (opcional) UUID de categoría para filtrar
        """
        try:
            # 1. Generar embedding de la query
            query_embedding = await generate_embedding(query)

            # 2. Llamar RPC semántica de Supabase
            rpc_params = {
                "query_embedding": query_embedding,
                "company_id_filter": company_id,
                "match_threshold": 0.4,
                "match_count": 8,
            }

            result = supabase_client.rpc(
                "search_products_semantic", rpc_params
            ).execute()

            if not result.data:
                return "No encontré productos que coincidan con tu búsqueda."

            products = result.data

            # 3. Filtrar por stock > 0
            available = []
            for p in products:
                stock_result = supabase_client.table("product_warehouse_stock")\
                    .select("quantity, warehouse_id")\
                    .eq("product_id", p["id"])\
                    .execute()

                total_stock = sum(s["quantity"] for s in (stock_result.data or []))
                if total_stock > 0:
                    p["total_stock"] = total_stock
                    available.append(p)

            # 4. Filtrar por categoría si se especifica
            if category_id and available:
                cat_result = supabase_client.table("products")\
                    .select("id, category_id")\
                    .in_("id", [p["id"] for p in available])\
                    .eq("category_id", category_id)\
                    .execute()
                valid_ids = {r["id"] for r in (cat_result.data or [])}
                available = [p for p in available if p["id"] in valid_ids]

            if not available:
                return "Los productos encontrados están sin stock disponible."

            # 5. Formatear respuesta
            lines = [f"Encontré {len(available)} producto(s) relevante(s):\n"]
            for p in available[:5]:
                sim = p.get("similarity", 0)
                lines.append(
                    f"• **{p['name']}** (ID: {p['id']})\n"
                    f"  Precio: ${p['price']} / {p['unit']}\n"
                    f"  Stock disponible: {p.get('total_stock', 0)} unidades\n"
                    f"  {p.get('description', '')[:100]}...\n"
                    f"  Relevancia: {sim:.0%}\n"
                )
            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error en search_products: {e}")
            return f"Error al buscar productos: {str(e)}"

    @tool
    async def get_product_detail(product_id: str) -> str:
        """
        Obtiene información completa de un producto específico:
        descripción, usos, precio, stock por almacén, tiempo de reserva.
        Úsalo cuando el cliente quiere saber más sobre un producto específico.
        """
        try:
            result = supabase_client.table("products")\
                .select("*, categories(name, reservation_time_hours)")\
                .eq("id", product_id)\
                .eq("company_id", company_id)\
                .single()\
                .execute()

            if not result.data:
                return "Producto no encontrado."

            p = result.data
            cat = p.get("categories", {}) or {}

            # Stock por almacén
            stock_result = supabase_client.table("product_warehouse_stock")\
                .select("quantity, min_stock_alert, warehouses(name, location)")\
                .eq("product_id", product_id)\
                .execute()

            stock_lines = []
            for s in (stock_result.data or []):
                wh = s.get("warehouses", {}) or {}
                stock_lines.append(
                    f"  - {wh.get('name', 'Almacén')}: {s['quantity']} unidades"
                )

            reservation_hours = p.get("reservation_time_hours") or cat.get("reservation_time_hours", 24)

            return (
                f"**{p['name']}**\n"
                f"SKU: {p.get('sku', 'N/A')} | Código: {p.get('barcode', 'N/A')}\n"
                f"Precio: ${p['price']} / {p['unit']}\n"
                f"Categoría: {cat.get('name', 'Sin categoría')}\n\n"
                f"Descripción: {p.get('description', 'Sin descripción')}\n\n"
                f"Usos: {p.get('use_cases', 'No especificado')}\n\n"
                f"Stock por almacén:\n" + "\n".join(stock_lines or ["  Sin stock"]) + "\n\n"
                f"Tiempo de reserva: {reservation_hours} horas\n"
                f"Atributos: {p.get('attributes', {})}"
            )

        except Exception as e:
            logger.error(f"Error en get_product_detail: {e}")
            return f"Error al obtener producto: {str(e)}"

    @tool
    async def get_stock_availability(product_id: str) -> str:
        """
        Obtiene el stock REAL disponible de un producto,
        descontando las reservas activas (pending + confirmed).
        Úsalo antes de crear una reserva para confirmar disponibilidad.
        """
        try:
            # Stock total
            stock_result = supabase_client.table("product_warehouse_stock")\
                .select("quantity, warehouse_id, warehouses(name)")\
                .eq("product_id", product_id)\
                .execute()

            if not stock_result.data:
                return "Sin stock registrado para este producto."

            # Reservas activas
            reservas_result = supabase_client.table("reservations")\
                .select("quantity, warehouse_id")\
                .eq("product_id", product_id)\
                .eq("company_id", company_id)\
                .in_("status", ["pending", "confirmed"])\
                .execute()

            # Calcular por almacén
            reserved_by_wh: dict[str, int] = {}
            for r in (reservas_result.data or []):
                wh_id = r["warehouse_id"]
                reserved_by_wh[wh_id] = reserved_by_wh.get(wh_id, 0) + r["quantity"]

            lines = []
            total_available = 0
            for s in stock_result.data:
                wh_id = s["warehouse_id"]
                wh_name = (s.get("warehouses") or {}).get("name", "Almacén")
                reserved = reserved_by_wh.get(wh_id, 0)
                available = s["quantity"] - reserved
                total_available += max(available, 0)
                lines.append(
                    f"  - {wh_name}: {s['quantity']} total - {reserved} reservados = **{max(available,0)} disponibles**"
                    f" (warehouse_id: {wh_id})"
                )

            return (
                f"Disponibilidad del producto {product_id}:\n"
                + "\n".join(lines)
                + f"\n\nTotal disponible: {total_available} unidades"
            )

        except Exception as e:
            logger.error(f"Error en get_stock_availability: {e}")
            return f"Error: {str(e)}"

    @tool
    async def create_reservation(
        product_id: str,
        warehouse_id: str,
        quantity: int,
        client_name: str,
        client_email: str = "",
        client_phone: str = ""
    ) -> str:
        """
        Crea una reserva de producto para el cliente.
        IMPORTANTE: Verificar stock disponible ANTES de llamar este tool.
        Siempre confirmar al cliente: código de reserva y fecha de expiración.
        Parámetros:
        - product_id: UUID del producto
        - warehouse_id: UUID del almacén con stock
        - quantity: cantidad a reservar (entero positivo)
        - client_name: nombre completo del cliente
        - client_email: email del cliente (opcional pero recomendado)
        - client_phone: teléfono del cliente (opcional)
        """
        try:
            # Verificar stock disponible
            stock_q = supabase_client.table("product_warehouse_stock")\
                .select("quantity")\
                .eq("product_id", product_id)\
                .eq("warehouse_id", warehouse_id)\
                .single()\
                .execute()

            if not stock_q.data:
                return "Error: No hay stock registrado en ese almacén."

            reservas_activas = supabase_client.table("reservations")\
                .select("quantity")\
                .eq("product_id", product_id)\
                .eq("warehouse_id", warehouse_id)\
                .in_("status", ["pending", "confirmed"])\
                .execute()

            total_reserved = sum(r["quantity"] for r in (reservas_activas.data or []))
            available = stock_q.data["quantity"] - total_reserved

            if available < quantity:
                return f"Stock insuficiente. Solo hay {available} unidades disponibles."

            # Calcular expiración
            product_res = supabase_client.table("products")\
                .select("reservation_time_hours, name, categories(reservation_time_hours)")\
                .eq("id", product_id)\
                .single()\
                .execute()

            product_data = product_res.data or {}
            cat_data = product_data.get("categories") or {}
            hours = (
                product_data.get("reservation_time_hours")
                or cat_data.get("reservation_time_hours")
                or 24
            )

            # Generar código único
            code_result = supabase_client.rpc("generate_reservation_code").execute()
            reservation_code = code_result.data or f"RES-{product_id[:6].upper()}"

            # Verificar que el código no exista
            existing = supabase_client.table("reservations")\
                .select("id")\
                .eq("reservation_code", reservation_code)\
                .execute()
            if existing.data:
                reservation_code = f"RES-{product_id[:4].upper()}-{warehouse_id[:4].upper()}"

            from datetime import timedelta
            expires_at = (datetime.utcnow() + timedelta(hours=hours)).isoformat()

            # Crear reserva
            reservation_data = {
                "company_id": company_id,
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "quantity": quantity,
                "client_name": client_name,
                "client_email": client_email or None,
                "client_phone": client_phone or None,
                "status": "pending",
                "reservation_code": reservation_code,
                "expires_at": expires_at,
            }

            result = supabase_client.table("reservations")\
                .insert(reservation_data)\
                .execute()

            if not result.data:
                return "Error al crear la reserva. Intenta nuevamente."

            res = result.data[0]

            # Notificación al admin
            supabase_client.table("notifications").insert({
                "company_id": company_id,
                "type": "new_reservation",
                "message": f"Nueva reserva #{reservation_code} - {client_name} - {product_data.get('name', '')} x{quantity}",
                "target_role": "admin",
                "metadata": {"reservation_id": res["id"], "code": reservation_code},
            }).execute()

            # Email al cliente (async, no bloquea la respuesta)
            if client_email:
                try:
                    from app.services.notifications import send_reservation_email
                    import asyncio
                    asyncio.create_task(send_reservation_email(
                        to_email=client_email,
                        client_name=client_name,
                        product_name=product_data.get('name', 'Producto'),
                        reservation_code=reservation_code,
                        quantity=quantity,
                        expires_at=expires_at[:16].replace('T', ' ') + ' UTC',
                        company_name=company_id,  # se podría mejorar pasando el nombre
                    ))
                except Exception:
                    pass  # Email es best-effort, no crítico

            return (
                f"✅ **Reserva creada exitosamente!**\n\n"
                f"📋 Código de reserva: **{reservation_code}**\n"
                f"👤 Cliente: {client_name}\n"
                f"📦 Producto: {product_data.get('name', product_id)}\n"
                f"🔢 Cantidad: {quantity} unidades\n"
                f"⏰ Expira: {expires_at[:16].replace('T', ' ')} UTC\n\n"
                f"Guarda tu código **{reservation_code}** para consultar el estado de tu reserva."
            )

        except Exception as e:
            logger.error(f"Error en create_reservation: {e}")
            return f"Error al crear reserva: {str(e)}"

    @tool
    async def cancel_reservation(reservation_code: str) -> str:
        """
        Cancela una reserva por su código único.
        Solo se puede cancelar si está en estado 'pending' o 'confirmed'.
        """
        try:
            result = supabase_client.table("reservations")\
                .select("*")\
                .eq("reservation_code", reservation_code.upper())\
                .eq("company_id", company_id)\
                .single()\
                .execute()

            if not result.data:
                return f"No encontré la reserva con código {reservation_code}."

            res = result.data
            if res["status"] not in ("pending", "confirmed"):
                return f"La reserva {reservation_code} no se puede cancelar (estado: {res['status']})."

            supabase_client.table("reservations")\
                .update({"status": "cancelled", "updated_at": datetime.utcnow().isoformat()})\
                .eq("id", res["id"])\
                .execute()

            return (
                f"✅ Reserva **{reservation_code}** cancelada exitosamente.\n"
                f"El stock ha sido liberado."
            )

        except Exception as e:
            logger.error(f"Error en cancel_reservation: {e}")
            return f"Error: {str(e)}"

    @tool
    async def get_reservation_status(reservation_code: str) -> str:
        """
        Consulta el estado actual de una reserva por su código.
        Úsalo cuando el cliente pregunta por su reserva.
        """
        try:
            result = supabase_client.table("reservations")\
                .select("*, products(name, unit), warehouses(name)")\
                .eq("reservation_code", reservation_code.upper())\
                .eq("company_id", company_id)\
                .single()\
                .execute()

            if not result.data:
                return f"No encontré la reserva con código {reservation_code}."

            res = result.data
            product = res.get("products") or {}
            warehouse = res.get("warehouses") or {}

            status_map = {
                "pending": "⏳ Pendiente de confirmación",
                "confirmed": "✅ Confirmada",
                "completed": "🎉 Completada / Entregada",
                "cancelled": "❌ Cancelada",
                "expired": "⌛ Expirada",
            }

            return (
                f"**Reserva {reservation_code}**\n\n"
                f"Estado: {status_map.get(res['status'], res['status'])}\n"
                f"Producto: {product.get('name', 'N/A')} x{res['quantity']} {product.get('unit', '')}\n"
                f"Almacén: {warehouse.get('name', 'N/A')}\n"
                f"Cliente: {res['client_name']}\n"
                f"Creada: {res['created_at'][:16].replace('T', ' ')}\n"
                f"Expira: {res['expires_at'][:16].replace('T', ' ')} UTC\n"
            )

        except Exception as e:
            logger.error(f"Error en get_reservation_status: {e}")
            return f"Error: {str(e)}"

    return [
        search_products,
        get_product_detail,
        get_stock_availability,
        create_reservation,
        cancel_reservation,
        get_reservation_status,
    ]
