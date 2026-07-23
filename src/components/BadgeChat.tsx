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
      // Look for update_style tool results and apply the latest one.
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
    <div className="flex h-full flex-col rounded-md border-2" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
      <div className="border-b px-3 py-2 font-mono text-[10px] tracking-[0.24em]" style={{ borderColor: "rgba(23,21,15,0.16)", color: "rgba(23,21,15,0.55)" }}>
        · ITERATE WITH AI ·
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="font-mono text-xs" style={{ color: "rgba(23,21,15,0.55)" }}>
            Try: "make it more punk", "use a serif heading", "warmer palette", "add a neon glow to the hero"
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("");
          const hasToolCall = m.parts.some(
            (p) => typeof p.type === "string" && p.type.startsWith("tool-update_style"),
          );
          return (
            <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                  m.role === "user" ? "bg-[#17150f] text-[#f2efe6]" : "bg-[#f2efe6]"
                }`}
              >
                {text || (m.role === "assistant" && hasToolCall ? "✓ style updated" : "…")}
              </div>
              {hasToolCall && m.role === "assistant" && (
                <div className="mt-1 font-mono text-[10px]" style={{ color: "rgba(23,21,15,0.55)" }}>
                  ✓ applied to badge
                </div>
              )}
            </div>
          );
        })}
        {disabled && (
          <div className="text-left">
            <div className="inline-block rounded-lg bg-[#f2efe6] px-3 py-2 font-mono text-xs">thinking…</div>
          </div>
        )}
      </div>
      <form
        className="flex gap-2 border-t p-2"
        style={{ borderColor: "rgba(23,21,15,0.16)" }}
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
          className="flex-1 rounded-md border-2 bg-[#f2efe6] px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "rgba(23,21,15,0.24)" }}
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="rounded-md bg-[#17150f] px-3 py-2 text-sm font-semibold text-[#f2efe6] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
