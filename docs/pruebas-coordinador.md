# Próximos Pasos: Pruebas y Testeo del Coordinador Bot-Chatwoot

**Rama:** `coordinador-bot-chat`  
**Fecha:** 2025-02-15  

---

## Pre-requisitos para pruebas

### 1. Build y deploy

```bash
# En el servidor/container
cd /path/to/evolution-api
git checkout coordinador-bot-chat
npm run build
```

### 2. Migración de base de datos

```sql
-- Ejecutar en PostgreSQL de Evolution API
ALTER TABLE "Chatwoot" ADD COLUMN "coordinationSettings" JSONB;
```

### 3. Variables de entorno

Para las primeras pruebas, dejar los defaults (no agregar nada al .env = coordinación completa activada).

### 4. Verificar configuración de instancia

Antes de testear, confirmar que la instancia tiene:

| Setting | Valor | Dónde |
|---------|-------|-------|
| `reopenConversation` | `false` | Chatwoot config en Evolution API |
| `conversationPending` | `true` | Chatwoot config en Evolution API |
| `keepOpen` | `false` | Typebot bot config |
| `expire` | `30` | Typebot bot config |
| `stopBotFromMe` | `true` | Typebot bot config |

---

## Plan de pruebas

### Fase 1: Verificación básica (sin configuración extra)

#### Test 1.1 — Flujo completo del bot
**Objetivo:** Verificar que el bot responde normalmente cuando no hay agente asignado.

1. Enviar mensaje al número de WhatsApp conectado
2. Verificar que Typebot inicia y responde
3. Completar el flujo del bot hasta el final

**Resultado esperado:**
- Bot responde correctamente
- En Chatwoot aparece la conversación con mensajes del bot
- Al terminar el flujo, la conversación en Chatwoot se resuelve automáticamente

**Verificar en logs:**
```
[Coordination] Resolved Chatwoot conversation XXX for YYYY (bot flow completed)
```

#### Test 1.2 — Auto-pausa por agente
**Objetivo:** Verificar que el bot se pausa cuando un agente responde desde Chatwoot.

1. Enviar mensaje → bot inicia conversación
2. **Antes de que termine el flujo**, ir a Chatwoot y responder como agente
3. Enviar otro mensaje desde WhatsApp

**Resultado esperado:**
- El bot se pausa al detectar la respuesta del agente
- Los mensajes siguientes del usuario NO son respondidos por el bot
- En Chatwoot, el agente puede conversar normalmente

**Verificar en logs:**
```
[Coordination] Paused X bot session(s) for YYYY - human agent responded from Chatwoot
```

#### Test 1.3 — Check de agente en emit()
**Objetivo:** Verificar que el bot no procesa si ya hay un agente asignado.

1. En Chatwoot, asignar un agente a una conversación existente (sin que el agente haya respondido)
2. Enviar mensaje desde WhatsApp

**Resultado esperado:**
- El bot detecta el agente asignado y NO responde
- La sesión del bot se pausa

**Verificar en logs:**
```
[Coordination] Conversation XXX has human agent assigned (status: open), bot should not process
[TypebotController] Paused bot session YYY due to human agent
```

#### Test 1.4 — Verificar endpoint /chatbot/manage/status
**Objetivo:** Confirmar que el endpoint devuelve la configuración actual.

```bash
curl -X GET \
  'https://evolutionapi.mdsoluciones.ar/chatbot/manage/status/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY'
```

**Resultado esperado:**
```json
{
  "status": "ok",
  "integration": "chatbot-chatwoot-coordination",
  "instance": "NOMBRE_INSTANCIA",
  "coordination": {
    "checkAgent": true,
    "autoPause": true,
    "autoResolve": true,
    "manageEnabled": true
  }
}
```

---

### Fase 2: Probar acciones del endpoint /chatbot/manage

#### Test 2.1 — Transfer to human
**Objetivo:** Typebot puede derivar a humano vía HTTP Request.

```bash
curl -X POST \
  'https://evolutionapi.mdsoluciones.ar/chatbot/manage/action/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "transfer_human",
    "remoteJid": "5491155551234@s.whatsapp.net"
  }'
```

