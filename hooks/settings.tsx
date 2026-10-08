import type { ElementTable } from 'claude-code'

import type { ToggleWord } from './command'
import type { Look } from './rows'

export type PaneUi = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button'>

export type SettingsActions = {
  toggle: (word: ToggleWord) => void
  icons: () => void
}

export function settingsPane(look: Look, ui: PaneUi, actions: SettingsActions) {
  const { Box, Text, Button } = ui
  const { palette } = look.skin
  const { prefs } = look
  const toggle = (word: ToggleWord, hotkey: string, on: boolean) => (
    <Button
      key={`toggle-${word}`}
      label={`${word} ${on ? '●' : '○'}`}
      hotkey={hotkey}
      plain
      dimColor={!on}
      onPress={() => actions.toggle(word)}
    />
  )

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color={palette.muted}>Look</Text>
      {toggle('rail', 'r', prefs.rail)}
      {toggle('tables', 't', prefs.tables)}
      {toggle('shimmer', 's', prefs.shimmer)}
      {toggle('clip', 'c', prefs.clipOutput)}
      <Button key="icons" label={`icons ${prefs.icons}`} hotkey="i" plain onPress={() => actions.icons()} />
    </Box>
  )
}
