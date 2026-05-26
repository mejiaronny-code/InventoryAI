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


def create_inventory_tools(company_id: str, supabase_client, currency_symbol: str = "$", show_stock: bool = True):
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

            # 5. Obtener imágenes de los productos disponibles
            top = available[:5]
            img_res = supabase_client.table("products")\
                .select("id, images")\
                .in_("id", [p["id"] for p in top])\
                .execute()
            img_map = {r["id"]: (r.get("images") or []) for r in (img_res.data or [])}

            # 6. Formatear respuesta
            lines = [f"Encontré {len(available)} producto(s):\n"]
            for p in top:
                stock_val = p.get("total_stock", 0)
                stock_str = (
                    f"{stock_val} unidades" if show_stock
                    else ("disponible" if stock_val > 0 else "sin stock")
                )
                price_fmt = f"{float(p['price']):,.2f}"
                tags_str = ", ".join(p.get("tags") or [])
                imgs = img_map.get(p["id"], [])
                img_line = f"  ![{p['name']}]({imgs[0]})\n" if imgs else ""
                lines.append(
                    f"• **{p['name']}** (ID: {p['id']})\n"
                    f"{img_line}"
                    f"  Precio: {currency_symbol}{price_fmt} / {p['unit']}\n"
                    f"  Stock: {stock_str}\n"
                    + (f"  Etiquetas: {tags_str}\n" if tags_str else "")
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
                .select("*, categories(name, reservation_time_hours), images")\
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
                .select("quantity, min_stock_alert, store_location, warehouses(name, location)")\
                .eq("product_id", product_id)\
                .execute()

            stock_lines = []
            for s in (stock_result.data or []):
                wh = s.get("warehouses", {}) or {}
                store_loc = s.get("store_location") or ""
                if store_loc:
                    location_info = f" | 📍 {store_loc}"
                else:
                    location_info = " | 📍 Ubicación en tienda no registrada"
                qty_str = f"{s['quantity']} unidades" if show_stock else ("disponible" if s['quantity'] > 0 else "sin stock")
                stock_lines.append(
                    f"  - {wh.get('name', 'Almacén')}: {qty_str}{location_info}"
                )

            reservation_hours = p.get("reservation_time_hours") or cat.get("reservation_time_hours", 24)

            tags_str = ", ".join(p.get("tags") or [])
            units_list = p.get("units") or []
            units_lines = ""
            if units_list:
                units_lines = "Unidades disponibles:\n"
                units_lines += f"  - {p['unit']} (base, factor: 1) → {currency_symbol}{p['price']}\n"
                for u in units_list:
                    price_u = round(p['price'] * u['factor'], 2)
                    units_lines += f"  - {u['name']} (factor: {u['factor']}) → {currency_symbol}{price_u}\n"

            price_fmt = f"{float(p['price']):,.2f}"
            imgs = p.get("images") or []
            img_line = f"![{p['name']}]({imgs[0]})\n" if imgs else ""
            return (
                f"**{p['name']}**\n"
                f"{img_line}"
                f"SKU: {p.get('sku', 'N/A')} | Código: {p.get('barcode', 'N/A')}\n"
                f"Precio: {currency_symbol}{price_fmt} / {p['unit']}\n"
                f"Categoría: {cat.get('name', 'Sin categoría')}\n"
                + (f"Etiquetas: {tags_str}\n" if tags_str else "")
                + f"\nDescripción: {p.get('description', 'Sin descripción')}\n\n"
                f"Usos: {p.get('use_cases', 'No especificado')}\n\n"
                + (units_lines + "\n" if units_lines else "")
                + f"Stock por almacén:\n" + "\n".join(stock_lines or ["  Sin stock"]) + "\n\n"
                f"Tiempo de reserva: {reservation_hours} horas"
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
                .select("quantity, warehouse_id, store_location, warehouses(name)")\
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
                store_loc = s.get("store_location") or ""
                if store_loc:
                    loc_str = f" — 📍 {store_loc}"
                else:
                    loc_str = " — 📍 Ubicación en tienda no disponible"
                if show_stock:
                    lines.append(
                        f"  - {wh_name}: {s['quantity']} total - {reserved} reservados = **{max(available,0)} disponibles**"
                        f"{loc_str} (warehouse_id: {wh_id})"
                    )
                else:
                    status = "disponible" if max(available, 0) > 0 else "sin stock"
                    lines.append(
                        f"  - {wh_name}: **{status}**{loc_str} (warehouse_id: {wh_id})"
                    )

            if show_stock:
                summary = f"\n\nTotal disponible: {total_available} unidades"
            else:
                summary = f"\n\nEstado: {'hay stock disponible' if total_available > 0 else 'sin stock'}"

            return (
                f"Disponibilidad del producto {product_id}:\n"
                + "\n".join(lines)
                + summary
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
        client_email: str,
        client_phone: str = ""
    ) -> str:
        """
        Crea una reserva de producto para el cliente.
        IMPORTANTE:
        - Pedir nombre completo y email al cliente ANTES de llamar este tool.
        - Verificar stock disponible ANTES de llamar este tool.
        - Siempre confirmar al cliente: código de reserva y fecha de expiración.
        Parámetros:
        - product_id: UUID del producto
        - warehouse_id: UUID del almacén con stock
        - quantity: cantidad a reservar (entero positivo)
        - client_name: nombre completo del cliente (OBLIGATORIO)
        - client_email: email del cliente (OBLIGATORIO)
        - client_phone: teléfono del cliente (opcional)
        """
        # Validaciones de datos del cliente
        if not client_name or not client_name.strip():
            return "Error: Se requiere el nombre completo del cliente. Pídelo antes de continuar."
        if not client_email or "@" not in client_email:
            return "Error: Se requiere un correo electrónico válido del cliente. Pídelo antes de continuar."
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

    @tool
    async def get_batch_info(product_id: str) -> str:
        """
        Obtiene los lotes disponibles de un producto ordenados por FIFO (más antiguo primero).
        Útil cuando preguntan por lotes, trazabilidad o fechas de vencimiento por lote.
        """
        try:
            result = supabase_client.table("product_batches")\
                .select("*, warehouses(name)")\
                .eq("product_id", product_id)\
                .eq("company_id", company_id)\
                .gt("quantity", 0)\
                .order("received_at")\
                .execute()

            if not result.data:
                return "No hay lotes disponibles para este producto."

            prod = supabase_client.table("products")\
                .select("name, unit")\
                .eq("id", product_id)\
                .single().execute()
            prod_name = (prod.data or {}).get("name", product_id)

            lines = [f"Lotes disponibles de **{prod_name}** (orden FIFO):\n"]
            for b in result.data:
                wh = (b.get("warehouses") or {}).get("name", "—")
                exp = b["expires_at"][:10] if b.get("expires_at") else "Sin vencimiento"
                lines.append(
                    f"  • Lote **{b['batch_code']}** — {b['quantity']} unidades | "
                    f"Almacén: {wh} | Vence: {exp} | Recibido: {b['received_at'][:10]}"
                )
            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error en get_batch_info: {e}")
            return f"Error: {str(e)}"

    @tool
    async def find_serial_number(serial_number: str) -> str:
        """
        Busca un producto por su número de serie.
        Úsalo cuando el cliente menciona un número de serie específico.
        """
        try:
            result = supabase_client.table("product_serial_numbers")\
                .select("*, products(name, unit, price), warehouses(name)")\
                .eq("company_id", company_id)\
                .eq("serial_number", serial_number.upper())\
                .single()\
                .execute()

            if not result.data:
                return f"No encontré el número de serie '{serial_number}'."

            s = result.data
            prod = s.get("products") or {}
            wh = (s.get("warehouses") or {}).get("name", "—")
            raw_price = prod.get("price")
            price_fmt = f"{float(raw_price):,.2f}" if raw_price is not None else "—"
            status_map = {
                "in_stock": "✅ En stock",
                "reserved": "⏳ Reservado",
                "sold": "📦 Vendido",
                "retired": "🚫 Retirado",
            }
            return (
                f"**Número de serie: {s['serial_number']}**\n"
                f"Producto: {prod.get('name', '—')}\n"
                f"Estado: {status_map.get(s['status'], s['status'])}\n"
                f"Almacén: {wh}\n"
                f"Precio: {currency_symbol}{price_fmt} / {prod.get('unit', '—')}\n"
                f"Registrado: {s['created_at'][:10]}"
            )
        except Exception as e:
            logger.error(f"Error en find_serial_number: {e}")
            return f"Error: {str(e)}"

    @tool
    async def get_expiring_products(days: int | None = None) -> str:
        """
        Lista los productos que vencen en los próximos N días.
        Útil cuando el cliente o el negocio pregunta por productos próximos a vencer.
        Parámetros:
        - days: días hacia adelante a revisar (default: 30)
        """
        try:
            from datetime import timedelta
            days = days or 30  # null o None → default 30
            cutoff = (datetime.utcnow() + timedelta(days=days)).isoformat()
            now_iso = datetime.utcnow().isoformat()

            product_ids_res = supabase_client.table("products")\
                .select("id")\
                .eq("company_id", company_id)\
                .eq("is_active", True)\
                .execute()
            product_ids = [p["id"] for p in (product_ids_res.data or [])]

            if not product_ids:
                return "No hay productos registrados."

            stock_res = supabase_client.table("product_warehouse_stock")\
                .select("product_id, warehouse_id, quantity, nearest_expiry, warehouses(name)")\
                .in_("product_id", product_ids)\
                .not_.is_("nearest_expiry", "null")\
                .lte("nearest_expiry", cutoff)\
                .gte("nearest_expiry", now_iso)\
                .order("nearest_expiry")\
                .execute()

            if not stock_res.data:
                return f"No hay productos que venzan en los próximos {days} días. ✅"

            pid_set = list({r["product_id"] for r in stock_res.data})
            products_res = supabase_client.table("products")\
                .select("id, name")\
                .in_("id", pid_set)\
                .execute()
            name_map = {p["id"]: p["name"] for p in (products_res.data or [])}

            lines = [f"Productos que vencen en los próximos {days} días:\n"]
            for s in stock_res.data:
                name = name_map.get(s["product_id"], "—")
                wh = (s.get("warehouses") or {}).get("name", "—")
                expiry = s["nearest_expiry"][:10]
                days_left = (datetime.fromisoformat(s["nearest_expiry"].replace("Z", "")) - datetime.utcnow()).days
                urgency = "🔴" if days_left <= 3 else "🟡" if days_left <= 7 else "🟢"
                lines.append(f"  {urgency} **{name}** — Vence: {expiry} ({max(days_left, 0)} días) | {s['quantity']} unidades | {wh}")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error en get_expiring_products: {e}")
            return f"Error: {str(e)}"

    return [
        search_products,
        get_product_detail,
        get_stock_availability,
        create_reservation,
        cancel_reservation,
        get_reservation_status,
        get_expiring_products,
        get_batch_info,
        find_serial_number,
    ]
