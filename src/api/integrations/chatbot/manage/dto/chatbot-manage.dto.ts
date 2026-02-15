export class ChatbotManageDto {
  action: 'transfer_human' | 'resolve_bot' | 'pause_bot' | 'resume_bot';
  remoteJid: string;
  chatwoot?: {
    status?: 'open' | 'resolved' | 'pending';
    assigneeId?: number;
    teamId?: number;
  };
}
