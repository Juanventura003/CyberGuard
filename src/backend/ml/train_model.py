"""
Train the CyberGuard phishing model and save it where the backend loads it from.

Same model as your original train_model.py (TF-IDF + Logistic Regression on the
Kaggle phishing_email.csv), with two changes:
  * It saves to app/models/phishing_model.pkl, where phishing_detector.py looks.
  * It uses Python's csv module instead of pandas, so it runs inside the
    backend's own .venv with no extra installs. Training with the backend's
    scikit-learn version is what keeps the saved model loadable.

Run from src/backend:
    .venv\\Scripts\\python ml\\train_model.py
(expects ml\\phishing_email.csv, or pass a path to the CSV as an argument)
"""

import csv
import sys
from pathlib import Path

import joblib
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

HERE = Path(__file__).resolve().parent
CSV_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "phishing_email.csv"
MODEL_PATH = HERE.parent / "app" / "models" / "phishing_model.pkl"


def load_rows(path: Path):
    csv.field_size_limit(10**9)  # some emails are very long
    texts, labels = [], []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            text = (row.get("text_combined") or "").strip()
            label = (row.get("label") or "").strip()
            if text and label in {"0", "1"}:
                texts.append(text)
                labels.append(int(label))
    return texts, labels


def main():
    if not CSV_PATH.exists():
        sys.exit(f"Dataset not found at {CSV_PATH}. Put phishing_email.csv in the ml folder.")

    X, y = load_rows(CSV_PATH)
    print(f"Total emails loaded: {len(X):,}  (phishing: {sum(y):,}, legitimate: {len(y) - sum(y):,})")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = Pipeline([
        ("tfidf", TfidfVectorizer(stop_words="english", max_features=20000, ngram_range=(1, 2))),
        ("classifier", LogisticRegression(max_iter=1000)),
    ])

    print(f"Training on {len(X_train):,} emails with scikit-learn {sklearn.__version__} ...")
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    print(f"\nAccuracy: {accuracy_score(y_test, predictions) * 100:.2f}%")
    print(classification_report(y_test, predictions, target_names=["legitimate", "phishing"], digits=3))

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
