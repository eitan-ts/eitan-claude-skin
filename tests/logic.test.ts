import { expect, test } from 'claude-code/testing'

import { DEFAULT_PREFS, parsePrefs, runSkinCommand } from '../hooks/command'
import { clipLines, diffstat, formatDuration, formatMs, pick, shortenPath } from '../hooks/format'
import { columnWidths, cutCell, padCell, splitReply, widthOf } from '../hooks/markdown'
import { codeSvg, tokenize } from '../hooks/svg-code'
import { diffLines, diffSvg, hunksOf } from '../hooks/svg-diff'
import { fitColumns, kindOfCell, measure, tableSvg, wrapCell } from '../hooks/svg-table'
import { outputLines, shellOutputOf, terminalSvg } from '../hooks/svg-terminal'
import { deepen, isLightTheme, toLight } from '../hooks/light'
import { kindOf, summarize, toolLabel } from '../hooks/tools'
import orca from '../hooks/themes/orca'

test('paths under the session directory show relative, others stay', async () => {
  expect(shortenPath('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src/a.ts')
  expect(shortenPath('/work/app/src/a.ts', '/work/app/')).toBe('src/a.ts')
  expect(shortenPath('/etc/hosts', '/work/app')).toBe('/etc/hosts')
  expect(shortenPath('/work/application/a.ts', '/work/app')).toBe('/work/application/a.ts')
})

test('times read like Claude Code writes them', async () => {
  expect(formatDuration(400)).toBe('<1s')
  expect(formatDuration(64000)).toBe('1m 4s')
  expect(formatMs(340)).toBe('340ms')
  expect(formatMs(2140)).toBe('2.1s')
})

test('a seed always picks the same word, and an empty list picks none', async () => {
  expect(pick(['a', 'b', 'c'], 'Sauteing')).toBe(pick(['a', 'b', 'c'], 'Sauteing'))
  expect(pick([], 'Sauteing')).toBeUndefined()
})

test('long output keeps its head and tail and counts the rest', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const clipped = clipLines(lines, 8, 4).split('\n')

  expect(clipped[8]).toBe('… 18 lines hidden')
  expect(clipped[12]).toBe('line 29')
  expect(clipLines('a\nb', 8, 4)).toBe('a\nb')
})

test('a patch counts its added and removed lines, anything else counts nothing', async () => {
  const output = { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }] }

  expect(diffstat(output)).toEqual({ added: 2, removed: 2 })
  expect(diffstat({ stdout: 'x' })).toBeNull()
  expect(diffstat(null)).toBeNull()
})

test('only the tools a skin can draw faithfully get a kind', async () => {
  expect(kindOf('Bash')).toBe('run')
  expect(kindOf('mcp__github__search_code')).toBe('mcp')
  expect(kindOf('Task')).toBeNull()
  expect(toolLabel('mcp__github__search_code')).toBe('github:search_code')
})

test('a call summarises to the one thing worth a glance', async () => {
  expect(summarize('Bash', { command: 'pnpm test\n  --filter hub' }, '/w')).toBe('pnpm test')
  expect(summarize('Grep', { pattern: 'TODO', path: '/w/src' }, '/w')).toBe('TODO in src')
  expect(summarize('Bash', null, '/w')).toBe('')
})

test('tables and closed code fences are split out of a reply, and a fence keeps its table as code', async () => {
  const reply = [
    'Here:',
    '',
    '| Route | Limit |',
    '|:------|------:|',
    '| /chat | **60** |',
    '| /up | 10 |',
    '',
    'Done.',
    '```',
    '| a | b |',
    '|---|---|',
    '```',
  ].join('\n')
  const segments = splitReply(reply)

  expect(segments.map(segment => segment.kind)).toEqual(['text', 'table', 'text', 'code'])
  expect(segments[3]).toEqual({ kind: 'code', lang: '', code: '| a | b |\n|---|---|', raw: '```\n| a | b |\n|---|---|\n```' })
  expect(segments[1]).toEqual({
    kind: 'table',
    header: ['Route', 'Limit'],
    align: ['left', 'right'],
    rows: [
      ['/chat', '60'],
      ['/up', '10'],
    ],
  })
})

test('columns narrow from the widest until the table fits, and cells pad to their side', async () => {
  const table = { kind: 'table' as const, header: ['a', 'b'], align: ['left' as const, 'right' as const], rows: [['x'.repeat(30), 'yy']] }

  expect(columnWidths(table, 20, 3)).toEqual([15, 2])
  expect(padCell('abc', 6, 'right')).toBe('   abc')
  expect(padCell('abcdefgh', 5, 'left')).toBe('abcd…')
})

test('wide characters count two cells, so CJK cells are measured and cut in terminal cells', async () => {
  expect(widthOf('레일, 스피너')).toBe(12)
  expect(widthOf('e\u0301')).toBe(1)
  expect(widthOf('中文')).toBe(4)
  expect(widthOf('カタカナ')).toBe(8)
  expect(widthOf('ok 🚀')).toBe(5)
  expect(widthOf('👍🏽')).toBe(2)
  expect(widthOf('🫠')).toBe(2)
  expect(cutCell('레일, 스피너', 12)).toBe('레일, 스피너')
  expect(cutCell('레일, 스피너', 5)).toBe('레일…')
  expect(widthOf(padCell('레일', 8, 'left'))).toBe(8)
})

