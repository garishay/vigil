import { useState, type RefObject } from 'react'

/**
 * Copy text to the clipboard with the handoff's mechanics (03b), shared by the drawer and the
 * site plan (08b): the clipboard API first; failing that — no API, or permission refused — select
 * the visible textarea and copy that, so a manual Ctrl+C works even when the fallback throws or
 * refuses outside the original gesture (#47 round 5). "Copied" is a claim about the current
 * text: it reads true only for the text actually copied, and reverts once the text regenerates
 * (a false claim puts stale clipboard content into an escalation — review finding on #47).
 * Nothing is transmitted (§2): the operator delivers it themselves.
 */
export function useCopy(textarea: RefObject<HTMLTextAreaElement | null>) {
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const copy = async (text: string) => {
    let copied: boolean
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      textarea.current?.select()
      try {
        copied = document.execCommand?.('copy') ?? false
      } catch {
        copied = false
      }
    }
    setCopiedText(copied ? text : null)
  }
  return { copy, copied: (text: string) => copiedText === text }
}
