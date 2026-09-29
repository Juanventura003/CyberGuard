export type KnowledgeTopic = {
  id: string;
  title: string;
  /** Short phrases / keywords. Longer phrases score higher. */
  keywords: string[];
  /** Optional boost when these intent phrases appear with topic keywords. */
  intentBoosts?: string[];
  reply: string;
};

/**
 * Guided cybersecurity knowledge for CyberGuard’s local assistant.
 * Defensive consumer advice only — no attack/exploit guidance.
 */
export const KNOWLEDGE_TOPICS: KnowledgeTopic[] = [
  {
    id: "phishing",
    title: "Phishing emails",
    keywords: [
      "phishing",
      "phish",
      "email",
      "emails",
      "e-mail",
      "phishing email",
      "spoofed email",
      "fake email",
      "suspicious email",
      "email safe",
      "safe email",
      "trust this email",
      "is this email",
      "is an email",
      "verify your account",
      "verify account",
      "account locked",
      "email scam",
      "inbox scam",
      "spam email",
    ],
    intentBoosts: [
      "how can i tell",
      "how do i know",
      "how do i tell",
      "is safe",
      "safe to",
      "should i trust",
      "spot",
      "legit",
      "legitimate",
      "real or fake",
    ],
    reply: `Phishing emails try to trick you into sharing passwords, codes, or money.

**Common signs**
- Urgent or threatening language (“act now or your account will be locked”)
- Unexpected asks for passwords, payment, one-time codes, or gift cards
- Links or attachments you did not expect
- Sender address looks off (extra words, misspellings, odd domain)
- Greeting is generic (“Dear customer”) when the company normally uses your name

**What to do**
1. Do not click links or open attachments from suspicious mail.
2. Check the real sender address, not just the display name.
3. Go to the site yourself by typing the official URL — never use the email’s link.
4. Report the message as phishing in your email app, then delete it.

If you already entered a password, change it and turn on two-factor authentication.`,
  },
  {
    id: "smishing",
    title: "Text / SMS scams",
    keywords: [
      "smishing",
      "text scam",
      "sms scam",
      "text message",
      "sms",
      "texted me",
      "package delivery text",
      "bank text",
      "otp text",
    ],
    reply: `Smishing is phishing by text message. Scammers send fake delivery, bank, or “account problem” texts.

**Warning signs**
- Unexpected package, toll, tax, or bank alerts with a link
- Asks you to “confirm” a purchase you did not make
- Pressure to click quickly or call an unknown number
- Shortened links from senders you do not know

**Safer steps**
1. Do not tap the link in the text.
2. Open your bank or shipping app yourself, or call the number on the back of your card / official site.
3. Delete the message and block the sender if your phone allows it.
4. Never share one-time codes from texts with anyone who contacts you.`,
  },
  {
    id: "vishing",
    title: "Phone / voice scams",
    keywords: [
      "vishing",
      "phone scam",
      "caller",
      "phone call",
      "called me",
      "tech support call",
      "irs call",
      "bank called",
      "robocall",
      "voice scam",
    ],
    reply: `Phone scams (vishing) use fear or urgency to get money, codes, or remote access to your device.

**Common scripts**
- “Your computer has a virus — install this remote tool”
- “This is the IRS / police — pay now or face arrest”
- “Your bank detected fraud — read me the code we just sent”
- Fake family emergency asking for gift cards or wire transfers

**What to do**
1. Hang up. Real banks and agencies do not demand gift cards or secrecy.
2. Call back using a number from the official website or the back of your card — not a number the caller gave you.
3. Never grant remote desktop access to an unexpected caller.
4. Do not read out one-time passwords or authenticator codes.

If you already paid or shared access, contact your bank and change passwords from a trusted device.`,
  },
  {
    id: "passwords",
    title: "Strong passwords",
    keywords: [
      "password",
      "passwords",
      "passcode",
      "strong password",
      "weak password",
      "password tip",
      "create a password",
      "change my password",
    ],
    intentBoosts: ["strong", "secure", "best", "how to make", "what makes"],
    reply: `A strong password is long, unique, and hard to guess.

**Good habits**
- Use at least 12–16 characters (longer is better)
- Prefer a passphrase of random words, or a password manager’s generator
- Never reuse the same password across important accounts
- Turn on two-factor authentication (2FA) wherever it is offered

**Avoid**
- Names, birthdays, “Password123”, or keyboard patterns (qwerty, 1234)
- Sharing passwords in chat, email, or text
- Saving passwords only in a browser without a trustworthy manager

A password manager helps you use a unique password for every site.`,
  },
  {
    id: "password-manager",
    title: "Password managers",
    keywords: [
      "password manager",
      "password managers",
      "bitwarden",
      "1password",
      "lastpass",
      "keepass",
      "vault",
      "credential manager",
    ],
    reply: `A password manager stores unique passwords behind one strong master password (plus 2FA).

**Why it helps**
- You only remember one master password
- Every site can have a different, random password
- Built-in generators create strong credentials
- Many warn you about reused or breached passwords

**Safe use**
1. Pick a reputable manager (built-in OS options or well-known apps).
2. Use a long master passphrase you do not reuse elsewhere.
3. Turn on 2FA for the manager itself.
4. Be careful with browser autofill on shared or public devices.

Never share your master password. If someone asks for it, that is a scam.`,
  },
  {
    id: "2fa",
    title: "Two-factor authentication",
    keywords: [
      "2fa",
      "mfa",
      "two-factor",
      "two factor",
      "multi-factor",
      "multifactor",
      "authenticator",
      "authentication app",
      "one-time code",
      "otp",
      "verification code",
    ],
    reply: `Two-factor authentication (2FA) adds a second check after your password — usually a code, app prompt, or security key.

**Best options (strongest first)**
- Hardware security keys (where supported)
- Authenticator apps (TOTP) or push approvals
- SMS codes — better than nothing, but weaker (SIM-swap risk)

**Tips**
- Turn on 2FA for email, banking, work, and social accounts first
- Save backup/recovery codes in a safe place (password manager or printed offline)
- Never share a 2FA code with anyone who calls, texts, or emails you
- Prefer authenticator apps over SMS when both are offered

If you lose your phone, those backup codes (or a second registered device) are how you regain access.`,
  },
  {
    id: "links",
    title: "Suspicious links",
    keywords: [
      "suspicious link",
      "bad link",
      "unsafe link",
      "safe link",
      "check a link",
      "check if a link",
      "is this link",
      "link is safe",
      "links",
      "link",
      "url",
      "shortened link",
      "bit.ly",
      "tinyurl",
      "hover over",
    ],
    intentBoosts: ["safe", "check", "should i open", "before i click"],
    reply: `Suspicious links are a common way attackers steal logins or install malware.

**Before you click**
- Hover (or long-press on mobile) to preview the real URL
- Look for misspellings (paypa1.com, g00gle.com) or odd extra domains
- Prefer https:// on login and payment pages — but https alone does not prove safety
- Be wary of shortened links from unknown senders

**Safer approach**
1. Open a new tab and type the official site address yourself.
2. Use CyberGuard’s Website Tracker or Security Checker when those tools are available.
3. If unsure, do not click — ask someone you trust or ignore the message.`,
  },
  {
    id: "websites",
    title: "Fake or unsafe websites",
    keywords: [
      "fake website",
      "fake site",
      "spoofed site",
      "unsafe website",
      "unsafe site",
      "is this website",
      "is this site safe",
      "website safe",
      "site safe",
      "lookalike site",
      "clone site",
      "website",
      "websites",
      "https",
      "padlock",
      "ssl",
      "tls",
      "ssl certificate",
      "security certificate",
    ],
    reply: `Attackers build lookalike websites that copy real banks, stores, or login pages.

**How to spot fakes**
- Domain has extra words, hyphens, or odd endings (.xyz, .top, misspellings)
- The site asks for passwords, card numbers, or codes right after an unexpected link
- Design looks rough, urgent pop-ups, or too-good-to-be-true deals
- https / padlock means the connection is encrypted — not that the site is trustworthy

**Safer habits**
1. Type the official address yourself or use a bookmark you created earlier.
2. For shopping, start from a known store or search result you trust — not a random ad.
3. If a “login” page appeared after an email or text link, close it and go to the real site manually.`,
  },
  {
    id: "malware",
    title: "Malware and viruses",
    keywords: [
      "malware",
      "virus",
      "trojan",
      "spyware",
      "adware",
      "infected",
      "infection",
      "malicious software",
      "bad software",
      "computer virus",
    ],
    reply: `Malware is software that harms your device, steals data, or spies on you. It often arrives as unexpected downloads or email attachments.

**Warning signs**
- .exe, .scr, .js, or double extensions like invoice.pdf.exe
- Pressure to “enable macros” or “run this installer”
- Downloads from ads, pop-ups, or unknown sites
- Sudden slowdowns, new toolbars, or constant pop-ups

**If you suspect malware**
1. Disconnect from the network if the device is behaving oddly.
2. Do not enter passwords until you know the device is clean.
3. Run a trusted security scan (built-in OS tools or reputable antivirus).
4. Change important passwords from a different, clean device if needed.

When in doubt, do not open the file.`,
  },
  {
    id: "ransomware",
    title: "Ransomware",
    keywords: [
      "ransomware",
      "ransom",
      "files encrypted",
      "pay bitcoin",
      "locked files",
      "decrypt",
      "crypto locker",
    ],
    reply: `Ransomware locks or encrypts your files and demands payment to unlock them. Paying does not guarantee recovery and funds criminals.

**Prevention**
- Keep backups offline or in a separate cloud account (3-2-1 style helps)
- Avoid unknown attachments and cracked/pirated software
- Keep your OS and apps updated
- Turn on ransomware/protection features in your OS security tools

**If it happens**
1. Disconnect the device from Wi‑Fi / Ethernet immediately.
2. Do not pay until you have spoken with a trusted advisor or incident responder.
3. Preserve evidence (note messages, screenshots) if you need to report it.
4. Restore from a clean backup after the device is cleaned.
5. For businesses, involve IT/security and consider reporting to authorities.

Regular backups are the strongest defense against ransomware.`,
  },
  {
    id: "attachments",
    title: "Risky attachments and downloads",
    keywords: [
      "attachment",
      "attachments",
      "download",
      "downloads",
      "exe",
      "macro",
      "enable macros",
      "zip file",
      "invoice.pdf",
      "unexpected file",
    ],
    reply: `Unexpected attachments and downloads are a top way malware spreads.

**High-risk signs**
- You were not expecting the file
- The sender presses you to open it quickly
- File types: .exe, .scr, .js, .vbs, .bat, or “document.pdf.exe”
- Office files that demand “Enable macros” or “Enable content”
- Zips password-protected in the email body (common scam pattern)

**Safer approach**
1. Confirm with the sender through a different channel (call/chat you already trust).
2. Prefer cloud links from known coworkers only when expected.
3. Scan downloads with your OS or antivirus before opening.
4. Install software only from official stores or vendor sites.`,
  },
  {
    id: "incident",
    title: "After a mistake or compromise",
    keywords: [
      "hacked",
      "compromised",
      "stolen",
      "breach",
      "account taken over",
      "gave my password",
      "shared my password",
      "entered my password",
      "what should i do",
      "i think i got scammed",
      "i got scammed",
      "help me",
      "already clicked",
      "i clicked",
      "clicked a link",
      "bad link",
    ],
    intentBoosts: ["already", "just", "accidentally", "oops", "mistake"],
    reply: `If something already went wrong, act quickly but calmly.

**Immediate steps**
1. Stop interacting with the suspicious site or message.
2. Change the password for that account from a device you trust.
3. Turn on two-factor authentication.
4. Check recent account activity (logins, sent mail, payments, recovery email/phone).
5. Watch for follow-up scams claiming they can “fix” it for a fee.

**Also consider**
- If you shared banking or card details, contact your bank and watch statements
- If work accounts are involved, notify your IT / security team
- Sign out other sessions from account security settings when available

I can also walk you through phishing signs, passwords, or checking links — ask about any of those.`,
  },
  {
    id: "data-breach",
    title: "Data breaches",
    keywords: [
      "data breach",
      "breach notification",
      "leaked",
      "leaked password",
      "have i been pwned",
      "pwned",
      "exposed password",
      "credentials leaked",
      "company was hacked",
    ],
    reply: `A data breach means an organization lost control of data — often emails, passwords, or personal details.

**What to do when you get a breach notice**
1. Change the password for that service immediately.
2. If you reused that password elsewhere, change those accounts too.
3. Turn on 2FA on important accounts.
4. Watch for phishing that pretends to “help” with the breach.
5. Consider a credit freeze / fraud alert if Social Security numbers or financial data were exposed (U.S. context).

**Ongoing habit**
Use unique passwords so one breach does not unlock everything else.`,
  },
  {
    id: "identity-theft",
    title: "Identity theft",
    keywords: [
      "identity theft",
      "identity stolen",
      "stolen identity",
      "ssn",
      "social security",
      "someone opened an account",
      "fraudulent account",
      "credit fraud",
    ],
    reply: `Identity theft is when someone uses your personal information to open accounts, file taxes, or make purchases as you.

**Early warning signs**
- Bills or collection calls for accounts you did not open
- Unexpected credit score drops or denied credit
- Tax return already filed in your name
- Mail for new cards or loans you did not request

**Response checklist**
1. Place a fraud alert or credit freeze with major credit bureaus.
2. Change passwords on email and financial accounts; enable 2FA.
3. Review bank and credit card statements; dispute unauthorized charges.
4. Report to the FTC at IdentityTheft.gov (U.S.) and keep a case file.
5. Contact affected banks, IRS (if tax-related), and Social Security if needed.

Act quickly — early freezes and disputes limit further damage.`,
  },
  {
    id: "wifi",
    title: "Public Wi‑Fi and networks",
    keywords: [
      "public wifi",
      "public wi-fi",
      "wifi",
      "wi-fi",
      "hotspot",
      "cafe wifi",
      "airport wifi",
      "hotel wifi",
      "open network",
      "unsecured wifi",
    ],
    reply: `Public Wi‑Fi is convenient but easier for attackers to snoop on or spoof.

**Safer use**
- Prefer your phone’s mobile hotspot for banking, email, and work
- Avoid logging into banks, payroll, or email on open café/airport networks without protection
- Confirm the network name with staff (fake “Free_Airport_WiFi” networks exist)
- Turn off auto-join for open networks when possible
- Use a reputable VPN if you must use public Wi‑Fi for sensitive tasks

**At home**
- Change the default router admin password
- Use WPA2 or WPA3 with a strong Wi‑Fi password
- Keep router firmware updated`,
  },
  {
    id: "vpn",
    title: "VPNs",
    keywords: [
      "vpn",
      "vpns",
      "virtual private network",
      "do i need a vpn",
      "should i use a vpn",
    ],
    reply: `A VPN encrypts your traffic between your device and a VPN server. It helps on untrusted networks; it is not a full “make me anonymous / unhackable” shield.

**When a VPN helps**
- Public Wi‑Fi (cafés, hotels, airports)
- Reducing casual snooping by the local network operator
- Accessing work resources when your employer requires one

**What a VPN does not do**
- Stop phishing, malware, or bad downloads
- Hide your activity from the sites you log into
- Magically secure a weak password

**Tips**
Pick a reputable paid VPN if you need one; free VPNs often monetize your data. Keep using 2FA and good password habits either way.`,
  },
  {
    id: "updates",
    title: "Software updates",
    keywords: [
      "update",
      "updates",
      "software update",
      "system update",
      "patch",
      "patches",
      "outdated",
      "auto update",
      "firmware",
    ],
    reply: `Software updates fix security holes that attackers actively exploit.

**Keep updated**
- Operating system (Windows, macOS, iOS, Android)
- Browser and extensions
- Office apps, Zoom, messaging apps
- Router / firmware when the vendor offers updates

**Habits that help**
1. Turn on automatic updates where you can.
2. Restart when prompted so patches finish installing.
3. Be suspicious of pop-ups that claim “your Flash/Java is outdated — click here” — go to Settings yourself instead.
4. Retire devices that no longer receive security updates.

Skipping updates is one of the most common ways devices get compromised.`,
  },
  {
    id: "backups",
    title: "Backups",
    keywords: [
      "backup",
      "backups",
      "back up",
      "cloud backup",
      "time machine",
      "restore",
      "lost files",
    ],
    reply: `Good backups recover you from ransomware, theft, hardware failure, and accidental deletion.

**Simple 3-2-1 idea**
- 3 copies of important data
- 2 different storage types
- 1 copy offline or off-site (external drive unplugged, or trusted cloud)

**Practical tips**
- Turn on built-in backup (Time Machine, File History, iCloud/Google backup for phones)
- Test restoring a file once so you know it works
- Do not keep the only backup permanently plugged into a PC that gets ransomware
- Encrypt backups that hold sensitive documents

Backups are boring until the day you need them — then they are everything.`,
  },
  {
    id: "social-engineering",
    title: "Social engineering",
    keywords: [
      "social engineering",
      "social engineer",
      "manipulate",
      "urgency scam",
      "pretext",
      "impersonation",
      "pretending to be",
    ],
    reply: `Social engineering tricks people — not technology. Attackers use trust, fear, urgency, or helpfulness to get you to click, pay, or share secrets.

**Classic tactics**
- Urgency: “Act in 10 minutes or lose access”
- Authority: fake boss, bank, IT, police, or delivery company
- Scarcity / prizes: “You won — claim now”
- Helpfulness: “I’m stuck, please send a code / gift card”

**Defense mindset**
1. Slow down when something feels urgent or emotional.
2. Verify identity through a channel you already know (official app, known phone number).
3. Never share passwords, 2FA codes, or remote access with unexpected contacts.
4. When unsure, ask a trusted person before acting.`,
  },
  {
    id: "romance-scam",
    title: "Romance and relationship scams",
    keywords: [
      "romance scam",
      "dating scam",
      "online dating",
      "catfish",
      "military romance",
      "send money to boyfriend",
      "send money to girlfriend",
      "love scam",
    ],
    reply: `Romance scams build a fake relationship to extract money, gift cards, or crypto.

**Red flags**
- Moves off the dating app quickly to private chat
- Story involves overseas work, military deployment, or sudden crisis
- Asks for money, gift cards, crypto, or “temporary” loans
- Avoids video calls or always has an excuse
- Declares love very quickly

**What to do**
1. Do not send money or financial info to someone you have never met in person.
2. Reverse-search their photos if something feels off.
3. Talk to a friend or family member before transferring anything.
4. Report the profile on the platform and to local authorities / FTC if you already sent money.

Real partners do not need you to wire emergency funds to strangers.`,
  },
  {
    id: "gift-card-scam",
    title: "Gift card and payment scams",
    keywords: [
      "gift card",
      "gift cards",
      "itunes card",
      "google play card",
      "steam card",
      "wire transfer",
      "western union",
      "zelle scam",
      "pay with crypto",
      "bitcoin payment",
    ],
    reply: `Legitimate companies, banks, tax agencies, and police do not demand payment by gift card, wire, or crypto.

**Hard rule**
If someone tells you to buy gift cards and read the codes over the phone or chat — hang up. It is a scam.

**Also refuse**
- Urgent crypto transfers to “secure your account”
- Wire transfers to “bail” someone you cannot verify
- Paying a “refund fee” to get a larger refund back

If you already shared gift card codes, contact the card issuer immediately and report to reportfraud.ftc.gov (U.S.) or your local consumer protection agency.`,
  },
  {
    id: "qr-codes",
    title: "QR code safety",
    keywords: [
      "qr code",
      "qr codes",
      "scan qr",
      "qr scam",
      "quishing",
    ],
    reply: `QR codes are just links in picture form — scanning one is like clicking a URL you cannot easily read.

**Safer scanning**
- Prefer QR codes on official printed materials you expect (restaurant menu you asked for, event badge)
- Be careful with stickers placed over real signs (parking meters, posters)
- After scanning, read the URL preview before opening if your phone shows it
- Never enter passwords or pay from a QR you found randomly in public

If a QR leads to a login or payment page you did not expect, close it and navigate to the official site yourself.`,
  },
  {
    id: "social-media",
    title: "Social media privacy",
    keywords: [
      "social media",
      "facebook",
      "instagram",
      "tiktok",
      "twitter",
      "x.com",
      "privacy settings",
      "oversharing",
      "public profile",
    ],
    reply: `Oversharing on social media helps attackers guess passwords, answer security questions, or craft convincing scams.

**Tighten privacy**
- Review who can see posts, stories, and friend lists
- Limit birthday, hometown, school, and pet names in public bios
- Turn on 2FA for every major platform
- Be careful with quizzes that ask for personal “fun facts” (often harvesting security-question answers)

**Scam watch**
- Friend requests from “you” duplicates (cloned accounts)
- Messages asking for money, codes, or investment tips from hijacked friend accounts
- Fake giveaways that require login or payment details`,
  },
  {
    id: "privacy",
    title: "Everyday privacy",
    keywords: [
      "privacy",
      "personal data",
      "tracking",
      "cookies",
      "data collection",
      "permission",
      "app permissions",
      "location tracking",
    ],
    reply: `Everyday privacy habits reduce how much of your life is exposed if one account or app is abused.

**Practical steps**
- Give apps only the permissions they need (camera, mic, location, contacts)
- Prefer private or “ask every time” location access
- Clear unused accounts; delete apps you no longer use
- Use unique emails or aliases for shopping when available
- Review browser cookie / tracking settings and reject non-essential cookies when it matters to you

Privacy is not secrecy from everyone — it is limiting unnecessary exposure.`,
  },
  {
    id: "browsing",
    title: "Safer browsing",
    keywords: [
      "safe browsing",
      "safer browsing",
      "browser safety",
      "browser",
      "browsing tips",
      "secure browsing",
    ],
    reply: `Safer everyday browsing reduces a lot of risk.

**Basics**
- Keep your browser and device updated
- Prefer official app stores and known websites
- Be careful on public Wi‑Fi — avoid logging into banks or email without a VPN
- Review browser extensions; remove ones you do not recognize
- Lock your screen and use device passcodes / biometrics
- Think twice before installing “free” toolbars or codec packs

Ask me about phishing, passwords, or suspicious links if you want a deeper checklist.`,
  },
  {
    id: "device-security",
    title: "Device lock and theft",
    keywords: [
      "phone stolen",
      "laptop stolen",
      "lost phone",
      "lost laptop",
      "device lock",
      "screen lock",
      "biometrics",
      "find my",
      "remote wipe",
    ],
    reply: `A locked device buys you time if it is lost or stolen.

**Set this up now**
- Strong device passcode / PIN (not 1234 or birth year)
- Biometrics as a convenience layer — still keep a strong passcode fallback
- “Find My” / find-device features with remote lock and erase
- Auto-lock after a short idle time
- Full-disk encryption (usually on by default on modern phones; enable BitLocker/FileVault on laptops)

**If the device is gone**
1. Use find-device to locate, lock, or erase.
2. Change email and banking passwords from another trusted device.
3. Contact your carrier to suspend service if a phone was stolen.
4. Watch accounts for new login alerts.`,
  },
  {
    id: "home-network",
    title: "Home router security",
    keywords: [
      "router",
      "home network",
      "home wifi",
      "wifi password",
      "default password",
      "iot",
      "smart home",
      "smart devices",
    ],
    reply: `Your home router is the front door to every device on your network.

**Quick hardening**
1. Change the default admin username/password on the router.
2. Use WPA2 or WPA3 with a long Wi‑Fi passphrase.
3. Install firmware updates from the router maker’s site or app.
4. Turn off remote admin access from the internet if you do not need it.
5. Put smart cameras, bulbs, and guests on a separate guest network when possible.

Rename the network if the default name reveals your router model (that helps attackers look up known flaws).`,
  },
  {
    id: "kids-safety",
    title: "Family and kids online",
    keywords: [
      "kids",
      "children",
      "child online",
      "parental",
      "family safety",
      "teen",
      "teenager",
      "cyberbullying",
    ],
    reply: `Helping kids stay safer online is about habits and conversation — not only filters.

**For caregivers**
- Use age-appropriate controls on devices and app stores
- Keep shared devices in common areas when possible
- Talk about never sharing passwords, photos they would not show you, or meeting strangers from chat
- Agree on what to do if someone is mean, creepy, or asks for secrecy
- Model good behavior: pause before clicking, verify unusual requests

**If something goes wrong**
Stay calm, preserve evidence (screenshots), and use platform reporting tools. Involve school or authorities when threats, exploitation, or serious bullying appear.`,
  },
  {
    id: "work-security",
    title: "Work and account hygiene",
    keywords: [
      "work email",
      "work account",
      "company laptop",
      "it department",
      "corporate",
      "business email",
      "ceo fraud",
      "wire fraud",
      "invoice scam",
    ],
    reply: `Work accounts are high-value targets. Follow your organization’s rules and treat unusual payment requests with extra care.

**Habits**
- Use only approved devices and apps for work data
- Do not forward work mail to personal accounts unless policy allows it
- Verify payment / gift-card / wire requests from “the CEO” by phone using a known number
- Report phishing to IT instead of just deleting it when your org asks you to
- Lock your screen when you step away

If you clicked a bad work link, tell IT immediately — early reporting limits damage and is usually treated as a learning moment, not a gotcha.`,
  },
  {
    id: "cookies-sessions",
    title: "Sessions and shared computers",
    keywords: [
      "shared computer",
      "public computer",
      "library computer",
      "log out",
      "sign out",
      "remember me",
      "session",
      "incognito",
      "private browsing",
    ],
    reply: `On shared or public computers, assume the next person can see what you leave behind.

**Checklist**
1. Use private/incognito browsing when you must sign in on a shared PC.
2. Never check “Remember me” on public machines.
3. Sign out of email, banking, and social accounts when finished.
4. Do not download files with sensitive data to a public PC.
5. Clear browsing data if private mode was not available.
6. Prefer your own phone for sensitive tasks when possible.

Private browsing reduces local leftovers; it does not hide activity from the network or the website.`,
  },
  {
    id: "cyberguard-tools",
    title: "CyberGuard tools",
    keywords: [
      "cyberguard",
      "website tracker",
      "security checker",
      "email scanner",
      "this app",
      "this tool",
      "this platform",
      "dashboard",
      "what can you do",
      "what do you do",
      "what tools",
      "features",
      "where is",
    ],
    reply: `I help with cybersecurity questions and with finding tools inside CyberGuard.

**Open these from the left sidebar**
- [Dashboard](/dashboard) — home overview
- [Website Tracker](/website-tracker) — site risk scores
- [Email Scanner](/email-scanner) — phishing scans (paste or Gmail)
- [Security Checker](/security-checker) — security checks
- [Reports](/reports) — report summaries
- [Settings](/settings) — preferences
- Login / Sign up — buttons at the top of the sidebar

**Ask me things like**
- “Where is the Email Scanner?”
- “How do I spot a phishing email?”
- “What should I do after I clicked a bad link?”

I give defensive guidance only — I will not help with hacking, bypassing security, or harming others.`,
  },
];

export const TOPIC_CATALOG_FALLBACK = `I am CyberGuard’s Cyber Assistant. I can help with everyday defensive cybersecurity, including:

- Phishing, smishing (texts), and phone scams
- Passwords, password managers, and 2FA
- Suspicious links, QR codes, and fake websites
- Malware, ransomware, and risky downloads
- Public Wi‑Fi, VPNs, updates, and backups
- Data breaches, identity theft, and “what to do next”
- Social media privacy, device locks, and home router basics

I can also point you to CyberGuard pages when you cannot find a feature — try “Where is Email Scanner?”`;

export const OUT_OF_SCOPE_REPLY = `I only provide defensive cybersecurity guidance for staying safer online.

I cannot help with hacking, cracking accounts, bypassing security, making malware, or anything meant to harm people or systems.

If you have a safety question — phishing, passwords, scams, breaches, or what to do after a mistake — ask me that instead.`;
