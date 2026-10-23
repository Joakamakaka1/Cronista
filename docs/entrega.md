# CI, despliegue y reglas del repo

Un único entorno remoto (producción): local → PR → squash merge a `master` → despliegue automático. La BD efímera de la CI forma parte de los tests: no es un segundo entorno.

## Reglas de `master` (ruleset de GitHub)

- Solo se cambia por PR. Nada de push directo, force push ni borrado.
- Squash merge como único método (historial lineal). La rama se borra al fusionar.
- Checks obligatorios y al día con `master`: `code` y `secrets`.
- Sin aprobaciones obligatorias: hay un solo desarrollador, y los checks son el freno.

## Checks de cada PR (`.github/workflows/ci.yml`)

| Check        | Qué hace                                                                               | Estado                             |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `code`       | `pnpm check`: Prettier, ESLint con tipos, `tsc` y Vitest, vía Turborepo                | ✅ Activo                          |
| `secrets`    | gitleaks sobre todo el historial con `.gitleaks.toml`                                  | ✅ Activo                          |
| `db`         | `supabase db start` → `db reset` → pgTAP → tipos sin cambios → lint de SQL destructivo | Cuando exista la primera migración |
| `evals`      | N1 siempre; N2 si cambian rutas de IA                                                  | Cuando exista el narrador          |
| `judge-gate` | Juez Sonnet 5.5 por Batch, solo con la etiqueta correspondiente (N3)                   | Cuando exista el juez              |
| `cdk-diff`   | `cdk diff` con el rol de solo lectura, publicado como comentario; no bloquea           | Cuando exista el CDK               |

Cada check nuevo se añade al ruleset como obligatorio en la misma PR que lo activa.

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
