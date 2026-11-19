/**
 * CyberGuard in-app features the assistant can explain and deep-link to.
 * Keep paths in sync with App.tsx routes.
 */
export type PlatformFeature = {
  id: string;
  name: string;
  path: string;
  summary: string;
  howTo: string;
  keywords: string[];
};

export const PLATFORM_FEATURES: PlatformFeature[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    path: "/dashboard",
    summary:
      "Your CyberGuard home screen with an overview of tools and quick actions.",
    howTo:
      "Open Dashboard from the left sidebar (top item), or go to [Dashboard](/dashboard).",
    keywords: [
      "dashboard",
      "home",
      "home screen",
      "overview",
      "main page",
      "where do i start",
      "getting started",
    ],
  },
  {
    id: "website-tracker",
    name: "Website Tracker",
    path: "/website-tracker",
    summary:
      "Review websites you have visited with risk scores (Safe, Suspicious, High Risk).",
    howTo:
      "Open **Website Tracker** in the left sidebar, or go to [Website Tracker](/website-tracker). Search or sort the list by domain, risk score, or time visited.",
    keywords: [
      "website tracker",
      "track websites",
      "visited sites",
      "site history",
      "domain risk",
      "website risk",
      "check a website",
      "is this site",
      "url checker",
      "browsing history",
    ],
  },
  {
    id: "email-scanner",
    name: "Email Scanner",
    path: "/email-scanner",
    summary:
      "Scan emails for phishing risk. Paste emails manually or connect Gmail (read-only) and analyze selected messages.",
    howTo: `Open **Email Scanner** in the left sidebar, or go to [Email Scanner](/email-scanner).

**Two ways to scan**
1. Paste emails manually — add sender, subject, body, and links, then analyze.
2. Connect Gmail — sign in with Google (read-only), pick up to 50 messages, then analyze.

Results show a risk score, SAFE/PHISHING classification, and a plain-English explanation.`,
    keywords: [
      "email scanner",
      "scan email",
      "scan emails",
      "check email",
      "analyze email",
      "gmail",
      "connect gmail",
      "phishing scan",
      "paste email",
      "inbox scan",
      "email risk",
    ],
  },
  {
    id: "security-checker",
    name: "Security Checker",
    path: "/security-checker",
    summary:
      "Run security checks from CyberGuard (page is available in the sidebar; more checks are being added).",
    howTo:
      "Open **Security Checker** in the left sidebar, or go to [Security Checker](/security-checker).",
    keywords: [
      "security checker",
      "security check",
      "check security",
      "scan security",
      "vulnerability",
      "safety check",
    ],
  },
  {
    id: "device-scanner",
    name: "Device Scanner",
    path: "/device-scanner",
    summary:
      "Scan this device for security findings and review local assessment results.",
    howTo:
      "Open **Device Scanner** in the left sidebar, or go to [Device Scanner](/device-scanner). Sign in if prompted, then start a scan and review the findings.",
    keywords: [
      "device scanner",
      "scan device",
      "device scan",
      "local scan",
      "computer scan",
      "pc scan",
      "mac scan",
      "endpoint scan",
    ],
  },
  {
    id: "system-guardian",
    name: "System Guardian",
    path: "/system-guardian",
    summary:
      "Monitor live system activity such as processes, network use, and local security events.",
    howTo:
      "Open **System Guardian** in the left sidebar, or go to [System Guardian](/system-guardian). Keep the local scanner running so live process and network views can connect.",
    keywords: [
      "system guardian",
      "process monitor",
      "process network",
      "gpu monitor",
      "live processes",
      "system activity",
      "security timeline",
      "local guardian",
    ],
  },
  {
    id: "organization",
    name: "Team Security",
    path: "/organization",
    summary:
      "Collaborate with your team on shared findings, protection rules, notices, and live member activity.",
    howTo:
      "Open **Team Security** in the left sidebar, or go to [Team Security](/organization). Create or join an organization, then share findings and manage team protection.",
    keywords: [
      "team security",
      "organization",
      "org",
      "team",
      "shared findings",
      "team notices",
      "team protection",
      "collaborate",
      "members",
    ],
  },
  {
    id: "cyber-assistant",
    name: "Cyber Assistant",
    path: "/cyber-assistant",
    summary:
      "Ask cybersecurity questions and get guidance, including where to find tools in CyberGuard.",
    howTo:
      "You are already here on [Cyber Assistant](/cyber-assistant). Use the suggestion chips or type any security or CyberGuard question.",
    keywords: [
      "cyber assistant",
      "assistant",
      "chatbot",
      "ask a question",
      "help center",
      "what can you do",
      "what do you do",
    ],
  },
  {
    id: "news",
    name: "News",
    path: "/news",
    summary:
      "Read recent cybersecurity news collected from trusted sources, with search and saved articles.",
    howTo:
      "Open **News** in the left sidebar, or go to [News](/news). Search or filter articles, open the original story, and save copies when signed in.",
    keywords: [
      "news",
      "cyber news",
      "security news",
      "articles",
      "bleepingcomputer",
      "threat news",
      "latest news",
    ],
  },
  {
    id: "reports",
    name: "Reports",
    path: "/reports",
    summary:
      "View CyberGuard reports and scan summaries (available from the sidebar).",
    howTo:
      "Open **Reports** in the left sidebar, or go to [Reports](/reports).",
    keywords: [
      "reports",
      "report",
      "scan history",
      "results history",
      "past scans",
      "summary",
    ],
  },
  {
    id: "settings",
    name: "Settings",
    path: "/settings",
    summary: "Manage CyberGuard account and app preferences.",
    howTo:
      "Open **Settings** in the left sidebar, or go to [Settings](/settings).",
    keywords: [
      "settings",
      "preferences",
      "account settings",
      "profile",
      "change settings",
      "configuration",
    ],
  },
  {
    id: "auth",
    name: "Login / Sign up",
    path: "/dashboard",
    summary:
      "Create an account or sign in with the Login and Sign Up buttons at the top of the left sidebar.",
    howTo: `Use the **Login** or **Sign Up** buttons at the top of the left sidebar (above the navigation).

After you sign in, the sidebar shows your email and a Log Out button. Account features use Supabase when it is configured in the app environment.`,
    keywords: [
      "login",
      "log in",
      "sign in",
      "signin",
      "sign up",
      "signup",
      "register",
      "create account",
      "logout",
      "log out",
      "account",
      "password reset",
    ],
  },
];

