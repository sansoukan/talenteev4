"use client"

import type React from "react"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import NovaRecorder from "@/components/NovaRecorder"
import { useRepeatIntent } from "@/hooks/useRepeatIntent"
import { MetalButton } from "@/components/ui/metal-button"
import VideoPlayer from "@/components/VideoPlayer"
import NovaChatBox_TextOnly, { type NovaChatBoxTextOnlyRef } from "./NovaChatBox_TextOnly"
import { Volume2, VolumeX } from "lucide-react"

const isDefined = (x: any) => x !== undefined && x !== null
import { useNovaRealtimeVoice } from "@/hooks/useNovaRealtimeVoice"
import { NOVA_SESSION_CONFIG } from "@/config/novaSessionConfig"
import NovaTimer from "@/components/NovaTimer"
import { NovaPlaylistManager } from "@/lib/NovaPlaylistManager"
import { NovaIdleManager_Playlist } from "@/lib/NovaIdleManager_Playlist"
import {
  startNovaTranscription,
  stopNovaTranscription,
  disableNovaTranscription,
  novaEnableMic,
  novaDisableMic,
} from "@/lib/voice-utils"
import { NovaFlowController } from "@/lib/NovaFlowController"

/* ============================================================
   🔥 EMOTIONAL HEARTBEAT V5 — Niveau Google
============================================================ */
let EMO_INTERVAL: any = null

function startEmotionHeartbeat(questionId: string, sessionId: string, userId: string) {
  if (EMO_INTERVAL) clearInterval(EMO_INTERVAL)

  EMO_INTERVAL = setInterval(() => {
    fetch("/api/emotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        user_id: userId,
        question_id: questionId,
        source: "voice",
        words_per_min: (window as any).__novaResponseMetrics?.speaking_speed_wpm || null,
        hesitations: (window as any).__novaResponseMetrics?.hesitations_count || null,
      }),
    })
  }, 800)
}

function stopEmotionHeartbeat() {
  if (EMO_INTERVAL) clearInterval(EMO_INTERVAL)
  EMO_INTERVAL = null
}

interface ResponseMetrics {
  startTime: number
  endTime: number
  currentTranscript: string
  currentQuestionId: string | null
  detectedPauses: any[]
  lastSilenceTime: number | null
  scoring_axes?: any
  feedbackVideo?: string | null
  expectedAnswer?: string | null
  currentScore?: number | null
  currentScoreAuto?: number | null
}

function isQuestionVideo(url: string | null): boolean {
  if (!url) return false

  const isQ = /\/q_[0-9]+/i.test(url)

  const SYSTEM_FILES = [
    "clarify_end",
    "clarify_start",
    "idle_listen",
    "idle_smile",
    "intro_en_1",
    "intro_en_2",
    "intro_fr_1",
    "intro_fr_2",
    "listen_idle_01",
    "nova_end_interview",
    "nova_feedback_final",
    "question_missing",
    "thankyou",
  ]

  const isSystem = SYSTEM_FILES.some((name) => url.includes(name))

  return isQ && !isSystem
}

function shouldEnableMic(url: string | null): boolean {
  if (!url) return false
  return url.includes("idle_listen") || url.includes("idle_smile") || url.includes("listen")
}

function isIdleSmileVideo(url: string | null): boolean {
  if (!url) return false
  return url.includes("idle_smile") || url.includes("smile")
}

function pushQuestionToChat(chatRef: React.RefObject<NovaChatBoxTextOnlyRef | null>, question: any, lang = "en") {
  if (!chatRef?.current || !question) return

  const text =
    question[`audio_prompt_${lang}`] ||
    question[`text_${lang}`] ||
    question[`question_${lang}`] ||
    question.question_en ||
    question.question_fr ||
    null

  if (text) {
    chatRef.current.addMessage("nova", text.trim())
  }
}

