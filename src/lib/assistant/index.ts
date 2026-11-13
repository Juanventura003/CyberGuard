import { localGuidedProvider } from "./localGuidedProvider";
import type { AssistantReplyProvider } from "./types";

export type {
  AssistantMessage,
  AssistantReplyProvider,
  AssistantRole,
} from "./types";
export {
  SUGGESTED_PROMPTS,
  SAMPLE_ASSISTANT_QUESTIONS,
  assistantQuestionPath,
} from "./types";
export {
  matchReply,
  resolveUserQuery,
  suggestionPromptsFor,
} from "./localGuidedProvider";

/**
 * Local guided knowledge base + CyberGuard page redirects.
 * Swap this export to plug in another AssistantReplyProvider later.
 */
export const assistantProvider: AssistantReplyProvider = localGuidedProvider;
