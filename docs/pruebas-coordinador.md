# Coordinador Bot-Chatwoot — Documentación Técnica

**Rama:** `coordinador-bot-chat`  
**Última actualización:** 2025-02-16  

---

## Descripción general

El coordinador permite que Evolution API gestione automáticamente la transición entre **bots** (Typebot, OpenAI, etc.) y **agentes humanos** en Chatwoot. El sistema detecta cuándo interviene un humano, pausa el bot, y abre la conversación en Chatwoot para que el agente la atienda.

### Funcionalidades principales

| Función | Descripción |
|---------|-------------|
| **checkAgent** | Antes de activar el bot, verifica si hay un agente asignado en Chatwoot |
| **autoPause** | Pausa el bot automáticamente cuando un agente responde desde Chatwoot |
| **autoResolve** | Resuelve la conversación en Chatwoot cuando el flujo del bot termina |
| **detectTransferMarker** | Detecta el marcador `[transfer_human]` en mensajes de Typebot para derivar a humano |
| **manageEnabled** | Habilita el endpoint REST `/manage/action` para control externo |

---

## Pre-requisitos

### 1. Migración de base de datos

```sql
ALTER TABLE "Chatwoot" ADD COLUMN "coordinationSettings" JSONB;
```

### 2. Configuración recomendada de instancia

| Setting | Valor | Dónde |
|---------|-------|-------|
| `reopenConversation` | `false` | Chatwoot config en Evolution API |
| `conversationPending` | `true` | Chatwoot config en Evolution API |
| `keepOpen` | `false` | Typebot bot config |
| `expire` | `30` | Typebot bot config |
| `stopBotFromMe` | `true` | Typebot bot config |

### 3. Variables de entorno (opcionales)

Todos los defaults son `true`. Solo agregá variables si querés **desactivar** algo:

```bash
# En .env (solo si necesitás cambiar defaults)
CHATBOT_COORDINATION_CHECK_AGENT=false
CHATBOT_COORDINATION_AUTO_PAUSE=false
CHATBOT_COORDINATION_AUTO_RESOLVE=false
CHATBOT_COORDINATION_DETECT_TRANSFER_MARKER=false
CHATBOT_COORDINATION_MANAGE_ENABLED=false
```

---

## Derivación a humano: marcador `[transfer_human]`

### Cómo funciona

En el flujo de Typebot, para derivar a un agente humano **no se necesita HTTP Request**. Solo se incluye un bloque de texto con el marcador `[transfer_human]`:

```
[transfer_human]Te estamos derivando con un agente, muchas gracias.
```

O solo el marcador (sin texto visible para el usuario):
```
[transfer_human]
```

### Secuencia interna

1. Usuario elige "Atención Personalizada" (o similar) en el bot
2. Typebot envía mensaje con `[transfer_human]`
3. **TypebotService** detecta el marcador → ejecuta `transferToHuman()` internamente
4. La sesión del bot se **pausa** (status: `paused`)
5. La conversación en Chatwoot se **abre** (status: `open`)
6. **autoResolve** se omite (detecta que la sesión fue pausada)
7. Chatwoot asigna agente según sus reglas automáticas (round-robin, equipos, etc.)

### Logs esperados

```
[Coordination] Detected [transfer_human] marker in Typebot message for 542216697311@s.whatsapp.net
[Coordination] Transfer to human requested for 542216697311@s.whatsapp.net (marker: true, paused: false)
[Coordination] transferToHuman result: {"success":true,"message":"Paused 1 bot session(s), Chatwoot updated: true"}
```

### Configuración en Typebot

1. En el flujo, donde querés derivar, agregá un bloque **Text** con `[transfer_human]`
2. Podés combinar con un mensaje: `[transfer_human]Gracias, te derivamos a un agente.`
3. El marcador se quita del texto antes de enviarlo al usuario
4. Si el texto queda vacío después de quitar el marcador, no se envía nada

> **Nota:** La variable `remoteJid` se inyecta automáticamente por Evolution API.
> No es necesario configurar nada extra en Typebot.

---

## Configuración por instancia

### Niveles de configuración (prioridad)

1. **Per-instance** (campo `coordinationSettings` en Chatwoot) → prioridad máxima
2. **Global** (variables de entorno `CHATBOT_COORDINATION_*`) → fallback

### Configurar desde la UI (Evolution Manager)

La sección "Coordinación Bot-Agente" en la página de Chatwoot permite activar/desactivar cada función por instancia. Incluye presets para configuraciones comunes.

### Configurar desde API REST

```bash
POST /chatwoot/set/NOMBRE_INSTANCIA
```

El campo `coordinationSettings` acepta un objeto JSON con las claves deseadas. Las no especificadas usan el default global:

