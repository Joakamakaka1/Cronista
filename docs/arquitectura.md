# Arquitectura

Resumen del documento de arquitectura (privado). Aquí solo está lo que hace falta para trabajar en el código.

## Piezas

| Pieza             | Dónde                | Tecnología                                                                       |
| ----------------- | -------------------- | -------------------------------------------------------------------------------- |
| Front (PWA)       | `apps/web`           | SvelteKit estático, provisional hasta el spike visual (ADR-15)                   |
| API de acciones   | `services/api`       | Lambda Node 24 arm64 + Function URL, detrás de CloudFront con OAC                |
| Avisos push       | `services/push`      | Lambda alimentada por SQS, Web Push con VAPID (ADR-16)                           |
| Recordatorios     | `services/scheduler` | Lambda lanzada por EventBridge Scheduler a T-3 h y T-1 h del cierre              |
| Resolución diaria | `services/resolver`  | Lambda a la hora de cierre, idempotente por (temporada, día)                     |
| Dominio           | `packages/core`      | Tipos, esquemas Zod y reglas de calendario; sin dependencias de Node             |
| Narrador          | `packages/narrator`  | AI SDK 7 + Claude Haiku 5.5, memoria RAG, herramientas y presupuesto de contexto |
| Base de datos     | `packages/db`        | Migraciones de Supabase, pruebas pgTAP y tipos generados                         |
| Infraestructura   | `infra`              | AWS CDK (eu-west-1 + us-east-1)                                                  |
| Evaluación        | `evals`              | promptfoo, datasets y jueces (Sonnet 5.5)                                        |

## Flujos

1. **Jugar**: el móvil envía la acción a `/api/*` → CloudFront firma la petición hacia la Function URL → la Lambda `api` verifica el JWT de Supabase (cabecera `X-Session-Token`, JWKS ES256), valida con Zod, guarda y encola «X ha jugado» → `push` avisa a los demás.
2. **Recordar**: Scheduler dispara `scheduler` a T-3 h y T-1 h del cierre, y se avisa solo a quien falta.
3. **Resolver**: a las 23:00 (Europe/Madrid) `resolver` aplica el piloto automático a los ausentes → narrador → validación en código → capítulo y puntos → extracción de memoria → aviso «Capítulo publicado».

El móvil solo habla directamente con Supabase para iniciar sesión, leer con RLS y recibir eventos en vivo. Todo lo demás pasa por CloudFront.

## Datos

- Supabase Postgres 17 en eu-west-1, plan Free. Se mantiene vivo con un keep-alive y hay un volcado nocturno cifrado en S3.
- RLS en todas las tablas, con los permisos por defecto revocados. Autorización por `app_metadata`, nunca por `user_metadata`.
- Funciones `security definer` con `search_path = ''`, fuera de los esquemas expuestos. Vistas con `security_invoker = true`.
- Memoria: «momentos» atómicos en pgvector con búsqueda híbrida (vector + texto) fusionada por RRF. Embeddings `voyage-4` para documentos y `voyage-4-lite` para consultas.
- El **estado canónico manda sobre la memoria**: lo que diga la BD prevalece sobre lo que recuerde el narrador.

## IA

- Narrador: Haiku 5.5 vía `@ai-sdk/anthropic`, con versiones exactas. Se recuenta el contexto antes de cada llamada, con un tope de 85k tokens (por encima de 100k el precio se multiplica).
- Recuperación mixta: un paquete fijo + top-k + 3 herramientas con tope de llamadas. Las mismas herramientas se exponen como servidor MCP local para Claude Code.
- Nunca se pide un campo «reasoning» en el JSON de salida. Si el clasificador rechaza una respuesta, se usa un fallback narrativo.
- Presupuesto: libro de gasto propio por ciclo de créditos, y tres workspaces de la Claude Console (`game-prod`, `evals` y `dev`) con límites como red de seguridad.

## Infraestructura y seguridad

- Solo CloudFront es público: plan flat-rate gratuito con WAF de 5 reglas. S3 y las Function URLs solo aceptan peticiones firmadas por la distribución.
- Las cabeceras de seguridad (CSP, HSTS…) se ponen con una CloudFront Function de respuesta.
- Un rol IAM mínimo por Lambda. Secretos en SSM Parameter Store (`SecureString`, `/cronista/prod/…`), leídos con la extensión de Lambda. Nunca en variables de entorno en claro.
- El ID de la cuenta AWS y los IDs de recursos no van en el repo: el CDK los toma del entorno (`CDK_DEFAULT_ACCOUNT`) o de búsquedas.

## Código

- Los paquetes internos exportan su TypeScript fuente (`exports: ./src/index.ts`) y no tienen paso de compilación. Las Lambdas se empaquetan con esbuild (CDK `NodejsFunction`) y la web con Vite. Los scripts y el CDK se ejecutan con el soporte nativo de TypeScript de Node 24, de ahí `erasableSyntaxOnly` y las importaciones relativas con extensión `.ts`.
- `packages/core` no puede depender de Node ni de AWS: también se usa en el navegador.
