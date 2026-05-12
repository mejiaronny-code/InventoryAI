#!/usr/bin/env python3
"""
scripts/regenerate_embeddings.py
Regenera los embeddings de todos los productos que no los tienen.
Ejecutar una vez después de la migración inicial o para productos históricos.

Uso:
  cd backend
  source venv/bin/activate
  python scripts/regenerate_embeddings.py

  # Solo para una empresa específica:
  python scripts/regenerate_embeddings.py --company-id UUID
"""
import asyncio
import argparse
import sys
import os

# Agregar el directorio raíz al path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.config import settings
from app.core.supabase_client import supabase
from app.embeddings.embedding_service import generate_product_embedding


async def regenerate_all(company_id: str = None, dry_run: bool = False):
    print(f"\n🔄 Regenerando embeddings faltantes...")
    if company_id:
        print(f"   Filtrando por empresa: {company_id}")

    # Obtener productos sin embedding
    query = supabase.table("products")\
        .select("id, name, description, use_cases, company_id")\
        .is_("embedding", "null")\
        .eq("is_active", True)

    if company_id:
        query = query.eq("company_id", company_id)

    result = query.execute()
    products = result.data or []

    print(f"   Encontrados {len(products)} producto(s) sin embedding\n")

    if dry_run:
        for p in products:
            print(f"  [DRY RUN] {p['name']} ({p['id']})")
        return

    success = 0
    errors = 0
    for i, p in enumerate(products, 1):
        try:
            embedding = await generate_product_embedding(
                p['name'],
                p.get('description') or '',
                p.get('use_cases') or '',
            )
            supabase.table("products")\
                .update({"embedding": embedding})\
                .eq("id", p['id'])\
                .execute()
            print(f"  [{i}/{len(products)}] ✅  {p['name']}")
            success += 1

            # Pequeña pausa para no saturar la API de OpenAI
            if i % 10 == 0:
                await asyncio.sleep(1)

        except Exception as e:
            print(f"  [{i}/{len(products)}] ❌  {p['name']}: {e}")
            errors += 1

    print(f"\n✅  Completado: {success} éxitos, {errors} errores\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Regenerar embeddings de productos")
    parser.add_argument("--company-id", help="UUID de empresa específica")
    parser.add_argument("--dry-run", action="store_true", help="Solo mostrar, no guardar")
    args = parser.parse_args()

    asyncio.run(regenerate_all(args.company_id, args.dry_run))
