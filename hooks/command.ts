import type { Prefs } from '../types'

export const DEFAULT_PREFS: Prefs = {
  icons: 'unicode',
  rail: true,
  tables: true,
  shimmer: true,
  clipOutput: false,
}

// The on/off settings, by the word /skin and the settings pane use for each.
export const TOGGLES = {
  rail: 'rail',
  tables: 'tables',
  shimmer: 'shimmer',
  clip: 'clipOutput',
} as const satisfies Record<string, keyof Prefs>

export type ToggleWord = keyof typeof TOGGLES

export type Outcome = {
  prefs: Prefs
  message: string
  // `row` prints a transcript line (mistakes); `toast` confirms a change quietly.
  channel: 'row' | 'toast'
}

const flagOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

// What the store hands back may be old, hand-edited or from another version.
export function parsePrefs(raw: unknown): Prefs {
  const saved = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

  return {
    icons: saved.icons === 'ascii' ? 'ascii' : 'unicode',
    rail: flagOr(saved.rail, DEFAULT_PREFS.rail),
    tables: flagOr(saved.tables, DEFAULT_PREFS.tables),
    shimmer: flagOr(saved.shimmer, DEFAULT_PREFS.shimmer),
    clipOutput: flagOr(saved.clipOutput, DEFAULT_PREFS.clipOutput),
  }
}

const changed = (prefs: Prefs, message: string): Outcome => ({ prefs, message, channel: 'toast' })

const refused = (prefs: Prefs, message: string): Outcome => ({ prefs, message, channel: 'row' })

const isToggle = (word: string): word is ToggleWord => Object.hasOwn(TOGGLES, word)

// Every argument but none: with none, /skin opens the settings pane instead.
export function runSkinCommand(args: string, current: Prefs): Outcome {
  const [head = '', value] = args.trim().toLowerCase().split(/\s+/)

  if (isToggle(head)) {
    const field = TOGGLES[head]

    return value === 'on' || value === 'off'
      ? changed({ ...current, [field]: value === 'on' }, `${head} ${value}`)
      : refused(current, `usage: /skin ${head} on|off`)
  }

  if (head === 'icons') {
    return value === 'unicode' || value === 'ascii'
      ? changed({ ...current, icons: value }, `icons: ${value}`)
      : refused(current, 'usage: /skin icons unicode|ascii')
  }

  return refused(current, 'usage: /skin rail|tables|shimmer|clip on|off, /skin icons unicode|ascii')
}