```json
{
  "coordinationSettings": {
    "checkAgent": true,
    "autoPause": true,
    "autoResolve": true,
    "detectTransferMarker": true,
    "manageEnabled": true
  }
}
```

### Verificar configuración actual

```bash
curl -X GET \
  'https://evolutionapi.mdsoluciones.ar/manage/status/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY'
```

Respuesta:
```json
{
  "status": "ok",
  "integration": "chatbot-chatwoot-coordination",
  "instance": "NOMBRE_INSTANCIA",
  "coordination": {
    "checkAgent": true,
    "autoPause": true,
    "autoResolve": true,
    "detectTransferMarker": true,
    "manageEnabled": true
  }
}
```

---

## Endpoint REST `/manage`

### POST `/manage/action/{instanceName}`

Acciones disponibles:

| Acción | Descripción |
|--------|-------------|
| `transfer_human` | Pausa bot + abre conversación en Chatwoot |
| `pause_bot` | Solo pausa la sesión del bot |
| `resume_bot` | Reactiva una sesión pausada |
| `resolve_bot` | Cierra sesión + resuelve conversación en Chatwoot |

#### Ejemplo: transfer_human

```bash
curl -X POST \
  'https://evolutionapi.mdsoluciones.ar/manage/action/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "transfer_human",
    "remoteJid": "5491155551234@s.whatsapp.net"
  }'
```

> `assigneeId` y `teamId` son opcionales. Si no se envían, Chatwoot usa su asignación automática.

#### Ejemplo: transfer_human con asignación manual

```bash
curl -X POST \
  'https://evolutionapi.mdsoluciones.ar/manage/action/NOMBRE_INSTANCIA' \
  -H 'apikey: TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "transfer_human",
    "remoteJid": "5491155551234@s.whatsapp.net",
    "chatwoot": {
      "assigneeId": 42,
      "teamId": 5
    }
  }'
```

#### Ejemplo: pause, resume, resolve

```bash
# Pausar bot
curl -X POST '.../manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "pause_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'

# Resumir bot
curl -X POST '.../manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "resume_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'

# Resolver bot + cerrar conversación Chatwoot
curl -X POST '.../manage/action/INSTANCIA' \
  -H 'apikey: KEY' -H 'Content-Type: application/json' \
  -d '{"action": "resolve_bot", "remoteJid": "549XXXXXXXXXX@s.whatsapp.net"}'
```

---

## Fixes aplicados

### Fix 1: autoResolve no deshace transfer_human

**Problema:** Cuando Typebot enviaba `[transfer_human]` y el flujo terminaba, `autoResolve` resolvía la conversación, deshaciendo la transferencia.

**Solución:** Antes de cerrar la sesión y auto-resolver, se re-lee la sesión de la DB. Si está `paused`, se omite el close y autoResolve.

### Fix 2: Conversación Chatwoot se abre al pausar bot

**Problema:** Cuando un agente respondía desde Chatwoot y el bot se pausaba, la conversación no se abría automáticamente.

**Solución:** Se agregó llamada a `updateChatwootConversationStatus('open')` después de pausar las sesiones del bot.

### Fix 3: Marcador `[transfer_human]` reemplaza HTTP Request

**Problema:** El HTTP Request de Typebot no llegaba a la API (redes Docker separadas, problemas de DNS/SSL).

**Solución:** Se implementó detección del marcador `[transfer_human]` directamente en `TypebotService.processMessages()`, eliminando la dependencia de llamadas HTTP externas.

---

## Troubleshooting

### Bot no responde aunque no hay agente
- Buscar `[Coordination]` en logs
- Verificar config: `GET /manage/status/INSTANCIA`
- Verificar que `chatwootConversationId` se asigna correctamente

### Bot responde aunque hay agente
- Verificar que `checkAgent` no está desactivado
- Verificar que el agente está **asignado** en Chatwoot (no solo viendo la conversación)

### Conversación no se resuelve al terminar flujo
- Verificar que `autoResolve` está activado
- Buscar en logs: `[Coordination] Resolved Chatwoot conversation`
- Si hubo `[transfer_human]`, es correcto que NO se resuelva

### transfer_human no funciona
- Verificar que `detectTransferMarker` está activado
- Verificar que el texto en Typebot contiene exactamente `[transfer_human]`
- Buscar en logs: `[Coordination] Detected [transfer_human] marker`

### Override per-instance no toma efecto
- Verificar que el JSON en `coordinationSettings` es válido
- No requiere reinicio, verificar con `GET /manage/status`

---

## Próximos pasos

1. **Performance:** Cache para `hasHumanAgentAssigned()` (actualmente HTTP por cada mensaje)
2. **Otros bots:** Extender `[transfer_human]` a OpenAI, Dify, N8N
3. **Tests unitarios:** Mock de Prisma + axios para `ChatbotChatwootService`
4. **Logs:** Mover debug logging extensivo a `.verbose()` para producción
