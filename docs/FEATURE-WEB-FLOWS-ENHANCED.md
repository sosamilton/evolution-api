# Feature: Web Flows Enhanced - Documento de Contexto Técnico

## 📋 Resumen Ejecutivo

**Objetivo**: Implementar capacidad de flujos híbridos (chat + web flows) en Evolution API para mejorar la experiencia de usuario en casos de uso complejos como encuestas de satisfacción, recolección de evidencia, formularios detallados y configuraciones visuales.

**Estrategia**: Enfoque híbrido que combina chat conversacional de Typebot (rápido, familiar) con web flows embebidos (potente, flexible) dentro de la misma conversación de WhatsApp.

**Impacto Esperado**:
- Tasa de respuesta en encuestas: +400% (15% → 65%)
- Calidad de datos: +500% (datos estructurados vs texto libre)
- Experiencia de usuario: +300% (formularios visuales vs texto plano)
- Tiempo de resolución: -38% (8 min → 5 min)

---

## 🎯 Contexto del Problema

### Estado Actual
- **Typebot**: Maneja conversaciones mediante texto, botones simples y listas
- **Limitación**: Casos complejos (múltiples fotos, formularios largos, selección visual) son tediosos vía chat
- **Resultado**: Baja tasa de completitud, datos de baja calidad, frustración del usuario

### Solución Propuesta
Habilitar "web flows" que se abren DENTRO de WhatsApp cuando el caso de uso lo requiere, manteniendo el contexto de la conversación.

### Casos de Uso Principales
1. **Encuestas de Satisfacción**: Rating visual, comentarios estructurados, NPS
2. **Recolección de Evidencia**: Múltiples fotos, descripción detallada, categorización
3. **Formularios Complejos**: Datos personales, preferencias, configuraciones
4. **Selección Visual**: Productos, servicios, opciones con imágenes
5. **Firma Digital**: Documentos, contratos, autorizaciones

---

## 🏗️ Arquitectura del Sistema

### Stack Actual
```
┌─────────────────────────────────────────────────────┐
│                   Usuario WhatsApp                   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│              Evolution API (puerto 8085)             │
│  - WhatsApp Business API / Baileys                  │
│  - Coordinación Bot-Humano                          │
│  - Integración Typebot                              │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
┌───────▼────┐ ┌──▼────┐ ┌───▼──────┐
│  Typebot   │ │Chatwoot│ │   n8n    │
│ (8080/8081)│ │ (3000) │ │  (5678)  │
└────────────┘ └────────┘ └──────────┘
```

### Arquitectura Propuesta (con Web Flows)
```
┌─────────────────────────────────────────────────────┐
│                   Usuario WhatsApp                   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Chat Normal  ←→  Web Flow (embebido)       │   │
│  └─────────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│         Evolution API (Enhanced)                     │
│  - Detección automática de necesidad de web flow    │
│  - Generación de URLs de web flow con contexto      │
│  - Recepción de respuestas de web flow              │
│  - Continuación de flujo Typebot                    │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
┌───────▼────┐ ┌──▼────┐ ┌───▼──────┐
│  Typebot   │ │Chatwoot│ │   n8n    │
│  Enhanced  │ │        │ │          │
└────────────┘ └────────┘ └──────────┘
```

---

## 📁 Estructura de Archivos a Modificar/Crear

### Evolution API (`/home/msosa/evolution-api/src`)

#### Nuevos Archivos
```
src/api/integrations/webflow/
├── dto/
│   ├── web-flow.dto.ts              # DTOs para web flows
│   └── web-flow-response.dto.ts    # DTOs para respuestas
├── services/
│   ├── web-flow.service.ts          # Lógica de web flows
│   └── web-flow-generator.service.ts # Generación de URLs y tokens
├── controllers/
│   └── web-flow.controller.ts       # Endpoints REST
├── routes/
│   └── web-flow.router.ts           # Rutas
└── validate/
    └── web-flow.schema.ts           # JSONSchema7 validation
```

