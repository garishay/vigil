/**
 * The prioritization pair's cast ids (S7d, #167; #131's owner amendment of 2026-09-17): the id
 * each row of 03a and of 03b takes, in row order. Two scenarios of one cast, rotated, must not
 * let a first run answer the second by name, so the two lists are **disjoint** and neither
 * orders its roles by number — 03a's threats are not its two lowest, and the lower of a pair is
 * the first entrant in 03a and the second in 03b.
 *
 * Only a **silent** row's number is ever read: a track with no broadcast identity shows
 * `TRK-<n>` (`trackIdent`), and a heard one shows its `UAS-XXXX` label, which the two seeds
 * already draw apart. So the twenty-five silent rows of each scenario take two-digit numbers
 * from the 11–99 the display has always used — fifty of eighty-nine, disjoint — and the
 * twenty-four heard furniture rows, which never show a number, take three-digit ones: 100–123
 * on 03a and 124–147 on 03b. The numbers were drawn once by a shuffle and are frozen here; the
 * file is the truth, and `scripts/study.test.ts` holds the two sets apart.
 *
 * Row order is the cast table's: threat 1, threat 2, the four baits, 02a's twenty-four furniture
 * rows, then the nineteen load rows.
 *
 * The demo member 03d (S11, #213) takes a third set, disjoint from both: its twenty-seven silent
 * rows draw from the thirty-nine two-digit numbers the pair left, its twenty-four heard rows take
 * 148–171. Drawn once by the same shuffle, frozen here, held apart by `scenarios.test.ts` on the
 * idents the screen shows — so no ident a viewer of the bare link has read is an ident 03a or 03b
 * shows. The corroboration pair numbers from 11 and is not held apart: 02a and 02b's silent
 * decoys read TRK-12 to TRK-16, and two of those, 14 and 16, are load rows here — non-threats on
 * both sides, and 02's threat is heard, so nothing carries. Its row order is its own table's:
 * threat 1, threat 2, the baits, the furniture, the load, then 03a's two threat rows re-cut as
 * near misses.
 */

/** 03a's ids, in cast-row order. */
export const CAST_IDS_03A = [
  31, 57, 35, 36, 25, 86, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
  115, 116, 117, 118, 119, 120, 121, 122, 123, 65, 74, 85, 52, 58, 91, 56, 94, 15, 20, 45, 62, 48,
  12, 64, 60, 22, 84, 47,
] as const

/** 03b's ids, in cast-row order — disjoint from 03a's. */
export const CAST_IDS_03B = [
  29, 23, 21, 79, 19, 73, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138,
  139, 140, 141, 142, 143, 144, 145, 146, 147, 80, 33, 83, 27, 70, 82, 98, 13, 95, 89, 96, 26, 51,
  49, 87, 99, 37, 24, 68,
] as const

/** 03d's ids, in cast-row order — disjoint from both of the pair's (S11, #213). */
export const CAST_IDS_03D = [
  44, 39, 32, 93, 97, 53, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162,
  163, 164, 165, 166, 167, 168, 169, 170, 171, 16, 72, 11, 76, 54, 66, 55, 14, 92, 42, 28, 50, 18,
  61, 43, 77, 41, 30, 75, 81, 90,
] as const
