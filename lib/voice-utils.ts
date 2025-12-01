// ===============================================================
//  Nova Voice Utils — Dedicated WebSocket STT (CTO V4.2 FINAL)
// ===============================================================
//
//  ✔ Compatible Ngrok, Render, Vercel
//  ✔ Zero conflict with Next.js
//  ✔ Micro intelligent : ON/OFF contrôlé depuis NovaEngine
//  ✔ Évite les "Silence initial — patience"
//  ✔ Reconnexion seulement si micro actif
//  ✔ API identique : startNovaTranscription(), stopNovaTranscription()
// ===============================================================

let STT_WS: WebSocket | null = null
let TRANSCRIPTION_ENABLED = false
let MIC_ENABLED = false

/* ---------------------------------------------------------------
   🔵 DEBUG LOGS PREFIX
---------------------------------------------------------------- */
function log(...args: any[]) {
  console.log("🎧 [NovaVoice]", ...args)
}

/* ---------------------------------------------------------------
   🎚 MICRO CONTROL — Called from NovaEngine
---------------------------------------------------------------- */
export function novaEnableMic() {
  log("🎤 Micro ENABLED")
  MIC_ENABLED = true
}

export function novaDisableMic() {
  log("🔇 Micro DISABLED")
  MIC_ENABLED = false
}

/* ---------------------------------------------------------------
   🔴 CLEANUP — Stop + close STT
---------------------------------------------------------------- */
export function disableNovaTranscription() {
  TRANSCRIPTION_ENABLED = false
  MIC_ENABLED = false

  if (STT_WS) {
    try {
      STT_WS.close()
      log("🧹 STT WebSocket closed")
    } catch {}
  }

  STT_WS = null
}

/* ---------------------------------------------------------------
   🚀 START REALTIME STT
---------------------------------------------------------------- */
export async function startNovaTranscription({
  sessionId,
  userId,
  onTranscript,
  onSilence,
  onSpeaking,
}: {
  sessionId: string
  userId: string
  onTranscript: (t: string) => void
  onSilence: (m: any) => void
  onSpeaking: () => void
}) {
  disableNovaTranscription()
  TRANSCRIPTION_ENABLED = true

  const WS_BASE = process.env.NEXT_PUBLIC_STT_WS_URL
  if (!WS_BASE) {
    log("❌ ERROR: NEXT_PUBLIC_STT_WS_URL is missing")
    return
  }

  const WS_URL = `${WS_BASE}?session_id=${sessionId}&user_id=${userId}`
  log("🔵 Connecting STT WebSocket:", WS_URL)

  try {
    STT_WS = new WebSocket(WS_URL)
  } catch (err) {
    log("❌ Cannot create WebSocket:", err)
    return
  }

  /* ---------------------------------------------------------------
     🌐 CONNECTION EVENTS
  ---------------------------------------------------------------- */
  STT_WS.onopen = () => {
    log("🟢 STT WebSocket connected")
  }

  STT_WS.onerror = (err) => {
    log("❌ STT WebSocket error:", err)
  }

  STT_WS.onclose = () => {
    log("🔵 STT WebSocket closed")

    // ONLY reconnect if STT is enabled AND mic should be listening
    if (TRANSCRIPTION_ENABLED && MIC_ENABLED) {
      log("⏳ Reconnecting (mic ON)…")
      setTimeout(() => {
        startNovaTranscription({ sessionId, userId, onTranscript, onSilence, onSpeaking })
      }, 600)
    } else {
      log("⛔ No reconnection (mic OFF)")
    }
  }

  /* ---------------------------------------------------------------
     📨 MESSAGE HANDLER
  ---------------------------------------------------------------- */
  STT_WS.onmessage = (event) => {
    let msg: any = null

    try {
      msg = JSON.parse(event.data)
    } catch {
      log("⚠️ Cannot parse STT frame:", event.data)
      return
    }

    // If mic is OFF, ignore everything
    if (!MIC_ENABLED) {
      log("⏭️ Ignored STT frame (mic off)", msg.type)
      return
    }

    // Detect user speaking
    if (msg.type === "input_audio_buffer.append") {
      onSpeaking()
    }

    // Incremental text
    if (msg.type === "response.output_text.delta" && msg.text) {
      onTranscript(msg.text)
    }

    // Finalization (silence)
    if (msg.type === "response.completed") {
      onSilence(msg.metrics || {})
    }
  }
}

/* ---------------------------------------------------------------
   🛑 STOP STT (called end of session)
---------------------------------------------------------------- */
export function stopNovaTranscription() {
  disableNovaTranscription()
}