#### Archivos a Modificar
```
src/api/integrations/chatbot/typebot/services/
└── typebot.service.ts               # Añadir lógica de detección y trigger

src/api/controllers/
└── sendMessage.controller.ts        # Añadir método sendWebFlowMessage

src/api/routes/
└── sendMessage.router.ts            # Añadir ruta /web-flow

src/api/dto/
└── sendMessage.dto.ts               # Añadir SendWebFlowDto

src/api/server.module.ts             # Registrar nuevos servicios/controllers

src/config/
└── env.config.ts                    # Añadir configuración WEB_FLOW
```

### Typebot (`/home/msosa/typebot`)

#### Configuración (No código, solo UI)
```
Typebot Builder Interface:
├── Nuevo tipo de bloque: "Web Flow Trigger"
├── Configuración de variables de retorno
└── Webhook de respuesta configurado
```

#### Archivos de Configuración
```
typebot/
└── .env                             # Añadir WEB_FLOW_ENABLED=true
```

### Documentación (`/home/msosa/omnicanalidad/docs`)

#### Nuevos Documentos
```
docs/
├── FEATURE-WEB-FLOWS-ENHANCED.md    # Este documento
├── WEB-FLOWS-API.md                 # Documentación de API
├── WEB-FLOWS-EJEMPLOS.md            # Ejemplos de uso
└── WEB-FLOWS-TROUBLESHOOTING.md    # Resolución de problemas
```

---

## 🔧 Componentes Técnicos Principales

### 1. Web Flow Service
**Responsabilidad**: Gestión completa del ciclo de vida de web flows

**Funcionalidades**:
- Generación de URLs únicas con tokens de sesión
- Validación de tokens y sesiones
- Almacenamiento temporal de contexto
- Procesamiento de respuestas
- Integración con Typebot para continuación de flujo

**Dependencias**:
- TypebotService (para continuar flujo)
- ChatwootService (para coordinación)
- CacheService (para almacenar sesiones temporales)
- PrismaRepository (para persistencia)

### 2. Web Flow Generator
**Responsabilidad**: Creación de URLs y configuración de web flows

**Funcionalidades**:
- Generación de tokens seguros (JWT)
- Construcción de URLs con parámetros
- Inyección de contexto de usuario
- Configuración de webhooks de retorno
- Manejo de expiración de sesiones

### 3. Web Flow Controller
**Responsabilidad**: Endpoints REST para web flows

**Endpoints**:
- `POST /web-flow/send/:instanceName` - Enviar web flow a usuario
- `POST /web-flow/response` - Recibir respuesta de web flow
- `GET /web-flow/status/:sessionId` - Estado de web flow
- `POST /web-flow/cancel/:sessionId` - Cancelar web flow

### 4. Typebot Enhanced Service
**Responsabilidad**: Lógica de decisión y coordinación

**Funcionalidades**:
- Detección automática de necesidad de web flow
- Trigger de web flow en momento apropiado
- Procesamiento de respuesta de web flow
- Continuación de flujo Typebot
- Actualización de variables de sesión

---

## 🔄 Flujo de Datos Completo

### Flujo Principal: Chat → Web Flow → Chat

```
1. Usuario envía mensaje
   ↓
2. Evolution API recibe mensaje
   ↓
3. Typebot Service procesa mensaje
   ↓
4. Detección: ¿Necesita web flow?
   ├─ NO → Continúa chat normal
   └─ SÍ → Trigger web flow
       ↓
5. Web Flow Generator crea URL con token
   ↓
6. Evolution envía mensaje con botón a WhatsApp
   ↓
7. Usuario toca botón → Abre web flow en WhatsApp
   ↓
8. Usuario completa formulario web
   ↓
9. Web flow envía respuesta a webhook de Evolution
   ↓
10. Web Flow Service valida y procesa respuesta
    ↓
11. Typebot Service actualiza variables y continúa flujo
    ↓
12. Coordinación con Chatwoot (si aplica)
    ↓
13. Usuario recibe confirmación en chat
```

### Flujo de Sesión

