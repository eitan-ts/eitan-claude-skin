import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { Prefs, TurnStats } from '../types'
import { DEFAULT_PREFS, parsePrefs, runSkinCommand, TOGGLES } from './command'
import { forTheme, isLightTheme } from './light'
import { clipLines, diffstat, pick } from './format'
import { splitReply } from './markdown'
import { askBand, desktopSpinnerRow, diffCard, footerRow, terminalCard, groupRow, replyRows, spinnerRow, toolRow } from './rows'
import type { Look, SvgElement, Ui } from './rows'
import { settingsPane } from './settings'
import { ICONS } from './skin'
import type { Skin } from './skin'
import orca from './themes/orca'
import { hunksOf } from './svg-diff'
import { shellOutputOf } from './svg-terminal'
import { shortenPath } from './format'
import { kindOf, summarize } from './tools'

const SETTINGS = 'skins-settings'

// Markdown takes at most 10000 characters a block; a longer prompt keeps Claude Code's
// own drawing, which folds a big paste.
const MAX_MARKDOWN = 9000

const CLIP_HEAD = 8
const CLIP_TAIL = 4
const FRAME_MS = 90
const KEPT_TURNS = 40

const prefsAtom = atom({ plugin: 'eitan-skin', key: 'prefs' } as const, DEFAULT_PREFS)
const startedAtom = atom({ plugin: 'eitan-skin', key: 'startedAt' } as const, 0)
const frameAtom = atom({ plugin: 'eitan-skin', key: 'frame' } as const, 0)
const turnsAtom = atom({ plugin: 'eitan-skin', key: 'turns' } as const, {})
const durationAtom = atom({ plugin: 'eitan-skin', key: 'duration' } as const, -1)
const lightAtom = atom({ plugin: 'eitan-skin', key: 'isLight' } as const, false)

const EDITS = new Set(['Edit', 'MultiEdit', 'Write'])

type Active = { prefs: Prefs; skin: Skin }

const NO_STATS: TurnStats = { tools: 0, added: 0, removed: 0 }

async function activeSkin($: EngineInterface): Promise<Active> {
  return { prefs: await read($, prefsAtom), skin: forTheme(orca, await read($, lightAtom)) }
}

// Claude Code's own theme decides whether skins draw for a light or a dark background.
async function refreshTheme($: EngineInterface): Promise<void> {
  const rows = await $.config.list()
  const isLight = isLightTheme(rows.find(row => row.key === 'theme')?.value)

  await update($, lightAtom, () => isLight)
}

// Every surface's element table names Svg, but the terminal draws it as nothing, so
// vector icons are for the other surfaces only.
const lookOf = (
  ui: Ui & { Svg?: SvgElement },
  active: Active,
  surface: RenderSurface,
  copy?: (text: string) => void,
): Look => ({
  ui,
  skin: active.skin,
  icons: ICONS[active.prefs.icons],
  prefs: active.prefs,
  surface,
  ...(surface !== 'terminal' && ui.Svg !== undefined ? { svg: ui.Svg } : {}),
  ...(copy === undefined ? {} : { copy }),
})

async function load($: EngineInterface): Promise<void> {
  const prefs = parsePrefs(await $.store.get('prefs'))

  await update($, prefsAtom, () => prefs)
}

async function commit($: EngineInterface, prefs: Prefs): Promise<void> {
  await update($, prefsAtom, () => prefs)
  await $.store.set('prefs', prefs)
}

