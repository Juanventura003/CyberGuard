import {
  KNOWLEDGE_TOPICS,
  OUT_OF_SCOPE_REPLY,
  TOPIC_CATALOG_FALLBACK,
  type KnowledgeTopic,
} from "./knowledgeBase";
import {
  PLATFORM_FEATURES,
  TOPIC_TOOL_LINKS,
  formatFeatureRedirect,
  formatToolLinks,
  platformCatalogReply,
  type PlatformFeature,
} from "./platformGuide";
import type { AssistantMessage, AssistantReplyProvider } from "./types";

type ScoredTopic = {
  topic: KnowledgeTopic;
  score: number;
};

type ScoredFeature = {
  feature: PlatformFeature;
  score: number;
};

/** Phrases that indicate the user wants attack/abuse help — refuse. */
const OFFENSIVE_PATTERNS = [
  /\bhow (do|can|to) (i|you) hack\b/,
  /\bhack (into|someone|an? account)\b/,
  /\bcrack (a |the )?password\b/,
  /\bsteal (passwords?|accounts?|data)\b/,
  /\bbypass (2fa|mfa|authentication|security|login)\b/,
  /\bmake (a )?virus\b/,
  /\bcreate (malware|ransomware)\b/,
  /\bdos attack\b/,
  /\bddos\b/,
  /\bsql injection\b/,
  /\bkeylogger\b/,
  /\bbrute ?force\b/,
];

const NAV_INTENTS = [
  "where is",
  "where can i",
  "where do i",
  "how do i open",
  "how do i find",
  "how do i use",
  "how do i log",
  "how do i sign",
  "how to use",
  "how to log",
  "how to sign",
  "take me to",
  "go to",
  "open the",
  "find the",
  "show me",
  "navigate",
  "in the app",
  "in cyberguard",
  "on the platform",
  "this platform",
  "this app",
  "can't find",
  "cannot find",
  "cant find",
  "looking for",
];