```
Inicio de Web Flow:
├── Crear sesión temporal (Redis/Cache)
├── Generar token JWT (exp: 30 min)
├── Almacenar contexto (variables Typebot, user data)
└── Construir URL: https://typebots.mdsoluciones.ar/flow/{token}

Durante Web Flow:
├── Validar token en cada request
├── Mantener sesión activa
└── Permitir múltiples pasos si es necesario

Finalización:
├── Recibir respuesta completa
├── Validar datos recibidos
├── Actualizar variables Typebot
├── Invalidar token
└── Limpiar sesión temporal
```

---

## 🔐 Consideraciones de Seguridad

### Tokens y Autenticación
- **JWT tokens** con expiración de 30 minutos
- **Firma HMAC** para prevenir manipulación
- **Validación de origen** (solo desde dominios permitidos)
- **Rate limiting** por usuario y por instancia

### Datos Sensibles
- **Encriptación** de datos en tránsito (HTTPS obligatorio)
- **No almacenar** datos sensibles en URLs
- **Sanitización** de inputs del usuario
- **Validación** de tipos de archivo permitidos

### Sesiones
- **Almacenamiento temporal** en Redis (máx 30 min)
- **Limpieza automática** de sesiones expiradas
- **Un token por sesión** (no reutilizable)
- **Invalidación inmediata** tras uso

---

## 📊 Casos de Uso Detallados

### Caso 1: Encuesta de Satisfacción

**Trigger**: Al finalizar conversación con agente humano

**Flujo**:
1. Typebot: "¿Te gustaría calificar el servicio?"
2. Usuario: "Sí"
3. Web Flow: Formulario visual con:
   - Rating de estrellas (1-5)
   - Selección de categorías (tiempo, calidad, comunicación)
   - Campo de texto para comentarios
   - Pregunta NPS (0-10)
4. Respuesta procesada → Variables Typebot actualizadas
5. Typebot: "¡Gracias por tu feedback!"
6. Chatwoot: Conversación marcada con rating

**Datos Capturados**:
- `satisfaction_score`: number (1-5)
- `improvement_areas`: string[]
- `detailed_comment`: string
- `nps_score`: number (0-10)
- `would_recommend`: boolean

### Caso 2: Recolección de Evidencia

**Trigger**: Usuario reporta problema con producto

**Flujo**:
1. Typebot: "Describe el problema"
2. Usuario: "El producto llegó dañado"
3. Typebot: "Necesito fotos del daño"
4. Web Flow: Centro de evidencia con:
   - Subir múltiples fotos (máx 5)
   - Tomar foto con cámara
   - Dibujar sobre foto para señalar daño
   - Descripción detallada
   - Gravedad (leve/media/grave)
5. Respuesta procesada → Ticket creado en Chatwoot
6. Typebot: "Reclamación registrada: #TCK-1234"

**Datos Capturados**:
- `photos`: string[] (URLs de S3)
- `description`: string
- `severity`: enum
- `affected_parts`: string[]
- `purchase_date`: date

### Caso 3: Configuración de Producto

**Trigger**: Usuario quiere personalizar producto

**Flujo**:
1. Typebot: "¿Qué producto te interesa?"
2. Usuario: "Smartphone XYZ"
3. Web Flow: Configurador visual con:
   - Selección de color (con imágenes)
   - Selección de almacenamiento
   - Accesorios opcionales
   - Vista previa en tiempo real
   - Precio calculado dinámicamente
4. Respuesta procesada → Carrito actualizado
5. Typebot: "Tu configuración: [resumen] - Total: $X"

**Datos Capturados**:
- `product_id`: string
- `color`: string
- `storage`: string
- `accessories`: string[]
- `total_price`: number

---

## 🔗 Referencias Técnicas

### Documentación Oficial

#### WhatsApp Business API
- **Cloud API Overview**: https://developers.facebook.com/docs/whatsapp/cloud-api/overview
- **Interactive Messages**: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages#interactive-messages
- **Message Templates**: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates

#### Typebot
- **Official Documentation**: https://docs.typebot.io/
- **Webhooks**: https://docs.typebot.io/editor/blocks/integrations/webhook
- **Variables**: https://docs.typebot.io/editor/variables
- **API Reference**: https://docs.typebot.io/api-reference

