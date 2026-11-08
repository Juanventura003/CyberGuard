"""
CyberGuard phishing detector.

The decision comes from the trained model in app/models/phishing_model.pkl
(TF-IDF + Logistic Regression trained on ~82k real emails from the Kaggle
phishing_email.csv dataset; see ml/train_model.py).

The model only reads the words of an email, so a few structural checks
(link domain vs sender domain, high-risk TLDs, requests for credentials) are
layered on top. They add a small amount of risk and show up as reasons.

email_checks.py adds evidence the wording can't show: where links really go
(and whether they're on Google Web Risk / OpenPhish), and whether the sender
is who it claims to be (SPF/DKIM/DMARC, Reply-To, display name, lookalike
domains).

analyze_email() returns risk_score, classification, confidence and
explanation as before, plus checks, links, highlights and preview for the
Email Scanner's result cards.
"""

import re
import warnings
from pathlib import Path

import joblib

from . import email_checks

MODEL_PATH = Path(__file__).resolve().parent / "models" / "phishing_model.pkl"

CREDENTIAL_WORDS = [
    "password", "ssn", "social security", "credit card", "bank account",
    "login credentials", "pin number", "verify your password", "security code",
]
SUSPICIOUS_TLDS = (".xyz", ".top", ".click", ".zip", ".gq", ".tk", ".ru", ".info")

_DISPLAY_SKIP = {"http", "https", "www", "com", "net", "org", "html", "php"}

SAFE_MAX = 30       # risk_score <= 30  -> SAFE
SUSPICIOUS_MAX = 70  # risk_score <= 70  -> SUSPICIOUS, above -> PHISHING


def _load_model():
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Phishing model not found at {MODEL_PATH}. "
            "Train it first: .venv\\Scripts\\python ml\\train_model.py"
        )
    try:
        from sklearn.exceptions import InconsistentVersionWarning
    except ImportError:  # very old scikit-learn
        InconsistentVersionWarning = UserWarning

    with warnings.catch_warnings():
        warnings.simplefilter("error", InconsistentVersionWarning)
        try:
            return joblib.load(MODEL_PATH)
        except InconsistentVersionWarning as exc:
            raise RuntimeError(
                "phishing_model.pkl was saved with a different scikit-learn version than this "
                "backend uses. Re-train it inside the backend's .venv: "
                ".venv\\Scripts\\python ml\\train_model.py"
            ) from exc


# Load once at import so a missing or incompatible model stops the server
# at startup with a clear message, instead of failing on the first scan.
_model = _load_model()
_vectorizer = _model.steps[0][1]
_classifier = _model.steps[-1][1]
_vocab = _vectorizer.get_feature_names_out()


def _normalize(subject: str, body: str) -> str:
    # The training data is lowercased with punctuation stripped; match that.
    text = f"{subject}\n{body}".lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return text.strip()


def _key_phrases(text: str, toward_phishing: bool, n: int = 4) -> list[str]:
    """Words/phrases in this email that pushed the model hardest toward its answer."""
    vec = _vectorizer.transform([text]).tocsr()
    if vec.nnz == 0:
        return []
    weights = vec.data * _classifier.coef_[0][vec.indices]
    if not toward_phishing:
        weights = -weights
    order = weights.argsort()[::-1]
    phrases = []
    for i in order:
        if weights[i] <= 0 or len(phrases) == n:
            break
        phrase = _vocab[vec.indices[i]]
        if not set(phrase.split()) & _DISPLAY_SKIP:  # URL fragments aren't helpful to show users
            phrases.append(phrase)
    return phrases


def _structural_signals(sender: str, body: str, urls: list[str]) -> tuple[float, list[str]]:
    bonus, reasons = 0.0, []

    m = re.search(r"@([\w.\-]+)", sender or "")
    sender_domain = m.group(1).lower() if m else ""
    hosts = [h.group(1).lower() for u in urls if (h := re.search(r"https?://([\w.\-]+)", u))]

    def same_org(host: str) -> bool:
        return host == sender_domain or host.endswith("." + sender_domain) or sender_domain.endswith("." + host)

    mismatched = [h for h in hosts if sender_domain and not same_org(h)]
    if mismatched:
        bonus += 8
        reasons.append(f"Links point to {mismatched[0]}, which doesn't match the sender's domain ({sender_domain}).")

    if any(d.endswith(SUSPICIOUS_TLDS) for d in [sender_domain, *hosts] if d):
        bonus += 10
        reasons.append("The sender or a link uses a domain ending (TLD) often tied to disposable or malicious sites.")

    lowered = body.lower()
    credential_hits = sum(1 for w in CREDENTIAL_WORDS if w in lowered)
    if credential_hits:
        bonus += min(credential_hits * 4, 8)
        reasons.append("Mentions sensitive information such as passwords, card numbers or account details.")

    return bonus, reasons


