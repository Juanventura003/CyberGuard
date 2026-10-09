export type AssistantRole = "user" | "assistant";

export type AssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
};

/**
 * Local guided reply backend (knowledge base + CyberGuard page redirects).
 */
export type AssistantReplyProvider = {
  getReply: (messages: AssistantMessage[]) => Promise<string>;
};

export const SUGGESTED_PROMPTS = [
  "How can I tell if an email is phishing?",
  "Where is the Email Scanner?",
  "How do I check if a link is safe?",
  "What should I do if I think I clicked a bad link?",
  "Where can I track website risk?",
  "What tools does CyberGuard have?",
] as const;
