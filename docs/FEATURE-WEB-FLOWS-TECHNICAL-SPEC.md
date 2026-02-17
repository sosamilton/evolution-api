# Web Flows Enhanced - Especificación Técnica

## Objetivo
Implementar sistema híbrido de conversación que permita transición fluida entre chat conversacional (Typebot) y formularios web embebidos dentro de WhatsApp, manteniendo contexto de sesión y coordinación bot-humano.

## Problema
Casos de uso complejos (encuestas multi-campo, upload múltiple de archivos, selección visual) son ineficientes vía chat secuencial. Baja tasa de completitud (15%), datos de baja calidad, alta fricción.

## Solución
Sistema de "web flows" que se activan automáticamente cuando la complejidad del caso de uso lo requiere, abriendo web view dentro de WhatsApp con formulario interactivo, retornando datos estructurados al flujo conversacional.

---

## Arquitectura

### Componentes Nuevos

**WebFlowService**
- Gestión de ciclo de vida de web flows
- Generación de tokens JWT (exp: 30min, HMAC-256)
- Almacenamiento temporal de sesiones en Redis
- Procesamiento de respuestas y validación
- Integración con TypebotService para continuación de flujo

**WebFlowGenerator**
- Construcción de URLs firmadas con contexto
- Inyección de variables de sesión Typebot
- Configuración de webhooks de retorno
- Manejo de expiración y renovación

**WebFlowController**
- `POST /web-flow/send/:instanceName` - Trigger web flow
- `POST /web-flow/response` - Webhook de respuesta
- `GET /web-flow/status/:sessionId` - Estado de sesión
- `DELETE /web-flow/cancel/:sessionId` - Cancelación

### Modificaciones a Componentes Existentes

**TypebotService**
- `shouldTriggerWebFlow(session, message): boolean` - Lógica de detección
- `launchWebFlow(instanceName, session, flowType): Promise<void>` - Activación
- `processWebFlowResponse(sessionId, data): Promise<void>` - Procesamiento
- Integración con ChatbotChatwootService para coordinación post-respuesta

**SendMessageController**
- Nuevo método `sendWebFlowMessage(instanceName, data)`
- Soporte para botones con deep links a web flows

---

## Flujo de Datos

```
1. Message → Evolution API → TypebotService
2. shouldTriggerWebFlow() → true
3. WebFlowGenerator.createSession()
   - Generate JWT token
   - Store context in Redis (TTL: 30min)
   - Build URL: https://typebots.mdsoluciones.ar/flow/{token}
4. SendMessage con button → WhatsApp
5. User tap → Open web view in WhatsApp
6. Web form submit → POST /web-flow/response
7. WebFlowService.processResponse()
   - Validate token
   - Extract data
   - Update Typebot variables
8. TypebotService.continueFlow()
9. ChatbotChatwootService coordination (if needed)
10. Response → WhatsApp
```

---

## Estructura de Archivos

### Nuevos
```
src/api/integrations/webflow/
├── dto/
│   ├── web-flow.dto.ts
│   └── web-flow-response.dto.ts
├── services/
│   ├── web-flow.service.ts
│   └── web-flow-generator.service.ts
├── controllers/
│   └── web-flow.controller.ts
├── routes/
│   └── web-flow.router.ts
└── validate/
    └── web-flow.schema.ts
```

### Modificar
```
src/api/integrations/chatbot/typebot/services/typebot.service.ts
src/api/controllers/sendMessage.controller.ts
src/api/routes/sendMessage.router.ts
src/api/dto/sendMessage.dto.ts
src/api/server.module.ts
src/config/env.config.ts
```

---

## DTOs Principales

**SendWebFlowDto**
- `number: string` - Destinatario
- `flowType: string` - Tipo de flow (satisfaction_survey, evidence_collection, etc)
- `sessionData: Record<string, any>` - Contexto de Typebot
- `expiresIn: number` - TTL en segundos (default: 1800)
- `webhookUrl?: string` - URL de retorno custom

**WebFlowResponseDto**
- `sessionId: string` - ID de sesión
- `token: string` - JWT token
- `data: Record<string, any>` - Datos del formulario
- `metadata: { completedAt, duration, userAgent }`

**WebFlowSessionDto**
- `sessionId: string`
- `instanceName: string`
- `remoteJid: string`
- `flowType: string`
- `typebotVariables: Record<string, any>`
- `createdAt: Date`
- `expiresAt: Date`

---

## Lógica de Detección

**Triggers Automáticos**
- Keywords: "adjuntar fotos", "subir documentos", "formulario", "encuesta"
- Estados Typebot: `evidence_collection`, `detailed_feedback`, `product_configuration`
- Condiciones: `messageCount > 5 && !hasStructuredData`
- Configuración por bot: `webFlowEnabled: true` en metadata

**Criterios de Decisión**
```
shouldTriggerWebFlow = (
  hasComplexDataRequirement ||
  requiresMultipleFiles ||
  needsVisualSelection ||
  isStructuredForm
) && !isSimpleQuestion
```

---

## Seguridad

**Token JWT**
- Algoritmo: HS256
- Payload: `{ sessionId, instanceName, remoteJid, flowType, exp, iat }`
- Secret: `process.env.WEB_FLOW_JWT_SECRET` (min 32 chars)
- Expiración: 30 minutos
- Single-use: Token invalidado tras uso exitoso

**Validaciones**
- Rate limiting: 10 web flows por usuario por hora
- CORS: Solo dominios whitelisted
- Input sanitization: Todos los campos del formulario
- File upload: Validación de tipo MIME y tamaño (max 16MB)
- HTTPS: Obligatorio en producción

