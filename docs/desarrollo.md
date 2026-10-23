# Desarrollo local

Entorno: Windows nativo con PowerShell. WSL solo queda como respaldo.

## Requisitos

| Herramienta    | Versión                    | Instalación                                                |
| -------------- | -------------------------- | ---------------------------------------------------------- |
| Node.js        | 24.x (`.node-version`)     | Instalador oficial                                         |
| pnpm           | 11.17.0 (`packageManager`) | Independiente, sin corepack                                |
| gitleaks       | 8.30+                      | `scoop install gitleaks` (sin él no se puede hacer commit) |
| Supabase CLI   | 2.x                        | `scoop install supabase`                                   |
| AWS CLI        | 2.32+                      | Perfil `la-cronica`, `aws login`                           |
| Docker Desktop |                            | Para `supabase start`                                      |

## Primer arranque

```powershell
git clone https://github.com/Joakamakaka1/cronista.git
cd cronista
pnpm install        # el script `prepare` activa .githooks (gitleaks en pre-commit)
pnpm check
```

Los commits del repo usan el email noreply de GitHub, configurado solo en este repo:

```powershell
git config user.email "129002508+Joakamakaka1@users.noreply.github.com"
```

## Secretos en local

- Están **fuera del repo**, en `%USERPROFILE%\.secrets\cronista\.env` (ACL solo para tu usuario).
- Para usar otra ruta, pon `CRONISTA_ENV_FILE` con la ruta completa.
- No existe `.env.example`: los nombres de las variables se documentan aquí a medida que el código las necesite.
- Para añadir o cambiar un valor, sin que pase por la pantalla ni por el historial de PowerShell:

```powershell
$s = Read-Host -AsSecureString "Valor"
$plain = [System.Net.NetworkCredential]::new('', $s).Password
aws ssm put-parameter --profile la-cronica --type SecureString --overwrite --name "/cronista/prod/<servicio>/<clave>" --value $plain
Remove-Variable plain, s
```

- En SSM (producción) se comprueba que un parámetro existe sin descifrarlo:

```powershell
aws ssm describe-parameters --profile la-cronica --parameter-filters "Key=Name,Option=BeginsWith,Values=/cronista/prod/"
```

## Supabase local

Las migraciones y la configuración de la CLI viven en `packages/db/supabase` (se crean en la fase de esqueleto):

```powershell
supabase start --workdir packages/db
supabase db reset --workdir packages/db
```

## Qué nunca se sube

Lo bloquean `.gitignore` y gitleaks, pero la regla está por encima de las herramientas:

- Secretos de cualquier tipo, `.env`, claves y certificados.
- Volcados de la BD, partidas reales, la biblia con datos reales y etiquetas del juez.
- Nombres y emails reales de los jugadores. En fixtures y seeds: personajes inventados y `@example.com`.
