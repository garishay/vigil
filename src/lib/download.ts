/**
 * Handing a file to the browser (S6a-iii, #165): one click, one file.
 *
 * The anchor is attached before the click, because a detached one does not download in every
 * browser, and the object URL is revoked on a later turn — the click is taken synchronously, but
 * the blob is not read until after it (round 1 on #187, ruled 5). Its own module because both
 * the end screen and the sheet's document view offer files, and the end screen must not import
 * anything from the sheet's chunk (R1).
 */
export function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** A run's own file, the name a subject hands over (item 3). */
export const downloadRun = (subject: string, run: number, text: string) =>
  download(`vigil-${subject}-run${run}.json`, 'application/json', text)
