import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { ChatbotCoordination, Chatwoot, ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import axios from 'axios';

/**
 * Per-instance coordination config. Resolved by merging:
 *   1. Global env var defaults (CHATBOT_COORDINATION_*)
 *   2. Per-instance override (Chatwoot.coordinationSettings JSON field)
 */
export interface CoordinationConfig {
  checkAgent: boolean;
  autoPause: boolean;
  autoResolve: boolean;
  manageEnabled: boolean;
  detectTransferMarker: boolean;
}

/**
 * Coordination service between chatbot integrations and Chatwoot.
 * Handles: bot pause on human takeover, conversation resolution on bot completion,
 * and explicit management actions (transfer_human, resolve_bot, pause_bot, resume_bot).
 *
 * All behaviors are configurable via env vars (global) and per-instance override.
 */
export class ChatbotChatwootService {
  private readonly logger = new Logger('ChatbotChatwootService');

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check if Chatwoot integration is globally enabled
   */
  public isEnabled(): boolean {
    return this.configService.get<Chatwoot>('CHATWOOT').ENABLED;
  }

  /**
   * Get global coordination defaults from env vars
   */
  private getGlobalDefaults(): CoordinationConfig {
    const global = this.configService.get<ChatbotCoordination>('CHATBOT_COORDINATION');
    return {
      checkAgent: global.CHECK_AGENT,
      autoPause: global.AUTO_PAUSE,
      autoResolve: global.AUTO_RESOLVE,
      manageEnabled: global.MANAGE_ENABLED,
      detectTransferMarker: global.DETECT_TRANSFER_MARKER,
    };
  }

  /**
   * Resolve coordination config for a specific instance.
   * Per-instance values (from Chatwoot.coordinationSettings) override global env var defaults.
   */
  public async getCoordinationConfig(instanceId: string): Promise<CoordinationConfig> {
    const defaults = this.getGlobalDefaults();

    try {
      const provider = await this.getProvider(instanceId);
      const override = provider?.coordinationSettings as Partial<CoordinationConfig> | null;

      if (!override) return defaults;

      return {
        checkAgent: override.checkAgent ?? defaults.checkAgent,
        autoPause: override.autoPause ?? defaults.autoPause,
        autoResolve: override.autoResolve ?? defaults.autoResolve,
        manageEnabled: override.manageEnabled ?? defaults.manageEnabled,
        detectTransferMarker: override.detectTransferMarker ?? defaults.detectTransferMarker,
      };
    } catch (error) {
      this.logger.error(`[Coordination] Error reading instance config, using defaults: ${error?.message}`);
      return defaults;
    }
  }

  /**
   * Get the Chatwoot provider config for an instance
   */
  private async getProvider(instanceId: string) {
    return this.prismaRepository.chatwoot.findFirst({
      where: { instanceId },
    });
  }

  /**
   * Check if a conversation in Chatwoot has a human agent assigned.
   * Returns true if an agent is assigned (bot should NOT process).
   * Respects the checkAgent config flag.
   */
  public async hasHumanAgentAssigned(instanceId: string, chatwootConversationId: number): Promise<boolean> {
    if (!chatwootConversationId) return false;

    try {
      const config = await this.getCoordinationConfig(instanceId);
      if (!config.checkAgent) return false;

      const provider = await this.getProvider(instanceId);
      if (!provider?.enabled || !provider.url || !provider.token || !provider.accountId) return false;

      const response = await axios.get(
        `${provider.url}/api/v1/accounts/${provider.accountId}/conversations/${chatwootConversationId}`,
        {
          headers: { api_access_token: provider.token },
          timeout: 5000,
        },
      );

      const conversation = response.data;
      const hasAssignee = !!conversation?.meta?.assignee;
      const status = conversation?.status;

      if (hasAssignee && status === 'open') {
        this.logger.log(
          `[Coordination] Conversation ${chatwootConversationId} has human agent assigned (status: ${status}), bot should not process`,
        );
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`[Coordination] Error checking agent assignment: ${error?.message}`);
      return false;
    }
  }

  /**
   * Pause all active bot sessions for a given remoteJid on an instance.
   * Called when a human agent responds from Chatwoot.
   */
  public async pauseBotSessionsForJid(instanceId: string, remoteJid: string): Promise<number> {
    try {
      const result = await this.prismaRepository.integrationSession.updateMany({
        where: {
          instanceId,
          remoteJid,
          status: 'opened',
        },
        data: {
          status: 'paused',
        },
      });

      if (result.count > 0) {
        this.logger.log(`[Coordination] Paused ${result.count} bot session(s) for ${remoteJid} (human agent responded)`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`[Coordination] Error pausing bot sessions: ${error?.message}`);
      return 0;
    }
  }

  /**
   * Resolve (or change status of) a Chatwoot conversation.
   * Called when a bot flow completes.
   */
  public async updateChatwootConversationStatus(
    instanceId: string,
    remoteJid: string,
    status: 'open' | 'resolved' | 'pending',
    assigneeId?: number,
    teamId?: number,
  ): Promise<boolean> {
    try {
      const provider = await this.getProvider(instanceId);
      if (!provider?.enabled || !provider.url || !provider.token || !provider.accountId) return false;

      // Find the conversation ID from cache or recent messages
      const conversationId = await this.findChatwootConversationId(instanceId, remoteJid, provider);
      if (!conversationId) {
        this.logger.warn(`[Coordination] No Chatwoot conversation found for ${remoteJid}`);
        return false;
      }

      // Update conversation status
      await axios.post(
        `${provider.url}/api/v1/accounts/${provider.accountId}/conversations/${conversationId}/toggle_status`,
        { status },
        {
          headers: { api_access_token: provider.token },
          timeout: 5000,
        },
      );

      this.logger.log(`[Coordination] Chatwoot conversation ${conversationId} status changed to: ${status}`);

      // Assign agent if specified
      if (assigneeId) {
        await axios.post(
          `${provider.url}/api/v1/accounts/${provider.accountId}/conversations/${conversationId}/assignments`,
          { assignee_id: assigneeId },
          {
            headers: { api_access_token: provider.token },
            timeout: 5000,
          },
        );
        this.logger.log(`[Coordination] Assigned agent ${assigneeId} to conversation ${conversationId}`);
      }

      // Assign team if specified
      if (teamId) {
        await axios.post(
          `${provider.url}/api/v1/accounts/${provider.accountId}/conversations/${conversationId}/assignments`,
          { team_id: teamId },
          {
            headers: { api_access_token: provider.token },
            timeout: 5000,
          },
        );
        this.logger.log(`[Coordination] Assigned team ${teamId} to conversation ${conversationId}`);
      }

      return true;
    } catch (error) {
      this.logger.error(`[Coordination] Error updating Chatwoot conversation: ${error?.message}`);
      return false;
    }
  }

  /**
   * Find the Chatwoot conversation ID for a given remoteJid.
   * Looks at the most recent message with a chatwootConversationId.
   */
  private async findChatwootConversationId(
    instanceId: string,
    remoteJid: string,
    provider: any,
  ): Promise<number | null> {
    // Strategy 1: Look at the most recent message with chatwootConversationId
    const recentMessage = await this.prismaRepository.message.findFirst({
      where: {
        instanceId,
        key: {
          path: ['remoteJid'],
          equals: remoteJid,
        },
        chatwootConversationId: { not: null },
      },
      orderBy: { messageTimestamp: 'desc' },
    });

    if (recentMessage?.chatwootConversationId) {
      return recentMessage.chatwootConversationId;
    }

    return null;
  }

  /**
   * Transfer to human: pause bot + open conversation in Chatwoot with optional assignment
   */
  public async transferToHuman(
    instanceId: string,
    remoteJid: string,
    assigneeId?: number,
    teamId?: number,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Pause bot sessions
    const paused = await this.pauseBotSessionsForJid(instanceId, remoteJid);

    // 2. Update Chatwoot conversation to open with assignment
    const chatwootUpdated = await this.updateChatwootConversationStatus(
      instanceId,
      remoteJid,
      'open',
      assigneeId,
      teamId,
    );

    return {
      success: paused > 0 || chatwootUpdated,
      message: `Paused ${paused} bot session(s), Chatwoot updated: ${chatwootUpdated}`,
    };
  }

  /**
   * Resolve bot: close bot session + resolve Chatwoot conversation
   */
  public async resolveBot(
    instanceId: string,
    remoteJid: string,
    resolveChatwoot: boolean = true,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Close/delete bot sessions
    const result = await this.prismaRepository.integrationSession.updateMany({
      where: {
        instanceId,
        remoteJid,
        status: { in: ['opened', 'paused'] },
      },
      data: {
        status: 'closed',
      },
    });

    let chatwootResolved = false;
    if (resolveChatwoot) {
      chatwootResolved = await this.updateChatwootConversationStatus(instanceId, remoteJid, 'resolved');
    }

    return {
      success: result.count > 0 || chatwootResolved,
      message: `Closed ${result.count} bot session(s), Chatwoot resolved: ${chatwootResolved}`,
    };
  }

  /**
   * Resume bot: reactivate a paused bot session
   */
  public async resumeBot(
    instanceId: string,
    remoteJid: string,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.prismaRepository.integrationSession.updateMany({
      where: {
        instanceId,
        remoteJid,
        status: 'paused',
      },
      data: {
        status: 'opened',
      },
    });

    return {
      success: result.count > 0,
      message: `Resumed ${result.count} bot session(s)`,
    };
  }

  /**
   * Pause bot: pause active bot sessions (without touching Chatwoot)
   */
  public async pauseBot(
    instanceId: string,
    remoteJid: string,
  ): Promise<{ success: boolean; message: string }> {
    const paused = await this.pauseBotSessionsForJid(instanceId, remoteJid);

    return {
      success: paused > 0,
      message: `Paused ${paused} bot session(s)`,
    };
  }
}
