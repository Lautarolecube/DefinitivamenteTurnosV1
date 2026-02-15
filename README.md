# Helpcenter + Turnos (MVP)

## Run
- Backend: `cd backend && npm install && npm start`
- Front: abrir `V6 - prueba nueva logica.html` en navegador
- Admin: abrir `admin.html`

## Catálogo y servicios
Los servicios se definen en `backend/db.js` dentro de `ServiceCatalog`.
Para agregar un tratamiento:
- Crear un `service_key` único (ej: `mesoterapia_facial`)
- Completar `category`, `technology_key`, `duration_min`
- Si requiere evaluación previa, setear `requires_eval = 1`
- Asignar `default_min_pack_sessions` y `default_min_interval_days`
- Definir `allowed_professional_ids` con IDs de `Professional`

## Profesionales y skills
Los profesionales se definen en `backend/db.js` dentro de `Professional`.
- `skills` acepta una lista de `service_key` permitidos
- El front filtra profesionales con `allowed_professional_ids` por servicio

## Packs / productos
Los packs se definen en `backend/db.js` dentro de `PackProduct`.
- `pack_sessions_total` define el total de sesiones
- `deposit_required` y `deposit_amount` controlan la seña
- `payment_methods` define métodos aceptados

## Gatekeeping Turnito
El iframe de Turnito solo se abre si el backend genera URL:
- `POST /api/turnito/link` valida:
  - tratamiento activo del paciente
  - sesiones disponibles
  - paciente no bloqueado
  - intervalo mínimo entre sesiones
  - seña confirmada (MVP: `deposit_confirmed=true`)
  - no permite tratamientos que requieren evaluación
- `POST /api/turnito/link-eval` solo para evaluación (Ultherapy/PRP/Criolipólisis)

## Consumo y vencimientos (P1)
El webhook está implementado en `POST /api/webhooks/turnito` con reglas básicas:
- al crear turno `scheduled`, generar `SessionLedger` con `expires_at = scheduled_at + 30 días`
- si `completed` consume sesión
- si `expired` consume sesión (Opción B)
- cancelación tardía penaliza según reglas de negocio (depilación < 12h, médica < 24h)
- `no_show` consume sesión y bloquea paciente al segundo evento

## Nota sobre base de datos
Se usa SQLite en `backend/data/helpcenter.db`.  
Para reiniciar datos, borrar el archivo `helpcenter.db` y reiniciar el backend.
