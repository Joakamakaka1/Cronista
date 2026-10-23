# Cronista

PWA privada para 5 amigos: cada día cada jugador manda una acción y a las 23:00 (Europe/Madrid) un narrador de IA las resuelve todas y publica un capítulo. **El repositorio es público**: lee la sección de secretos antes de nada.

## Arquitectura en 10 líneas

1. TypeScript de punta a punta, en un monorepo con pnpm workspaces y Turborepo.
2. Front `apps/web`: SvelteKit estático (provisional hasta el spike visual), servido desde S3 privado por CloudFront (plan flat-rate) con WAF.
3. API `services/*`: Lambdas Node 24 arm64 con Function URL detrás de CloudFront + OAC. El JWT de Supabase llega en `X-Session-Token` y se verifica con JWKS.
4. Lambdas: `api` (acciones), `push` (Web Push por cola SQS), `scheduler` (recordatorios) y `resolver` (cierre diario, idempotente por temporada y día).
5. Datos: Supabase Postgres en eu-west-1 con RLS en todas las tablas. Memoria RAG en pgvector con búsqueda híbrida + RRF y embeddings de Voyage.
6. IA en `packages/narrator`: AI SDK 7 con versiones exactas. Haiku 5.5 narra y Sonnet 5.5 juzga (por Batch). Trazas en Langfuse Cloud UE.
7. Dominio y esquemas Zod compartidos en `packages/core`; migraciones, pgTAP y tipos generados en `packages/db`.
8. Infraestructura con CDK en `infra` (eu-west-1, más us-east-1 para lo global). Secretos en SSM `/cronista/prod/`.
9. Un solo entorno remoto (producción). En local se usa `supabase start`, y la CI levanta una BD efímera.
10. Evaluación en `evals` (promptfoo + jueces propios). Los gates de cada PR son el único freno antes de producción.

Más detalle en [`docs/`](docs/).

## Comandos

```powershell
pnpm install          # also enables the gitleaks pre-commit hook
pnpm check            # lint + typecheck + test (what CI runs)
pnpm lint             # ESLint
pnpm format           # Prettier (write)
pnpm typecheck        # tsc --noEmit in every package
pnpm test             # Vitest
pnpm --filter @cronista/core test   # a single package
```

## Convenciones

- **Idioma**: código, identificadores, commits y comentarios en inglés. Documentación, interfaz y prompts del narrador en español.
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y `verbatimModuleSyntax`. Solo ESM. Toda entrada externa (HTTP, salida del LLM, JSON de la BD) se valida con Zod.
- **Commits**: Conventional Commits (`feat(narrator): …`). Una PR es un commit squash en `master`. Ramas `tipo/descripcion-corta`.
- **Dependencias**: versión exacta, sin `^`. El AI SDK solo se actualiza si pasan los evals.
- **Ficheros**: siempre LF (`.gitattributes`). Los scripts del repo se escriben en TypeScript para Node, nunca en bash ni en PowerShell. Excepción: los hooks de git.
- **Migraciones**: patrón expand/contract. `DROP`, `RENAME` y `ALTER … TYPE` solo en una PR aparte con la etiqueta `contract`.
- **RLS**: en todas las tablas. Políticas con `(select auth.uid())` y `TO authenticated`. Cada política lleva su prueba pgTAP, incluidos los casos que deben fallar.
- **Despliegue**: automático al hacer merge en `master`. Nunca de 22:30 a 00:00 (Europe/Madrid), para no pisar la resolución de las 23:00.

## Secretos y datos de los jugadores (reglas duras)

- En el repo **nunca** entran: claves, tokens, contraseñas, ficheros `.env`, volcados de BD, la biblia con datos reales, partidas reales, nombres o emails de los jugadores, etiquetas del juez, el ID de la cuenta AWS ni IDs de recursos privados. Su sitio es SSM, `%USERPROFILE%\.secrets\cronista\` o el bucket privado. El ID de cuenta y los ARN llegan por variables de GitHub Actions o del entorno.
- Los secretos locales están en `%USERPROFILE%\.secrets\cronista\.env` (ruta configurable con `CRONISTA_ENV_FILE`). Ese fichero no se lee, no se imprime y no se copia.
- Un secreto no se imprime nunca, ni en el chat ni en los logs: nada de `--with-decryption`, ni de hacer `echo` de variables con claves. Para comprobar que un parámetro existe: `aws ssm describe-parameters`.
- Si el usuario tiene que introducir un secreto, se le da un comando con `Read-Host -AsSecureString`. El valor no pasa nunca por el chat.
- Fixtures, seed y temporada simulada: personajes inventados y emails `@example.com`.
- Si gitleaks bloquea un commit, se quita el dato. **Nunca** se usa `--no-verify` ni se amplía `.gitleaks.toml` sin preguntar.
- Son públicos por diseño, porque van en el bundle web: la URL y la clave publicable de Supabase, y la public key de Langfuse.

## Pide confirmación antes de

`cdk deploy`/`destroy`, `supabase db push`, `aws ssm put-parameter`/`get-parameter`, cualquier `git push`, y crear recursos con coste o hacer acciones irreversibles. Las reglas están en `.claude/settings.json`.

## Antes de tocar X, lee Y

| Si tocas… | Lee antes… |
|---|---|
| `packages/db` (SQL, RLS, migraciones) | `docs/arquitectura.md` (datos) y la skill `supabase-postgres-best-practices` |
| `packages/narrator`, prompts o `evals` | `docs/arquitectura.md` (IA) y la skill `claude-api`; ejecuta los evals |
| `infra` o `services/*` | `docs/arquitectura.md` (infraestructura) |
| `.github/workflows`, despliegue o reglas de ramas | `docs/entrega.md` |
| Entorno local o secretos | `docs/desarrollo.md` |