PREVIEW_CHARS = 1500
# A link on Google Web Risk / OpenPhish makes an email phishing regardless of wording.
KNOWN_THREAT_MIN_SCORE = 90.0


def _preview(body: str) -> str:
    text = re.sub(r"[ \t]+", " ", body or "")
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return text[:PREVIEW_CHARS] + ("…" if len(text) > PREVIEW_CHARS else "")


def analyze_email(
    sender: str,
    subject: str,
    body: str,
    urls: list[str] | None = None,
    *,
    links: list[dict] | None = None,
    headers: dict[str, list[str]] | None = None,
    display_name: str = "",
) -> dict:
    """
    urls: addresses written in the email; links: [{href, text}] from its HTML;
    headers: lower-case header name -> values (Gmail only); display_name: the
    name shown with the sender address.
    """
    urls = urls or []
    subject, body = subject or "", body or ""
    text = _normalize(subject, body)

    # Evidence beyond the wording: links and the sender (see email_checks.py).
    link_info = email_checks.analyze_links(links or [], urls, email_checks.domain_of(sender))
    sender_info = email_checks.analyze_sender(sender, display_name, headers)
    checks = sender_info["checks"] + link_info["checks"]
    extra = {
        "checks": checks,
        "links": link_info["reports"],
        "preview": _preview(body),
    }

    if not text:
        if link_info["known_threat"]:
            return {
                "risk_score": KNOWN_THREAT_MIN_SCORE,
                "classification": "PHISHING",
                "confidence": 0.95,
                "explanation": ["This email links to an address listed as phishing or malware."],
                "highlights": [],
                **extra,
            }
        return {
            "risk_score": 0.0,
            "classification": "SAFE",
            "confidence": 0.0,
            "explanation": ["This email has no readable text, so the model could not analyze it."],
            "highlights": [],
            **extra,
        }

    phishing_proba = float(_model.predict_proba([text])[0][1])
    bonus, structural_reasons = _structural_signals(sender, body, urls)
    bonus += link_info["bonus"] + sender_info["bonus"]
    risk_score = max(0.0, min(100.0, phishing_proba * 100 * 0.85 + bonus))
    if link_info["known_threat"]:
        risk_score = max(risk_score, KNOWN_THREAT_MIN_SCORE)

    if risk_score <= SAFE_MAX:
        classification = "SAFE"
    elif risk_score <= SUSPICIOUS_MAX:
        classification = "SUSPICIOUS"
    else:
        classification = "PHISHING"

    explanation = [
        f"CyberGuard's model, trained on about 82,000 real emails, rates this message "
        f"{phishing_proba * 100:.0f}% likely to be phishing."
    ]
    looks_phishy = phishing_proba >= 0.5
    phrases = _key_phrases(text, toward_phishing=looks_phishy)
    if phrases:
        quoted = ", ".join(f'"{p}"' for p in phrases)
        if looks_phishy:
            explanation.append(f"Wording most associated with phishing in this email: {quoted}.")
        else:
            explanation.append(f"Wording that matches legitimate email patterns: {quoted}.")
    # The strongest sender/link findings, in plain words, after the model's view.
    explanation.extend(c["detail"] for c in checks if c["status"] == "fail")
    explanation.extend(structural_reasons)

    return {
        "risk_score": round(risk_score, 1),
        "classification": classification,
        "confidence": round(max(phishing_proba, 1 - phishing_proba), 3),
        "explanation": explanation,
        # Words to highlight in the email preview (only when they point to phishing).
        "highlights": _key_phrases(text, toward_phishing=True, n=8) if risk_score > SAFE_MAX else [],
        **extra,
    }
