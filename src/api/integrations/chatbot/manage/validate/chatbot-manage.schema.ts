import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const chatbotManageSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['transfer_human', 'resolve_bot', 'pause_bot', 'resume_bot'],
    },
    remoteJid: { type: 'string' },
    chatwoot: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'pending'] },
        assigneeId: { type: 'integer' },
        teamId: { type: 'integer' },
      },
    },
  },
  required: ['action', 'remoteJid'],
};
