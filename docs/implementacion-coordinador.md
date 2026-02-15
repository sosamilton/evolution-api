# Implementación: Coordinador Bot-Chatwoot

**Rama:** `coordinador-bot-chat`  
**Base:** `main` (tag `2.3.7`)  
**Fecha:** 2025-02-15  

---

## Resumen

Se implementó una capa de coordinación configurable entre los chatbots (Typebot, OpenAI, Dify, etc.) y Chatwoot en Evolution API. El objetivo es gestionar automáticamente el ciclo de vida de las conversaciones: cuándo el bot debe responder, cuándo debe pausarse, y cuándo debe resolver la conversación.

---

## Commits (5)

| # | Hash | Tipo | Descripción |
|---|------|------|-------------|
| 1 | `7ed6a67e` | fix(meta) | Normalizar orden de ejecución Chatwoot-first en Meta Business API + fix bug chatwootIds |
| 2 | `fb601198` | feat(chatbot) | Coordination layer: ChatbotChatwootService, agent check, auto-pause, auto-resolve |
| 3 | `9b38f47e` | feat(chatbot) | Endpoint REST `/chatbot/manage` (transfer_human, resolve_bot, pause_bot, resume_bot) |
| 4 | `1cfeafcc` | feat(chatbot) | Coordinación configurable: env vars globales + override per-instance |
| 5 | `197a3a45` | docs | Documentación completa de la coordinación y configuración |

---

## Archivos creados (nuevos, no existen en upstream)

| Archivo | Propósito |
|---------|-----------|
| `src/api/integrations/chatbot/chatbot-chatwoot.service.ts` | Servicio de coordinación. Métodos: `hasHumanAgentAssigned`, `getCoordinationConfig`, `pauseBotSessionsForJid`, `updateChatwootConversationStatus`, `transferToHuman`, `resolveBot`, `resumeBot`, `pauseBot` |
| `src/api/integrations/chatbot/manage/dto/chatbot-manage.dto.ts` | DTO para acciones de gestión |
| `src/api/integrations/chatbot/manage/controllers/chatbot-manage.controller.ts` | Controller REST para acciones de gestión |
| `src/api/integrations/chatbot/manage/validate/chatbot-manage.schema.ts` | JSONSchema7 para validación de requests |
| `src/api/integrations/chatbot/manage/routes/chatbot-manage.router.ts` | Router con POST `/action` y GET `/status` |
| `prisma/postgresql-migrations/20250215120000_.../migration.sql` | Migración PostgreSQL: campo `coordinationSettings` |
| `prisma/mysql-migrations/20250215120000_.../migration.sql` | Migración MySQL: campo `coordinationSettings` |
| `docs/coordinacion-typebot-chatwoot.md` | Documentación técnica detallada |
| `docs/cosas-pendietnes.md` | Lista de pendientes actualizada |

---

## Archivos modificados (vs upstream)

### 1. `src/api/integrations/channel/meta/whatsapp.business.service.ts`
**Cambio:** Normalizar orden de ejecución para que Chatwoot procese antes que el bot (igual que Baileys).  
**Bug fix:** `chatwootInboxId` y `chatwootConversationId` usaban `.id` en vez de `.inbox_id` y `.conversation_id`.  
**Impacto:** El bot ahora tiene acceso al `chatwootConversationId` para verificar agentes.

### 2. `src/api/integrations/chatbot/base-chatbot.controller.ts`
**Cambio:** Capa de coordinación en `emit()`.  
- Lazy getter `getChatbotChatwootService()` via `require()` para evitar dependencia circular
- Verifica si hay agente humano asignado antes de activar el bot (respeta `checkAgent` config)
- Si hay agente → pausa la sesión del bot y retorna sin procesar
- Debug logging extensivo en todo el flujo de `emit()`
- Session lifecycle: sesiones cerradas se nullifican para crear nuevas conversaciones

### 3. `src/api/integrations/chatbot/chatbot.controller.ts`
**Cambio:** `chatbotChatwootService` agregado como propiedad pública y parámetro opcional del constructor.

### 4. `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts`
**Cambio:** Auto-pausa de bot sessions en `receiveWebhook()`.  
- Cuando se detecta un mensaje outgoing (agente responde desde Chatwoot), se pausan todas las sessions activas del bot para ese `remoteJid`
- Respeta `autoPause` config (global env var + per-instance override)

### 5. `src/api/integrations/chatbot/typebot/services/typebot.service.ts`
**Cambio:** Auto-resolución de conversación Chatwoot al terminar flujo.  
- Cuando `input === null` (flujo Typebot terminó), resuelve la conversación en Chatwoot
- Nuevo método `resolveChatwootConversation()` que busca el conversationId en mensajes recientes
- Respeta `autoResolve` config (global env var + per-instance override)

