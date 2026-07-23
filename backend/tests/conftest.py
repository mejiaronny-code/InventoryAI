"""
tests/conftest.py
Infraestructura compartida de la suite de tests del backend.

Provee un "Supabase falso" en memoria (`FakeSupabase`) que imita el query
builder real (`.table().select().eq().execute()`, insert/update/delete,
maybe_single/single) sin tocar la red ni una base de datos real. Así podemos
probar la LÓGICA de negocio (descuento de stock, recetas, multi-tenant, etc.)
de forma rápida y determinista — el mismo enfoque de mockeo de una suite seria.
"""
import os
import uuid

# Las settings (pydantic-settings) exigen estas vars al importar la app.
# Valores dummy: no se conecta a nada real en los tests.
os.environ.setdefault("SUPABASE_URL", "https://dummy.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy.dummy.dummy")
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
os.environ.setdefault("ENVIRONMENT", "ci")

import pytest


class _Result:
    """Imita la respuesta de supabase-py: tiene `.data`."""
    def __init__(self, data):
        self.data = data


class _Query:
    """Un query encadenable sobre una tabla en memoria."""

    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._op = "select"
        self._filters = []          # (col, op, value)
        self._payload = None
        self._single = None         # None | "maybe" | "one"
        self._range = None          # (start, end) inclusive, como .range() de supabase-py

    # ── builders ──────────────────────────────────────────────
    def select(self, *args, **kwargs):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = [c.strip() for c in on_conflict.split(",")] if on_conflict else None
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters.append((col, "eq", val))
        return self

    def neq(self, col, val):
        self._filters.append((col, "neq", val))
        return self

    def in_(self, col, vals):
        self._filters.append((col, "in", list(vals)))
        return self

    def gte(self, col, val):
        self._filters.append((col, "gte", val))
        return self

    def lte(self, col, val):
        self._filters.append((col, "lte", val))
        return self

    def or_(self, *args, **kwargs):
        return self  # no filtramos por or_ en los tests; basta no romper la cadena

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def maybe_single(self):
        self._single = "maybe"
        return self

    def single(self):
        self._single = "one"
        return self

    # ── helpers ───────────────────────────────────────────────
    def _rows(self):
        return self._db.setdefault(self._table, [])

    def _matches(self, row):
        for col, op, val in self._filters:
            cur = row.get(col)
            if op == "eq" and cur != val:
                return False
            if op == "neq" and cur == val:
                return False
            if op == "in" and cur not in val:
                return False
            if op == "gte" and not (cur is not None and cur >= val):
                return False
            if op == "lte" and not (cur is not None and cur <= val):
                return False
        return True

    def _apply_single(self, matched):
        if self._single == "maybe":
            return _Result(matched[0] if matched else None)
        if self._single == "one":
            if len(matched) != 1:
                raise Exception("single() esperaba exactamente 1 fila")
            return _Result(matched[0])
        return _Result(matched)

    # ── ejecución ─────────────────────────────────────────────
    def execute(self):
        rows = self._rows()

        if self._op == "select":
            matched = [dict(r) for r in rows if self._matches(r)]
            if self._range:
                start, end = self._range
                matched = matched[start:end + 1]
            return self._apply_single(matched)

        if self._op == "insert":
            payload = self._payload
            items = payload if isinstance(payload, list) else [payload]
            inserted = []
            for item in items:
                row = dict(item)
                row.setdefault("id", str(uuid.uuid4()))
                rows.append(row)
                inserted.append(dict(row))
            return _Result(inserted)

        if self._op == "update":
            updated = []
            for r in rows:
                if self._matches(r):
                    r.update(self._payload)
                    updated.append(dict(r))
            return _Result(updated)

        if self._op == "delete":
            kept, removed = [], []
            for r in rows:
                (removed if self._matches(r) else kept).append(r)
            self._db[self._table] = kept
            return _Result([dict(r) for r in removed])

        if self._op == "upsert":
            payload = self._payload
            items = payload if isinstance(payload, list) else [payload]
            keys = self._on_conflict or ["id"]
            out = []
            for item in items:
                existing = next(
                    (r for r in rows if all(r.get(k) == item.get(k) for k in keys)),
                    None,
                )
                if existing is not None:
                    existing.update(item)
                    out.append(dict(existing))
                else:
                    row = dict(item)
                    row.setdefault("id", str(uuid.uuid4()))
                    rows.append(row)
                    out.append(dict(row))
            return _Result(out)

        raise AssertionError(f"op no soportada: {self._op}")


