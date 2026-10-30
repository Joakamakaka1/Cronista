# apps/web

Front de Cronista: una PWA en SvelteKit estático (adapter-static), servida desde S3 por CloudFront.

Pendiente del **spike visual** (ADR-15), que decide entre CSS/SVG con Motion o con GSAP. El proyecto se crea con `sv create` al empezar el spike, junto con `eslint-plugin-svelte` y `prettier-plugin-svelte`.

## Página provisional

Hasta el spike, `placeholder/` es lo que sirve `cronista.jcvstro.dev`: una portada y la página «Probar conexión», en HTML, CSS y JS sin dependencias ni build. `CronistaEdge` la sube al bucket con `BucketDeployment` en cada `cdk deploy`.

«Probar conexión» comprueba la cadena entera tal como la usará la app:

- Inicia sesión con Google redirigiendo a Supabase Auth, que devuelve el token en el fragmento de la URL. La página lo borra de la barra de direcciones y solo lo guarda en memoria. Supabase solo vuelve a la página si `https://cronista.jcvstro.dev/**` está entre sus URLs de redirección (Authentication → URL Configuration).
- Llama a `core-api` y `ai-api` con el JWT en `X-Session-Token` y, en cada POST, el SHA-256 del cuerpo en `x-amz-content-sha256`, que exige el OAC de CloudFront.
- Respuestas esperadas: 401 sin sesión, 200 en `/api/me`, 501 con una acción válida, 400 con una de 1001 caracteres y 501 en `/api/ai/hint`. Un 503 en la pista significa que faltan claves de los proveedores en SSM.

La CSP (`script-src 'self'`) no admite scripts inline: todo el JS va en `check.js`. Turbo no lo lintea, porque `apps/web` aún no es un paquete; Prettier sí lo formatea.