**Resultado esperado:**
- Session del bot se pausa
- Conversación en Chatwoot pasa a estado "open"
- Respuesta: `{ "success": true, "message": "Paused X bot session(s), Chatwoot updated: true" }`

#### Test 2.2 — Transfer con asignación de agente/equipo

```bash
curl -X POST \
  'https://evolutionapi.mdsoluciones.ar/chatbot/manage/action/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "transfer_human",
    "remoteJid": "5491155551234@s.whatsapp.net",
    "assigneeId": 42,
    "teamId": 5
  }'
```

**Nota:** Obtener IDs de agentes y equipos desde Chatwoot API:
```bash
# Agentes
curl 'https://conectarba.mdsoluciones.ar/api/v1/accounts/34/agents' \
  -H 'api_access_token: TOKEN_CHATWOOT'

# Equipos
curl 'https://conectarba.mdsoluciones.ar/api/v1/accounts/34/teams' \
  -H 'api_access_token: TOKEN_CHATWOOT'
```

#### Test 2.3 — Pause, Resume, Resolve

```bash
# Pausar bot
curl -X POST '.../chatbot/manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "pause_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'

# Resumir bot (reactivar sesión pausada)
curl -X POST '.../chatbot/manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "resume_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'

# Resolver bot + cerrar conversación Chatwoot
curl -X POST '.../chatbot/manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "resolve_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'
```

---

### Fase 3: Probar configuración por env vars

#### Test 3.1 — Desactivar checkAgent

```bash
# En .env
CHATBOT_COORDINATION_CHECK_AGENT=false
```

Reiniciar servicio. Repetir Test 1.3.

**Resultado esperado:** El bot responde AUNQUE haya un agente asignado en Chatwoot.

#### Test 3.2 — Desactivar autoPause

```bash
# En .env
CHATBOT_COORDINATION_AUTO_PAUSE=false
```

Reiniciar servicio. Repetir Test 1.2.

**Resultado esperado:** El bot NO se pausa cuando el agente responde desde Chatwoot. Ambos coexisten.

#### Test 3.3 — Desactivar autoResolve

```bash
# En .env
CHATBOT_COORDINATION_AUTO_RESOLVE=false
```

Reiniciar servicio. Repetir Test 1.1.

**Resultado esperado:** Al terminar el flujo del bot, la conversación en Chatwoot NO se resuelve automáticamente.

#### Test 3.4 — Desactivar manageEnabled

```bash
# En .env
CHATBOT_COORDINATION_MANAGE_ENABLED=false
```

Reiniciar servicio. Repetir Test 2.1.

**Resultado esperado:** El endpoint devuelve `{ "error": "Manage endpoint is disabled for this instance", "status": "disabled" }`.

---

### Fase 4: Probar override per-instance

#### Test 4.1 — Override de una instancia

```sql
-- Desactivar checkAgent solo para esta instancia
UPDATE "Chatwoot" SET "coordinationSettings" = '{"checkAgent": false}'
WHERE "instanceId" = 'ID_DE_TU_INSTANCIA';
```

**No requiere reinicio.** Verificar con GET `/chatbot/manage/status/INSTANCIA`:

```json
{
  "coordination": {
    "checkAgent": false,        // ← override de instancia
    "autoPause": true,          // ← default global
    "autoResolve": true,        // ← default global
    "manageEnabled": true       // ← default global
  }
}
```

#### Test 4.2 — Modo coexistencia per-instance

```sql
UPDATE "Chatwoot" SET "coordinationSettings" = '{"checkAgent": false, "autoPause": false, "autoResolve": false}'
WHERE "instanceId" = 'ID_DE_TU_INSTANCIA';
```

Enviar mensajes y verificar que el bot responde aunque haya agente asignado.

#### Test 4.3 — Resetear override (volver a defaults globales)

```sql
UPDATE "Chatwoot" SET "coordinationSettings" = NULL
WHERE "instanceId" = 'ID_DE_TU_INSTANCIA';
```

---

### Fase 5: Integración con Typebot (HTTP Request blocks)

#### Test 5.1 — Flujo Typebot con derivación a humano