class _StockRpcCall:
    """
    Simula `decrement_stock_strict`/`decrement_stock_clamped` (ver
    supabase/migrations/011_atomic_stock.sql) sobre el `db` en memoria, para
    poder testear la lógica de negocio sin una base de datos real.
    """
    def __init__(self, db, name, params):
        self._db = db
        self._name = name
        self._params = params or {}

    def execute(self):
        rows = self._db.setdefault("product_warehouse_stock", [])
        pid = self._params.get("p_product_id")
        wid = self._params.get("p_warehouse_id")
        qty = self._params.get("p_qty")
        if qty is None:
            qty = self._params.get("p_quantity")
        row = next((r for r in rows if r.get("product_id") == pid and r.get("warehouse_id") == wid), None)

        if self._name == "create_reservation_if_available":
            if not row:
                raise Exception("INSUFFICIENT_AVAILABLE_STOCK:0")
            active = sum(
                r.get("quantity", 0)
                for r in self._db.setdefault("reservations", [])
                if r.get("company_id") == self._params.get("p_company_id")
                and r.get("product_id") == pid
                and r.get("warehouse_id") == wid
                and r.get("status") in ("pending", "confirmed")
            )
            available = max(row["quantity"] - active, 0)
            if available < qty:
                raise Exception(f"INSUFFICIENT_AVAILABLE_STOCK:{available}")
            reservation_id = str(uuid.uuid4())
            self._db["reservations"].append({
                "id": reservation_id,
                "company_id": self._params.get("p_company_id"),
                "product_id": pid,
                "warehouse_id": wid,
                "quantity": qty,
                "client_name": self._params.get("p_client_name"),
                "client_email": self._params.get("p_client_email"),
                "client_phone": self._params.get("p_client_phone"),
                "notes": self._params.get("p_notes"),
                "status": "pending",
                "reservation_code": self._params.get("p_reservation_code"),
                "expires_at": self._params.get("p_expires_at"),
            })
            return _Result([{
                "reservation_id": reservation_id,
                "available_after": available - qty,
            }])

        if self._name == "transition_reservation":
            reservation_id = self._params.get("p_reservation_id")
            company_id = self._params.get("p_company_id")
            reservation = next(
                (r for r in self._db.setdefault("reservations", [])
                 if r.get("id") == reservation_id and r.get("company_id") == company_id),
                None,
            )
            if not reservation:
                raise Exception("RESERVATION_NOT_FOUND")
            new_status = self._params.get("p_new_status")
            old_status = reservation["status"]
            if new_status == old_status:
                return _Result([dict(reservation)])
            allowed = (
                old_status == "pending" and new_status in ("confirmed", "cancelled", "expired")
            ) or (
                old_status == "confirmed" and new_status in ("completed", "cancelled", "expired")
            )
            if not allowed:
                raise Exception(f"INVALID_STATUS_TRANSITION:{old_status}->{new_status}")
            if new_status == "completed":
                reservation_stock = next(
                    (r for r in rows
                     if r.get("product_id") == reservation["product_id"]
                     and r.get("warehouse_id") == reservation["warehouse_id"]),
                    None,
                )
                if not reservation_stock or reservation_stock["quantity"] < reservation["quantity"]:
                    raise Exception("INSUFFICIENT_STOCK")
                reservation_stock["quantity"] -= reservation["quantity"]
                self._db.setdefault("stock_movements", []).append({
                    "id": str(uuid.uuid4()),
                    "product_id": reservation["product_id"],
                    "warehouse_id": reservation["warehouse_id"],
                    "type": "salida",
                    "quantity": reservation["quantity"],
                    "notes": "Reserva completada",
                    "created_by": self._params.get("p_created_by"),
                })
                combination = self._params.get("p_variant_combination")
                if combination:
                    variant = next(
                        (v for v in self._db.setdefault("product_variants_stock", [])
                         if v.get("product_id") == reservation["product_id"]
                         and v.get("warehouse_id") == reservation["warehouse_id"]
                         and v.get("combination") == combination),
                        None,
                    )
                    if variant:
                        variant["quantity"] = max(
                            variant["quantity"] - reservation["quantity"], 0
                        )
            reservation["status"] = new_status
            if self._params.get("p_notes") is not None:
                reservation["notes"] = self._params["p_notes"]
            return _Result([dict(reservation)])

        if self._name == "decrement_stock_strict":
            if not row or row["quantity"] < qty:
                raise Exception("INSUFFICIENT_STOCK")
            row["quantity"] -= qty
            return _Result(row["quantity"])

        if self._name == "decrement_stock_clamped":
            if not row:
                return _Result(None)
            row["quantity"] = max(row["quantity"] - qty, 0)
            return _Result(row["quantity"])

        if self._name == "record_stock_movement":
            movement_type = self._params["p_type"]
            to_wid = self._params.get("p_to_warehouse_id")
            destination_qty = None

            if movement_type == "entrada":
                if row:
                    row["quantity"] += qty
                else:
                    row = {"id": str(uuid.uuid4()), "product_id": pid,
                           "warehouse_id": wid, "quantity": qty, "min_stock_alert": 5}
                    rows.append(row)
            elif movement_type == "salida":
                if not row or row["quantity"] < qty:
                    raise Exception("INSUFFICIENT_STOCK")
                row["quantity"] -= qty
            elif movement_type == "ajuste":
                if row:
                    row["quantity"] = qty
                else:
                    row = {"id": str(uuid.uuid4()), "product_id": pid,
                           "warehouse_id": wid, "quantity": qty, "min_stock_alert": 5}
                    rows.append(row)
            elif movement_type == "transferencia":
                if not to_wid or to_wid == wid:
                    raise Exception("INVALID_DESTINATION")
                if not row or row["quantity"] < qty:
                    raise Exception("INSUFFICIENT_STOCK")
                row["quantity"] -= qty
                destination = next(
                    (r for r in rows if r.get("product_id") == pid and r.get("warehouse_id") == to_wid),
                    None,
                )
                if destination:
                    destination["quantity"] += qty
                else:
                    destination = {"id": str(uuid.uuid4()), "product_id": pid,
                                   "warehouse_id": to_wid, "quantity": qty, "min_stock_alert": 5}
                    rows.append(destination)
                destination_qty = destination["quantity"]
            else:
                raise Exception("INVALID_MOVEMENT_TYPE")

            movement_id = str(uuid.uuid4())
            self._db.setdefault("stock_movements", []).append({
                "id": movement_id,
                "product_id": pid,
                "warehouse_id": wid,
                "to_warehouse_id": to_wid,
                "type": movement_type,
                "quantity": qty,
                "notes": self._params.get("p_notes"),
                "created_by": self._params.get("p_created_by"),
            })
            batch_code = self._params.get("p_batch_code")
            if movement_type == "entrada" and batch_code:
                self._db.setdefault("product_batches", []).append({
                    "id": str(uuid.uuid4()),
                    "company_id": self._params.get("p_company_id"),
                    "product_id": pid,
                    "warehouse_id": wid,
                    "batch_code": batch_code,
                    "quantity": qty,
                    "initial_quantity": qty,
                    "expires_at": self._params.get("p_expires_at"),
                    "notes": self._params.get("p_notes"),
                })
            return _Result([{
                "movement_id": movement_id,
                "new_quantity": row["quantity"],
                "destination_quantity": destination_qty,
            }])

        if self._name == "set_stock_with_audit":
            old_qty = row.get("quantity") if row else None
            if row:
                row["quantity"] = qty
                row["min_stock_alert"] = self._params["p_min_stock_alert"]
            else:
                row = {"id": str(uuid.uuid4()), "product_id": pid, "warehouse_id": wid,
                       "quantity": qty, "min_stock_alert": self._params["p_min_stock_alert"]}
                rows.append(row)
            movement_id = None
            if old_qty != qty:
                movement_id = str(uuid.uuid4())
                self._db.setdefault("stock_movements", []).append({
                    "id": movement_id,
                    "product_id": pid,
                    "warehouse_id": wid,
                    "type": "ajuste",
                    "quantity": qty,
                    "notes": self._params.get("p_notes") or "Ajuste manual de stock",
                    "created_by": self._params.get("p_created_by"),
                })
            return _Result([{"new_quantity": qty, "movement_id": movement_id}])

        raise AssertionError(f"RPC no soportada en FakeSupabase: {self._name}")


