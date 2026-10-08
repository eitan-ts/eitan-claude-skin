// Every colour a skin names. `fg` is body text, `muted` secondary text, `surface` the
// band behind a table header, `zebra` every other table row.
export type SkinSlot =
  | 'read'
  | 'write'
  | 'run'
  | 'search'
  | 'web'
  | 'mcp'
  | 'other'
  | 'user'
  | 'fg'
  | 'muted'
  | 'surface'
  | 'zebra'
  | 'ok'
  | 'err'
  | 'warn'

// What /skin and the settings pane change.
export type Prefs = {
  icons: 'unicode' | 'ascii'
  rail: boolean
  tables: boolean
  shimmer: boolean
  clipOutput: boolean
}

// What one turn did, shown in its footer.
export type TurnStats = { tools: number; added: number; removed: number }

declare module 'claude-code' {
  interface PluginState {
    'eitan-skin': {
      prefs: Prefs
      startedAt: number
      frame: number
      turns: Record<string, TurnStats>
      duration: StateFamily<number>
      isLight: boolean
    }
  }
}
