"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import { RING_TIMEOUT_MS, type CallLog } from "@/lib/call-rules";
import { browserClient } from "@/lib/supabase/browser";
import { answerCall, callSetup, callStatus, endCall, getIncoming, placeCall } from "./actions";
import { Mic, MicOff, Phone, Video, VideoOff } from "lucide-react";
import { Ico } from "@/components/icon";

type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "live" | "ended";
interface Incoming {
  callId: string;
  video: boolean;
  sdp: string;
}
interface SignalRow {
  deal_id: string;
  call_id: string;
  kind: "offer" | "answer" | "decline" | "hangup" | "busy";
  video: boolean;
  sdp: string | null;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Resolves once ICE gathering is complete (or after 3 s): we send one complete SDP, no trickle. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((done) => {
    if (pc.iceGatheringState === "complete") return done();
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        done();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, 3000);
  });
}

/**
 * Voice / video calls between the task's customer and chosen helper (docs/decisions.md 2026-11-14).
 * WebRTC in the browser; the handshake goes through server actions into `call_signals` (RLS: the
 * two people only) and arrives by Realtime, with a 2 s poll as backup. Not recorded — a call-log
 * line goes into the chat. If the network can't connect, we offer a voice message instead.
 */
export function CallPanel({
  dealId,
  withHelper,
  me,
  name,
  canCall,
  initialCallId,
  onFallback,
}: {
  dealId: string;
  /** The applicant this conversation is with (customer side, while choosing). */
  withHelper: string | null;
  me: string;
  name: string;
  canCall: boolean;
  initialCallId: string | null;
  onFallback: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [video, setVideo] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const callId = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const startedAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  function cleanup() {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
    local.current?.getTracks().forEach((tr) => tr.stop());
    local.current = null;
    pc.current?.close();
    pc.current = null;
    setMuted(false);
    setCamOff(false);
  }

  function finish(text: string, fallback = false) {
    cleanup();
    callId.current = null;
    setIncoming(null);
    setMessage(text);
    setShowFallback(fallback);
    go("ended");
  }

  async function hangUp(log: CallLog | null, text: string, fallback = false) {
    const id = callId.current;
    finish(text, fallback);
    if (id) await endCall(dealId, id, "hangup", log, withHelper);
  }

  function wire(conn: RTCPeerConnection, isVideo: boolean) {
    conn.ontrack = (e) => {
      const stream = e.streams[0];
      if (isVideo && remoteVideo.current) remoteVideo.current.srcObject = stream;
      if (remoteAudio.current) remoteAudio.current.srcObject = stream;
    };
    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      if (s === "connected" && phaseRef.current !== "live") {
        startedAt.current = Date.now();
        go("live");
      } else if (s === "failed") {
        void hangUp({ kind: "failed", video: isVideo }, t("call.failed"), true);
      } else if (s === "disconnected") {
        // brief network blips recover by themselves; give it 8 s
        timers.current.push(
          setTimeout(() => {
            if (pc.current === conn && conn.connectionState !== "connected") {
              void hangUp({ kind: "ended", video: isVideo, seconds: Math.round((Date.now() - startedAt.current) / 1000) }, t("call.ended"));
            }
          }, 8000),
        );
      }
    };
  }

  async function media(isVideo: boolean): Promise<MediaStream | null> {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setMessage(t("call.unsupported"));
      setShowFallback(true);
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo ? { facingMode: "user" } : false });
    } catch {
      setMessage(t("call.permission"));
      return null;
    }
  }

  function showLocal(stream: MediaStream, isVideo: boolean) {
    if (isVideo && localVideo.current) localVideo.current.srcObject = stream;
  }

  /** Applies whatever the other side sent for the current call. */
  async function onSignal(kind: SignalRow["kind"], sdp: string | null) {
    const p = phaseRef.current;
    if (kind === "answer" && p === "outgoing" && pc.current && sdp) {
      go("connecting");
      await pc.current.setRemoteDescription({ type: "answer", sdp });
    } else if (kind === "decline") finish(t("call.declined", { name }));
    else if (kind === "busy") finish(t("call.busy", { name }));
    else if (kind === "hangup" && p !== "idle" && p !== "ended") finish(t("call.ended"));
  }

  async function start(isVideo: boolean) {
    setMessage(null);
    setShowFallback(false);
    const setup = await callSetup(dealId, withHelper);
    if ("error" in setup) return setMessage(setup.error);
    const stream = await media(isVideo);
    if (!stream) return;
    setVideo(isVideo);
    local.current = stream;
    const conn = new RTCPeerConnection({ iceServers: setup.iceServers, iceTransportPolicy: setup.relayOnly ? "relay" : "all" });
    pc.current = conn;
    wire(conn, isVideo);
    stream.getTracks().forEach((tr) => conn.addTrack(tr, stream));
    go("outgoing");
    showLocal(stream, isVideo);
    await conn.setLocalDescription(await conn.createOffer());
    await gathered(conn);
    const id = crypto.randomUUID();
    callId.current = id;
    const r = await placeCall(dealId, id, isVideo, conn.localDescription?.sdp ?? "", withHelper);
    if (r.error) return finish(r.error, true);
    // no answer in time → missed
    timers.current.push(
      setTimeout(
        () => phaseRef.current === "outgoing" && void hangUp({ kind: "missed", video: isVideo }, t("call.noAnswer"), true),
        RING_TIMEOUT_MS,
      ),
    );
    // backup for Realtime: check the call's signals every 2 s until it's live or over
    const poll = async () => {
      if (callId.current !== id || !["outgoing", "connecting"].includes(phaseRef.current)) return;
      const rows = await callStatus(dealId, id);
      for (const row of rows) await onSignal(row.kind, row.sdp);
      timers.current.push(setTimeout(poll, 2000));
    };
    timers.current.push(setTimeout(poll, 2000));
  }

  async function accept() {
    const inc = incoming;
    if (!inc) return;
    setMessage(null);
    const setup = await callSetup(dealId, withHelper);
    if ("error" in setup) return finish(setup.error);
    const stream = await media(inc.video);
    if (!stream) return;
    setVideo(inc.video);
    local.current = stream;
    callId.current = inc.callId;
    const conn = new RTCPeerConnection({ iceServers: setup.iceServers, iceTransportPolicy: setup.relayOnly ? "relay" : "all" });
    pc.current = conn;
    wire(conn, inc.video);
    stream.getTracks().forEach((tr) => conn.addTrack(tr, stream));
    go("connecting");
    showLocal(stream, inc.video);
    await conn.setRemoteDescription({ type: "offer", sdp: inc.sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await gathered(conn);
    const r = await answerCall(dealId, inc.callId, conn.localDescription?.sdp ?? "", withHelper);
    setIncoming(null);
    if (r.error) finish(r.error, true);
  }

  async function decline() {
    const inc = incoming;
    setIncoming(null);
    go("idle");
    if (inc) await endCall(dealId, inc.callId, "decline", { kind: "declined", video: inc.video }, withHelper);
  }

  // one signalling row (an offer, or the other side's answer / hang-up). An Effect Event (React 19.2):
  // it always sees the latest phase and handlers, so the subscription below never has to restart.
  const onSignalRow = useEffectEvent((row: SignalRow) => {
    if (row.deal_id !== dealId) return;
    if (row.kind === "offer") {
      if (phaseRef.current !== "idle" && phaseRef.current !== "ended") {
        void endCall(dealId, row.call_id, "busy", null, withHelper);
        return;
      }
      if (row.sdp) {
        setIncoming({ callId: row.call_id, video: row.video, sdp: row.sdp });
        setMessage(null);
        go("incoming");
        navigator.vibrate?.([300, 200, 300, 200, 300]);
      }
    } else if (row.call_id === callId.current) {
      void onSignal(row.kind, row.sdp);
    }
  });

  // incoming offers and the other side's answers / hang-ups (Realtime, filtered by RLS to me)
  useEffect(() => {
    const sb = browserClient();
    const channel = sb
      .channel(`calls-${dealId}-${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user_id=eq.${me}` }, (payload) =>
        onSignalRow(payload.new as SignalRow),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [dealId, me]);

  // arriving from the push notification: "/chat/<id>?call=<callId>"
  useEffect(() => {
    if (!initialCallId) return;
    void getIncoming(dealId, initialCallId, withHelper).then((inc) => {
      if (inc && phaseRef.current === "idle") {
        setIncoming({ callId: inc.callId, video: inc.video, sdp: inc.sdp });
        go("incoming");
      }
    });
  }, [dealId, initialCallId, withHelper]);

  // an incoming call stops ringing after the timeout
  useEffect(() => {
    if (phase !== "incoming") return;
    const id = setTimeout(() => phaseRef.current === "incoming" && (setIncoming(null), go("idle")), RING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // leaving the page ends the call cleanly (an Effect Event: the latest call, without re-running)
  const leave = useEffectEvent(() => {
    const id = callId.current;
    if (id && ["outgoing", "connecting", "live"].includes(phaseRef.current)) void endCall(dealId, id, "hangup", null, withHelper);
    cleanup();
  });
  useEffect(() => () => leave(), []);

  const toggleMute = () => {
    local.current?.getAudioTracks().forEach((tr) => (tr.enabled = muted));
    setMuted(!muted);
  };
  const toggleCam = () => {
    local.current?.getVideoTracks().forEach((tr) => (tr.enabled = camOff));
    setCamOff(!camOff);
  };

  const active = phase === "outgoing" || phase === "connecting" || phase === "live";

  return (
    <>
      {canCall && !active && phase !== "incoming" && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => start(false)} className={btn.secondary}>
              <Ico as={Phone} /> {t("call.voice")}
            </button>
            <button type="button" onClick={() => start(true)} className={btn.secondary}>
              <Ico as={Video} /> {t("call.video")}
            </button>
          </div>
          <p className="text-caption text-ink-2">{t("call.privacyNote")}</p>
        </div>
      )}

      {message && (
        <div role="status" className="flex flex-col gap-2 rounded-input bg-fill p-3 text-small">
          <span>{message}</span>
          {showFallback && (
            <button type="button" className={`${btn.small} self-start`} onClick={onFallback}>
              <Ico as={Mic} /> {t("call.tryVoice")}
            </button>
          )}
        </div>
      )}

      {phase === "incoming" && incoming && (
        <div
          role="alertdialog"
          aria-label={t(incoming.video ? "call.incomingVideo" : "call.incoming", { name })}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-ink/95 p-6 text-white"
        >
          <p className="text-center text-headline font-bold">{t(incoming.video ? "call.incomingVideo" : "call.incoming", { name })}</p>
          <div className="flex gap-6">
            <button
              type="button"
              onClick={decline}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-headline"
              aria-label={t("call.decline")}
            >
              ✕
            </button>
            <button
              type="button"
              onClick={accept}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-held text-headline"
              aria-label={t("call.accept")}
            >
              {incoming.video ? <Ico as={Video} size={24} /> : <Ico as={Phone} size={24} />}
            </button>
          </div>
        </div>
      )}

      {/* the call screen stays mounted while active so the media elements keep their streams */}
      <div className={active ? "fixed inset-0 z-50 flex flex-col bg-ink text-white" : "hidden"} aria-hidden={!active}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live call: there is no caption track to give */}
        <audio ref={remoteAudio} autoPlay />
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live call: there is no caption track to give */}
        {video && <video ref={remoteVideo} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />}
        {video && (
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className="absolute right-4 top-4 h-40 w-28 rounded-card object-cover shadow-float"
          />
        )}
        <div className="relative z-10 mt-auto flex flex-col items-center gap-5 bg-gradient-to-t from-ink/90 to-transparent p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <p className="text-title-lg font-semibold">{name}</p>
          <p className="text-small text-white/80" role="status">
            {phase === "outgoing"
              ? t("call.calling", { name })
              : phase === "connecting"
                ? t("call.connecting")
                : t("call.inCall", { time: fmt(seconds) })}
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={toggleMute}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-title-lg"
              aria-label={muted ? t("call.unmute") : t("call.mute")}
              aria-pressed={muted}
            >
              {muted ? <Ico as={MicOff} size={24} /> : <Ico as={Mic} size={24} />}
            </button>
            {video && (
              <button
                type="button"
                onClick={toggleCam}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-title-lg"
                aria-label={camOff ? t("call.cameraOn") : t("call.cameraOff")}
                aria-pressed={camOff}
              >
                {camOff ? <Ico as={VideoOff} size={24} /> : <Ico as={Video} size={24} />}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                hangUp(
                  phase === "live"
                    ? { kind: "ended", video, seconds: Math.round((Date.now() - startedAt.current) / 1000) }
                    : phase === "outgoing"
                      ? { kind: "missed", video }
                      : null,
                  t("call.ended"),
                )
              }
              className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-title-lg"
              aria-label={t("call.hangUp")}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