export const register: Register = on => {
  // What the turn on the main loop has done so far, for its footer.
  let stats: TurnStats = NO_STATS
  let isWorking = false
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin',
      description: 'Open the skin settings, or /skin <rail | tables | shimmer | clip | icons>',
      argumentHint: '[rail | tables | shimmer | clip | icons]',
      immediate: true,
    })
    await load($)
    await refreshTheme($)

    // Only the spinner reads the frame, so a tick redraws the spinner and nothing else.
    ticker?.cancel()
    ticker = $.clock.every(FRAME_MS, () => {
      if (isWorking) {
        void update($, frameAtom, frame => frame + 1)
      }
    })

    return next(e)
  })

  // /clear, /resume and /branch reset $.state to its defaults and skip session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    stats = NO_STATS
    isWorking = true
    const now = await $.clock.now()
    await update($, startedAtom, () => now)

    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)

    if (e.key === 'theme') {
      await refreshTheme($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      const finished = stats
      await update($, turnsAtom, turns =>
        Object.fromEntries([...Object.entries(turns), [String(e.durationMs), finished]].slice(-KEPT_TURNS)),
      )
    }

    return next(e)
  })

  // Times every call and counts the main loop's calls and changed lines.
  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - startedAt

    await update($, memberOf(durationAtom, { requestId: e.tool_use_id }), () => ms)

    if (e.agentId === undefined && ran.deny === undefined) {
      const diff = diffstat(ran.result)
      stats = {
        tools: stats.tools + 1,
        added: stats.added + (diff?.added ?? 0),
        removed: stats.removed + (diff?.removed ?? 0),
      }
    }

    return ran
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    if (e.args.trim() === '') {
      await $.ui.open({ id: SETTINGS, title: 'Skins', focus: true, closeOnEscape: true })

      return {}
    }

    const current = await read($, prefsAtom)
    const outcome = runSkinCommand(e.args, current)

    if (outcome.prefs !== current) {
      await commit($, outcome.prefs)
    }

    if (outcome.channel === 'row') {
      return { text: outcome.message }
    }

    $.ui.toast(outcome.message)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const prefs = await read($, prefsAtom)
    const ui = $.ui.resolve(e)

    if (e.surface === 'mobile' || !('Button' in ui)) {
      return <ui.Text>Open the skin settings in the terminal or the desktop app.</ui.Text>
    }

    const look = lookOf(ui, await activeSkin($), e.surface)

    return settingsPane(look, ui, {
      toggle: word => void commit($, { ...prefs, [TOGGLES[word]]: !prefs[TOGGLES[word]] }),
      icons: () => void commit($, { ...prefs, icons: prefs.icons === 'unicode' ? 'ascii' : 'unicode' }),
    })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const kind = kindOf(e.props.tool)
    const active = await activeSkin($)

    if (kind === null) {
      return next(e)
    }

    const ms = await read($, memberOf(durationAtom, e))
    const diff = diffstat(e.props.output)
    const target = summarize(e.props.tool, e.props.input, await $.session.cwd())

    return toolRow(lookOf($.ui.resolve(e), active, e.surface), e.props, kind, target, {
      ...(ms >= 0 && !e.props.isRunning ? { ms } : {}),
      ...(diff === null ? {} : diff),
    })
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (e.props.isExpanded) {
      return next(e)
    }

    return groupRow(lookOf($.ui.resolve(e), active, e.surface), e.props.calls)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const active = await activeSkin($)
    const output = e.props.output as { stdout?: unknown } | null
    const copy = (text: string) => {
      void $.ui.copy({ text, surface: e.surface }).then(result => $.ui.toast(result.isCopied ? 'Copied' : 'Could not copy here'))
    }
    const look = lookOf($.ui.resolve(e), active, e.surface, copy)
    const columns = e.viewport?.columns ?? 100

    // The desktop gets cards: a diff for an edit, a terminal for a shell command.
    if (look.svg !== undefined && EDITS.has(e.props.tool) && !e.props.isErrored) {
      const diff = hunksOf(e.props.output)

      if (diff !== null) {
        return diffCard(look, look.svg, diff, shortenPath(diff.path, await $.session.cwd()), columns)
      }
    }

    if (look.svg !== undefined && e.props.tool === 'Bash') {
      const shell = shellOutputOf(e.props.output)

      if (shell !== null) {
        return terminalCard(look, look.svg, shell, e.props.isErrored, columns)
      }
    }

    if (!active.prefs.clipOutput || e.props.tool !== 'Bash' || typeof output?.stdout !== 'string') {
      return next(e)
    }

    const stdout = clipLines(output.stdout, CLIP_HEAD, CLIP_TAIL)

    return stdout === output.stdout
      ? next(e)
      : next({ ...e, props: { ...e.props, output: { ...output, stdout } } })
  })

  // A reply keeps Claude Code's own drawing unless it holds a table to draw.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const active = await activeSkin($)

    const text = e.props.text

    if (!active.prefs.tables || !/\||```|~~~/.test(text)) {
      return next(e)
    }

    const segments = splitReply(text)
    const fits = segments.every(segment => segment.kind === 'table' || (segment.kind === 'text' ? segment.text : segment.raw).length <= MAX_MARKDOWN)

    if (!fits || !segments.some(segment => segment.kind !== 'text')) {
      return next(e)
    }

    // Every surface's table names Svg, but the terminal draws it as nothing.
    const ui = $.ui.resolve(e)
    const copy = (copied: string) => {
      void $.ui.copy({ text: copied, surface: e.surface }).then(result => $.ui.toast(result.isCopied ? 'Copied' : 'Could not copy here'))
    }

    return replyRows(lookOf(ui, active, e.surface, copy), segments, e.viewport?.columns ?? 100, e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined)
  })

  // The terminal's spinner gets the skin's word with a shimmer; the desktop's keeps its
  // word, which says what the step is doing, beside an animated icon.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (e.surface !== 'terminal') {
      const look = lookOf($.ui.resolve(e), active, e.surface)

      return look.svg === undefined
        ? next(e)
        : desktopSpinnerRow(look, look.svg, e.props.mode, e.props.message ?? e.props.word)
    }

    const word = pick(active.skin.spinner, e.props.word) ?? e.props.word

    if (!active.prefs.shimmer || e.props.message !== null) {
      return next({ ...e, props: { ...e.props, word } })
    }

    const frame = await read($, frameAtom)
    const startedAt = await read($, startedAtom)
    const elapsed = startedAt === 0 ? 0 : (await $.clock.now()) - startedAt

    return spinnerRow(lookOf($.ui.resolve(e), active, e.surface), word, frame, elapsed)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const active = await activeSkin($)

    const turns = await read($, turnsAtom)
    const word = pick(active.skin.done, e.props.word) ?? e.props.word

    return footerRow(lookOf($.ui.resolve(e), active, e.surface), word, e.props.durationMs, turns[String(e.props.durationMs)])
  })

  // Claude Code's own dialog stays whole: the skin only adds a band above it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const active = await activeSkin($)
    const theirs = await next(e)
    const headers = e.props.questions
      .map(question => (question as { header?: unknown } | null)?.header)
      .filter((header): header is string => typeof header === 'string' && header !== '')
    const look = lookOf($.ui.resolve(e), active, e.surface)
    const { Box } = look.ui

    return headers.length === 0 ? (
      theirs
    ) : (
      <Box flexDirection="column">
        {askBand(look, headers)}
        {theirs}
      </Box>
    )
  })
}