export default function NovaEngine_Playlist({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const recordingRef = useRef<any>(null)
  const chatRef = useRef<NovaChatBoxTextOnlyRef>(null)
  const playlist = useRef(new NovaPlaylistManager()).current
  const idleMgrRef = useRef<any>(null)
  const flowRef = useRef<any>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const userCameraRef = useRef<HTMLVideoElement | null>(null)

  const startTimeRef = useRef<number | null>(null)
  const pausesRef = useRef<number[]>([])
  const lastSilentAtRef = useRef<number | null>(null)

  const [session, setSession] = useState<any>(null)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [playlistReady, setPlaylistReady] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [lastFollowupText, setLastFollowupText] = useState("")
  const [userCameraStream, setUserCameraStream] = useState<any>(null)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [showPreparingOverlay, setShowPreparingOverlay] = useState(false)
  const [showDashboardButton, setShowDashboardButton] = useState(false)
  const [userCameraHovered, setUserCameraHovered] = useState(false)
  const [videoPaused, setVideoPaused] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [isListeningPhase, setIsListeningPhase] = useState(false)
  const [isSilencePhase, setIsSilencePhase] = useState(false)
  const [isMuted, setIsMuted] = useState(true) // Add isMuted state - starts muted, unmutes on Start Simulation
  const [showStartLoading, setShowStartLoading] = useState(false) // Ajout du state pour le loading overlay au clic Start
  const idleLoopStartedRef = useRef(false)

  const responseMetrics = useRef<ResponseMetrics>({
    startTime: 0,
    endTime: 0,
    currentTranscript: "",
    currentQuestionId: null,
    detectedPauses: [],
    lastSilenceTime: null,
  })

  const novaVoice = useNovaRealtimeVoice(session?.lang || "en")
  const { checkRepeatIntent } = useRepeatIntent()
  const durationSecSafe = useMemo(() => session?.duration_target ?? NOVA_SESSION_CONFIG.durationSec, [session])

  const simulationMode = session?.simulation_mode || ((session?.lang || "en") === "en" ? "video" : "audio")
  const isAudioMode = simulationMode === "audio"
  const isVideoMode = simulationMode === "video"

  const handleTranscript = useCallback((t: string) => {
    responseMetrics.current.currentTranscript = t
    setLastFollowupText(t)

    if (idleMgrRef.current?.onUserSpeaking) {
      idleMgrRef.current.onUserSpeaking()
    }
  }, [])

  const handleSilenceConfirmed = useCallback((metrics: any) => {
    console.log("🔇 Silence confirmed (WS)", metrics)
    idleMgrRef.current?.handleSilence()
  }, [])

  const handleUserSpeaking = useCallback(() => {
    console.log("🗣️ User speaking")
  }, [])

  const handleSilenceStart = useCallback(() => {
    console.log("📢 Silence start detected")
  }, [])

  useEffect(() => {
    if (!hasStarted) return

    if (isListeningPhase && recordingRef.current) {
      console.log("[v0] Opening microphone - listening phase started")
      // Resume AudioContext if suspended (requires user interaction)
      recordingRef.current.startRecording()
      setMicEnabled(true)
      novaEnableMic() // Enable microphone using novaEnableMic
    } else if (!isListeningPhase && recordingRef.current?.isRecording?.()) {
      console.log("[v0] Closing microphone - listening phase ended")
      recordingRef.current.stopRecording()
      setMicEnabled(false)
      novaDisableMic() // Disable microphone using novaDisableMic
    }
  }, [isListeningPhase, hasStarted])

  useEffect(() => {
    ;(async () => {
      console.log("📡 Chargement session + questions…")

      let attempts = 0
      let json: any = null
      let res: any = null

      while (attempts < 6) {
        try {
          res = await fetch(`/api/engine/orchestrate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          })
          json = await res.json()
        } catch {
          json = null
        }

        if (res?.ok && (json?.questions?.length > 0 || json?.action === "INIT_Q1")) {
          console.log(`✅ Tentative ${attempts + 1} OK (${json?.questions?.length || 1} reçue(s))`)
          break
        }

        console.warn(`⏳ Tentative ${attempts + 1} — orchestrate encore en attente`)
        await new Promise((r) => setTimeout(r, 2000))
        attempts++
      }

      if (!json) {
        console.error("❌ Orchestrate null → Dashboard")
        router.push("/dashboard")
        return
      }

      // ---------------------------------------------------------
      // CAS 1 — INIT_Q1
      // ---------------------------------------------------------
      if (json?.action === "INIT_Q1" && json?.question) {
        console.log("🟦 INIT_Q1 détecté → Setup minimal (FlowController FIRST)")

        // 1) FlowController → toujours AVANT playlist.reset()
        flowRef.current = new NovaFlowController(
          sessionId,
          json.lang || "en",
          json.simulation_mode || ((json.lang || "en") === "en" ? "video" : "audio"),
          json.firstname || null,
        )

        flowRef.current.ctx.currentQuestion = json.question
        flowRef.current.ctx.nextQuestions = [] // ⛔ FIX MAJEUR

        // 2) Playlist reset → APRES FlowController
        playlist.reset?.()

        // 3) Session locale
        setSession({
          ...json,
          questions: [json.question],
          total_questions: 1,
        })

        setHasStarted(false)
        setIsPlaying(false)
        setVideoSrc(null)
        return
      }

      // ---------------------------------------------------------
      // CAS 2 — Séquence complète
      // ---------------------------------------------------------
      const qs = json.questions || json.session?.questions || json.detail?.questions || []

      console.log("📊 Questions reçues:", qs.length)

      // 1) FlowController → toujours AVANT playlist.reset()
      flowRef.current = new NovaFlowController(
        sessionId,
        json.lang || "en",
        json.simulation_mode || ((json.lang || "en") === "en" ? "video" : "audio"),
        json.firstname || null,
      )

      // 2) Injection questions dans FlowController
      flowRef.current.ctx.nextQuestions = [...qs]

      // 3) Playlist reset → APRES FlowController
      playlist.reset?.()

      // 4) Session locale
      setSession({
        ...json,
        questions: qs,
        total_questions: qs.length,
      })

      setHasStarted(false)
      setIsPlaying(false)
      setVideoSrc(null)
      ;(window as any).__novaFlow = flowRef.current
    })()
  }, [sessionId, playlist, router])

  /* ============================================================
     🧠 IDLE MANAGER INIT
  ============================================================ */
  useEffect(() => {
    if (!session || !playlist) return

    idleMgrRef.current = new NovaIdleManager_Playlist({
      session,
      playlist,
      lastFollowupText: () => lastFollowupText,
      flowRef: () => flowRef.current,
      onRelanceStart: () => {
        setIsListeningPhase(false)
      },
      onRelanceEnd: () => {
        setIsListeningPhase(true)
      },
    })

    console.log("🧠 IdleManager_Playlist initialisé")
  }, [session, playlist, lastFollowupText])

  useEffect(() => {
    const handleVideoChange = (next: string | null) => {
      console.log("[v0] Playlist emitted video:", next)
      setVideoSrc(next)

      if (!next) return

      if (isQuestionVideo(next)) {
        novaDisableMic()
        setIsListeningPhase(false)
        setIsSilencePhase(false)
        return
      }

      if (shouldEnableMic(next)) {
        novaEnableMic()
        setIsListeningPhase(true)
        setIsSilencePhase(false)
        idleMgrRef.current?.startLoop?.()
        return
      }

      if (isIdleSmileVideo(next)) {
        novaDisableMic()
        setIsListeningPhase(false)
        setIsSilencePhase(true)
        return
      }
    }

    playlist.subscribe(handleVideoChange)
    setPlaylistReady(true)
    console.log("[v0] Playlist subscription ready")

    return () => {
      playlist.unsubscribe(handleVideoChange)
    }
  }, [playlist])

  useEffect(() => {
    const setupUserCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false,
        })
        setUserCameraStream(stream)
        if (userCameraRef.current) {
          userCameraRef.current.srcObject = stream
        }
      } catch (err) {
        console.error("❌ Could not access user camera:", err)
      }
    }

    setupUserCamera()

    return () => {
      userCameraStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    }
  }, [])

  useEffect(() => {
    if (userCameraRef.current && userCameraStream) {
      userCameraRef.current.srcObject = userCameraStream
    }
  }, [userCameraStream])

  useEffect(() => {
    if (!hasStarted) return
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        setUserCameraStream(stream)
      } catch (err) {
        console.warn("📷 Camera access denied:", err)
      }
    })()

    return () => {
      userCameraStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    }
  }, [hasStarted])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && hasStarted) {
        e.preventDefault()
        const v = videoRef.current
        if (!v) return

        if (isPlaying) {
          v.pause()
          setVideoPaused(true)
          setIsPlaying(false)
          novaDisableMic() // Disable microphone when video is paused
        } else {
          v.play()
          setVideoPaused(false)
          setIsPlaying(true)
          novaEnableMic() // Enable microphone when video starts playing again
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasStarted, isPlaying, videoSrc])

  useEffect(() => {
    ;(window as any).__novaResponseMetrics = responseMetrics.current
    ;(window as any).__novaSessionId = sessionId
    ;(window as any).__novaUserId = session?.user_id
    ;(window as any).__novaLang = session?.lang || "en"
    ;(window as any).__novaFirstname = session?.profiles?.prenom || null
    ;(window as any).__novaIsTrial = session?.type_entretien === "trial"
    ;(window as any).__novaSimulationMode = simulationMode

    // Register hooks emitted by NovaRecorder
    ;(window as any).__novaSpeechStart = () => {
      console.log("🗣️ Speech start (WS)")
    }
    ;(window as any).__novaSilence = (metrics: any) => {
      console.log("🔇 Silence (WS)", metrics)
      idleMgrRef.current?.handleSilence()
    }
  }, [sessionId, session, simulationMode])

  /* ============================================================
     🎬 START HANDLER
  ============================================================ */
  async function handleStart() {
    console.log("[v0] handleStart called")

    playlist.reset?.()
    console.log("♻️ Playlist nettoyée avant démarrage")

    if (!session) return console.warn("⚠️ Session non chargée")

    if (!flowRef.current) {
      console.error("❌ FlowController non initialisé")
      return
    }

    try {
      const intro1 = await flowRef.current.getIntro1()
      console.log("[v0] Got intro1:", intro1)

      playlist.add(intro1)
      console.log("[v0] Added intro1 to playlist, size:", playlist.size())

      console.log("🎞️ Playlist initialisée avec intro_1")
      setIsPlaying(true)
      setVideoPaused(false)
      setHasStarted(true)

      await startNovaTranscription({
        sessionId,
        userId: session?.user_id,
        onTranscript: handleTranscript,
        onSilence: handleSilenceConfirmed,
        onSpeaking: handleUserSpeaking,
      })

      novaDisableMic()
      setIsListeningPhase(false)
    } catch (err) {
      console.error("❌ Erreur pendant le handleStart:", err)
    }
  }

  const prevVideoRef = useRef<string | null>(null)

  const handleEnded = async () => {
    console.log("⏹ Clip terminé:", videoSrc)

    const currentSrc = typeof videoSrc === "string" ? videoSrc : null

    prevVideoRef.current = currentSrc

    if (!flowRef.current) {
      console.error("❌ FlowController non initialisé")
      return
    }

    const flow = flowRef.current
    const state = flow.ctx.state
    const mode = flow.ctx.mode
    const lang = flow.ctx.lang

    /* ---------------------------------------------------------
       INTRO 1 → INTRO 2
    --------------------------------------------------------- */
    if (state === "INTRO_1") {
      console.log("[v0] INTRO_1 → INTRO_2")
      const intro2 = await flow.getIntro2()
      playlist.add(intro2)
      playlist.next()
      return
    }

    /* ---------------------------------------------------------
       INTRO 2 → Q1
    --------------------------------------------------------- */
    if (state === "INTRO_2") {
      console.log("[v0] INTRO_2 → Q1")

      const first = await flow.fetchQ1()
      if (!first) {
        console.error("❌ fetchQ1() a renvoyé NULL")
        return
      }

      pushQuestionToChat(chatRef, first.question, lang)

      if (first.type === "video") {
        playlist.add(first.url)
        if (flow.ctx.currentQuestion?.id) {
          responseMetrics.current.currentQuestionId = flow.ctx.currentQuestion.id
        }
      } else if (first.type === "audio") {
        const q = first.question
        responseMetrics.current.currentQuestionId = q.id

        await playAudioQuestion(q)

        const idle = await flow.getIdleListen()
        playlist.add(idle)
      }

      playlist.next()
      return
    }

    /* ---------------------------------------------------------
       Q1_VIDEO or RUN_VIDEO → Idle Listen
    --------------------------------------------------------- */
    if (state === "Q1_VIDEO" || state === "RUN_VIDEO") {
      console.log("🎤 Question finished → Idle listen")
      const idle = await flow.getIdleListen()
      playlist.add(idle)
      playlist.next()
      idleMgrRef.current?.startLoop?.()
      return
    }

    /* ---------------------------------------------------------
       REPEAT for AUDIO MODE
    --------------------------------------------------------- */
    if ((window as any).__novaRepeatRequested && mode === "audio") {
      ;(window as any).__novaRepeatRequested = false
      responseMetrics.current.currentTranscript = ""

      const q = flow.ctx.currentQuestion
      if (q?.id) {
        responseMetrics.current.currentQuestionId = q.id
      }

      pushQuestionToChat(chatRef, q, lang)

      await playAudioQuestion(q)

      const idle = await flow.getIdleListen()
      playlist.add(idle)
      playlist.next()
      novaEnableMic() // Enable microphone after repetition audio
      return
    }

    /* ---------------------------------------------------------
       REPEAT for VIDEO MODE
    --------------------------------------------------------- */
    if ((window as any).__novaRepeatRequested && mode === "video") {
      ;(window as any).__novaRepeatRequested = false
      responseMetrics.current.currentTranscript = ""

      const q = flow.ctx.currentQuestion
      if (q?.id) {
        responseMetrics.current.currentQuestionId = q.id
      }

      playlist.add(videoSrc)
      playlist.next()
      return
    }

    /* ---------------------------------------------------------
       FEEDBACK if transcript exists
    --------------------------------------------------------- */
    if (flow.ctx.currentQuestion && responseMetrics.current.currentTranscript) {
      const transcript = responseMetrics.current.currentTranscript || ""
      await flow.sendFeedback(transcript)
      novaEnableMic() // Enable microphone after sending feedback
      responseMetrics.current.currentTranscript = ""

      const idle = await flow.getIdleListen()
      playlist.add(idle)
      playlist.next()
      return
    }

    /* ---------------------------------------------------------
       FALLBACK — prevent getting stuck
    --------------------------------------------------------- */
    console.log("⚠️ handleEnded fallback reached")

    if (playlist.size() === 0) {
      const idle = await flow.getIdleListen()
      playlist.add(idle)
      playlist.next()
      novaEnableMic() // Enable microphone in fallback
    }
  }

  const playAudioQuestion = async (q: any) => {
    if ((window as any).__novaAudioLock) return
    ;(window as any).__novaAudioLock = true
    setTimeout(() => {
      ;(window as any).__novaAudioLock = false
    }, 2000)

    if (!q) return
    if (q.id) {
      responseMetrics.current.currentQuestionId = q.id
    }
    const lang = session?.lang || "en"
    const text =
      q[`audio_prompt_${lang}`] || q[`text_${lang}`] || q[`question_${lang}`] || q.question_en || q.question_fr || ""
    chatRef.current?.addMessage("nova", text)
    console.log("🎤 [Nova] Question audio :", text)
    await novaVoice.speak(text)
  }

  const handleUserChatMessage = useCallback(async (message: string) => {
    console.log("💬 User message:", message)
    try {
      const lastQuestion = chatRef.current?.getLastQuestion() || null
      const res = await fetch("/api/nova-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: message, lastQuestion }),
      })
      const data = await res.json()
      console.log("🧠 Nova response:", data)
      chatRef.current?.addMessage("nova", data.reply || "I'm here to help!")
    } catch (err) {
      console.error("❌ nova-chat error:", err)
      chatRef.current?.addMessage("nova", "Sorry, I couldn't process your message.")
    }
  }, [])

  const handleSessionEnd = async () => {
    console.log("⏹ Fin de session par timer")

    stopEmotionHeartbeat()
    setIsListeningPhase(false)

    try {
      stopNovaTranscription()
    } catch {}

    disableNovaTranscription()
    setMicEnabled(false)
    novaDisableMic()

    playlist.reset?.()
    setIsPlaying(false)
    setHasStarted(false)
    videoRef.current?.pause()

    idleMgrRef.current?.showEndScreen?.()

    await fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})

    await fetch("/api/engine/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})

    await handleFinalFeedback()
  }

  const handleFinalFeedback = async () => {
    console.log("🎯 Génération du feedback final...")
    setShowPreparingOverlay(true)

    try {
      if (flowRef.current) {
        await flowRef.current.endSession()
      }

      setTimeout(() => {
        router.push(`/interview/${sessionId}/results`)
      }, 1500)
    } catch (err) {
      console.error("❌ Erreur lors du feedback final:", err)
      setShowPreparingOverlay(false)
    }
  }

  return (
    <main className="h-screen w-screen bg-black text-white overflow-hidden flex flex-col antialiased">
      <header className="h-14 bg-black/80 backdrop-blur-2xl border-b border-white/10 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <img
            src="https://qpnalviccuopdwfscoli.supabase.co/storage/v1/object/public/nova-annexes/talentee_logo_static.svg"
            alt="Talentee"
            className="h-8 w-auto"
          />
          <span className="text-xs text-white/40">🚀 v2.1</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Live indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-red-400">Live</span>
          </div>
          {/* Timer - only when started */}
          {hasStarted && <NovaTimer totalMinutes={durationSecSafe / 60} onHardStop={handleSessionEnd} />}
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden items-stretch">
        {/* Video area - takes all available space */}
        <div
          className="flex-1 relative bg-zinc-900/50 rounded-3xl overflow-hidden border border-white/10"
          onMouseEnter={() => setUserCameraHovered(true)}
          onMouseLeave={() => setUserCameraHovered(false)}
        >
          {/* Video player - full size */}
          {videoSrc ? (
            <VideoPlayer
              ref={videoRef}
              src={videoSrc}
              autoPlay={!isMuted}
              muted={isMuted}
              playsInline
              onPlay={() => {
                console.log("Lecture en cours:", videoSrc)
                setIsPlaying(true)

                const q = flowRef.current?.ctx?.currentQuestion
                const lang = session?.lang || "en"

                // Affichage automatique dans le chat
                if (isQuestionVideo(videoSrc) && q) {
                  pushQuestionToChat(chatRef, q, lang)
                }

                novaDisableMic() // Micro OFF pendant toutes les videos (intro, question, relance)

                // Audio mode fallback
                if (isAudioMode && q) {
                  playAudioQuestion(q)
                }
              }}
              onPause={() => console.log("Pause detectee:", videoSrc)}
              onEnded={handleEnded}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 flex items-center justify-center">
              <div className="text-white/60 text-lg font-medium tracking-wide">Preparing interview...</div>
            </div>
          )}

          {!hasStarted && playlistReady && (
            <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/60 backdrop-blur-sm">
              <MetalButton
                onClick={async () => {
                  console.log("▶️ Start Simulation clicked")

                  setShowStartLoading(true)

                  setIsMuted(false)

                  await new Promise((res) => setTimeout(res, 900))

                  await handleStart()

                  setTimeout(() => setShowStartLoading(false), 300)
                }}
                variant="primary"
                size="lg"
                className="px-10 py-4 text-lg"
                disabled={showStartLoading}
              >
                Start Simulation
              </MetalButton>
            </div>
          )}

          {/* Click to play/pause overlay */}
          <div
            onClick={(e) => {
              if (!hasStarted) return
              e.stopPropagation()
              const v = videoRef.current
              if (!v) return

              if (isPlaying) {
                v.pause()
                setVideoPaused(true)
                setIsPlaying(false)
              } else {
                v.play()
                setVideoPaused(false)
                setIsPlaying(true)
              }
            }}
            className={hasStarted ? "absolute inset-0 cursor-pointer z-10" : "pointer-events-none"}
          />

          {/* User camera PIP - bottom right of video */}
          {userCameraStream && (
            <div
              className="absolute bottom-6 right-6 z-20 group/camera"
              onMouseEnter={() => setUserCameraHovered(true)}
              onMouseLeave={() => setUserCameraHovered(false)}
            >
              <div
                className={`rounded-2xl overflow-hidden border-2 border-white/30 bg-black shadow-2xl transition-all duration-300 ${
                  userCameraHovered ? "w-56 h-42" : "w-40 h-30"
                }`}
                style={{ width: userCameraHovered ? 224 : 160, height: userCameraHovered ? 168 : 120 }}
              >
                <video
                  ref={(el) => {
                    if (el && userCameraStream) {
                      el.srcObject = userCameraStream
                    }
                  }}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              </div>
              <span className="absolute bottom-2 left-3 text-xs text-white bg-black/70 backdrop-blur-xl px-2 py-0.5 rounded-full font-medium">
                You
              </span>
            </div>
          )}

          {/* Microphone recorder */}
          <div className="absolute bottom-6 left-6 z-20">
            <NovaRecorder
              ref={recordingRef}
              sessionId={sessionId}
              userId={session?.user_id}
              onTranscript={handleTranscript}
              onSilence={handleSilenceConfirmed}
              onSpeaking={handleUserSpeaking}
              onSilenceStart={handleSilenceStart}
            />
          </div>

          {/* Volume toggle button - Apple style */}
          {hasStarted && (
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="absolute bottom-6 left-6 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/20 flex items-center justify-center text-white/80 hover:text-white hover:bg-black/70 transition-all duration-200"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          )}
        </div>

        <aside className="w-80 lg:w-96 h-full bg-zinc-900/80 backdrop-blur-xl rounded-3xl border border-white/15 flex flex-col overflow-hidden">
          <div className="h-14 px-5 flex items-center gap-3 border-b border-white/10 bg-zinc-800/50">
            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <h2 className="font-semibold text-white tracking-wide">Nova Chat</h2>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-hidden">
            <NovaChatBox_TextOnly ref={chatRef} onUserMessage={handleUserChatMessage} />
          </div>
        </aside>
      </div>

      {showDashboardButton && (
        <button
          onClick={() => router.push("/dashboard")}
          className="fixed bottom-6 right-6 bg-white text-black px-6 py-3 rounded-xl shadow-lg hover:scale-105 transition z-50 font-semibold"
        >
          Return to dashboard
        </button>
      )}

      {showStartLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400 mb-4" />
          <p className="text-white/80 text-lg font-medium">Generating Nova Video...</p>
        </div>
      )}
    </main>
  )
}
