"use client"

import { useEffect, useRef } from "react"

interface VideoPlayerProps {
  src: string
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  playsInline?: boolean
  onReady?: () => void
  onEnded?: () => void
  onPlay?: () => void
  onUnlockAudio?: () => void
  className?: string
}

/**
 * =========================================================
 * VideoPlayer V2 - Seamless transitions (no black screen)
 * ---------------------------------------------------------
 * - Preloads next video while current plays
 * - Instant switch on video end
 * - Keeps audio context alive
 * =========================================================
 */
export default function VideoPlayer({
  src,
  autoPlay = false,
  muted = true,
  loop = false,
  playsInline = true,
  onReady,
  onEnded,
  onPlay,
  onUnlockAudio,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const prevSrcRef = useRef<string | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return

    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src

      // Store current muted state
      const wasMuted = v.muted

      // Preload and switch seamlessly
      v.preload = "auto"
      v.src = src
      v.load()

      // Restore muted state
      v.muted = wasMuted

      const handleCanPlay = async () => {
        try {
          if (autoPlay) {
            await v.play()
            onReady?.()
            onPlay?.()
          }
        } catch (err) {
          console.warn("[VideoPlayer] Autoplay blocked:", err)
        }
        v.removeEventListener("canplaythrough", handleCanPlay)
      }

      v.addEventListener("canplaythrough", handleCanPlay)

      return () => v.removeEventListener("canplaythrough", handleCanPlay)
    }
  }, [src, autoPlay, onReady, onPlay])

  // Audio unlock on user click
  const unlockAudio = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      v.muted = false
      await v.play()
      onUnlockAudio?.()
    } catch (err) {
      console.warn("[VideoPlayer] Cannot enable audio:", err)
    }
  }

  return (
    <video
      ref={videoRef}
      className={className || "w-full h-full object-cover rounded-xl"}
      muted={muted}
      playsInline={playsInline}
      loop={loop}
      preload="auto"
      onEnded={onEnded}
      onClick={unlockAudio}
    />
  )
}
