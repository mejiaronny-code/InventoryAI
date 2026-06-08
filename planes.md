# Planes de Precios — InventoryAI (Mercado Hondureño)

> Análisis de mercado y propuesta de niveles de suscripción (Bronce, Plata, Oro), basado en el contexto socioeconómico de Honduras: PIB, inflación, comportamiento del consumidor/pyme e informalidad económica.

---

## 1. Contexto socioeconómico de Honduras

### PIB y estructura económica
- PIB nominal aproximado: **USD 35,000–38,000 millones** (2023-2024).
- PIB per cápita: **~USD 3,000–3,400** — uno de los más bajos de Centroamérica.
- Sectores clave: agricultura/agroindustria (café, banano, palma africana), maquila textil, remesas (**~27% del PIB**, una de las proporciones más altas del mundo) y comercio/retail informal.
- **60–70% de la economía es informal**: la mayoría de pequeños negocios (pulperías, ferreterías, farmacias familiares, distribuidoras pequeñas) no llevan inventario digitalizado — operan con cuadernos o Excel básico.

### Inflación
- Inflación interanual: **4–5.5%** en los últimos años (Banco Central de Honduras), con picos cercanos al 9-10% post-pandemia (2022).
- Erosiona el poder adquisitivo de las pymes; gastos recurrentes en USD (infraestructura: Render, Vercel, DeepInfra) se sienten "caros" en Lempiras (~L. 25–26 por USD).

### Comportamiento del consumidor / empresarial
- Pymes hondureñas: **muy sensibles al precio**, desconfían de suscripciones recurrentes ("pagar todos los meses" se percibe como gasto, no inversión).
- Prefieren **pagos anuales o únicos con descuento** sobre mensualidades (menor fricción psicológica).
- Adopción digital creciente en zonas urbanas (Tegucigalpa, San Pedro Sula, La Ceiba) vía WhatsApp Business, POS básicos, redes sociales — pero persiste el "miedo a lo técnico".
- Gasto típico en software/herramientas digitales: **L. 300–1,500/mes** (~USD 12–60).
- Negocios medianos/grandes (cadenas de farmacias, ferreterías regionales, distribuidoras) ya destinan presupuesto a sistemas de facturación obligatorios (exigidos por la SAR) y a ERPs — comparan contra Alegra, Siigo, sistemas locales (USD 30–150/mes).

---

## 2. Implicaciones para el pricing

- **Bronce** = puerta de entrada psicológicamente barata, para microempresas/emprendedores que digitalizan su inventario por primera vez. Compite contra "no pagar nada" (Excel/cuaderno).
- **Plata** = segmento dulce: pymes formales con 1–3 sucursales que ya valoran catálogo público + chat IA + reportes.
- **Oro** = negocios medianos con varias bodegas/sucursales, trazabilidad avanzada (lotes, caducidad, series) y mayor uso de IA — el ahorro operativo (menos mermas, menos quiebres de stock, más ventas vía catálogo) justifica el costo mayor.

**Recomendaciones de estructura de precio:**
- Anclar el precio en **Lempiras** (reduce fricción psicológica), pero calcular costos internos en **USD** (la infraestructura — Render, Vercel, DeepInfra, Supabase — se factura en USD). Esto protege el margen ante depreciación/inflación del Lempira.
- Empujar el **plan anual con descuento** (~15-20%): mejor flujo de caja, menor cancelación (churn), y alineado con la preferencia cultural de "pagar una vez y olvidarse".

---

## 3. Niveles propuestos

| Nivel | Precio mensual (L.) | Equivalente USD | Precio anual sugerido (desc. ~15-20%) | Perfil objetivo |
|---|---|---|---|---|
| 🥉 **Bronce** | L. 350 – 500 / mes | ~USD 14 – 20 | L. 3,500 – 5,000 / año | Microempresas/emprendedores. 1 usuario admin, catálogo básico, chat IA con límite bajo (~50-100 msj/día), 1 almacén |
| 🥈 **Plata** | L. 800 – 1,200 / mes | ~USD 32 – 48 | L. 8,000 – 12,000 / año | Pymes formales. 2-5 usuarios, catálogo + chat IA con límite medio (~200-500 msj/día), reportes básicos, hasta 2-3 almacenes, notificaciones |
| 🥇 **Oro** | L. 1,800 – 2,800 / mes | ~USD 70 – 110 | L. 18,000 – 28,000 / año | Negocios medianos/cadenas. Usuarios ilimitados (o altos), IA sin límite práctico, trazabilidad avanzada (lotes, caducidad, números de serie), múltiples almacenes, picking, reabastecimiento automático, soporte prioritario |

### Justificación de los rangos
- **Bronce** (~USD 14-20): calibrado para no espantar al segmento informal/microempresa, manteniendo rentabilidad (costos variables estimados por cliente en este nivel: ~USD 3-8/mes en DeepInfra + Supabase + hosting).
- **Plata**: cercano a lo que ya pagan por sistemas de facturación obligatorios (SAR) — sumar inventario + IA + catálogo a un costo similar es fácil de justificar ante el cliente.
- **Oro**: compite contra ERPs internacionales (USD 100-300/mes en Honduras) — posicionarse en USD 70-110 lo hace lucir "premium pero local y accesible", mucho más barato que alternativas extranjeras.

---

## 4. Recomendaciones adicionales

1. **Trial gratuito de 14-30 días** — en mercados con baja confianza digital, "probar antes de pagar" reduce drásticamente la fricción de conversión.
2. **Cobrar en Lempiras, indexar en USD** — ajustar el precio en L. cada 6-12 meses según tipo de cambio/inflación, para no perder margen real.
3. **Empujar el plan anual** con descuento visible — mejor flujo de caja y menor cancelación.
4. **Considerar un "Bronce gratuito" limitado** (freemium) — capturar el segmento informal sin costo inicial y convertirlos a Plata cuando crecen; estrategia de penetración fuerte en economías con alta informalidad.
5. **Vender el ahorro, no el software** — en un país con inflación ~5% y márgenes ajustados, el argumento de venta más fuerte es "reduce mermas, evita quiebres de stock, vende más por catálogo", explicado en Lempiras concretos (ROI tangible), no "tiene IA".

---

## 5. Próximo paso sugerido

Definir qué *feature flags* existentes en InventoryAI (`physical_location`, `tags`, `barcodes_qr`, `batch_tracking`, `expiration_dates`, `serial_numbers`, `multi_unit`, `variants`, `auto_reorder`, etc. — ver sistema de `features JSONB` en `companies`) corresponden a cada nivel (Bronce / Plata / Oro), para alinear el pricing comercial con el sistema técnico de feature flags ya implementado.
