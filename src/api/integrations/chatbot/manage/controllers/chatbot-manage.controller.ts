import { InstanceDto } from '@api/dto/instance.dto';
import { ChatbotChatwootService } from '@api/integrations/chatbot/chatbot-chatwoot.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';

import { ChatbotManageDto } from '../dto/chatbot-manage.dto';

export class ChatbotManageController {
  private readonly logger = new Logger('ChatbotManageController');

  constructor(
    private readonly chatbotChatwootService: ChatbotChatwootService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  public async manage(instance: InstanceDto, data: ChatbotManageDto) {
    const instanceDb = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
    });

    if (!instanceDb) {
      throw new BadRequestException('Instance not found');
    }

    if (!data.remoteJid) {
      throw new BadRequestException('remoteJid is required');
    }

    // Normalize remoteJid
    const remoteJid = data.remoteJid.includes('@') ? data.remoteJid : `${data.remoteJid}@s.whatsapp.net`;

    this.logger.log(`[Manage] action=${data.action}, instance=${instance.instanceName}, remoteJid=${remoteJid}`);

    switch (data.action) {
      case 'transfer_human': {
        const result = await this.chatbotChatwootService.transferToHuman(
          instanceDb.id,
          remoteJid,
          data.chatwoot?.assigneeId,
          data.chatwoot?.teamId,
        );
        return { action: 'transfer_human', ...result };
      }

      case 'resolve_bot': {
        const resolveChatwoot = data.chatwoot?.status !== undefined ? data.chatwoot.status === 'resolved' : true;
        const result = await this.chatbotChatwootService.resolveBot(instanceDb.id, remoteJid, resolveChatwoot);
        return { action: 'resolve_bot', ...result };
      }

      case 'pause_bot': {
        const result = await this.chatbotChatwootService.pauseBot(instanceDb.id, remoteJid);
        return { action: 'pause_bot', ...result };
      }

      case 'resume_bot': {
        const result = await this.chatbotChatwootService.resumeBot(instanceDb.id, remoteJid);
        return { action: 'resume_bot', ...result };
      }

      default:
        throw new BadRequestException(
          `Invalid action: ${data.action}. Valid actions: transfer_human, resolve_bot, pause_bot, resume_bot`,
        );
    }
  }
}
