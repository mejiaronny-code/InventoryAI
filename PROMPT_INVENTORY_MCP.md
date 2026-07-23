# Prompt para implementar MCP bidireccional en Inventory

Actúa como arquitecto senior, ingeniero de seguridad y desarrollador full-stack. Trabaja directamente en el repositorio de mi aplicación de inventario y construye una integración MCP de producción, multi-tenant y bidireccional.

## Regla inicial obligatoria

Antes de modificar código:

1. Lee completos `AGENTS.md`, `CLAUDE.md` y cualquier instrucción o skill local aplicable.
2. Estudia la arquitectura, stack, autenticación, modelo multi-tenant, esquema real de base de datos, RLS, roles, bodegas/sucursales, movimientos, productos, costos, ventas, auditoría y UI existentes.
3. Localiza tests, migraciones y convenciones del proyecto.
4. Revisa `git status` y preserva cambios ajenos.
5. Resume brevemente lo entendido y crea un plan verificable.

No inventes nombres de tablas, columnas, roles, endpoints ni reglas de negocio. Adapta todo al modelo real del repositorio. No reemplaces integraciones existentes: MCP debe ser aditivo y estar detrás de un feature flag desactivado por defecto. No hagas commit. Si hace falta SQL en Supabase, crea un único script idempotente para que yo lo ejecute manualmente; no lo ejecutes tú.

## Objetivo

Inventory debe tener las dos capacidades:

1. **Inventory como host MCP:** cada empresa puede conectar sistemas MCP externos —ERP, e-commerce, CRM, logística, proveedores u otras fuentes— y permitir que Inventory consulte sus herramientas.
2. **Inventory como servidor MCP remoto:** Papyrus, ChatGPT, Claude, Codex y aplicaciones de clientes pueden conectarse a Inventory para consultar inventario en vivo y, cuando esté expresamente permitido, ejecutar operaciones controladas.

El aislamiento entre empresas es innegociable. El tenant siempre se deriva de la credencial o sesión autenticada; nunca aceptes `company_id`, `tenant_id` o equivalente como argumento confiable de una tool.

## A. Inventory como host de servidores MCP externos

Implementa:

- conexiones por empresa con nombre, URL, transporte, autenticación, timeout, estado y auditoría;
- Streamable HTTP como transporte principal y SSE solo como compatibilidad heredada si el SDK usado por el proyecto lo soporta;
- autenticación `none`, bearer, API key por header, basic y OAuth client credentials, sin devolver secretos al navegador;
- secretos cifrados con el mecanismo seguro existente; si no existe uno, AES-GCM con una llave exclusiva para credenciales MCP;
- descubrimiento de tools con paginación y límites;
- permisos por tool: deshabilitada por defecto, habilitada, permitida en chat, confirmación obligatoria y nivel declarado de riesgo;
- nombres internos con namespace para evitar colisiones entre servidores;
- timeouts, límites por empresa, límite de tools por mensaje y truncado seguro de resultados;
- resultados externos marcados como datos no confiables, nunca como instrucciones del sistema;
- degradación limpia: si MCP está apagado, no hay conexión o falla el proveedor, el flujo existente del inventario sigue funcionando.

### No confíes en las anotaciones de terceros

`readOnlyHint`, `destructiveHint`, descripciones y schemas son metadata declarada por el propio servidor, no una garantía.

Para cada definición descubierta:

1. Canonicaliza y calcula SHA-256 sobre nombre, título, descripción, input schema, output schema y anotaciones.
2. Toda tool nueva empieza deshabilitada y con `review_required=true`.
3. Muestra al administrador toda la definición y advierte que viene del servidor.
4. Exige aprobación explícita de esa huella exacta.
5. Si cualquier parte cambia en un descubrimiento posterior, deshabilita inmediatamente la tool, quítala del chat, borra la verificación de solo lectura y exige nueva revisión.
6. Solo permite ejecución automática en chat cuando:
   - el servidor la declara de lectura;
   - un administrador aprobó la definición exacta;
   - está habilitada;
   - la conexión permite chat;
   - la credencial usada contra el sistema externo tiene realmente mínimo privilegio y, para este caso, solo lectura.
