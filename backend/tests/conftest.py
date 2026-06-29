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

        raise AssertionError(f"op no soportada: {self._op}")


class FakeSupabase:
    """Cliente falso. `db` es {tabla: [filas]}."""

    def __init__(self, db=None):
        self.db = db or {}

    def table(self, name):
        return _Query(self.db, name)

    def rpc(self, *args, **kwargs):
        # Las funciones RPC (búsqueda semántica) no se ejercitan en estos tests.
        return _Query(self.db, "_rpc")

    def seed(self, table, rows):
        self.db.setdefault(table, []).extend(dict(r) for r in rows)


@pytest.fixture
def fake_supabase():
    """Un Supabase falso vacío, listo para sembrar datos por test."""
    return FakeSupabase()
