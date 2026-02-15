# Edge Functions — Booking Engine

## Requisitos en base de datos

- **profesionales**: columna `google_calendar_id` (text) con el ID del calendario de Google del profesional.
- **servicios_items**: columnas `duracion_minutos` (integer), `monto_sena` (numeric), `nombre` (text, opcional para el título del ítem en MP).

Si tu schema actual usa otras tablas (ej. `tratamientos_catalogo`), puedes crear vistas o adaptar los nombres en el código de las funciones.

---

## TAREA 1: Configuración del entorno

### deno.json por función (recomendado por Supabase)

Cada función tiene su propio `deno.json` con las dependencias que usa:

- **get-availability**: `@supabase/supabase-js`, `googleapis` (Google Calendar).
- **create-preference**: `@supabase/supabase-js` (Mercado Pago vía REST, sin SDK npm).

Así se mantiene aislamiento y despliegues correctos. Para desarrollo local con CLI puedes usar un único `deno.json` en `supabase/functions` si lo prefieres (mismo formato `imports`).

### CORS

Ambas funciones responden con estos headers en todas las respuestas (incluido OPTIONS):

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Access-Control-Max-Age: 86400`

Desde tu frontend (`index.html` o SPA) puedes llamar con `fetch` a:

- `POST https://<PROJECT_REF>.supabase.co/functions/v1/get-availability`
- `POST https://<PROJECT_REF>.supabase.co/functions/v1/create-preference`

Si quieres restringir orígenes, cambia `*` por tu dominio (ej: `https://tu-dominio.com`).

### Variables de entorno / Secrets

Configura en Supabase (Dashboard → Project Settings → Edge Functions → Secrets) o con CLI:

```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'
supabase secrets set MP_ACCESS_TOKEN=APP_USR-...
```

Opcionales:

- `BOOKING_BACK_URL_BASE`: base para `back_urls` (ej: `https://tu-sitio.com`). Por defecto `https://tu-sitio.com`.
- `MP_WEBHOOK_URL`: URL de tu webhook para notificaciones de pago (para Etapa 3).

---

## get-availability

- **Método:** POST  
- **Body:** `{ "professional_id": "uuid", "service_item_id": "text", "date": "YYYY-MM-DD" }`  
- **Respuesta:** `{ "slots": ["09:00", "09:30", "15:00"] }`  
- **Lógica:** Lee `google_calendar_id` y `duracion_minutos`, consulta freebusy en Google Calendar (08:00–21:00), genera slots cada 30 min solo donde quepa la duración del servicio.

---

## create-preference

- **Método:** POST  
- **Body:** `{ "professional_id", "service_item_id", "date", "time", "client_data" }`  
- **Respuesta:** `{ "init_point": "https://www.mercadopago.com.ar/...", "preference_id": "..." }`  
- **Lógica:** Obtiene `monto_sena` de `servicios_items`, crea preferencia en Mercado Pago, guarda en `external_reference` un JSON con los datos de la reserva (para el webhook).

---

## mercadopago-webhook

- **Método:** POST (notificaciones de Mercado Pago).
- **Trigger:** MP envía `{ "type": "payment", "data": { "id": "<payment_id>" } }`.
- **Lógica:** Si el pago está aprobado, lee `external_reference`, obtiene `duracion_minutos` del servicio, crea evento en Google Calendar (zona Argentina), inserta en `agenda_turnos` con `estado_pago: 'confirmado'`, `mp_payment_id`, `google_event_id`, `monto_sena`.
- **Respuesta:** Siempre `200` para que MP no reintente (errores se registran en `console.error`).
- **Idempotencia:** Si ya existe un turno con el mismo `mp_payment_id`, no se vuelve a insertar.
- **Recomendado:** Configurar `SUPABASE_SERVICE_ROLE_KEY` como secret para que el insert en `agenda_turnos` no sea bloqueado por RLS. En la app de MP, configurar la URL del webhook apuntando a esta función.
