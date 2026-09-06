import { useCallback, useEffect, useRef } from 'react'

/**
 * The alert tone (#101, 101b): one audio element for the session, created on the first raise
 * from the file the generator wrote (`public/alert-tone.wav`, under the deploy's base), restarted
 * on each raise, and played once per raise batch — the caller signals a batch, not a card, so
 * several cards raised on one tick sound once. Muted, nothing plays; the cards still stack.
 *
 * Browsers gate audio behind a user gesture (ruled A9 on #101): the app plays on load without
 * one, so a raise before the viewer's first click anywhere is refused by the browser, and that
 * refusal is swallowed here — no console noise, no prompt. Play, Pause, a row, Mute: any of
 * them is the gesture, and every raise after it sounds.
 */
export function useAlertTone(
  muted: boolean,
  create: () => HTMLAudioElement = () => new Audio(`${import.meta.env.BASE_URL}alert-tone.wav`),
): () => void {
  const element = useRef<HTMLAudioElement | null>(null)
  // Read through refs so the returned callback keeps one identity: the effect that calls it on
  // a raise depends on it, and must not fire because the mute toggled.
  const mutedRef = useRef(muted)
  const createRef = useRef(create)
  useEffect(() => {
    mutedRef.current = muted
    createRef.current = create
  }, [muted, create])
  return useCallback(() => {
    if (mutedRef.current) return
    element.current ??= createRef.current()
    const audio = element.current
    audio.currentTime = 0
    // `play()` resolves or rejects with the autoplay policy's answer; either way, the tone is
    // best-effort and nothing waits on it.
    audio.play()?.catch(() => undefined)
  }, [])
}
