# CI, despliegue y reglas del repo

Un único entorno remoto (producción): local → PR → squash merge a `master` → despliegue automático. La BD efímera de la CI forma parte de los tests: no es un segundo entorno.

## Reglas de `master` (ruleset de GitHub)

- Solo se cambia por PR. Nada de push directo, force push ni borrado.
- Squash merge como único método (historial lineal). La rama se borra al fusionar.
- Checks obligatorios y al día con `master`: `code`, `secrets` y `snyk`.
- Todos los hilos de revisión resueltos, incluidos los de CodeRabbit.
- Sin aprobaciones obligatorias: hay un solo desarrollador, y los checks son el freno.

## Checks de cada PR (`.github/workflows/ci.yml` y `security.yml`)

| Check        | Qué hace                                                                               | Estado                             |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `code`       | `pnpm check`: Prettier, ESLint con tipos, `tsc` y Vitest, vía Turborepo                | ✅ Activo                          |
| `secrets`    | gitleaks sobre todo el historial con `.gitleaks.toml`                                  | ✅ Activo                          |
| `snyk`       | Snyk Open Source (`security.yml`): dependencias de todo el workspace; falla con high+  | ✅ Activo                          |
| `snyk-code`  | Snyk Code (`security.yml`): análisis estático; solo informa, no bloquea                | ✅ Activo (no obligatorio)         |
| `db`         | `supabase db start` → `db reset` → pgTAP → tipos sin cambios → lint de SQL destructivo | Cuando exista la primera migración |
| `evals`      | N1 siempre; N2 si cambian rutas de IA                                                  | Cuando exista el narrador          |
| `judge-gate` | Juez Sonnet 5.5 por Batch, solo con la etiqueta correspondiente (N3)                   | Cuando exista el juez              |
| `cdk-diff`   | `cdk diff` con el rol de solo lectura, publicado como comentario; no bloquea           | Cuando exista el CDK               |

Cada check nuevo se añade al ruleset como obligatorio en la misma PR que lo activa.

## Servicios externos

Los dos están en su capa gratuita.

### CodeRabbit (revisión de PR)

- App de GitHub instalada solo en este repo. Es gratis en repos públicos y la configuración está en `.coderabbit.yaml`.
- Revisa en inglés (como las PR) con el perfil `chill`. Ignora `pnpm-lock.yaml`, los tipos generados (`database.types.ts`), `dist`, `.turbo` y los snapshots. Tiene instrucciones por ruta para `packages/db`, el narrador y `evals`, `infra`, `services` y `.github`.
- Usa como guías `AGENTS.md`, `.claude/rules/*.md` y `docs/*.md`, además de los ficheros que lee por defecto (como `CLAUDE.md`).
- **No bloquea por sí mismo**: su commit status no es obligatorio y no pide cambios. Lo que sí obliga es el ruleset: hay que resolver sus hilos antes de fusionar. Si CodeRabbit no llega a revisar (límites o caída), la PR se puede fusionar igual.
- En la PR se le habla con `@coderabbitai` (por ejemplo `@coderabbitai review` o `@coderabbitai resolve`).

### Snyk (vulnerabilidades)

- CLI en Actions (`.github/workflows/security.yml`), sin la app de GitHub. El escaneo por la app no admite el protocolo `workspace:` y la capa gratuita tiene un tope de 5 proyectos.
- El binario de la CLI se descarga con el SHA-256 fijado en el workflow. Para actualizarlo, se cambian `SNYK_VERSION` y `SNYK_SHA256` con el valor de `https://downloads.snyk.io/cli/v<versión>/snyk-linux.sha256`, respetando el día de margen de `minimumReleaseAge`.
- Se ejecuta en cada PR, en cada push a `master`, cada lunes (para los CVE publicados después del merge) y a mano.
- `snyk`: `snyk test --all-projects --dev --fail-fast --severity-threshold=high`. Incluye las `devDependencies`, porque casi todo el repo es herramienta de build y test, y falla si algún proyecto no se puede analizar. Lee `pnpm-lock.yaml` (lockfile 9.x) y es **obligatorio**.
- `snyk-code`: `snyk code test` en modo informativo. Solo falla por errores reales (código de salida 2 o 3), no por hallazgos. **Pendiente: volverlo bloqueante** cuando haya código de verdad. Pasos: añadir `--severity-threshold=high`, quitar `|| [ $? -eq 1 ]` y añadir `snyk-code` al ruleset.
- Resultados:
  - En el log del job.
  - En **Security → Code scanning**, por SARIF. Los de dependencias van en una categoría por proyecto del workspace (`Snyk/Open Source/<paquete>`); los de código, en `Snyk/Code`.
- Secrets de Actions: `SNYK_TOKEN` y `SNYK_ORG`, el ID de la organización de Snyk. `SNYK_ORG` va como secret y no como variable para que no salga en los logs públicos; sin él, Snyk Code responde `SNYK-CODE-0005`. Las PR de forks no lo reciben, así que su check `snyk` falla. Es intencionado: una PR externa no puede saltarse el check.
- Ignorar un hallazgo: en `.snyk`, siempre con motivo y fecha de caducidad (`snyk ignore --id=… --reason=… --expiry=…`).
- Límites gratuitos: según la documentación de Snyk, solo se aplican a repos privados. En privado, Snyk Code tiene 100 tests al mes y cuenta uno por repositorio escaneado; Open Source cuenta un test por manifiesto analizado. Si el check empieza a fallar por cuota, hay que mirar el uso en snyk.io (Settings → Usage).

## Seguridad del repo público

- Ningún workflow usa `pull_request_target`. Las PR de forks no reciben secretos ni asumen roles: la confianza OIDC se limita a este repo y a sus ramas.
- Las actions se fijan por SHA (Dependabot las mantiene). Solo se permiten las de GitHub y las de la lista blanca.
- `permissions: contents: read` por defecto. Cada job pide solo lo que usa.
- Tres capas contra fugas: gitleaks en pre-commit, gitleaks en CI, y secret scanning con push protection de GitHub.

## Despliegue (pendiente: fase de esqueleto)

`deploy.yml` en cada push a `master`, con `concurrency: prod` y sin cancelar el que está en curso:

1. Espera si está dentro de la ventana sin despliegues, de 22:30 a 00:00 Europe/Madrid (`isDeployFrozen` de `@cronista/core`).
2. Tests rápidos.
3. Volcado de la BD al bucket privado de copias.
4. `supabase db push --dry-run` y, si cuadra, `supabase db push`.
5. `cdk deploy --all --require-approval never` (por change set; nunca `--hotswap`).
6. Canary de Lambda con un hook previo al tráfico.
7. Prueba de humo contra `cronista.jcvstro.dev`.

Si el fallo aparece después, `git revert` vuelve a desplegar. En la BD solo hay migraciones hacia delante.

## Roles OIDC de AWS (pendiente)

| Rol          | Confía en                       | Permisos                                              |
| ------------ | ------------------------------- | ----------------------------------------------------- |
| Solo lectura | `pull_request` de este repo     | `cdk diff` y lectura del prefijo de datasets privados |
| Despliegue   | Solo `ref:refs/heads/master`    | Despliegue de CDK                                     |
| Copias       | Workflow programado en `master` | Escritura en el prefijo de copias de S3               |

Los repos creados después del 15-07-2026 usan un `sub` con IDs inmutables (`repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:…`), así que la política de confianza se escribe con IDs, no con nombres.