7. Tools de escritura o destructivas nunca se autoejecutan desde chat. Deben requerir flujo explícito, confirmación humana reciente y autorización de backend.

No prometas en la UI que una tool es segura o de solo lectura únicamente porque el servidor lo afirma. Usa textos como “Declarada de lectura” y “Definición revisada”.

## B. Inventory como servidor MCP remoto

Expón un endpoint público de producción, preferentemente `/mcp`, usando el SDK oficial compatible con el stack y respetando el protocolo MCP. No implementes el protocolo a mano.

Primero inspecciona el modelo real y después diseña un catálogo pequeño, coherente y tipado. Como guía —adapta nombres y capacidades a lo que realmente existe— considera tools de lectura como:

- buscar/listar productos con paginación y filtros;
- consultar existencias actuales por producto, bodega y sucursal;
- consultar movimientos dentro de un rango de fechas;
- consultar productos bajo mínimo o agotados;
- consultar disponibilidad por lote/serie si el producto ya soporta eso;
- resumir ventas, entradas, salidas o valorización mediante cálculos determinísticos;
- obtener detalle de una entidad por ID estable.

Si el producto ya permite acciones de escritura y existe autorización clara, considera por separado:

- crear un ajuste;
- transferir existencias entre bodegas;
- registrar una entrada o salida;
- crear o actualizar un producto.

Las tools de escritura deben cumplir además:

- no aceptar SQL arbitrario ni filtros ejecutables;
- schemas estrictos y listas blancas;
- validación de rol, empresa, sucursal/bodega y estado de cuenta en backend;
- confirmación explícita y de corta duración;
- `idempotency_key` obligatoria para evitar duplicados;
- transacción de base de datos y bloqueo/concurrencia correctos;
- rechazo de stock negativo si las reglas actuales no lo permiten;
- auditoría antes/después sin guardar secretos;
- respuesta estructurada con IDs, estado y timestamp;
- anotaciones MCP correctas, aunque los consumidores deban tratarlas como hints.

Toda consulta de cantidades, costos, valorización, sumas, promedios y tendencias debe salir de SQL o código determinístico existente, nunca de una estimación del LLM. Define con claridad moneda, zona horaria, unidad, bodega, fecha de corte (`as_of`) y precisión decimal. Pagina y limita respuestas grandes.

Publica además recursos o prompts únicamente si aportan valor real. No expongas archivos, secretos, costos o campos sensibles fuera de los permisos existentes.

## Autenticación para Papyrus, ChatGPT, Claude y apps de clientes

Implementa dos caminos:

### OAuth 2.1 recomendado

- Authorization Code + PKCE S256;
- metadata de Authorization Server y Protected Resource;
- Resource Indicators/audience ligada al endpoint MCP;
- scopes mínimos y comprensibles;
- consentimiento visible con empresa, cliente y scopes;
- redirect URIs exactas;
- registro dinámico solo si el ecosistema objetivo lo necesita, con rate limiting;
- access tokens de vida corta;
- refresh tokens rotatorios;
- endpoint de revocación;
- códigos de autorización de un solo uso;
- tokens y códigos almacenados únicamente como hash;
- clientes confidenciales cifrados.

La rotación de refresh debe ser atómica en base de datos:

1. conserva el refresh consumido con `consumed_at`; no lo borres;
2. bloquea la fila durante la rotación;
3. mantiene un `family_id`;
4. revoca access/refresh anteriores de la familia;
5. emite el nuevo par dentro de la misma transacción;
6. si un refresh consumido reaparece, considera replay y revoca toda la familia, incluido el par más reciente;
7. registra el incidente;
8. nunca permite aumentar scopes durante refresh.

