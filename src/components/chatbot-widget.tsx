"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Trash2, UserRound, X } from "lucide-react";
import { sendChatbotMessage, type ChatbotHistoryMessage, type ChatbotRole } from "@/services/chatbot.api";

const STORAGE_KEY = "vnstock.chatbot.messages";
const MAX_STORED_MESSAGES = 20;

interface ChatbotMessage extends ChatbotHistoryMessage {
  id: string;
}

function buildMessage(role: ChatbotRole, content: string): ChatbotMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
  };
}

function readStoredMessages(): ChatbotMessage[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is ChatbotMessage => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const candidate = item as Partial<ChatbotMessage>;
        return (
          typeof candidate.id === "string" &&
          (candidate.role === "user" || candidate.role === "assistant") &&
          typeof candidate.content === "string" &&
          candidate.content.trim().length > 0
        );
      })
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message || "").trim();
    if (message) {
      return message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Chatbot request failed";
}

export function ChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatbotMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const history = useMemo<ChatbotHistoryMessage[]>(
    () =>
      messages.slice(-MAX_STORED_MESSAGES).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  useEffect(() => {
    setMessages(readStoredMessages());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  }, [loaded, messages]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading, open]);

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || loading) {
      return;
    }

    const userMessage = buildMessage("user", content);
    setMessages((prev) => [...prev, userMessage].slice(-MAX_STORED_MESSAGES));
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const reply = await sendChatbotMessage(content, history);
      const assistantMessage = buildMessage("assistant", reply);
      setMessages((prev) => [...prev, assistantMessage].slice(-MAX_STORED_MESSAGES));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full border border-cyan-200/50 bg-cyan-400 text-slate-950 shadow-[0_18px_45px_rgba(45,212,191,0.32)] transition hover:-translate-y-0.5 hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-100/80 active:translate-y-0"
        aria-label="Open chatbot"
        title="Open chatbot"
      >
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
      </button>
    );
  }

  return (
    <section className="fixed bottom-4 right-4 z-50 flex max-h-[min(640px,calc(100vh-2rem))] w-[390px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-white/15 bg-[#0b0f0e]/95 shadow-2xl backdrop-blur">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-200/30 bg-cyan-300/15 text-cyan-100">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-50">Codex assistant</h2>
            <p className="truncate text-xs text-slate-400">Stock Analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearChat}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-slate-300 transition hover:border-amber-200/50 hover:bg-amber-300/10 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-200/30 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Clear chat"
            title="Clear chat"
            disabled={loading || messages.length === 0}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-slate-300 transition hover:border-cyan-200/50 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-200/30"
            aria-label="Close chatbot"
            title="Close chatbot"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300">
            No messages yet.
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div key={message.id} className={`flex items-start gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                {!isUser ? (
                  <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-200/25 bg-cyan-300/10 text-cyan-100">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : null}
                <div
                  className={`max-w-[82%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-5 ${
                    isUser
                      ? "bg-cyan-300 text-slate-950"
                      : "border border-white/10 bg-white/[0.05] text-slate-100"
                  }`}
                >
                  {message.content}
                </div>
                {isUser ? (
                  <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-300">
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : null}
              </div>
            );
          })
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-hidden="true" />
            Codex is responding...
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-3 mb-3 rounded-md border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm leading-5 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Message"
            aria-label="Chat message"
            disabled={loading}
            rows={1}
          />
          <button
            type="submit"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-200/50 bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-100/80 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-slate-500"
            aria-label="Send message"
            title="Send message"
            disabled={loading || input.trim().length === 0}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
