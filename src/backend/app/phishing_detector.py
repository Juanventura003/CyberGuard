import re
import random
import numpy as np
from sklearn.linear_model import LogisticRegression

URGENCY_WORDS = [
    "urgent", "immediately", "verify your account", "suspended", "act now",
    "limited time", "confirm your identity", "final notice", "click here",
    "restricted", "unauthorized login", "unusual activity", "expire",
]
CREDENTIAL_WORDS = [
    "password", "ssn", "social security", "credit card", "bank account",
    "login credentials", "pin number", "verify your password", "security code",
]
FREE_MAIL_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com"}
SUSPICIOUS_TLDS = {".xyz", ".top", ".click", ".zip", ".gq", ".tk", ".ru", ".info"}

FEATURE_NAMES = [
    "num_links", "urgency_hits", "credential_hits", "domain_mismatch",
    "sender_freemail", "suspicious_tld", "body_length_norm", "exclaim_count",
]


def extract_features(sender: str, subject: str, body: str, urls: list[str]) -> dict:
    text = f"{subject}\n{body}".lower()

    urgency_hits = sum(1 for w in URGENCY_WORDS if w in text)
    credential_hits = sum(1 for w in CREDENTIAL_WORDS if w in text)

    sender_domain_match = re.search(r"@([\w.\-]+)", sender or "")
    sender_domain = sender_domain_match.group(1).lower() if sender_domain_match else ""

    domain_mismatch = 0
    for url in urls:
        host_match = re.search(r"https?://([\w.\-]+)", url)
        if host_match and sender_domain and host_match.group(1).lower() != sender_domain:
            domain_mismatch = 1
            break

    suspicious_tld = 1 if any(sender_domain.endswith(t) for t in SUSPICIOUS_TLDS) else 0
    suspicious_tld = suspicious_tld or (
        1 if any(any(u.lower().endswith(t) or t in u.lower() for t in SUSPICIOUS_TLDS) for u in urls) else 0
    )

    sender_freemail = 1 if sender_domain in FREE_MAIL_DOMAINS else 0

    return {
        "num_links": len(urls),
        "urgency_hits": urgency_hits,
        "credential_hits": credential_hits,
        "domain_mismatch": domain_mismatch,
        "sender_freemail": sender_freemail,
        "suspicious_tld": suspicious_tld,
        "body_length_norm": min(len(body) / 2000, 1.0),
        "exclaim_count": min(text.count("!"), 10),
        "_sender_domain": sender_domain,
    }


def _synthetic_training_set(n=600):
    X, y = [], []
    for _ in range(n):
        if random.random() < 0.5:
            X.append([
                random.randint(1, 6), random.randint(2, 6), random.randint(1, 4),
                random.choice([0, 1]), random.choice([0, 1]), random.choice([0, 1]),
                random.uniform(0.1, 0.6), random.randint(1, 8),
            ])
            y.append(1)
        else:
            X.append([
                random.randint(0, 2), random.randint(0, 1), 0,
                0, random.choice([0, 1]), 0,
                random.uniform(0.2, 1.0), random.randint(0, 1),
            ])
            y.append(0)
    return np.array(X), np.array(y)


_X_train, _y_train = _synthetic_training_set()
_model = LogisticRegression(max_iter=1000)
_model.fit(_X_train, _y_train)


def analyze_email(sender: str, subject: str, body: str, urls: list[str] | None = None) -> dict:
    urls = urls or []
    feats = extract_features(sender, subject, body, urls)
    vec = np.array([[feats[k] for k in FEATURE_NAMES]])

    phishing_proba = float(_model.predict_proba(vec)[0][1])
    rule_bonus = feats["credential_hits"] * 8 + feats["domain_mismatch"] * 15 + feats["suspicious_tld"] * 10
    risk_score = float(np.clip(phishing_proba * 100 * 0.7 + rule_bonus, 0, 100))

    if risk_score <= 30:
        classification = "SAFE"
    elif risk_score <= 70:
        classification = "SUSPICIOUS"
    else:
        classification = "PHISHING"

    explanation = []
    if feats["urgency_hits"]:
        explanation.append(f"Detected {feats['urgency_hits']} urgency/pressure phrase(s) commonly used to rush victims.")
    if feats["credential_hits"]:
        explanation.append(f"Requests sensitive credentials or personal data ({feats['credential_hits']} indicator(s)).")
    if feats["domain_mismatch"]:
        explanation.append("A linked URL's domain does not match the sender's domain.")
    if feats["suspicious_tld"]:
        explanation.append("Sender or link uses a domain/TLD commonly associated with disposable or malicious sites.")
    if feats["num_links"] >= 3:
        explanation.append(f"Contains {feats['num_links']} links, above the typical count for legitimate mail.")
    if not explanation:
        explanation.append("No strong phishing indicators found; message matches typical legitimate patterns.")

    return {
        "risk_score": round(risk_score, 1),
        "classification": classification,
        "confidence": round(max(phishing_proba, 1 - phishing_proba), 3),
        "explanation": explanation,
    }