**Sesiones**
- Storage: Redis con TTL automático
- Key pattern: `webflow:session:{sessionId}`
- Cleanup: Job cada 5 minutos para sesiones expiradas
- Encryption: Datos sensibles encriptados con AES-256

---

## Integración con Stack Existente

**Typebot**
- Variables actualizadas automáticamente post web-flow
- Continuación de flujo desde bloque siguiente
- Soporte para condicionales basados en respuesta de web flow
- Webhook configurado en Typebot apunta a Evolution API

**Chatwoot**
- Custom attributes actualizados con datos de web flow
- Trigger de coordinación según respuesta (ej: score < 7 → transfer_human)
- Conversación marcada con metadata de web flow completado
- Analytics de satisfacción integrados

**n8n**
- Webhook opcional para procesamiento adicional
- Integración con CRM/ERP basado en datos de web flow
- Automatizaciones post-respuesta

---

## Casos de Uso Implementados

**1. Satisfaction Survey**
- Trigger: Fin de conversación con agente
- Fields: rating (1-5), categories[], comment, nps (0-10)
- Post-process: Update Chatwoot, trigger coordination si rating < 7

**2. Evidence Collection**
- Trigger: Usuario reporta problema
- Fields: photos[] (max 5), description, severity, affected_parts[]
- Post-process: Upload a S3, crear ticket Chatwoot, notificar agente

**3. Product Configuration**
- Trigger: Usuario solicita personalización
- Fields: color, storage, accessories[], preview_image
- Post-process: Actualizar carrito, calcular precio, continuar checkout

---

## Variables de Entorno

```bash
# Web Flow Configuration
WEB_FLOW_ENABLED=true
WEB_FLOW_BASE_URL=https://typebots.mdsoluciones.ar
WEB_FLOW_JWT_SECRET=<32-char-secret>
WEB_FLOW_SESSION_TTL=1800
WEB_FLOW_MAX_FILE_SIZE=16777216
WEB_FLOW_ALLOWED_ORIGINS=https://typebots.mdsoluciones.ar,https://evolutionapi.mdsoluciones.ar

# Redis (para sesiones)
REDIS_URI=redis://localhost:6379
REDIS_PREFIX=webflow:

# S3 (para archivos)
S3_BUCKET=evolution-webflow-uploads
S3_REGION=us-east-1
```

---

## Métricas y Monitoring

**KPIs Técnicos**
- Latencia de generación de token: <100ms
- Latencia de carga de web flow: <2s
- Tasa de error de validación: <2%
- Uptime del servicio: >99.5%

**KPIs de Negocio**
- Completion rate: >80%
- Average completion time: <2min
- Data quality score: >90%
- User satisfaction: >4.5/5

**Logs Críticos**
- Web flow created: `{ sessionId, instanceName, flowType }`
- Web flow opened: `{ sessionId, timestamp, userAgent }`
- Web flow completed: `{ sessionId, duration, dataSize }`
- Web flow error: `{ sessionId, errorType, errorMessage }`

---

## Testing

**Unit Tests**
- WebFlowService: Generación de tokens, validación, procesamiento
- WebFlowGenerator: Construcción de URLs, inyección de contexto
- TypebotService: Lógica de detección, continuación de flujo

**Integration Tests**
- Flujo completo: Chat → Web Flow → Response → Continue Chat
- Coordinación: Web Flow → Chatwoot update → Transfer to human
- Error handling: Token expirado, sesión inválida, datos malformados

**E2E Tests**
- Satisfaction survey completo
- Evidence collection con uploads
- Timeout y cancelación de web flow

---

## Dependencias

**Nuevas Librerías**
- `jsonwebtoken`: ^9.0.0 - JWT generation/validation
- `uuid`: ^9.0.0 - Session ID generation
- `multer`: ^1.4.5 - File upload handling
- `sharp`: ^0.32.0 - Image processing

**Servicios Externos**
- Redis: Sesiones temporales
- S3/MinIO: Almacenamiento de archivos
- Typebot: Web flow frontend
- WhatsApp: Deep links y web view

---

## Limitaciones Técnicas

- Max 100 web flows concurrentes por instancia
- Session TTL fijo: 30 minutos (no renovable)
- File size limit: 16MB por archivo
- Max 10 archivos por web flow
- Solo HTTPS en producción
- Requiere WhatsApp versión moderna (iOS 12+, Android 8+)

---

## Rollout Strategy

**Fase 1 (Semana 1-2)**: Core infrastructure
- WebFlowService, Generator, Controller
- JWT tokens y sesiones Redis
- Endpoints REST básicos

**Fase 2 (Semana 3-4)**: Typebot integration
- Lógica de detección automática
- Trigger desde Typebot
- Procesamiento de respuestas
- Continuación de flujo

**Fase 3 (Semana 5)**: Use cases
- Satisfaction survey
- Evidence collection
- Product configuration

**Fase 4 (Semana 6)**: Production
- Performance optimization
- Monitoring y alertas
- Load testing
- Deployment

---

## Referencias Técnicas

- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Typebot API: https://docs.typebot.io/api-reference
- Evolution API: https://doc.evolution-api.com/
- JWT Best Practices: https://tools.ietf.org/html/rfc7519
- Redis Sessions: https://redis.io/docs/manual/patterns/

---

**Versión**: 1.0  
**Target**: Evolution API v2.3.8+  
**Status**: Ready for Implementation