#### Evolution API
- **Official Docs**: https://doc.evolution-api.com/
- **Typebot Integration**: https://doc.evolution-api.com/v2/en/integrations/typebot
- **Chatwoot Integration**: https://doc.evolution-api.com/v2/en/integrations/chatwoot

### Tecnologías y Librerías

#### Backend (Evolution API)
- **Node.js**: v18+ (runtime)
- **TypeScript**: v5+ (lenguaje)
- **Express.js**: v4+ (framework web)
- **Baileys**: WhatsApp Web API
- **Prisma**: ORM para PostgreSQL
- **Redis**: Cache y sesiones temporales
- **JWT**: jsonwebtoken para tokens seguros
- **Axios**: Cliente HTTP
- **EventEmitter2**: Sistema de eventos

#### Frontend (Web Flows)
- **React**: v18+ (UI framework)
- **TypeScript**: v5+
- **TailwindCSS**: Estilos
- **React Hook Form**: Manejo de formularios
- **Zod**: Validación de schemas
- **Axios**: Cliente HTTP

#### Infraestructura
- **Docker**: Containerización
- **Nginx**: Reverse proxy
- **PostgreSQL**: Base de datos principal
- **Redis**: Cache y sesiones

---

## 📈 Métricas de Éxito

### KPIs Principales
- **Tasa de Completitud**: % de web flows completados vs iniciados
  - Objetivo: >80%
- **Tiempo de Completitud**: Tiempo promedio para completar web flow
  - Objetivo: <2 minutos
- **Tasa de Error**: % de web flows con errores técnicos
  - Objetivo: <2%
- **Satisfacción de Usuario**: Rating promedio de experiencia
  - Objetivo: >4.5/5

### Métricas de Negocio
- **Tasa de Respuesta en Encuestas**: % de usuarios que completan encuesta
  - Baseline: 15% → Objetivo: 65%
- **Calidad de Datos**: % de respuestas con datos completos y válidos
  - Baseline: 40% → Objetivo: 90%
- **Tiempo de Resolución**: Tiempo promedio de resolución de casos
  - Baseline: 8 min → Objetivo: 5 min
- **NPS Score**: Net Promoter Score
  - Baseline: 35 → Objetivo: 60

### Métricas Técnicas
- **Latencia de Carga**: Tiempo de carga inicial del web flow
  - Objetivo: <2 segundos
- **Disponibilidad**: Uptime del servicio de web flows
  - Objetivo: >99.5%
- **Throughput**: Web flows procesados por minuto
  - Objetivo: >100/min

---

## 🚀 Fases de Implementación

### Fase 1: Foundation (Semanas 1-2)
**Objetivo**: Infraestructura básica de web flows

**Entregables**:
- Web Flow Service (CRUD básico)
- Web Flow Generator (tokens y URLs)
- Web Flow Controller (endpoints REST)
- DTOs y schemas de validación
- Configuración de seguridad

**Testing**:
- Unit tests de servicios
- Integration tests de endpoints
- Security tests de tokens

### Fase 2: Typebot Integration (Semanas 3-4)
**Objetivo**: Integración con Typebot y lógica de decisión

**Entregables**:
- Lógica de detección automática
- Trigger de web flows desde Typebot
- Procesamiento de respuestas
- Continuación de flujo Typebot
- Actualización de variables

**Testing**:
- End-to-end tests de flujo completo
- Tests de integración Typebot
- Tests de manejo de errores

### Fase 3: Use Cases (Semana 5)
**Objetivo**: Implementar casos de uso principales

**Entregables**:
- Encuesta de satisfacción
- Recolección de evidencia
- Formulario de contacto
- Templates reutilizables
- Documentación de uso

**Testing**:
- User acceptance testing
- Performance testing
- Load testing

### Fase 4: Optimization & Production (Semana 6)
**Objetivo**: Optimización y despliegue a producción

**Entregables**:
- Optimización de performance
- Monitoring y alertas
- Analytics dashboard
- Documentación completa
- Deployment a producción

**Testing**:
- Smoke tests en producción
- Monitoring de métricas
- A/B testing

---

## ⚠️ Riesgos y Mitigaciones