/** Topic id → related CyberGuard tools to suggest after a security answer. */
export const TOPIC_TOOL_LINKS: Record<string, string[]> = {
  phishing: ["email-scanner", "website-tracker"],
  smishing: ["email-scanner", "website-tracker"],
  vishing: ["email-scanner", "reports"],
  passwords: ["settings", "security-checker"],
  "password-manager": ["settings", "security-checker"],
  "2fa": ["settings", "security-checker"],
  links: ["website-tracker", "email-scanner"],
  websites: ["website-tracker", "device-scanner"],
  malware: ["device-scanner", "system-guardian", "website-tracker"],
  ransomware: ["device-scanner", "security-checker", "reports"],
  attachments: ["email-scanner", "security-checker"],
  incident: ["email-scanner", "device-scanner", "reports"],
  "data-breach": ["settings", "security-checker"],
  "identity-theft": ["reports", "settings"],
  wifi: ["security-checker", "device-scanner"],
  vpn: ["security-checker"],
  updates: ["security-checker", "device-scanner"],
  backups: ["security-checker"],
  "social-engineering": ["email-scanner", "website-tracker"],
  "romance-scam": ["email-scanner", "reports"],
  "gift-card-scam": ["email-scanner", "reports"],
  "qr-codes": ["website-tracker", "security-checker"],
  "social-media": ["security-checker", "settings"],
  privacy: ["settings", "security-checker"],
  browsing: ["website-tracker", "news"],
  "device-security": ["device-scanner", "system-guardian", "settings"],
  "home-network": ["security-checker", "device-scanner"],
  "kids-safety": ["settings", "website-tracker"],
  "work-security": ["organization", "email-scanner", "security-checker"],
  "cookies-sessions": ["settings", "security-checker"],
  "cyberguard-tools": [
    "dashboard",
    "email-scanner",
    "website-tracker",
    "device-scanner",
    "system-guardian",
    "organization",
    "news",
    "security-checker",
  ],
};

export function featureById(id: string): PlatformFeature | undefined {
  return PLATFORM_FEATURES.find((feature) => feature.id === id);
}

export function formatFeatureRedirect(feature: PlatformFeature): string {
  return `**${feature.name}** — ${feature.summary}

${feature.howTo}`;
}

export function formatToolLinks(featureIds: string[]): string {
  const features = featureIds
    .map((id) => featureById(id))
    .filter((feature): feature is PlatformFeature => Boolean(feature));

  if (features.length === 0) {
    return "";
  }

  const lines = features.map(
    (feature) => `- [${feature.name}](${feature.path}) — ${feature.summary}`,
  );

  return `\n\n**In CyberGuard**\n${lines.join("\n")}`;
}

export function platformCatalogReply(): string {
  const lines = PLATFORM_FEATURES.filter((f) => f.id !== "auth").map(
    (feature) =>
      `- [${feature.name}](${feature.path}) — ${feature.summary}`,
  );

  return `Here is what you can open in CyberGuard right now:

${lines.join("\n")}

- **Login / Sign up** — use the buttons at the top of the left sidebar.

Tell me what you want to do (for example “scan an email” or “check a website”) and I will point you to the right place.`;
}
