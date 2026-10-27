import { ConversationMessage } from '@prisma/client';
import { ApiTokenUsageSource, toApiTokenUsageSource } from '../common/enums/usage.enums';

export type ApiConversationMessage = Omit<ConversationMessage, 'tokenUsageSource'> & {
  tokenUsageSource: ApiTokenUsageSource | null;
};

/** Converts a stored message to its public shape (hyphenated token usage source). */
export function toApiMessage(message: ConversationMessage): ApiConversationMessage {
  return {
    ...message,
    tokenUsageSource:
      message.tokenUsageSource == null
        ? message.tokenUsageSource
        : toApiTokenUsageSource(message.tokenUsageSource),
  };
}