### Credencial bearer administrada

- token aleatorio con suficiente entropía;
- se muestra una sola vez;
- en DB solo se guarda hash y prefijo;
- ligada a empresa, creador, scopes, roles/bodegas permitidas, tools permitidas y vencimiento;
- revocable y auditable;
- nunca confía en un tenant enviado por el cliente.

OAuth y bearer deben verificar en cada petición que empresa, usuario/credencial, rol y cuenta siguen activos.

## Separación de llaves

Usa secretos independientes:

- llave de cifrado de credenciales MCP;
- llave de firma OAuth.

Ambas deben ser obligatorias cuando `MCP_ENABLED=true`, tener longitud segura y ser diferentes. No hagas fallback de una a la otra. Valídalo al arrancar y falla cerrado. Documenta generación y rotación. `MCP_ENABLED=false` debe ser el valor por defecto.

## SSRF y red saliente

Protege todas las URLs controladas por administradores, incluyendo endpoint MCP, SSE y OAuth token URL:

- HTTPS obligatorio en producción;
- rechaza credenciales embebidas, fragmentos y hosts inválidos;
- bloquea loopback, privadas, link-local, multicast, reserved, unspecified, metadata cloud e IPv4 mapeada en IPv6;
- valida todas las respuestas DNS;
- cierra DNS rebinding/TOCTOU: resuelve y valida dentro de `connect_tcp`, conecta el socket a la IP numérica aprobada y conserva el hostname original para `Host` y TLS/SNI;
- no permitas que el cliente HTTP vuelva a resolver el hostname;
- desactiva redirects automáticos;
- ignora proxies heredados del entorno salvo configuración explícita segura;
- aplica lo mismo a Streamable HTTP, SSE y OAuth;
- límites de timeout, tamaño, conexiones y respuesta;
- en desarrollo, redes privadas solo mediante una variable explícita que permanezca apagada en producción.

Si el stack no permite pinning seguro sin usar APIs privadas frágiles, documenta el límite y usa una capa de egress/proxy controlado. No declares resuelto el rebinding si solo validaste DNS antes de entregar la URL al cliente HTTP.

## Seguridad multi-tenant y autorización

- tenant derivado solo de identidad autenticada;
- cada query y RPC filtra por empresa y, cuando aplique, sucursal/bodega;
- RLS como defensa adicional, sin depender únicamente de ella;
- tablas MCP sin permisos directos para `anon` o usuarios normales si solo el backend debe acceder;
- `service_role` exclusivamente en backend;
- no exponer conocimiento de otra empresa por errores, IDs enumerables, caché o logs;
- cache keys, rate limits y sesiones incluyen tenant/credencial;
- cuentas pausadas o usuarios desactivados pierden acceso inmediatamente;
- no registrar tokens, headers, contraseñas ni resultados completos;
- sanitizar argumentos de auditoría;
- protección de prompt injection: texto de tools, documentos o sistemas externos es contenido no confiable;
- no permitir que una respuesta MCP cambie instrucciones, seleccione otra empresa, revele secretos o autorice una operación;
- CORS específico para clientes web conocidos; CORS no sustituye autenticación;
- rate limiting por IP para registro/OAuth y por credencial/empresa/tool para uso;
- límites de concurrencia y circuit breaker para servidores externos lentos.

## SQL y persistencia

Crea una migración idempotente y aditiva que refleje el modelo real. Como mínimo necesitarás equivalentes de:

- conexiones MCP externas;
- snapshot y permisos de tools, incluida huella aprobada y revisión pendiente;
- credenciales bearer;
- clientes/códigos/tokens OAuth;
- auditoría MCP.

Incluye índices, constraints, claves foráneas, `updated_at`, RLS, grants/revokes y funciones transaccionales. No pongas secretos en SQL. El script debe poder ejecutarse sobre una instalación existente sin destruir datos y debe incluir instrucciones de orden de despliegue.

