#!/usr/bin/env python3
"""
test_smoke.py
Prueba de humo rápida para verificar que el backend arranca correctamente.
Ejecutar con: python test_smoke.py

Requiere que el servidor esté corriendo en localhost:8000
"""
import httpx
import asyncio
import sys


BASE = "http://localhost:8000"


async def check(label: str, coro):
    try:
        result = await coro
        print(f"  ✅  {label}")
        return result
    except Exception as e:
        print(f"  ❌  {label}: {e}")
        return None


async def main():
    print("\n🔍 InventoryAI — Smoke Test\n")

    async with httpx.AsyncClient(timeout=10) as client:
        # 1. Health
        r = await check("Health check", client.get(f"{BASE}/health"))
        if r and r.status_code != 200:
            print("    Backend no está corriendo. Ejecuta: uvicorn app.main:app --reload")
            sys.exit(1)

        # 2. Docs
        await check("OpenAPI docs accessible", client.get(f"{BASE}/docs"))

        # 3. Public companies list
        r = await check("GET /api/v1/companies/", client.get(f"{BASE}/api/v1/companies/"))

        # 4. Login with bad creds → should return 401
        r = await check(
            "Login con credenciales incorrectas → 401",
            client.post(f"{BASE}/api/v1/auth/login", json={"email": "x@x.com", "password": "wrong"})
        )
        if r and r.status_code != 401:
            print(f"    ⚠️  Esperaba 401, recibió {r.status_code}")

        # 5. Protected endpoint without token → 401
        r = await check(
            "Endpoint protegido sin token → 401",
            client.get(f"{BASE}/api/v1/products/")
        )
        if r and r.status_code not in (401, 403):
            print(f"    ⚠️  Esperaba 401/403, recibió {r.status_code}")

    print("\n✅  Smoke test completado\n")


if __name__ == "__main__":
    asyncio.run(main())
