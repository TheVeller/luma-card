import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import type { StyleSpec } from "@/lib/style-spec";
import { normalizeStyleSpec } from "@/lib/style-spec";
import { BadgeDocSchema, type BadgeDoc } from "@/lib/badge-doc/schema";

export type BadgeChatEventContext = {
  name: string;
  city?: string | null;
  dateLine?: string;
  description?: string | null;
  coverUrl?: string | null;
};

type Props = {
  spec: StyleSpec;
  doc: BadgeDoc;
  eventContext: BadgeChatEventContext;
  onSpecChange: (spec: StyleSpec) => void;
  onDocChange: (doc: BadgeDoc, intent: string) => void;
};

type ToolPart = {
  type: string;
  input?: unknown;
  output?: {
    ok?: boolean;
    spec?: unknown;
    palette?: unknown;
    fonts?: unknown;
    doc?: unknown;
    intent?: string;
  };
};

export function BadgeChat({ spec, doc, eventContext, onSpecChange, onDocChange }: Props) {
  const specRef = useRef(spec);
  const docRef = useRef(doc);
  const ctxRef = useRef(eventContext);
  useEffect(() => {
    specRef.current = spec;
  }, [spec]);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    ctxRef.current = eventContext;
  }, [eventContext]);

  const [input, setInput] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat-badge",
      body: () => ({ spec: specRef.current, doc: docRef.current, eventContext: ctxRef.current }),
    }),
    onFinish: ({ message }) => {
      // Walk forward so several tools in one turn all land, and let a later
      // call win over an earlier one.
      let nextSpec: StyleSpec | null = null;
      let nextDoc: { doc: BadgeDoc; intent: string } | null = null;
      let refused: string | null = null;

      for (const raw of message.parts ?? []) {
        const p = raw as ToolPart;
        if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue;
        const name = p.type.slice("tool-".length);

        if (p.output && p.output.ok === false) {
          refused = "The AI tried a change that was rejected — ask it to try a different way.";
          continue;
        }

        if (name === "set_palette" && p.output?.palette) {
          nextSpec = normalizeStyleSpec({
            ...(nextSpec ?? specRef.current),
            palette: p.output.palette as StyleSpec["palette"],
          });
        } else if (name === "set_fonts" && p.output?.fonts) {
          nextSpec = normalizeStyleSpec({
            ...(nextSpec ?? specRef.current),
            fonts: { ...(p.output.fonts as StyleSpec["fonts"]), source: "ai" },
          });
        } else if (name === "update_style") {
          const value = p.output?.spec ?? p.input;
          if (value && typeof value === "object")
            nextSpec = normalizeStyleSpec(value as Partial<StyleSpec>);
        } else if ((name === "patch_layout" || name === "replace_layout") && p.output?.doc) {
          const parsed = BadgeDocSchema.safeParse(p.output.doc);
          if (parsed.success)
            nextDoc = { doc: parsed.data, intent: p.output.intent ?? "layout change" };
        }
      }

      setRefusal(refused);
      if (nextSpec) onSpecChange(nextSpec);
      if (nextDoc) onDocChange(nextDoc.doc, nextDoc.intent);
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

  const starterPalette = [spec.palette.bg, spec.palette.accent, spec.palette.text];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-hairline bg-surface/70">
      <div className="border-b border-hairline px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Iterate with AI
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3 text-left">
            <div className="inline-block max-w-[92%] rounded-2xl bg-surface-2 px-3.5 py-2.5 leading-snug text-foreground">
              <div className="text-sm">
                I've analyzed <b>{eventContext.name}</b>. It reads as{" "}
                <span className="text-accent">{spec.mood}</span> · style{" "}
                <span className="font-mono text-xs">{spec.style}</span>.
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {starterPalette.map((c) => (
                  <span
                    key={c}
                    className="inline-block h-4 w-4 rounded border border-hairline"
                    style={{ backgroundColor: c }}
                  />
                ))}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {spec.fonts.heading} · {spec.fonts.body}
                </span>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Try: "make it more editorial", "use a serif heading", "warmer palette", "shift
                accent to rust".
              </div>
            </div>
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
      {refusal && (
        <div className="border-t border-hairline px-4 py-2 text-[11px] leading-snug text-muted-foreground">
          {refusal}
        </div>
      )}
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