const RECOVERY_HINTS = [
  "what should i do",
  "accidentally",
  "i clicked",
  "i entered",
  "i gave my",
  "shared my password",
  "got scammed",
  "been hacked",
  "account taken over",
  "someone got into",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9@./+\-'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesKeyword(text: string, keyword: string): boolean {
  const needle = keyword.toLowerCase().trim();
  if (!needle) {
    return false;
  }

  if (needle.includes(" ")) {
    return text.includes(needle);
  }

  const variants = new Set([needle]);
  if (needle.endsWith("s") && needle.length > 3) {
    variants.add(needle.slice(0, -1));
  } else {
    variants.add(`${needle}s`);
  }

  for (const variant of variants) {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegex(variant)}([^a-z0-9]|$)`,
    );
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

function keywordWeight(keyword: string): number {
  const words = keyword.trim().split(/\s+/).length;
  const len = keyword.trim().length;

  if (words >= 3 || len >= 18) {
    return 5;
  }
  if (words === 2 || len >= 10) {
    return 3;
  }
  if (len >= 6) {
    return 2;
  }
  return 1;
}

function hasNavIntent(text: string): boolean {
  return NAV_INTENTS.some((intent) => text.includes(intent));
}

function scoreFeature(text: string, feature: PlatformFeature): number {
  let score = 0;
  let hits = 0;

  for (const keyword of feature.keywords) {
    if (includesKeyword(text, keyword) || text.includes(keyword)) {
      score += keywordWeight(keyword);
      hits += 1;
    }
  }

  if (hits === 0) {
    return 0;
  }

  if (hits >= 2) {
    score += 2;
  }

  if (hasNavIntent(text)) {
    score += 4;
  }

  // Exact feature name is a strong signal.
  if (text.includes(feature.name.toLowerCase())) {
    score += 5;
  }

  return score;
}

function rankFeatures(text: string): ScoredFeature[] {
  return PLATFORM_FEATURES.map((feature) => ({
    feature,
    score: scoreFeature(text, feature),
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.feature.name.localeCompare(b.feature.name),
    );
}

function scoreTopic(text: string, topic: KnowledgeTopic): number {
  let score = 0;
  let hits = 0;

  for (const keyword of topic.keywords) {
    if (includesKeyword(text, keyword)) {
      score += keywordWeight(keyword);
      hits += 1;
    }
  }

  let intentHits = 0;
  for (const boost of topic.intentBoosts ?? []) {
    if (includesKeyword(text, boost) || text.includes(boost)) {
      score += 2;
      intentHits += 1;
    }
  }

  const title = normalize(topic.title);
  let titleHits = 0;
  for (const part of title.split(" ")) {
    if (part.length >= 4 && includesKeyword(text, part)) {
      score += 1;
      titleHits += 1;
    }
  }

  if (hits === 0) {
    if (intentHits > 0 && titleHits > 0) {
      return score + 2;
    }
    return 0;
  }

  if (hits >= 2) {
    score += 2;
  }
  if (hits >= 3) {
    score += 2;
  }

  return score;
}

function rankTopics(text: string): ScoredTopic[] {
  return KNOWLEDGE_TOPICS.map((topic) => ({
    topic,
    score: scoreTopic(text, topic),
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.topic.title.localeCompare(b.topic.title),
    );
}

function relatedSuggestions(scored: ScoredTopic[], excludeId: string): string {
  const others = scored
    .filter((entry) => entry.topic.id !== excludeId)
    .slice(0, 2)
    .map((entry) => entry.topic.title);

  if (others.length === 0) {
    return "";
  }

  return `\n\n**Related topics you can ask about**\n${others
    .map((title) => `- ${title}`)
    .join("\n")}`;
}

function clarifyingReply(scored: ScoredTopic[]): string {
  const options = scored.slice(0, 4);
  const lines = options.map((entry) => `- ${entry.topic.title}`);

  return `I found a few topics that might match. Which do you want help with?

${lines.join("\n")}

Or rephrase your question with a bit more detail (for example: “How do I spot a phishing text?”).

You can also ask “where is Email Scanner?” and I will send you to the right CyberGuard page.`;
}

function isOffensiveRequest(text: string): boolean {
  return OFFENSIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function applyRecoveryBias(text: string, ranked: ScoredTopic[]): ScoredTopic[] {
  const wantsRecovery = RECOVERY_HINTS.some((hint) =>
    includesKeyword(text, hint),
  );
  if (!wantsRecovery) {
    return ranked;
  }

  return ranked
    .map((entry) =>
      entry.topic.id === "incident"
        ? { ...entry, score: entry.score + 4 }
        : entry,
    )
    .sort(
      (a, b) =>
        b.score - a.score || a.topic.title.localeCompare(b.topic.title),
    );
}

function wantsPlatformHelp(text: string): boolean {
  return (
    hasNavIntent(text) ||
    text.includes("cyberguard") ||
    text.includes("this app") ||
    text.includes("the app") ||
    text.includes("platform") ||
    text.includes("sidebar") ||
    text.includes("menu") ||
    text.includes("feature") ||
    text.includes("tool")
  );
}

function matchPlatformReply(text: string): string | null {
  const ranked = rankFeatures(text);
  if (ranked.length === 0) {
    if (
      wantsPlatformHelp(text) &&
      (text.includes("what can") ||
        text.includes("features") ||
        text.includes("tools") ||
        text.includes("pages") ||
        text.includes("where"))
    ) {
      return platformCatalogReply();
    }
    return null;
  }

  const best = ranked[0];
  const second = ranked[1];

  const clearFeatureHit =
    best.score >= 2 ||
    hasNavIntent(text) ||
    text.includes(best.feature.name.toLowerCase()) ||
    wantsPlatformHelp(text) ||
    (ranked.length === 1 && best.score >= 1);

  // Strong navigation / feature question → send them to the page.
  if (clearFeatureHit) {
    if (
      second &&
      second.score >= best.score - 1 &&
      second.feature.id !== best.feature.id &&
      (hasNavIntent(text) || second.score >= 3)
    ) {
      const options = ranked.slice(0, 4);
      return `I can send you to a few matching places in CyberGuard:

${options
  .map(
    (entry) =>
      `- [${entry.feature.name}](${entry.feature.path}) — ${entry.feature.summary}`,
  )
  .join("\n")}

Which one do you need?`;
    }

    return formatFeatureRedirect(best.feature);
  }

  return null;
}

function withToolRedirects(topicId: string, reply: string): string {
  const toolIds = TOPIC_TOOL_LINKS[topicId] ?? [];
  return `${reply}${formatToolLinks(toolIds)}`;
}

function matchReply(userText: string): string {
  const text = normalize(userText);
  if (!text) {
    return `${TOPIC_CATALOG_FALLBACK}\n\n${platformCatalogReply()}`;
  }

  if (isOffensiveRequest(text)) {
    return OUT_OF_SCOPE_REPLY;
  }

  const platformReply = matchPlatformReply(text);
  if (platformReply) {
    return platformReply;
  }

  const ranked = applyRecoveryBias(text, rankTopics(text));
  if (ranked.length === 0) {
    if (wantsPlatformHelp(text)) {
      return platformCatalogReply();
    }
    return `${TOPIC_CATALOG_FALLBACK}\n\n${platformCatalogReply()}`;
  }

  const best = ranked[0];
  const second = ranked[1];

  if (
    second &&
    best.score >= 4 &&
    second.score >= 4 &&
    best.score - second.score <= 1 &&
    best.topic.id !== second.topic.id
  ) {
    return clarifyingReply(ranked);
  }

  if (best.score < 1) {
    return `${TOPIC_CATALOG_FALLBACK}\n\n${platformCatalogReply()}`;
  }

  return withToolRedirects(
    best.topic.id,
    `${best.topic.reply}${relatedSuggestions(ranked, best.topic.id)}`,
  );
}

export const localGuidedProvider: AssistantReplyProvider = {
  async getReply(messages) {
    const lastUser = [...messages]
      .reverse()
      .find((m: AssistantMessage) => m.role === "user");

    const content = lastUser?.content ?? "";
    await new Promise((resolve) => setTimeout(resolve, 350));
    return matchReply(content);
  },
};

export { matchReply };
