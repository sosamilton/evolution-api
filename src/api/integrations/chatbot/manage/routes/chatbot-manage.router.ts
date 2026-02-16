import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatbotManageDto } from '@api/integrations/chatbot/manage/dto/chatbot-manage.dto';
import { chatbotManageSchema } from '@api/integrations/chatbot/manage/validate/chatbot-manage.schema';
import { HttpStatus } from '@api/routes/index.router';
import { chatbotChatwootService, chatbotManageController } from '@api/server.module';
import { instanceSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

export class ChatbotManageRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('action'), ...guards, async (req, res) => {
        const response = await this.dataValidate<ChatbotManageDto>({
          request: req,
          schema: chatbotManageSchema,
          ClassRef: ChatbotManageDto,
          execute: async (instance, data) => {
            const config = await chatbotChatwootService.getCoordinationConfig(instance.instanceId);
            if (!config.manageEnabled) {
              return { error: 'Manage endpoint is disabled for this instance', status: 'disabled' };
            }
            return chatbotManageController.manage(instance, data);
          },
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('status'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => {
            const config = await chatbotChatwootService.getCoordinationConfig(instance.instanceId);
            return {
              status: 'ok',
              integration: 'chatbot-chatwoot-coordination',
              instance: instance.instanceName,
              coordination: config,
            };
          },
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
