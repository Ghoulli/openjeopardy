import { useRef, useCallback } from 'react'

export function useBuzzerSound() {
  const ctxRef = useRef(null)

  return useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = ctxRef.current

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    // Harsh descending buzz: square wave 220→110 Hz over 280ms
    osc.type = 'square'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.28)

    gain.gain.setValueAtTime(0.28, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.32)
  }, [])
}
