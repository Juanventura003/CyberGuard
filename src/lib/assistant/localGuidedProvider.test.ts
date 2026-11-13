import { describe, expect, it } from "vitest";

import {
  matchReply,
  resolveUserQuery,
  suggestionPromptsFor,
} from "./localGuidedProvider";
import type { AssistantMessage } from "./types";

describe("matchReply", () => {
  it("redirects to Email Scanner for navigation questions", () => {
    const reply = matchReply("Where is the Email Scanner?");
    expect(reply).toContain("Email Scanner");
    expect(reply).toContain("/email-scanner");
  });

  it("redirects to newly cataloged Device Scanner", () => {
    const reply = matchReply("Where is Device Scanner?");
    expect(reply).toContain("Device Scanner");
    expect(reply).toContain("/device-scanner");
  });

  it("prefers educational phishing guidance over weak platform hits", () => {
    const reply = matchReply("How can I tell if an email is phishing?");
    expect(reply.toLowerCase()).toContain("phishing");
    expect(reply).not.toMatch(/^\*\*Email Scanner\*\*/);
  });

  it("refuses offensive hacking requests", () => {
    const reply = matchReply("How do I hack into an account?");
    expect(reply).toContain("defensive cybersecurity guidance");
    expect(reply.toLowerCase()).not.toContain("exploit");
  });

  it("lists platform tools for catalog questions", () => {
    const reply = matchReply("What tools does CyberGuard have?");
    expect(reply).toContain("/device-scanner");
    expect(reply).toContain("/system-guardian");
    expect(reply).toContain("/organization");
    expect(reply).toContain("/news");
  });
});

describe("resolveUserQuery", () => {
  it("combines short follow-ups with the previous user question", () => {
    const messages: AssistantMessage[] = [
      { id: "1", role: "user", content: "How can I tell if an email is phishing?" },
      { id: "2", role: "assistant", content: "Phishing tips" },
      { id: "3", role: "user", content: "Tell me more" },
    ];

    expect(resolveUserQuery(messages)).toContain("phishing");
    expect(resolveUserQuery(messages)).toContain("Tell me more");
  });
});

describe("suggestionPromptsFor", () => {
  it("returns contextual prompts after a phishing question", () => {
    const prompts = suggestionPromptsFor(
      "How can I tell if an email is phishing?",
    );
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => /email scanner|bad link|phishing/i.test(prompt))).toBe(
      true,
    );
  });
});