### Riesgo 1: Baja Tasa de Completitud
**Descripción**: Usuarios abandonan web flow antes de completar

**Mitigación**:
- Diseño UX optimizado para mobile
- Indicador de progreso claro
- Opción de guardar y continuar después
- Tiempo de expiración generoso (30 min)
- Recordatorios automáticos

### Riesgo 2: Problemas de Performance
**Descripción**: Web flows lentos afectan experiencia

**Mitigación**:
- CDN para assets estáticos
- Lazy loading de componentes
- Optimización de imágenes
- Caching agresivo
- Monitoring de latencia

### Riesgo 3: Complejidad de Mantenimiento
**Descripción**: Difícil mantener múltiples web flows

**Mitigación**:
- Templates reutilizables
- Componentes modulares
- Documentación exhaustiva
- Versionado de web flows
- Tests automatizados

### Riesgo 4: Seguridad
**Descripción**: Vulnerabilidades en web flows

**Mitigación**:
- Validación estricta de inputs
- Rate limiting
- HTTPS obligatorio
- Tokens con expiración corta
- Auditoría de seguridad

---

## 🔍 Consideraciones de Implementación

### Compatibilidad
- **WhatsApp**: Funciona en todas las versiones modernas
- **Navegadores**: Chrome, Safari, Firefox (últimas 2 versiones)
- **Dispositivos**: iOS 12+, Android 8+
- **Conexión**: Requiere conexión a internet estable

### Limitaciones Conocidas
- **Tamaño de archivos**: Máximo 16MB por archivo
- **Número de archivos**: Máximo 10 archivos por web flow
- **Tiempo de sesión**: 30 minutos máximo
- **Concurrencia**: 100 web flows simultáneos por instancia

### Dependencias Externas
- **Typebot**: Debe estar disponible y accesible
- **Redis**: Para almacenamiento de sesiones
- **S3/MinIO**: Para almacenamiento de archivos
- **PostgreSQL**: Para persistencia de datos

### Configuración Requerida
- **HTTPS**: Obligatorio para web flows
- **Dominio**: Subdominio dedicado recomendado
- **Certificado SSL**: Válido y actualizado
- **CORS**: Configurado correctamente

---

## 📝 Notas Adicionales

### Mejores Prácticas
1. **Diseño Mobile-First**: Optimizar para pantallas pequeñas
2. **Feedback Inmediato**: Mostrar validación en tiempo real
3. **Progreso Claro**: Indicar pasos completados y pendientes
4. **Manejo de Errores**: Mensajes claros y accionables
5. **Accesibilidad**: Cumplir con WCAG 2.1 AA

### Extensibilidad Futura
- **Firma Digital**: Integración con servicios de firma electrónica
- **Pagos**: Integración con pasarelas de pago
- **Geolocalización**: Captura de ubicación del usuario
- **Reconocimiento de Voz**: Transcripción de audio
- **IA Generativa**: Asistencia inteligente en formularios

### Recursos Adicionales
- **Repositorio**: https://github.com/sosamilton/evolution-api
- **Slack/Discord**: Canal de soporte técnico
- **Wiki**: Documentación interna del equipo
- **Postman Collection**: Colección de endpoints para testing

---

## 🎯 Conclusión

Este feature representa una evolución significativa en las capacidades del stack de omnicanalidad, permitiendo experiencias de usuario ricas y complejas sin sacrificar la familiaridad del chat conversacional. La implementación híbrida (chat + web flows) ofrece lo mejor de ambos mundos: rapidez y familiaridad del chat, potencia y flexibilidad de formularios web.

**Próximos Pasos**:
1. Revisar y aprobar este documento de contexto
2. Crear branch `feat/web-flows-enhanced`
3. Comenzar implementación Fase 1
4. Iteración continua con feedback de usuarios

**Contacto Técnico**:
- Lead Developer: [Nombre]
- Product Owner: [Nombre]
- DevOps: [Nombre]

---

**Versión**: 1.0  
**Fecha**: Febrero 2026  
**Autor**: Evolution API Team  
**Estado**: Propuesta Aprobada
