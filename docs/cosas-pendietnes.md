## Pendientes de implementación

### Logs y Debug
- [ ] Mover logs extensivos de `emit()` en `base-chatbot.controller.ts` de `.log()` a `.verbose()` para producción
- [ ] Revisar logs de coordinación (`[Coordination]`): mantener `.log()` para acciones, `.error()` para errores
- [ ] Evaluar si los logs de cada integración individual necesitan niveles separados

### Scripts de Setup
- [ ] Script para crear reglas de derivación a humanos (ahora se puede vía `/chatbot/manage/action` con `transfer_human`)
- [ ] Script para crear integración con Typebot (configurar bot con settings recomendados: keepOpen=false, expire=30, stopBotFromMe=true)
- [ ] Script para crear integración con Chatwoot (configurar instancia con reopenConversation=false, conversationPending=true)
- [ ] Unificar scripts con config JSON seleccionable, valores por defecto para correcta integración

### Documentación
- [x] Documentar problema y solución de la integración con Typebot → `docs/coordinacion-typebot-chatwoot.md`
- [x] Documentar configuración de coordinación (env vars + per-instance) → sección 10 en `docs/coordinacion-typebot-chatwoot.md`

### Configuración de Coordinación
- [x] Env vars globales: `CHATBOT_COORDINATION_CHECK_AGENT`, `AUTO_PAUSE`, `AUTO_RESOLVE`, `MANAGE_ENABLED`
- [x] Override per-instance: campo `coordinationSettings` (JSON) en modelo Chatwoot
- [x] `getCoordinationConfig()` en `ChatbotChatwootService` (merge global + per-instance)
- [x] Wrap `checkAgent` en `base-chatbot.controller.ts` con config
- [x] Wrap `autoPause` en `chatwoot.service.ts` con config
- [x] Wrap `autoResolve` en `typebot.service.ts` con config
- [x] Wrap `/chatbot/manage` con `manageEnabled` config
- [x] GET `/chatbot/manage/status` devuelve config actual de coordinación
- [x] Migración DB: `coordinationSettings JSONB` (PostgreSQL) / `JSON` (MySQL)
- [x] Endpoint REST para configurar `coordinationSettings` per-instance (via POST `/chatwoot/set/{instanceName}`)

### Contribución
- [ ] Preparar PR para contribución pública (separar commits, limpiar logs de debug, escribir descripción del PR)

### Mejoras Técnicas (post-coordinación)
- [ ] Cache de verificación de agente: `hasHumanAgentAssigned()` hace HTTP por cada mensaje → implementar cache con TTL 30s
- [ ] Webhook de Chatwoot para assignment: en vez de consultar API, escuchar `conversation_updated`
- [ ] Soporte `resolveChatwootConversation` en otros bots (actualmente solo TypebotService, mover a BaseChatbotService)
- [ ] Tests unitarios para `ChatbotChatwootService` (mock Prisma + axios)