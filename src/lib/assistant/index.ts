import { localGuidedProvider } from "./localGuidedProvider";
import type { AssistantReplyProvider } from "./types";

export type {
  AssistantMessage,
  AssistantReplyProvider,
  AssistantRole,
} from "./types";
export { SUGGESTED_PROMPTS } from "./types";

/**
 * Local guided knowledge base + CyberGuard page redirects.
 */
export const assistantProvider: AssistantReplyProvider = localGuidedProvider;
