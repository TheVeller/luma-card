import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import type { StyleSpec } from "@/lib/style-spec";
import { normalizeStyleSpec } from "@/lib/style-spec";

type Props = {
  spec: StyleSpec;
  eventName: string;
  onSpecChange: (spec: StyleSpec) => void;
};

export function BadgeChat({ spec, eventName, onSpecChange }: Props) {
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  }, [spec]);

  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat-badge",
      body: () => ({ spec: specRef.current, eventName }),
    }),
    onFinish: ({ message }) => {
      const parts = message.parts ?? [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i] as { type: string; input?: unknown; output?: { spec?: unknown } };
        if (
          p.type === "tool-update_style" ||
          p.type === "dynamic-tool" ||
          (typeof p.type === "string" && p.type.startsWith("tool-update_style"))
        ) {
          const raw = p.output?.spec ?? p.input;
          if (raw && typeof raw === "object") {
            onSpecChange(normalizeStyleSpec(raw as Partial<StyleSpec>));
            return;
          }
        }
      }
    },
  });

  const disabled = status === "submitted" || status === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-hairline bg-surface/70">
      <div className="border-b border-hairline px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Iterate with AI
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Try: "make it more punk", "use a serif heading", "warmer palette", "add a neon glow to the hero"
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const hasToolCall = m.parts.some(
            (p) => typeof p.type === "string" && p.type.startsWith("tool-update_style"),
          );
          return (
            <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={
                  "inline-block max-w-[85%] rounded-2xl px-3.5 py-2 leading-snug " +
                  (m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground")
                }
              >
                {text || (m.role === "assistant" && hasToolCall ? "✓ style updated" : "…")}
              </div>
              {hasToolCall && m.role === "assistant" && (
                <div className="mt-1 font-mono text-[10px] text-accent">✓ applied to badge</div>
              )}
            </div>
          );
        })}
        {disabled && (
          <div className="text-left">
            <div className="inline-block rounded-2xl bg-surface-2 px-3.5 py-2 font-mono text-xs text-muted-foreground">
              thinking…
            </div>
          </div>
        )}
      </div>
      <form
        className="flex gap-2 border-t border-hairline p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || disabled) return;
          sendMessage({ text: input.trim() });
          setInput("");
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe a change…"
          disabled={disabled}
          className="flex-1 rounded-full border border-hairline bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