### 6. `src/api/server.module.ts`
**Cambio:** Registra `ChatbotChatwootService` y `ChatbotManageController`, los exporta para uso global.

### 7. `src/api/integrations/chatbot/chatbot.router.ts`
**Cambio:** Agrega ruta `/manage` con `ChatbotManageRouter`.

### 8. `src/api/integrations/chatbot/chatbot.schema.ts`
**Cambio:** Exporta `chatbotManageSchema`.

### 9. `src/config/env.config.ts`
**Cambio:** Agrega tipo `ChatbotCoordination` y sección `CHATBOT_COORDINATION` con 4 env vars.

### 10. `prisma/postgresql-schema.prisma` y `prisma/mysql-schema.prisma`
**Cambio:** Agrega campo `coordinationSettings Json?` al modelo `Chatwoot`.

---

## Configuración

### Variables de entorno (defaults globales)

```bash
# Todos los defaults son true (coordinación completa activada)
CHATBOT_COORDINATION_CHECK_AGENT=true       # Verificar agente antes de bot
CHATBOT_COORDINATION_AUTO_PAUSE=true        # Pausar bot cuando agente responde
CHATBOT_COORDINATION_AUTO_RESOLVE=true      # Resolver Chatwoot al terminar flujo
CHATBOT_COORDINATION_MANAGE_ENABLED=true    # Habilitar /chatbot/manage
```

### Override per-instance (campo JSON en DB)

```sql
-- Desactivar checkAgent para una instancia
UPDATE "Chatwoot" SET "coordinationSettings" = '{"checkAgent": false}'
WHERE "instanceId" = 'id-de-la-instancia';
```

### Presets de escenarios

| Escenario | checkAgent | autoPause | autoResolve | manageEnabled |
|-----------|-----------|-----------|-------------|---------------|
| **A: Coordinación completa** | `true` | `true` | `true` | `true` |
| **B: Bot + derivación manual** | `false` | `true` | `false` | `true` |
| **C: Sin coordinación** | `false` | `false` | `false` | `false` |
| **D: Coexistencia** | `false` | `false` | `false` | `true` |

---

## Endpoints nuevos

### POST `/chatbot/manage/action/{instanceName}`

```json
{
  "action": "transfer_human",
  "remoteJid": "5491155551234@s.whatsapp.net",
  "assigneeId": 42,
  "teamId": 5
}
```

Acciones disponibles: `transfer_human`, `resolve_bot`, `pause_bot`, `resume_bot`

### GET `/chatbot/manage/status/{instanceName}`

Devuelve la configuración de coordinación actual (merge global + per-instance):

```json
{
  "status": "ok",
  "integration": "chatbot-chatwoot-coordination",
  "instance": "mi-instancia",
  "coordination": {
    "checkAgent": true,
    "autoPause": true,
    "autoResolve": true,
    "manageEnabled": true
  }
}
```

---

## Flujo de coordinación

```
Mensaje WhatsApp llega
  ↓
Canal (Baileys/Meta) procesa
  ↓
Chatwoot recibe mensaje (SIEMPRE, si habilitado)
  → Crea conversación / agrega mensaje
  → Devuelve chatwootConversationId
  ↓
Bot emit() se ejecuta
  → [checkAgent=true] Verifica agente en Chatwoot API
    → Si hay agente → pausa session → NO procesa
    → Si no hay agente → continúa
  → Bot procesa mensaje normalmente
  ↓
Si flujo bot termina (input=null):
  → [autoResolve=true] Resuelve conversación Chatwoot
  ↓
Si agente responde desde Chatwoot:
  → [autoPause=true] Pausa sessions activas del bot
  ↓
Typebot HTTP Request block puede llamar:
  → [manageEnabled=true] /chatbot/manage/action
    → transfer_human, resolve_bot, pause_bot, resume_bot
```

---

## Requisitos para deploy

1. **Migración DB:**
   ```sql
   -- PostgreSQL
   ALTER TABLE "Chatwoot" ADD COLUMN "coordinationSettings" JSONB;
   -- MySQL
   ALTER TABLE `Chatwoot` ADD COLUMN `coordinationSettings` JSON NULL;
   ```

2. **Build:** `npm run build`

3. **Env vars:** Opcionales. Sin setear = coordinación completa (Escenario A).

4. **Configuración recomendada de Chatwoot (instancia):**
   - `reopenConversation: false`
   - `conversationPending: true`

5. **Configuración recomendada de Typebot (bot):**
   - `keepOpen: false`
   - `expire: 30`
   - `stopBotFromMe: true`
