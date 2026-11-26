"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import { MAX_VOICE_SECONDS } from "@/lib/call-rules";
import { browserClient } from "@/lib/supabase/browser";
import { prepareVoice, sendVoice } from "./actions";
import { Mic } from "lucide-react";
import { Ico } from "@/components/icon";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export interface VoiceRecorderHandle {
  start: () => void;
}

/**
 * Tap to record a voice message (max 2 min), tap again to send. Works on every network, so it's
 * also the fallback when a call can't connect. Stored privately in the chat bucket.
 */
export const VoiceRecorder = forwardRef<VoiceRecorderHandle, { dealId: string; withHelper: string | null; disabled: boolean; onError: (m: string) => void; onRecording: (r: boolean) => void }>(
  function VoiceRecorder({ dealId, withHelper, disabled, onError, onRecording }, ref) {
    const t = useT();
    const router = useRouter();
    const [recording, setRecording] = useState(false);
    const [busy, setBusy] = useState(false);
    const [secs, setSecs] = useState(0);
    const rec = useRef<MediaRecorder | null>(null);
    const chunks = useRef<Blob[]>([]);
    const started = useRef(0);
    const cancelled = useRef(false);

    useEffect(() => onRecording(recording), [recording, onRecording]);

    useEffect(() => {
      if (!recording) return;
      const id = setInterval(() => {
        const s = Math.round((Date.now() - started.current) / 1000);
        setSecs(s);
        if (s >= MAX_VOICE_SECONDS) rec.current?.stop();
      }, 500);
      return () => clearInterval(id);
    }, [recording]);

    async function start() {
      if (recording || busy) return;
      const type = typeof MediaRecorder !== "undefined" ? TYPES.find((x) => MediaRecorder.isTypeSupported(x)) : undefined;
      if (!type || !navigator.mediaDevices?.getUserMedia) return onError(t("call.unsupported"));
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return onError(t("call.permission"));
      }
      const r = new MediaRecorder(stream, { mimeType: type });
      chunks.current = [];
      cancelled.current = false;
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        if (cancelled.current) return;
        const seconds = Math.max(1, Math.round((Date.now() - started.current) / 1000));
        const base = type.split(";")[0];
        const blob = new Blob(chunks.current, { type: base });
        setBusy(true);
        try {
          const slot = await prepareVoice(dealId, base, blob.size, withHelper);
          if ("error" in slot) throw new Error(slot.error);
          const up = await browserClient().storage.from("chat").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: base });
          if (up.error) throw new Error(t("proof.failed"));
          const sent = await sendVoice(dealId, slot.path, seconds, withHelper);
          if (sent.error) throw new Error(sent.error);
          router.refresh();
        } catch (e) {
          onError(e instanceof Error && e.message ? e.message : t("proof.failed"));
        } finally {
          setBusy(false);
        }
      };
      rec.current = r;
      started.current = Date.now();
      setSecs(0);
      setRecording(true);
      r.start(1000);
    }

    useImperativeHandle(ref, () => ({ start: () => void start() }));

    if (recording) {
      return (
        <div className="flex flex-1 items-center gap-2" role="status">
          <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-danger" />
          <span className="flex-1 text-body tabular-nums">{t("call.recording", { time: fmt(secs) })}</span>
          <button
            type="button"
            className={btn.text}
            onClick={() => {
              cancelled.current = true;
              rec.current?.stop();
            }}
          >
            {t("call.cancel")}
          </button>
          <button type="button" className={btn.small} onClick={() => rec.current?.stop()}>
            {t("call.stopSend")}
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        aria-label={t("call.record")}
        disabled={disabled || busy}
        onClick={start}
        className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-fill text-title-lg disabled:opacity-50"
      >
        {busy ? "…" : <Ico as={Mic} size={22} />}
      </button>
    );
  },
);