test('/skin switches parts and refuses what it does not know', async () => {
  expect(runSkinCommand('rail off', DEFAULT_PREFS).prefs.rail).toBe(false)
  expect(runSkinCommand('clip on', DEFAULT_PREFS).prefs.clipOutput).toBe(true)
  expect(runSkinCommand('icons ascii', DEFAULT_PREFS).prefs.icons).toBe('ascii')
  expect(runSkinCommand('shimmer maybe', DEFAULT_PREFS).prefs).toBe(DEFAULT_PREFS)
  expect(runSkinCommand('plaid', DEFAULT_PREFS).channel).toBe('row')
})

test('stored prefs that are stale or hand-edited fall back to defaults', async () => {
  expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ icons: 'x', rail: 'yes' })).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ rail: false }).rail).toBe(false)
})

test('cells are read as colours, diffs, numbers, code or text', async () => {
  expect(kindOfCell('#7aa2f7')).toBe('colour')
  expect(kindOfCell('+18 −3')).toBe('diff')
  expect(kindOfCell('120')).toBe('number')
  expect(kindOfCell('2.1s')).toBe('number')
  expect(kindOfCell('apps/hub/server.ts')).toBe('code')
  expect(kindOfCell('Added a limiter')).toBe('text')
  expect(measure('MMMM', false)).toBeDefined()
})

test('a vector table stays within its width and escapes what it draws', async () => {
  const card = tableSvg(
    { kind: 'table', header: ['a', 'b'], align: ['left', 'right'], rows: [['<b>', 'Q'.repeat(400)]] },
    orca.palette,
    5000,
  )

  expect(card.width).toBe(1600)
  expect(tableSvg({ kind: 'table', header: ['a'], align: ['left'], rows: [['b']] }, orca.palette, 700).width).toBe(700)
  // A long cell wraps instead of being cut: every one of its 400 characters is drawn.
  expect(card.source).not.toContain('…')
  expect((card.source.match(/Q+/g) ?? []).join('').length).toBe(400)
  expect(card.source).toContain('&lt;b&gt;')
  expect(card.source).not.toContain('<b>')
  expect(card.source).toContain('prefers-reduced-motion')
})

test('a patch numbers its lines on each side and marks the gap between hunks', async () => {
  const lines = diffLines([
    { oldStart: 10, newStart: 10, lines: [' a', '-b', '+c', '+d'] },
    { oldStart: 40, newStart: 41, lines: [' e', '\\ No newline at end of file'] },
  ])

  expect(lines).toEqual([
    { kind: 'ctx', text: 'a', old: 10, new: 10 },
    { kind: 'del', text: 'b', old: 11 },
    { kind: 'add', text: 'c', new: 11 },
    { kind: 'add', text: 'd', new: 12 },
    { kind: 'gap', at: 41 },
    { kind: 'ctx', text: 'e', old: 40, new: 41 },
  ])
})

test('a new file with an empty patch shows its content as added lines', async () => {
  const diff = hunksOf({ type: 'create', filePath: '/w/a.ts', content: 'x\ny', structuredPatch: [] })

  expect(diff?.isNewFile).toBe(true)
  expect(diff?.hunks[0]?.lines).toEqual(['+x', '+y'])
  expect(hunksOf({ stdout: '' })).toBeNull()

  const card = diffSvg(diff!, 'a.ts', orca.palette, 600)

  expect(card.source).toContain('new file')
  expect(card.alt).toBe('a.ts: +2 −0')
})

test('shell output loses its colour codes, keeps stderr apart and folds the middle', async () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const shell = shellOutputOf({ stdout: `\u001b[32mok\u001b[0m\n${long}\n\n`, stderr: 'warn: x', interrupted: false })
  const lines = outputLines(shell!)

  expect(lines[0]).toEqual({ text: 'ok', isErr: false })
  expect(lines[6]).toEqual({ fold: 30 })
  expect(lines.at(-1)).toEqual({ text: 'warn: x', isErr: true })
  expect(terminalSvg(shell!, true, orca.palette, 600).source).toContain('failed')
  expect(shellOutputOf({ content: 'x' })).toBeNull()
})

test('code is split into comments, strings, numbers and keywords by language', async () => {
  expect(tokenize('const x = "hi" // note', 'ts').map(token => token.role)).toEqual([
    'keyword', 'plain', 'plain', 'plain', 'string', 'plain', 'comment',
  ])
  expect(tokenize('x = 1  # note', 'python').at(-1)).toEqual({ text: '# note', role: 'comment' })
  expect(codeSvg('a\nb', 'ts', orca.palette, 600).source).toContain('TS')
})

test('a long cell wraps on its words, breaks a word too long for the column, and caps its lines', async () => {
  expect(wrapCell('the quick brown fox jumps', 90, false)).toEqual(['the quick', 'brown fox', 'jumps'])
  expect(wrapCell('x'.repeat(30), 60, true).every(line => measure(line, true) <= 60)).toBe(true)
  expect(wrapCell('word '.repeat(80), 60, false, 2).at(-1)).toMatch(/…$/)
})

test('short columns keep their width and long ones share the rest', async () => {
  const [hash, why, who] = fitColumns([20, 900, 60], 700)

  expect(hash).toBe(20)
  expect(who).toBe(60)
  expect(Math.round((why ?? 0) + 20 + 60 + 2 * 28 + 2 * 24)).toBe(700)
})

test('a light palette is derived with dark text, light bands and deepened colours', async () => {
  const light = toLight(orca.palette)

  expect(light.fg).toBe('#1f1f1f')
  expect(light.surface).toBe('#ffffff')
  expect(light.run).toBe(deepen(orca.palette.run, 0.45))
  expect(deepen('#ffffff', 0.5)).toBe('#808080')
  expect(isLightTheme('light-daltonized')).toBe(true)
  expect(isLightTheme('dark')).toBe(false)
})