class _BookingRpcCall:
    def __init__(self, db, name, params):
        self._db = db
        self._name = name
        self._params = params or {}

    def execute(self):
        if self._name == "create_booking_with_items":
            table_id = self._params.get("p_table_id")
            if table_id:
                table = next(
                    (row for row in self._db.setdefault("restaurant_tables", [])
                     if row.get("id") == table_id
                     and row.get("company_id") == self._params.get("p_company_id")
                     and row.get("is_active", True)),
                    None,
                )
                if not table:
                    raise Exception("TABLE_NOT_FOUND")
                if self._params.get("p_party_size", 0) > table.get("capacity", 0):
                    raise Exception(f"TABLE_CAPACITY:{table.get('capacity', 0)}")

            booking_id = str(uuid.uuid4())
            booking = {
                "id": booking_id,
                "company_id": self._params.get("p_company_id"),
                "code": self._params.get("p_code"),
                "service_type": self._params.get("p_service_type"),
                "party_size": self._params.get("p_party_size"),
                "reserved_at": self._params.get("p_reserved_at"),
                "zone": self._params.get("p_zone"),
                "table_id": table_id,
                "client_name": self._params.get("p_client_name"),
                "client_email": self._params.get("p_client_email"),
                "client_phone": self._params.get("p_client_phone"),
                "status": "pending",
                "notes": self._params.get("p_notes"),
            }
            self._db.setdefault("bookings", []).append(booking)
            for item in self._params.get("p_items") or []:
                self._db.setdefault("booking_items", []).append({
                    "id": str(uuid.uuid4()),
                    "booking_id": booking_id,
                    "dish_id": item["dish_id"],
                    "quantity": item["quantity"],
                    "modifiers": item.get("modifiers") or {},
                })
            return _Result([{"booking_id": booking_id, "code": booking["code"]}])

        if self._name == "transition_booking":
            booking = next(
                (row for row in self._db.setdefault("bookings", [])
                 if row.get("id") == self._params.get("p_booking_id")
                 and row.get("company_id") == self._params.get("p_company_id")),
                None,
            )
            if not booking:
                raise Exception("BOOKING_NOT_FOUND")
            old = booking["status"]
            new = self._params.get("p_new_status") or old
            allowed = (
                old == "pending" and new in ("confirmed", "cancelled", "no_show")
            ) or (
                old == "confirmed" and new in ("preparing", "seated", "cancelled", "no_show")
            ) or (
                old == "preparing" and new in ("ready", "cancelled")
            ) or (
                old in ("ready", "seated") and new in ("completed", "cancelled", "no_show")
            )
            if new != old and not allowed:
                raise Exception(f"INVALID_BOOKING_TRANSITION:{old}->{new}")
            if new == "completed" and old != "completed":
                items = [
                    item for item in self._db.setdefault("booking_items", [])
                    if item.get("booking_id") == booking["id"]
                ]
                for item in items:
                    recipes = [
                        recipe for recipe in self._db.setdefault("recipes", [])
                        if recipe.get("company_id") == booking["company_id"]
                        and recipe.get("dish_id") == item["dish_id"]
                    ]
                    for recipe in recipes:
                        needed = int(round(float(recipe["quantity"]) * item["quantity"]))
                        stock_rows = [
                            row for row in self._db.setdefault("product_warehouse_stock", [])
                            if row.get("product_id") == recipe["ingredient_id"]
                        ]
                        if not stock_rows or needed <= 0:
                            continue
                        stock_row = max(stock_rows, key=lambda row: row["quantity"])
                        deducted = min(stock_row["quantity"], needed)
                        stock_row["quantity"] -= deducted
                        if deducted:
                            self._db.setdefault("stock_movements", []).append({
                                "id": str(uuid.uuid4()),
                                "product_id": recipe["ingredient_id"],
                                "warehouse_id": stock_row["warehouse_id"],
                                "type": "salida",
                                "quantity": deducted,
                                "notes": "Reserva completada",
                                "created_by": self._params.get("p_created_by"),
                            })
            booking["status"] = new
            if self._params.get("p_table_id"):
                booking["table_id"] = self._params["p_table_id"]
            if self._params.get("p_notes") is not None:
                booking["notes"] = self._params["p_notes"]
            return _Result([dict(booking)])

        raise AssertionError(f"RPC no soportada en FakeSupabase: {self._name}")


