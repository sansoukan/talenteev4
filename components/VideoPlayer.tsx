"use client"

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react"

interface VideoPlayerProps {
  src: string
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  playsInline?: boolean
  onReady?: () => void
  onEnded?: () => void
  onPlay?: () => void
  onPause?: () => void
  onUnlockAudio?: () => void
  className?: string
}

export interface VideoPlayerHandle {
  play: () => Promise<void>
  pause: () => void
  get paused(): boolean
  get currentTime(): number
  get element(): HTMLVideoElement | null
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  (
    {
      src,
      autoPlay = false,
      muted = true,
      loop = false,
      playsInline = true,
      onReady,
      onEnded,
      onPlay,
      onPause,
      onUnlockAudio,
      className,
    },
    ref,
  ) => {
    // Double-buffer refs
    const videoA = useRef<HTMLVideoElement | null>(null)
    const videoB = useRef<HTMLVideoElement | null>(null)
    const isA = useRef(true)
    const lastSrc = useRef<string | null>(null)

    useImperativeHandle(ref, () => ({
      play: async () => {
        const active = isA.current ? videoA.current : videoB.current
        if (active) {
          await active.play()
          onPlay?.()
        }
      },
      pause: () => {
        const active = isA.current ? videoA.current : videoB.current
        if (active) {
          active.pause()
          onPause?.()
        }
      },
      get paused() {
        const active = isA.current ? videoA.current : videoB.current
        return active?.paused ?? true
      },
      get currentTime() {
        const active = isA.current ? videoA.current : videoB.current
        return active?.currentTime ?? 0
      },
      get element() {
        return isA.current ? videoA.current : videoB.current
      },
    }))

    const swapVideo = () => {
      const prev = isA.current ? videoA.current : videoB.current
      isA.current = !isA.current
      const next = isA.current ? videoA.current : videoB.current

      if (prev) {
        prev.style.opacity = "0"
        prev.style.zIndex = "0"
        prev.pause()
      }
      if (next) {
        next.style.opacity = "1"
        next.style.zIndex = "1"
      }
    }

    useEffect(() => {
      if (!src || src === lastSrc.current) return
      lastSrc.current = src

      const buffer = isA.current ? videoB.current : videoA.current

      if (!buffer) return

      buffer.src = src
      buffer.load()

      const handleLoaded = async () => {
        buffer.removeEventListener("loadeddata", handleLoaded)
        swapVideo()

        try {
          if (autoPlay) {
            await buffer.play()
            onReady?.()
            onPlay?.()
          }
        } catch (err) {
          console.warn("[VideoPlayer] Autoplay blocked:", err)
        }
      }

      buffer.addEventListener("loadeddata", handleLoaded)

      return () => buffer.removeEventListener("loadeddata", handleLoaded)
    }, [src, autoPlay, onReady, onPlay])

    const unlockAudio = async () => {
      const active = isA.current ? videoA.current : videoB.current
      if (!active) return
      try {
        active.muted = false
        await active.play()
        onUnlockAudio?.()
      } catch (err) {
        console.warn("[VideoPlayer] Cannot enable audio:", err)
      }
    }

    const baseClass = className || "w-full h-full object-cover rounded-xl"
    const transitionStyle = "transition-opacity duration-[120ms] ease-in-out"

    return (
      <div className="relative w-full h-full">
        <video
          ref={videoA}
          className={`${baseClass} ${transitionStyle} absolute inset-0`}
          style={{ opacity: 1, zIndex: 1 }}
          muted={muted}
          playsInline={playsInline}
          loop={loop}
          preload="auto"
          onEnded={onEnded}
          onPlay={onPlay}
          onPause={onPause}
          onClick={unlockAudio}
        />
        <video
          ref={videoB}
          className={`${baseClass} ${transitionStyle} absolute inset-0`}
          style={{ opacity: 0, zIndex: 0 }}
          muted={muted}
          playsInline={playsInline}
          loop={loop}
          preload="auto"
          onEnded={onEnded}
          onPlay={onPlay}
          onPause={onPause}
          onClick={unlockAudio}
        />
      </div>
    )
  },
)

VideoPlayer.displayName = "VideoPlayer"

export default VideoPlayer
