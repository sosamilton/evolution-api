# Coordinación Typebot + Chatwoot — Documentación de Implementación

**Rama:** `coordinador-bot-chat`  
**Base:** `main` (tag `2.3.7`)  
**Fecha:** 2025-02-15  

---

## Índice

1. [Problema Original](#1-problema-original)
2. [Análisis y Diagnóstico](#2-análisis-y-diagnóstico)
3. [Solución Implementada: "Chatwoot First + Coordination Layer"](#3-solución-implementada)
4. [Archivos Nuevos (no existen en upstream)](#4-archivos-nuevos)
5. [Archivos Modificados (vs implementación oficial)](#5-archivos-modificados)
6. [Archivos Eliminados](#6-archivos-eliminados)
7. [Commits Anteriores en la Rama (pre-coordinación)](#7-commits-anteriores)
8. [Nuevo Endpoint REST: `/chatbot/manage`](#8-endpoint-rest)
9. [Flujo Completo de Coordinación](#9-flujo-completo)
10. [Configuración de Coordinación (env vars + per-instance)](#10-configuración-de-coordinación)
11. [Configuración Recomendada](#11-configuración-recomendada)
12. [Uso desde Typebot (HTTP Request Blocks)](#12-uso-desde-typebot)
13. [Pendientes y Mejoras Futuras](#13-pendientes)

---

## 1. Problema Original

La integración entre Evolution API, Typebot y Chatwoot presentaba los siguientes problemas:

- **Conversaciones que no se cierran:** las conversaciones en Chatwoot quedaban abiertas indefinidamente después de que el bot completaba su flujo.
- **Interferencia del bot durante atención humana:** cuando un agente humano tomaba una conversación en Chatwoot, el bot seguía respondiendo a los mensajes del usuario.
- **Inconsistencia entre canales:** Baileys procesaba Chatwoot antes que el bot, pero Meta Business API lo hacía al revés, causando que `chatwootConversationId` no estuviera disponible cuando el bot lo necesitaba.
- **Bug en asignación de IDs de Chatwoot:** en Meta Business API, `chatwootInboxId` y `chatwootConversationId` se asignaban incorrectamente usando `.id` en vez de `.inbox_id` y `.conversation_id`.
- **No había forma de controlar el bot desde Typebot:** no existía un mecanismo para que un flujo de Typebot pudiera pausar el bot, transferir a humano, o resolver la conversación.

---

## 2. Análisis y Diagnóstico

### Orden de ejecución de eventos en canales WhatsApp

Se analizaron los dos canales principales:

| Canal | Orden Original | Orden Correcto |
|-------|---------------|----------------|
| **Baileys** (`whatsapp.baileys.service.ts`) | ✅ Chatwoot → Bot | Chatwoot → Bot |
| **Meta Business API** (`whatsapp.business.service.ts`) | ❌ Bot → Chatwoot | Chatwoot → Bot |

**Impacto:** en Meta Business API, el bot procesaba el mensaje antes de que Chatwoot creara la conversación, por lo que `chatwootConversationId` no estaba disponible para la capa de coordinación.

### Opciones evaluadas

Se evaluaron 3 opciones:

- **Opción A: Bot First** — mantener bot primero y consultar Chatwoot después. Descartada por complejidad.
- **Opción B: Independiente** — cada sistema opera sin coordinación. Descartada porque no resuelve los problemas.
- **Opción C: Chatwoot First + Coordination Layer** — ✅ **SELECCIONADA**. Normalizar ambos canales a "Chatwoot primero" y agregar una capa de coordinación central.

---

## 3. Solución Implementada

### Arquitectura: "Chatwoot First + Coordination Layer"

```
WhatsApp Message
       │
       ▼
┌──────────────┐
│  Channel     │  (Baileys o Meta Business API)
│  Service     │
└──────┬───────┘
       │
       ▼  (1) Chatwoot primero
┌──────────────┐
│  Chatwoot    │  → Crea conversación, asigna IDs
│  Service     │  → Si agente responde: PAUSA bot sessions
└──────┬───────┘
       │
       ▼  (2) Bot después
┌──────────────┐
│  BaseChatbot │  → Verifica si hay agente humano asignado
│  Controller  │  → Si hay agente: NO procesa, pausa sesión
│  (emit)      │  → Si no hay agente: procesa normalmente
└──────┬───────┘
       │
       ▼  (3) Al finalizar flujo
┌──────────────┐
│  Typebot     │  → Resuelve conversación Chatwoot
│  Service     │  → Cierra sesión de bot
└──────────────┘
```

### Puntos de integración

| Punto | Archivo | Acción |
|-------|---------|--------|
| Pre-bot check | `base-chatbot.controller.ts` | Consulta API Chatwoot para verificar agente asignado |
| Agente responde | `chatwoot.service.ts` | Pausa sessions de bot automáticamente |
| Bot flow termina | `typebot.service.ts` | Resuelve conversación en Chatwoot |
| Control explícito | `/chatbot/manage/action` | Endpoint REST llamable desde Typebot |

---

## 4. Archivos Nuevos

> Estos archivos **NO existen en la implementación oficial** de Evolution API. Son completamente nuevos.

### 4.1 `src/api/integrations/chatbot/chatbot-chatwoot.service.ts`

**Propósito:** Servicio central de coordinación entre chatbots y Chatwoot.

**Métodos públicos:**
- `isEnabled()` — Verifica si Chatwoot está habilitado globalmente
- `hasHumanAgentAssigned(instanceId, conversationId)` — Consulta API Chatwoot para verificar si un agente humano está asignado a una conversación
- `pauseBotSessionsForJid(instanceId, remoteJid)` — Pausa todas las sessions de bot activas para un contacto
- `updateChatwootConversationStatus(instanceId, remoteJid, status, assigneeId?, teamId?)` — Cambia el estado de una conversación en Chatwoot (open/resolved/pending) con asignación opcional
- `transferToHuman(instanceId, remoteJid, assigneeId?, teamId?)` — Acción compuesta: pausa bot + abre conversación + asigna agente/equipo
- `resolveBot(instanceId, remoteJid, resolveChatwoot?)` — Acción compuesta: cierra sessions + resuelve conversación
- `resumeBot(instanceId, remoteJid)` — Reactiva sessions pausadas
- `pauseBot(instanceId, remoteJid)` — Pausa sessions sin tocar Chatwoot

**Por qué es necesario:**
- Encapsula toda la lógica de coordinación en un solo lugar
- Evita acoplar `ChatwootService` directamente con `BaseChatbotController`
- Proporciona acciones compuestas reutilizables desde endpoints REST y desde la lógica interna

### 4.2 `src/api/integrations/chatbot/manage/dto/chatbot-manage.dto.ts`

**Propósito:** DTO para el endpoint de gestión `/chatbot/manage`.

```typescript
export class ChatbotManageDto {
  action: 'transfer_human' | 'resolve_bot' | 'pause_bot' | 'resume_bot';
  remoteJid: string;
  chatwoot?: {
    status?: 'open' | 'resolved' | 'pending';
    assigneeId?: number;
    teamId?: number;
  };
}
```

### 4.3 `src/api/integrations/chatbot/manage/validate/chatbot-manage.schema.ts`

**Propósito:** JSONSchema7 para validar las peticiones al endpoint de gestión.

### 4.4 `src/api/integrations/chatbot/manage/controllers/chatbot-manage.controller.ts`

**Propósito:** Controller HTTP que recibe las acciones de gestión y las delega al `ChatbotChatwootService`.

**Por qué es necesario:**
- Permite que Typebot (vía HTTP Request block) controle el ciclo de vida bot/humano
- Normaliza el `remoteJid` (agrega `@s.whatsapp.net` si falta)
- Resuelve el `instanceId` desde el nombre de instancia

### 4.5 `src/api/integrations/chatbot/manage/routes/chatbot-manage.router.ts`

**Propósito:** Router Express que define las rutas:
- `POST /chatbot/manage/action/{instanceName}` — Ejecutar acción
- `GET /chatbot/manage/status/{instanceName}` — Health check

---

## 5. Archivos Modificados

> Estos archivos **existen en la implementación oficial** y fueron modificados. Se detalla exactamente qué se cambió y por qué.

### 5.1 `src/api/integrations/channel/meta/whatsapp.business.service.ts`

**Cambios:**
1. **Reordenamiento de ejecución:** Se movió la llamada a `chatwootService.eventWhatsapp()` ANTES de `chatbotController.emit()` (líneas ~671-695). Antes estaba al revés.
2. **Fix de asignación de IDs:** Se corrigió la asignación de `chatwootInboxId` y `chatwootConversationId`:
   - **Antes (bug):** `messageRaw.chatwootInboxId = chatwootSentMessage.id` 
   - **Después (fix):** `messageRaw.chatwootInboxId = chatwootSentMessage.inbox_id`
   - **Antes (bug):** `messageRaw.chatwootConversationId = chatwootSentMessage.id`
   - **Después (fix):** `messageRaw.chatwootConversationId = chatwootSentMessage.conversation_id`

**Por qué:**
- Sin esta normalización, el bot en Meta Business API procesaba mensajes sin tener el `chatwootConversationId`, lo que impedía verificar si había un agente asignado.
- El bug de IDs causaba que los datos de Chatwoot almacenados en la DB fueran incorrectos.

### 5.2 `src/api/integrations/chatbot/base-chatbot.controller.ts`

**Cambios:**
1. **Lazy getter para `ChatbotChatwootService`** (líneas 14-28): Función `getChatbotChatwootService()` que resuelve la dependencia circular usando `require()` lazy.
2. **Capa de coordinación en `emit()`** (líneas 923-944): Antes de procesar un mensaje con el bot, verifica si la conversación en Chatwoot tiene un agente humano asignado. Si lo tiene, no procesa y pausa la sesión activa.

**Por qué:**
- Los controllers individuales (TypebotController, DifyController, etc.) heredan de `BaseChatbotController` y no pasan `chatbotChatwootService` en su constructor.
- El lazy getter resuelve la dependencia circular (`base-chatbot.controller` → `server.module` → `chatbot.controller` → `base-chatbot.controller`).
- La verificación en `emit()` es el punto central donde TODOS los bots pasan antes de procesar.

### 5.3 `src/api/integrations/chatbot/chatbot.controller.ts`

**Cambios:**
1. Import de `ChatbotChatwootService`
2. Propiedad pública `chatbotChatwootService`
3. Constructor acepta tercer parámetro opcional `chatbotChatwootService?: ChatbotChatwootService`

**Por qué:** Permite que `server.module.ts` pase la instancia del servicio de coordinación al controller principal.

### 5.4 `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts`

**Cambios:** En el método `receiveWebhook()`, dentro del bloque que procesa mensajes `outgoing` (agente enviando desde Chatwoot), se agregó código (líneas 1454-1474) que:
1. Normaliza el `chatId` a formato `remoteJid` (agrega `@s.whatsapp.net`)
2. Busca sessions de bot activas (`status: 'opened'`) para ese `remoteJid`
3. Las pausa automáticamente (`status: 'paused'`)
4. Registra log de la acción

**Por qué:** Cuando un agente humano responde desde Chatwoot, el bot debe dejar de interferir inmediatamente. Sin esto, el bot seguía respondiendo incluso cuando el agente ya había tomado la conversación.

### 5.5 `src/api/integrations/chatbot/typebot/services/typebot.service.ts`

**Cambios:**
1. Import de `Chatwoot` config (línea 4)
2. Llamada a `this.resolveChatwootConversation()` cuando el flujo termina (línea 431)
3. Nuevo método privado `resolveChatwootConversation()` (líneas 446-490) que:
   - Verifica si Chatwoot está habilitado
   - Busca la instancia y el provider de Chatwoot
   - Encuentra el `chatwootConversationId` del mensaje más reciente
   - Llama a la API de Chatwoot para resolver (toggle_status → resolved)

**Por qué:** Cuando un flujo de Typebot termina (no hay más `input` que esperar del usuario), la conversación en Chatwoot debería resolverse automáticamente para mantener el workspace limpio.

### 5.6 `src/api/integrations/chatbot/chatbot.router.ts`

**Cambios:** Se agregó `this.router.use('/manage', new ChatbotManageRouter(...guards).router)` (línea 27).

**Por qué:** Registra las nuevas rutas de gestión en el árbol de rutas del chatbot.

### 5.7 `src/api/integrations/chatbot/chatbot.schema.ts`

**Cambios:** Se agregó `export * from '@api/integrations/chatbot/manage/validate/chatbot-manage.schema'` (línea 6).

**Por qué:** Exporta el schema de validación del nuevo endpoint para que esté disponible globalmente.

### 5.8 `src/api/server.module.ts`

**Cambios:**
1. Imports de `ChatbotChatwootService` y `ChatbotManageController`
2. Instanciación: `chatbotChatwootService = new ChatbotChatwootService(prismaRepository, waMonitor, configService)`
3. Se pasa `chatbotChatwootService` a `ChatbotController`
4. Instanciación: `chatbotManageController = new ChatbotManageController(chatbotChatwootService, prismaRepository)`

**Por qué:** Registra y conecta todos los nuevos servicios y controllers en el módulo principal.

---

## 6. Archivos Eliminados

No se eliminó ningún archivo de la implementación oficial.

> Nota: se eliminó un archivo temporal `chatbot-chatwoot.service.lazy.ts` que fue creado y eliminado durante el desarrollo. No llegó al estado final.

---

## 7. Commits Anteriores en la Rama

Antes de la implementación de coordinación, la rama ya contenía 3 commits con fixes para Cloud API auto-trigger:

| Commit | Descripción | Archivos |
|--------|-------------|----------|
| `4c6ccad7` | `fix(chatbot): add debug logging and null guards for Cloud API auto-trigger` | `base-chatbot.controller.ts` |
| `d7c3531b` | `fix(chatbot): closed session should not block bot re-activation` | `base-chatbot.controller.ts` |
| `6901107b` | `fix(chatbot): nullify closed session so processBot creates a new one` | `base-chatbot.controller.ts` |

Estos commits agregaron logging de debug extensivo al `emit()` de `BaseChatbotController` y corrigieron un bug donde una sesión cerrada bloqueaba la re-activación del bot (ahora se nullifica para que `processBot` cree una nueva).

---

## 8. Endpoint REST

### `POST /chatbot/manage/action/{instanceName}`

**Headers:**
```
apikey: {tu-api-key}
Content-Type: application/json
```

**Body:**

```jsonc
{
  "action": "transfer_human" | "resolve_bot" | "pause_bot" | "resume_bot",
  "remoteJid": "5511999999999",  // o "5511999999999@s.whatsapp.net"
  "chatwoot": {                   // opcional
    "status": "open",             // open | resolved | pending
    "assigneeId": 123,            // ID del agente en Chatwoot
    "teamId": 5                   // ID del equipo en Chatwoot
  }
}
```

**Acciones disponibles:**

| Acción | Efecto en Bot | Efecto en Chatwoot |
|--------|--------------|-------------------|
| `transfer_human` | Pausa sessions activas | Abre conversación + asigna agente/equipo |
| `resolve_bot` | Cierra sessions | Resuelve conversación |
| `pause_bot` | Pausa sessions activas | Sin efecto |
| `resume_bot` | Reactiva sessions pausadas | Sin efecto |

**Respuesta:**
```json
{
  "action": "transfer_human",
  "success": true,
  "message": "Paused 1 bot session(s), Chatwoot updated: true"
}
```

### `GET /chatbot/manage/status/{instanceName}`

Health check simple. Retorna estado de la integración.

---

## 9. Flujo Completo de Coordinación

### Caso 1: Usuario inicia conversación → Bot responde → Bot termina flujo

```
1. Usuario envía mensaje por WhatsApp
2. Chatwoot crea conversación (status: pending/open)
3. Bot encuentra trigger y crea session (status: opened)
4. Bot procesa mensajes y responde
5. Flujo Typebot termina (input = null)
6. → Session se cierra/elimina (según keepOpen)
7. → Conversación Chatwoot se RESUELVE automáticamente
```

### Caso 2: Bot está activo → Agente toma conversación

```
1. Bot está procesando (session status: opened)
2. Agente abre conversación en Chatwoot y responde
3. → receiveWebhook detecta mensaje outgoing
4. → Sessions de bot se PAUSAN automáticamente
5. Siguiente mensaje del usuario:
   - emit() verifica agente asignado en Chatwoot
   - Encuentra agente → NO procesa con bot
6. Agente continúa atendiendo sin interferencia del bot
```

### Caso 3: Typebot transfiere a humano (vía HTTP Request)

```
1. Flujo Typebot llega a un punto de transferencia
2. Typebot envía HTTP Request a /chatbot/manage/action
   → action: "transfer_human", assigneeId: 123
3. → Sessions de bot se PAUSAN
4. → Conversación Chatwoot se ABRE + asigna agente 123
5. Agente recibe la conversación asignada
```

### Caso 4: Agente termina y quiere reactivar bot

```
1. Agente resuelve conversación en Chatwoot
2. Opcionalmente llama /chatbot/manage/action
   → action: "resume_bot"
3. → Sessions pausadas se REACTIVAN
4. Siguiente mensaje del usuario → bot responde
```

---

## 10. Configuración de Coordinación

Todos los comportamientos de coordinación son configurables mediante:
1. **Variables de entorno** (global, aplica a todas las instancias)
2. **Per-instance override** (campo `coordinationSettings` en modelo Chatwoot de la DB)

### Variables de entorno (defaults globales)

```bash
# Verificar si hay agente humano asignado en Chatwoot antes de activar bot
# Si true: bot NO procesa si hay agente asignado
CHATBOT_COORDINATION_CHECK_AGENT=true

# Pausar bot automáticamente cuando agente responde desde Chatwoot
# Si true: al detectar mensaje outgoing de agente, sessions se pausan
CHATBOT_COORDINATION_AUTO_PAUSE=true

# Resolver conversación Chatwoot cuando flujo bot termina
# Si true: al terminar flujo Typebot (input=null), conversación se resuelve
CHATBOT_COORDINATION_AUTO_RESOLVE=true

# Habilitar endpoint /chatbot/manage para control explícito
# Si true: se pueden usar acciones transfer_human, resolve_bot, pause_bot, resume_bot
CHATBOT_COORDINATION_MANAGE_ENABLED=true
```

> **Nota:** Los defaults son `true` (coordinación completa). Para desactivar un comportamiento, setear explícitamente a `false`.

### Override per-instance

Se puede configurar por instancia guardando un JSON en el campo `coordinationSettings` del modelo Chatwoot. Los valores no especificados usan el default global (env var).

```sql
-- Ejemplo: desactivar checkAgent solo para una instancia
UPDATE "Chatwoot" SET "coordinationSettings" = '{"checkAgent": false}'
WHERE "instanceId" = 'id-de-la-instancia';

-- Ejemplo: modo coexistencia (bot + agente sin interferencia)
UPDATE "Chatwoot" SET "coordinationSettings" = '{"checkAgent": false, "autoPause": false, "autoResolve": false}'
WHERE "instanceId" = 'id-de-la-instancia';
```

Estructura del JSON:
```json
{
  "checkAgent": true,      // Override CHATBOT_COORDINATION_CHECK_AGENT
  "autoPause": true,       // Override CHATBOT_COORDINATION_AUTO_PAUSE
  "autoResolve": true,     // Override CHATBOT_COORDINATION_AUTO_RESOLVE
  "manageEnabled": true    // Override CHATBOT_COORDINATION_MANAGE_ENABLED
}
```

### Presets de escenarios

| Escenario | checkAgent | autoPause | autoResolve | manageEnabled | Caso de uso |
|-----------|-----------|-----------|-------------|---------------|-------------|
| **A: Coordinación completa** | `true` | `true` | `true` | `true` | Bot atiende, si no puede → humano |
| **B: Bot + derivación manual** | `false` | `true` | `false` | `true` | Bot decide cuándo derivar (vía Typebot HTTP Request) |
| **C: Sin coordinación** | `false` | `false` | `false` | `false` | Bot independiente, Chatwoot solo logging |
| **D: Coexistencia** | `false` | `false` | `false` | `true` | Ambos trabajan sin interferencia, control manual |

### Consultar config actual

```
GET /chatbot/manage/status/{instanceName}
Header: apikey: {tu-api-key}
```

Respuesta:
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

### Migración de base de datos

Se requiere migración para agregar el campo `coordinationSettings`:

```bash
# PostgreSQL
ALTER TABLE "Chatwoot" ADD COLUMN "coordinationSettings" JSONB;

# MySQL
ALTER TABLE `Chatwoot` ADD COLUMN `coordinationSettings` JSON NULL;
```

---

## 11. Configuración Recomendada

### Evolution API (.env)

```bash
CHATWOOT_ENABLED=true
TYPEBOT_ENABLED=true
```

### Chatwoot (configuración de instancia)

```json
{
  "enabled": true,
  "reopenConversation": false,
  "conversationPending": true,
  "signMsg": true,
  "signDelimiter": "\\n"
}
```

- **`reopenConversation: false`** — Cada nueva conversación crea un chat nuevo
- **`conversationPending: true`** — Conversaciones inician en estado "pending"

### Typebot (configuración del bot)

```json
{
  "keepOpen": false,
  "expire": 30,
  "stopBotFromMe": true
}
```

- **`keepOpen: false`** — Elimina sessions al terminar (más limpio)
- **`expire: 30`** — Re-inicia sesión si pasan 30 minutos sin interacción
- **`stopBotFromMe: true`** — Pausa bot si el operador responde desde WhatsApp

---

## 12. Uso desde Typebot (HTTP Request Blocks)

### Transferir a humano con asignación

En Typebot, agregar un bloque **HTTP Request**:

```
Método: POST
URL: https://evolutionapi.mdsoluciones.ar/chatbot/manage/action/{instanceName}
Headers:
  apikey: {tu-api-key}
  Content-Type: application/json
Body:
{
  "action": "transfer_human",
  "remoteJid": "{{remoteJid}}",
  "chatwoot": {
    "assigneeId": 123,
    "teamId": 5
  }
}
```

### Resolver bot y cerrar conversación

```json
{
  "action": "resolve_bot",
  "remoteJid": "{{remoteJid}}"
}
```

### Pausar bot temporalmente

```json
{
  "action": "pause_bot",
  "remoteJid": "{{remoteJid}}"
}
```

---

## 13. Pendientes y Mejoras Futuras

### Derivados de `docs/cosas-pendietnes.md`

| # | Pendiente | Estado | Notas |
|---|-----------|--------|-------|
| 1 | Mejorar logs: separar debug vs error | ⚠️ Parcial | Los logs de coordinación usan `.log()` y `.error()`. Los logs de debug extensivos del emit() (commits anteriores) deberían moverse a `.verbose()` o `.debug()` en producción |
| 2 | Script para crear reglas de derivación a humanos | ❌ Pendiente | Ahora se puede hacer vía endpoint `/chatbot/manage/action` con `transfer_human`, pero falta un script de setup inicial |
| 3 | Script para crear integración con Typebot | ❌ Pendiente | Crear script que configure bot con settings recomendados |
| 4 | Script para crear integración con Chatwoot | ❌ Pendiente | Crear script que configure instancia con `reopenConversation=false`, `conversationPending=true`, etc. |
| 5 | Unificar scripts con config JSON | ❌ Pendiente | Crear CLI unificado con archivo de configuración |
| 6 | Documentar problema y solución de integración Typebot | ✅ Completado | Este documento |
| 7 | Contribución pública | ❌ Pendiente | Preparar PR para upstream |

### Mejoras técnicas adicionales

| Mejora | Prioridad | Descripción |
|--------|-----------|-------------|
| Cache de verificación de agente | Media | `hasHumanAgentAssigned()` hace una llamada HTTP a Chatwoot por cada mensaje. Implementar cache con TTL de 30s para reducir latencia |
| Webhook de Chatwoot para assignment | Media | En vez de consultar la API, escuchar el webhook `conversation_updated` cuando se asigna un agente |
| Soporte para otros bots | Baja | `resolveChatwootConversation` solo está en TypebotService. Implementar en BaseChatbotService para todos los bots |
| Tests unitarios | Media | Tests para `ChatbotChatwootService` mockeando Prisma y axios |
| Mover logs de debug a `.verbose()` | Baja | Los logs extensivos agregados en commits anteriores para debugging de Cloud API deberían usar nivel verbose |

---

## Apéndice: Resumen de Archivos

### Nuevos (5 archivos — no existen en upstream)
```
src/api/integrations/chatbot/chatbot-chatwoot.service.ts          (296 líneas)
src/api/integrations/chatbot/manage/dto/chatbot-manage.dto.ts     (9 líneas)
src/api/integrations/chatbot/manage/validate/chatbot-manage.schema.ts (24 líneas)
src/api/integrations/chatbot/manage/controllers/chatbot-manage.controller.ts (67 líneas)
src/api/integrations/chatbot/manage/routes/chatbot-manage.router.ts (40 líneas)
```

### Modificados (8 archivos — diffs sobre upstream)
```
src/api/integrations/channel/meta/whatsapp.business.service.ts    (+14, -13)
src/api/integrations/chatbot/base-chatbot.controller.ts           (+40)
src/api/integrations/chatbot/chatbot.controller.ts                (+5, -1)
src/api/integrations/chatbot/chatbot.router.ts                    (+2)
src/api/integrations/chatbot/chatbot.schema.ts                    (+1)
src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts (+22)
src/api/integrations/chatbot/typebot/services/typebot.service.ts  (+54, -1)
src/api/server.module.ts                                          (+5, -1)
```

### Eliminados
```
(ninguno)
```
