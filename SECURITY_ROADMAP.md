# Security Roadmap — InventoryAI

Guía de hardening progresivo para el SaaS. Ordenada por prioridad real: impacto financiero → seguridad → escalabilidad → compliance.

---

## 🔴 FASE 1 — Quick wins de código (PENDIENTE)

> Sin dominio, sin Redis, sin costo. Se puede hacer ya mismo.

### 1.1 Tope de longitud de mensajes al chat IA
- **Archivo:** `backend/app/models/schemas.py`
- **Problema:** `message: str` no tiene límite → un atacante manda 100k caracteres y agota el presupuesto de DeepInfra en segundos.
- **Fix:** `message: str = Field(..., max_length=2000)`
- También aplicar en el campo `user_text` del endpoint `/chat/image`.

### 1.2 Rate limit por IP (además del límite diario por empresa)
- **Archivo:** `backend/app/routers/chat.py`
- **Problema:** El límite actual es por empresa (compartido). Un atacante puede agotar la cuota de los clientes legítimos, y puede mandar todos los requests en 1 segundo.
- **Fix:** Agregar un segundo counter `{ ip: { "2024-01-15:14:30": count } }` que rechace con 429 si supera ~15 requests/minuto por IP.
- Usar `request.client.host` para obtener la IP (con cuidado detrás de proxies — leer header `X-Forwarded-For` cuando Cloudflare esté activo).

### 1.3 Rate limit en endpoints públicos de catálogo/reservas
- **Archivos:** `backend/app/routers/reservations.py`, `backend/app/routers/products.py`
- **Problema:** `POST /reservations` es público y sin rate limit → alguien puede crear 100,000 reservas basura y ensuciar el inventario.
- **Fix:** Limitar a ~10 reservas por IP por hora.

---

## 🟡 FASE 2 — Cloudflare (REQUIERE DOMINIO PROPIO)

> Comprar un dominio (~$10/año en Namecheap o Porkbun) desbloquea esta fase entera.

### 2.1 Activar Cloudflare gratis
- Registrar dominio → apuntar nameservers a Cloudflare → agregar registro CNAME/A apuntando a Railway.
- En Railway: Settings → Networking → Custom Domain → ingresar tu dominio.
- **Resultado:** Todo el tráfico pasa por Cloudflare antes de llegar a Railway.
- **Plan gratuito incluye:** DDoS ilimitado, CDN global, SSL/TLS gestionado, WAF básico, analytics.

### 2.2 Configuración recomendada en Cloudflare
- **Security Level:** Medium (default) — invisible para usuarios normales.
- **SSL/TLS mode:** Full (strict) — encripción de punta a punta.
- **"I'm Under Attack Mode":** Solo activarlo manualmente si hay un ataque activo en tiempo real.
- Activar **Bot Fight Mode** (gratis) — bloquea bots conocidos automáticamente.

### 2.3 Cloudflare Turnstile en el chat IA
- Widget "no soy un robot" que se resuelve solo en el background — **invisible para usuarios reales**.
- Agregar en el frontend antes de permitir el primer mensaje del chat.
- Documentación: https://developers.cloudflare.com/turnstile/
- **Backend:** verificar el token de Turnstile en `POST /chat/message` antes de procesar.
- **Costo:** Gratis hasta 1M verificaciones/mes.

---

## 🟠 FASE 3 — Redis para rate limiting robusto (CUANDO HAYA TRÁFICO REAL)

> Necesario si escalas a 2+ réplicas en Railway o si el rate limiter en memoria se resetea con demasiada frecuencia.

### 3.1 Problema actual
- El rate limiter vive en memoria del proceso Python.
- Se **resetea en cada deploy** de Railway.
- Con 2+ réplicas, el límite se multiplica por réplica (cada una cuenta por separado).

### 3.2 Solución
- Agregar el plugin de **Redis** en Railway (gratis en el plan Hobby, ~$5/mes en producción).
- Reemplazar `_counts: dict` en `chat.py` por llamadas a Redis con TTL.
- Librería: `redis-py` (`pip install redis`).
- Usar `INCR` + `EXPIRE` de Redis — atómico, thread-safe, persiste entre deploys.

---

## 🔵 FASE 4 — Alertas de costo y backups (HACER PRONTO, NO REQUIERE CÓDIGO)

> Configuración en dashboards externos. Sin esto, un ataque o un bug te puede vaciar el presupuesto o borrar datos sin que te enteres.

### 4.1 Alerta de gasto en DeepInfra
- Ir a DeepInfra dashboard → Billing → configurar alerta cuando el gasto supere $X.
- Sin esto, un ataque que pase el rate limit puede generar una factura enorme sin aviso.

### 4.2 Backups de Supabase
- Verificar que **Point-in-Time Recovery (PITR)** esté activo en Supabase (disponible en plan Pro).
- Sin PITR, un bug o atacante que borre datos no tiene recuperación.
- En plan Free: hacer dumps manuales periódicos via `pg_dump` o Supabase CLI.

### 4.3 Alerta de gasto en Railway
- Railway → Settings → Billing → Usage Alerts → configurar límite mensual.

---

## ⚪ FASE 5 — Compliance y hardening avanzado (PARA CUANDO CREZCAS)

> No bloquea el lanzamiento. Necesario para escalar con clientes empresariales.

### 5.1 Secrets management
- Hoy las API keys viven en variables de entorno de Railway en texto plano.
- Para compliance real (SOC2, ISO 27001): migrar a **HashiCorp Vault** o **Doppler** con rotación automática y auditoría de accesos.

### 5.2 Prompt injection hardening
- Ya está bien protegido por el filtrado de `company_id` — un ataque no puede leer datos de otra empresa.
- Riesgo restante: que el bot diga cosas dañinas *en nombre de la empresa* (reputacional).
- Mitigación: output filtering + sistema de reporte de respuestas inapropiadas.

### 5.3 Compliance de datos (GDPR / privacidad)
- La app guarda emails y nombres de clientes en reservas.
- Pendiente: política de privacidad visible, endpoint de borrado de datos a pedido del usuario, retención máxima definida.

### 5.4 Logging y auditoría
- Centralizar logs de Railway en un servicio externo (Logtail, Papertrail, Datadog).
- Alertas ante: spike de errores 429/500, latencia alta, llamadas LLM anómalas.

### 5.5 Penetration testing
- Cuando tengas clientes reales pagando: contratar un pentest básico o usar herramientas como OWASP ZAP sobre los endpoints públicos.

---

## Resumen de prioridades

| Fase | Acción | Requiere | Urgencia |
|------|--------|----------|----------|
| 1.1 | Tope longitud mensajes | Solo código | 🔴 Alta |
| 1.2 | Rate limit por IP en chat | Solo código | 🔴 Alta |
| 1.3 | Rate limit en reservas | Solo código | 🟠 Media |
| 2.x | Cloudflare | Dominio propio (~$10/año) | 🔴 Alta |
| 3.x | Redis rate limiting | Railway Redis plugin | 🟡 Media |
| 4.1 | Alerta gasto DeepInfra | Config en dashboard | 🔴 Alta |
| 4.2 | Backups Supabase | Config en dashboard | 🔴 Alta |
| 4.3 | Alerta gasto Railway | Config en dashboard | 🟠 Media |
| 5.x | Compliance avanzado | Varios | ⚪ Baja (a futuro) |
