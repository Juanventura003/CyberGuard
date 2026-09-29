import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, SendHorizontal } from "lucide-react";

import {
  SUGGESTED_PROMPTS,
  assistantProvider,
  type AssistantMessage,
} from "../lib/assistant";

import "./CyberAssistant.css";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const WELCOME: AssistantMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi — I am CyberGuard’s Cyber Assistant. Ask any cybersecurity question, or ask where to find something in the app (for example Email Scanner or Website Tracker). Pick a suggestion or type your own question.",
};

const LINK_PATTERN = /\[([^\]]+)\]\((\/[a-z0-9\-/?=#]*)\)/gi;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(LINK_PATTERN.source, "gi");

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <Link key={`${match.index}-${match[2]}`} className="assistant-inline-link" to={match[2]}>
        {match[1]}
      </Link>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function formatReply(content: string) {
  return content.split("\n").map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <br key={index} />;
    }

    if (trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.slice(2, -2).includes("**")) {
      return (
        <p key={index} className="assistant-msg-heading">
          {trimmed.slice(2, -2)}
        </p>
      );
    }

    if (trimmed.startsWith("- ")) {
      return (
        <p key={index} className="assistant-msg-bullet">
          {renderInline(trimmed)}
        </p>
      );
    }

    if (/^\d+\.\s/.test(trimmed)) {
      return (
        <p key={index} className="assistant-msg-step">
          {renderInline(trimmed)}
        </p>
      );
    }

    return <p key={index}>{renderInline(line)}</p>;
  });
}

function CyberAssistant() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<AssistantMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  const isReplyingRef = useRef(isReplying);
  const prefillHandled = useRef(false);

  messagesRef.current = messages;
  isReplyingRef.current = isReplying;

  useEffect(() => {
    const el = threadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isReplying]);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || isReplyingRef.current) {
      return;
    }

    const userMessage: AssistantMessage = {
      id: createId(),
      role: "user",
      content: text,
    };

    const nextMessages = [...messagesRef.current, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsReplying(true);
    isReplyingRef.current = true;

    try {
      const reply = await assistantProvider.getReply(nextMessages);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content: reply,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content:
            "Something went wrong while getting a reply. Please try again.",
        },
      ]);
    } finally {
      setIsReplying(false);
      isReplyingRef.current = false;
    }
  }

  useEffect(() => {
    if (prefillHandled.current) {
      return;
    }

    const q = searchParams.get("q");
    if (!q?.trim()) {
      return;
    }

    prefillHandled.current = true;
    setSearchParams({}, { replace: true });
    void sendMessage(q);
    // Prefill from dashboard deep-link once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <div className="cyber-assistant">
      <header className="assistant-header">
        <div className="assistant-header-title">
          <div className="assistant-icon">
            <Bot size={22} />
          </div>
          <div>
            <h1>Cyber Assistant</h1>
            <p>Ask cybersecurity questions and get clear, practical guidance.</p>
          </div>
        </div>
      </header>

      <div className="assistant-panel">
        <div className="assistant-thread" ref={threadRef}>
          {messages.map((message) => (
            <div
              key={message.id}
              className={`assistant-bubble assistant-bubble-${message.role}`}
            >
              {message.role === "assistant" ? (
                <div className="assistant-bubble-body">
                  {formatReply(message.content)}
                </div>
              ) : (
                <p>{message.content}</p>
              )}
            </div>
          ))}

          {isReplying && (
            <div className="assistant-bubble assistant-bubble-assistant">
              <div className="assistant-typing" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        <div className="assistant-suggestions">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="assistant-chip"
              disabled={isReplying}
              onClick={() => void sendMessage(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <form className="assistant-composer" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a security question or where to find a tool…"
            rows={2}
            disabled={isReplying}
            aria-label="Message to Cyber Assistant"
          />
          <button
            type="submit"
            className="assistant-send"
            disabled={isReplying || !input.trim()}
            aria-label="Send message"
          >
            <SendHorizontal size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default CyberAssistant;
