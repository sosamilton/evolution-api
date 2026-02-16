# Typebot: Selección numérica de opciones

## Problema

Cuando Typebot enviaba opciones (choice input) al usuario vía WhatsApp, se mostraban con un emoji ▶️ como prefijo:

```
▶️ Inmobiliario
▶️ Automotor
▶️ IIBB
▶️ Atencion Personalizada
```

Esto generaba dos problemas:
1. **UX confusa**: el usuario no sabía cómo responder
2. **Respuesta exacta requerida**: el usuario debía escribir el texto completo de la opción (ej: "Atencion Personalizada") para que Typebot lo reconociera. Cualquier diferencia (mayúsculas, tildes, espacios) rompía el flujo.

## Solución

Se reemplazó el formato con **lista numerada en negrita** y se agregó **resolución de respuestas numéricas**:

```
*1.* Inmobiliario
*2.* Automotor
*3.* IIBB
*4.* Atencion Personalizada
```

Ahora el usuario puede responder de dos formas:
- **Con el número**: escribir `3` selecciona "IIBB"
- **Con el texto**: escribir `IIBB` sigue funcionando como antes

## Implementación técnica

### Archivo modificado
`src/api/integrations/chatbot/typebot/services/typebot.service.ts`

### Cambios realizados

#### 1. Formato de opciones (método `processMessages`)
```typescript
// Antes
for (const item of items) {
  formattedText += `▶️ ${item.content}\n`;
}

// Después
const choiceMap: Record<string, string> = {};
for (let i = 0; i < items.length; i++) {
  formattedText += `*${i + 1}.* ${items[i].content}\n`;
  choiceMap[String(i + 1)] = items[i].content;
}
```

#### 2. Persistencia del mapeo en sesión
Al mostrar las opciones, se guarda el mapeo número→texto en el campo `parameters` de la sesión (`IntegrationSession`):

```typescript
const updatedParams: any = {
  ...currentParams,
  lastChoiceMap: { "1": "Inmobiliario", "2": "Automotor", ... },
};
await prismaRepository.integrationSession.update({
  where: { id: session.id },
  data: { awaitUser: true, parameters: updatedParams },
});
```

#### 3. Resolución de respuesta numérica (método `processTypebot`)
Cuando el usuario responde, se lee el `lastChoiceMap` de la sesión y se traduce el número al texto de la opción antes de enviarlo a la API de Typebot:

```typescript
const freshSession = await this.prismaRepository.integrationSession.findUnique({
  where: { id: session.id },
});
const sessionParams = (freshSession?.parameters as Record<string, any>) || {};
if (sessionParams.lastChoiceMap && sessionParams.lastChoiceMap[content.trim()]) {
  resolvedContent = sessionParams.lastChoiceMap[content.trim()];
  // Se limpia el choiceMap después de usarlo
}
```

### Flujo completo

```
1. Typebot envía choice input con items ["Inmobiliario", "Automotor", "IIBB", "Atencion Personalizada"]
2. Evolution API formatea como "*1.* Inmobiliario\n*2.* Automotor\n..."
3. Se guarda choiceMap: {"1":"Inmobiliario", "2":"Automotor", "3":"IIBB", "4":"Atencion Personalizada"}
4. Usuario responde "3"
5. Evolution API lee choiceMap de la sesión, traduce "3" → "IIBB"
6. Se envía "IIBB" a la API de Typebot (continueChat)
7. Se limpia el choiceMap de la sesión
8. Typebot continúa el flujo normalmente
```

## Compatibilidad

- **Sin breaking changes**: los usuarios que escriban el texto completo de la opción siguen funcionando igual
- **No requiere migración de DB**: usa el campo JSON `parameters` existente en `IntegrationSession`
- **No requiere cambios en Typebot**: la traducción ocurre antes de enviar a la API de Typebot