class _OperationalRpcCall:
    def __init__(self, db, name, params):
        self._db = db
        self._name = name
        self._params = params or {}

    def execute(self):
        company_id = self._params.get("p_company_id")

        if self._name == "replace_recipe":
            dish_id = self._params.get("p_dish_id")
            dish = next(
                (row for row in self._db.setdefault("products", [])
                 if row.get("id") == dish_id and row.get("company_id") == company_id),
                None,
            )
            if not dish:
                raise Exception("DISH_NOT_FOUND")
            ingredient_ids = {
                item["ingredient_id"] for item in self._params.get("p_items") or []
            }
            owned_ids = {
                row["id"] for row in self._db["products"]
                if row.get("company_id") == company_id and row.get("id") in ingredient_ids
            }
            if owned_ids != ingredient_ids:
                raise Exception("INGREDIENT_NOT_FOUND")
            self._db["recipes"] = [
                row for row in self._db.setdefault("recipes", [])
                if not (row.get("company_id") == company_id and row.get("dish_id") == dish_id)
            ]
            for item in self._params.get("p_items") or []:
                self._db["recipes"].append({
                    "id": str(uuid.uuid4()),
                    "company_id": company_id,
                    "dish_id": dish_id,
                    **item,
                })
            return _Result(len(self._params.get("p_items") or []))

        if self._name == "register_recipe_sale":
            out = []
            requested_warehouse = self._params.get("p_warehouse_id")
            for sale in self._params.get("p_items") or []:
                dish = next(
                    row for row in self._db.setdefault("products", [])
                    if row.get("id") == sale["dish_id"]
                    and row.get("company_id") == company_id
                )
                recipe_rows = [
                    row for row in self._db.setdefault("recipes", [])
                    if row.get("company_id") == company_id
                    and row.get("dish_id") == sale["dish_id"]
                ]
                for recipe in recipe_rows:
                    needed = int(round(float(recipe["quantity"]) * sale["quantity"]))
                    stock_rows = [
                        row for row in self._db.setdefault("product_warehouse_stock", [])
                        if row.get("product_id") == recipe["ingredient_id"]
                        and (not requested_warehouse
                             or row.get("warehouse_id") == requested_warehouse)
                    ]
                    stock = max(stock_rows, key=lambda row: row["quantity"]) if stock_rows else None
                    deducted = min(stock["quantity"], needed) if stock else 0
                    if stock:
                        stock["quantity"] -= deducted
                    ingredient = next(
                        (row for row in self._db["products"]
                         if row.get("id") == recipe["ingredient_id"]),
                        {},
                    )
                    if deducted:
                        self._db.setdefault("stock_movements", []).append({
                            "id": str(uuid.uuid4()),
                            "product_id": recipe["ingredient_id"],
                            "warehouse_id": stock["warehouse_id"],
                            "type": "salida",
                            "quantity": deducted,
                            "created_by": self._params.get("p_created_by"),
                        })
                    out.append({
                        "dish_name": dish["name"],
                        "ingredient_name": ingredient.get("name", "insumo"),
                        "needed": needed,
                        "deducted": deducted,
                        "short": needed - deducted,
                        "warehouse_id": stock.get("warehouse_id") if stock else None,
                        "new_quantity": stock.get("quantity") if stock else 0,
                    })
            return _Result(out)

        if self._name == "replace_variant_stock":
            product_id = self._params.get("p_product_id")
            product = next(
                (row for row in self._db.setdefault("products", [])
                 if row.get("id") == product_id and row.get("company_id") == company_id),
                None,
            )
            if not product:
                raise Exception("PRODUCT_NOT_FOUND")
            variant_rows = self._db.setdefault("product_variants_stock", [])
            affected = set()
            for item in self._params.get("p_items") or []:
                warehouse_id = item["warehouse_id"]
                affected.add(warehouse_id)
                current = next(
                    (row for row in variant_rows
                     if row.get("product_id") == product_id
                     and row.get("warehouse_id") == warehouse_id
                     and row.get("combination") == item["combination"]),
                    None,
                )
                old = current.get("quantity", 0) if current else 0
                if item["quantity"] < old and not (
                    self._params.get("p_notes") or ""
                ).strip():
                    raise Exception("NOTES_REQUIRED")
                delta = item["quantity"] - old
                if current:
                    current["quantity"] = item["quantity"]
                else:
                    current = {
                        "id": str(uuid.uuid4()),
                        "product_id": product_id,
                        **item,
                    }
                    variant_rows.append(current)
                if delta:
                    notes = f"Variante {item['combination']}: {old} → {item['quantity']}"
                    if self._params.get("p_notes"):
                        notes += f" — Motivo: {self._params['p_notes']}"
                    self._db.setdefault("stock_movements", []).append({
                        "id": str(uuid.uuid4()),
                        "product_id": product_id,
                        "warehouse_id": warehouse_id,
                        "type": "entrada" if delta > 0 else "salida",
                        "quantity": abs(delta),
                        "notes": notes,
                        "created_by": self._params.get("p_created_by"),
                    })
            stock_rows = self._db.setdefault("product_warehouse_stock", [])
            for warehouse_id in affected:
                total = sum(
                    row["quantity"] for row in variant_rows
                    if row.get("product_id") == product_id
                    and row.get("warehouse_id") == warehouse_id
                )
                stock = next(
                    (row for row in stock_rows
                     if row.get("product_id") == product_id
                     and row.get("warehouse_id") == warehouse_id),
                    None,
                )
                if stock:
                    stock["quantity"] = total
                else:
                    stock_rows.append({
                        "id": str(uuid.uuid4()),
                        "product_id": product_id,
                        "warehouse_id": warehouse_id,
                        "quantity": total,
                        "min_stock_alert": 5,
                    })
            return _Result([{
                "saved": len(self._params.get("p_items") or []),
                "affected_warehouses": len(affected),
            }])

        raise AssertionError(f"RPC no soportada en FakeSupabase: {self._name}")


class FakeSupabase:
    """Cliente falso. `db` es {tabla: [filas]}."""

    def __init__(self, db=None):
        self.db = db or {}

    def table(self, name):
        return _Query(self.db, name)

    def rpc(self, name, params=None):
        if name in (
            "decrement_stock_strict",
            "decrement_stock_clamped",
            "record_stock_movement",
            "set_stock_with_audit",
            "create_reservation_if_available",
            "transition_reservation",
        ):
            return _StockRpcCall(self.db, name, params)
        if name in ("create_booking_with_items", "transition_booking"):
            return _BookingRpcCall(self.db, name, params)
        if name in ("replace_recipe", "register_recipe_sale", "replace_variant_stock"):
            return _OperationalRpcCall(self.db, name, params)
        # Otras funciones RPC (búsqueda semántica, etc.) no se ejercitan en estos tests.
        return _Query(self.db, "_rpc")

    def seed(self, table, rows):
        self.db.setdefault(table, []).extend(dict(r) for r in rows)


@pytest.fixture
def fake_supabase():
    """Un Supabase falso vacío, listo para sembrar datos por test."""
    return FakeSupabase()
