"use client";

import { ArrowUp, Camera, Lock, Phone, ShieldAlert, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { fmtClock } from "@/lib/format";
import type { ChatMessage } from "@/lib/chat";
import { decodeCallLog } from "@/lib/call-rules";
import { prepareChatImage, sendChat } from "./actions";
import { CallPanel } from "./call-panel";
import { VoiceRecorder, type VoiceRecorderHandle } from "./voice-recorder";
import { Ico } from "@/components/icon";
import { UserError, shownError } from "@/lib/user-error";

/**
 * The conversation: messages, composer and photo button. New messages arrive through Supabase
 * Realtime (RLS limits what this browser may receive) with an 8 s poll as a safety net, so a
 * dropped socket never hides a message.
 */
export function ChatRoom({
  dealId,
  messages,
  canSend,
  textOnly,
  me,
  name,
  callsAvailable,
  canCall,
  initialCallId,
  withHelper,
  canReport,
}: {
  /** The viewer can use "Report a problem" on this task (shown on this screen). */
  canReport: boolean;
  /** The applicant this conversation is with (customer side, while choosing); null otherwise. */
  withHelper: string | null;
  dealId: string;
  messages: ChatMessage[];
  canSend: boolean;
  textOnly: boolean;
  me: string;
  name: string;
  callsAvailable: boolean;
  canCall: boolean;
  initialCallId: string | null;
}) {
  const t = useT();
  const voice = useRef<VoiceRecorderHandle>(null);
  const [recording, setRecording] = useState(false);
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "bad"; text: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const sb = browserClient();
    const channel = sb
      .channel(`chat-${dealId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `deal_id=eq.${dealId}` }, () => router.refresh())
      .subscribe();
    const poll = setInterval(() => document.visibilityState === "visible" && router.refresh(), 8000);
    return () => {
      clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [dealId, router]);

  async function send(imagePath: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await sendChat(dealId, imagePath ? "" : text, imagePath, withHelper);
      if (r.error) setNotice({ tone: "bad", text: r.error });
      else {
        if (!imagePath) setText("");
        if (r.payOutside) setNotice({ tone: "warn", text: t("chat.payOutsideSent") });
        else if (r.masked) setNotice({ tone: "warn", text: t("chat.maskedNote") });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setNotice(null);
    try {
      const { blob } = await compressImage(f);
      const slot = await prepareChatImage(dealId, blob.size, withHelper);
      if ("error" in slot) throw new UserError(slot.error);
      const up = await browserClient().storage.from("chat").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "image/jpeg" });
      if (up.error) throw new UserError(t("proof.failed"));
      await send(slot.path);
    } catch (e) {
      setNotice({ tone: "bad", text: shownError(e, t("proof.failed")) });
      setBusy(false);
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {!callsAvailable && !textOnly && <p className="rounded-input bg-fill p-3 text-small text-ink-2">{t("call.temporarilyUnavailable")}</p>}
      {!textOnly && canCall && <CallPanel dealId={dealId} withHelper={withHelper} me={me} name={name} canCall={canCall} initialCallId={initialCallId} onFallback={() => voice.current?.start()} />}
      <p className="rounded-input bg-warn-bg p-3 text-small text-warn"><Ico as={Lock} size={16} /> {t("chat.safety")}</p>

      <ol className="flex flex-1 flex-col gap-2" aria-live="polite">
        {messages.length === 0 && <li className="py-8 text-center text-body text-ink-2">{t("chat.empty")}</li>}
        {messages.map((m) => {
          const log = m.system ? decodeCallLog(m.text) : null;
          if (log) {
            const time = log.kind === "ended" ? `${Math.floor(log.seconds / 60)}:${String(log.seconds % 60).padStart(2, "0")}` : "";
            return (
              <li key={m.id} className="self-center rounded-full bg-fill px-3 py-1 text-small text-ink-2">
                {log.video ? <Ico as={Video} size={16} /> : <Ico as={Phone} size={16} />} {log.video ? `${t("call.log.video")} · ` : ""}
                {t(`call.log.${log.kind}`, { time })} · {fmtClock(m.at)}
              </li>
            );
          }
          return (
          <li key={m.id} className={`flex flex-col ${m.fromMe ? "items-end" : "items-start"}`}>
            <div className={`max-w-[80%] rounded-card px-3.5 py-2 text-lead ${m.fromMe ? "bg-ink text-white" : "bg-fill text-ink"}`}>
              {m.imageUrl && (
                <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL */}
                  <img src={m.imageUrl} alt={t("chat.photo")} className="mb-1 max-h-64 rounded-input object-cover" />
                </a>
              )}
              {m.audioUrl && (
                <span className="flex items-center gap-2">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a voice message between two people; no transcript exists */}
                  <audio controls preload="none" src={m.audioUrl} className="h-10 max-w-56" />
                  {m.audioSeconds && <span className="text-caption tabular-nums opacity-80">{m.audioSeconds}s</span>}
                </span>
              )}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
            </div>
            <span className="mt-0.5 text-caption text-ink-2">
              {fmtClock(m.at)}
              {m.masked ? ` · ${t("chat.maskedTag")}` : ""}
              {m.fromMe && m.seen ? ` · ${t("chat.seen")}` : ""}
            </span>
            {/* the reader is warned where it matters: next to the message asking for money outside the app */}
            {m.payOutside && !m.fromMe && (
              <p className="mt-1 flex max-w-[80%] items-start gap-1.5 rounded-input bg-warn-bg px-3 py-2 text-meta leading-snug text-warn">
                <ShieldAlert aria-hidden size={16} className="mt-px shrink-0" />
                {t(canReport ? "chat.payOutsideWarn" : "chat.payOutsideWarnBefore")}
              </p>
            )}
          </li>
          );
        })}
        <div ref={bottom} />
      </ol>

      {notice && (
        <p role="alert" className={`rounded-input p-3 text-small ${notice.tone === "warn" ? "bg-warn-bg text-warn" : "bg-danger-bg text-danger"}`}>
          {notice.text}
        </p>
      )}

      {canSend ? (
        <form
          className="sticky bottom-0 -mx-5 flex items-end gap-2 border-t border-line bg-bg/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !busy) void send(null);
          }}
        >
          {!textOnly && <>
          <input ref={file} type="file" accept="image/*" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} />
          <VoiceRecorder ref={voice} dealId={dealId} withHelper={withHelper} disabled={busy} onRecording={setRecording} onError={(text) => setNotice({ tone: "bad", text })} />
          </>}
          {!recording && (
          <>
          {!textOnly && <button type="button" aria-label={t("chat.photo")} disabled={busy} onClick={() => file.current?.click()} className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-fill text-title-lg">
            <Ico as={Camera} size={22} />
          </button>}
          <label className="sr-only" htmlFor="chat-text">
            {t("chat.placeholder")}
          </label>
          <textarea
            id="chat-text"
            rows={1}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("chat.placeholder")}
            className="max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-input border border-line bg-bg px-3 py-3 text-lead outline-none focus:border-ink"
          />
          <button
            type="submit"
            aria-label={t("chat.send")}
            disabled={busy || !text.trim()}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-ink text-white disabled:bg-fill disabled:text-ink-3"
          >
            {busy ? "…" : <ArrowUp aria-hidden size={22} />}
          </button>
          </>
          )}
        </form>
      ) : (
        <p className="rounded-input bg-fill p-3 text-center text-small text-ink-2">{t("chat.readOnly")}</p>
      )}
    </div>
  );
}