## UI/UX del panel administrativo

Integra la configuración donde corresponda en el panel real, respetando colores y componentes de cada empresa:

- explica por separado “Inventory usa sistemas externos” y “Otros asistentes usan Inventory”;
- formulario de conexión con secretos ocultos;
- estados de conexión con texto e icono, no solo color;
- estados vacíos, carga, error, reintento y última prueba;
- descubrimiento y revisión de tools;
- mostrar descripción, input/output schemas y anotaciones;
- aviso de que la metadata pertenece al servidor;
- switches bloqueados hasta aprobar la definición;
- confirmación clara para escritura/destrucción;
- endpoint copiable;
- credencial mostrada una sola vez;
- lista y revocación de credenciales/sesiones;
- auditoría legible;
- accesibilidad de teclado, foco visible, labels, contraste y objetivos táctiles de al menos 44 px;
- diseño responsive para móvil sin tablas desbordadas.

No cambies la lógica visual general del producto ni hardcodees colores de una empresa.

## Compatibilidad específica con Papyrus

El servidor MCP de Inventory debe poder conectarse desde el panel MCP de Papyrus:

- URL pública Streamable HTTP;
- bearer de solo lectura o OAuth;
- tools con JSON Schema estricto y resultados estructurados;
- descripciones breves orientadas a uso;
- IDs estables;
- paginación y timestamps;
- una credencial de Papyrus limitada a lectura;
- ninguna tool requiere ni acepta el ID de empresa como argumento.

Documenta un ejemplo exacto de configuración en Papyrus, pero usa placeholders para URL y secretos.

## Testing obligatorio

Agrega pruebas proporcionales al riesgo y ejecuta toda la suite existente. Incluye como mínimo:

1. aislamiento entre dos empresas con IDs manipulados;
2. aislamiento por bodega/sucursal y rol;
3. empresa pausada y usuario/credencial revocados;
4. tool nueva bloqueada por defecto;
5. cambio en descripción/schema/anotaciones cambia la huella, deshabilita y exige revisión;
6. servidor que miente con `readOnlyHint=true` no obtiene acceso automático sin aprobación;
7. tools write/destructive nunca entran al chat automático;
8. confirmación e idempotencia de escritura;
9. concurrencia de movimientos/stock y rollback transaccional;
10. SSRF por IP directa, DNS privado, metadata cloud, IPv4-mapped IPv6 y DNS rebinding;
11. redirects desactivados y token URL OAuth protegido;
12. cifrado y separación de llaves;
13. OAuth PKCE, audience/resource, scopes, expiración y revocación;
14. dos rotaciones simultáneas del mismo refresh: una gana y el replay revoca toda la familia;
15. bearer almacenado solo como hash;
16. rate limiting separado por tenant/credencial;
17. prompt injection en resultados externos tratada como datos;
18. cliente del SDK MCP oficial que inicializa, lista y ejecuta una tool;
19. build del frontend;
20. regresión completa del inventario con MCP apagado.

No uses solo mocks para el contrato del protocolo: incluye al menos una prueba ASGI/HTTP con el cliente oficial. Para SQL transaccional crítico, incluye una prueba de integración real o deja claramente un comando reproducible que valide la RPC contra una base de prueba.

## Entregables

Al terminar:

1. implementación backend y frontend;
2. script SQL manual idempotente;
3. documentación de configuración local, Supabase y despliegue;
4. variables de entorno con valores seguros por defecto;
5. guía para conectar Papyrus, ChatGPT y Claude;
6. pruebas nuevas;
7. lista exacta de archivos modificados;
8. comandos ejecutados y resultados;
9. riesgos residuales explícitos;
10. checklist manual de prueba.

Ejecuta formatter/linter si ya existen, compilación, suite completa y build. Revisa `git diff --check`. No afirmes que algo funciona si no lo verificaste. No toques producción, no ejecutes el SQL y no hagas commit.