Crear un flujo en Typebot que incluya:

1. Saludo → pregunta al usuario
2. Si el usuario elige "Hablar con humano" → bloque HTTP Request:
   ```
   POST https://evolutionapi.mdsoluciones.ar/chatbot/manage/action/INSTANCIA
   Headers: apikey: TU_API_KEY
   Body: {"action": "transfer_human", "remoteJid": "{{remoteJid}}"}
   ```
3. Mensaje de despedida: "Te estamos derivando con un agente..."

**Resultado esperado:**
- Bot se pausa
- En Chatwoot la conversación queda abierta para que un agente la tome
- El usuario no recibe más mensajes del bot

#### Test 5.2 — Flujo completo con resolución

Crear un flujo Typebot que termine naturalmente (sin más inputs).

**Resultado esperado:**
- Bot completa el flujo
- Conversación en Chatwoot se resuelve automáticamente
- Si el usuario vuelve a escribir, se inicia una nueva sesión del bot

---

## Checklist de verificación rápida

```
[ ] Build exitoso (npm run build)
[ ] Migración DB aplicada (coordinationSettings column)
[ ] GET /chatbot/manage/status devuelve config correcta
[ ] Bot responde normalmente (sin agente)
[ ] Bot se pausa cuando agente responde desde Chatwoot
[ ] Bot no procesa cuando hay agente asignado
[ ] Conversación Chatwoot se resuelve al terminar flujo
[ ] transfer_human funciona vía endpoint
[ ] pause_bot / resume_bot / resolve_bot funcionan
[ ] Env var CHECK_AGENT=false desactiva verificación
[ ] Env var AUTO_PAUSE=false desactiva pausa automática
[ ] Env var AUTO_RESOLVE=false desactiva resolución automática
[ ] Override per-instance funciona (coordinationSettings JSON)
[ ] GET /status refleja override per-instance correctamente
[ ] Typebot HTTP Request block puede llamar /chatbot/manage
```

---

## Troubleshooting

### Bot no responde aunque no hay agente
- Verificar logs: buscar `[Coordination]` y `emit() called`
- Verificar que `chatwootConversationId` se está asignando correctamente
- Verificar config: `GET /chatbot/manage/status/INSTANCIA`

### Bot responde aunque hay agente
- Verificar que `CHATBOT_COORDINATION_CHECK_AGENT` no está en `false`
- Verificar que el agente está realmente **asignado** en Chatwoot (no solo viendo la conversación)
- Verificar que la conversación está en estado `open` (no `pending`)

### Conversación no se resuelve al terminar flujo
- Verificar que `CHATBOT_COORDINATION_AUTO_RESOLVE` no está en `false`
- Verificar logs: buscar `[Coordination] Resolved Chatwoot conversation`
- Verificar que hay mensajes con `chatwootConversationId` en la DB para ese `remoteJid`

### Endpoint /chatbot/manage devuelve error
- Verificar API key correcta
- Verificar nombre de instancia correcto
- Verificar que `CHATBOT_COORDINATION_MANAGE_ENABLED` no está en `false`
- Verificar formato del body (action + remoteJid requeridos)

### Override per-instance no toma efecto
- Verificar que el JSON en `coordinationSettings` es válido
- Verificar que se actualizó el registro correcto (por `instanceId`, no por `id`)
- No requiere reinicio, pero verificar con GET `/status`

---

## Próximos pasos post-pruebas

1. **Performance:** Implementar cache para `hasHumanAgentAssigned()` (actualmente hace HTTP por cada mensaje)
2. **Webhook Chatwoot:** Escuchar `conversation_updated` en vez de consultar API para assignment
3. **Otros bots:** Mover `resolveChatwootConversation` a `BaseChatbotService` para que funcione con OpenAI, Dify, etc.
4. **Tests unitarios:** Mock de Prisma + axios para `ChatbotChatwootService`
5. **Endpoint REST:** Crear endpoint para actualizar `coordinationSettings` per-instance (actualmente solo vía SQL)
6. **Logs:** Mover debug logging extensivo de `emit()` a `.verbose()` para producción
