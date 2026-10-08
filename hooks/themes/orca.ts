import type { Skin } from '../skin'

// From Orca's terminal theme "Modern Dark Pro - Night Glass".
const skin: Skin = {
  name: 'orca',
  label: 'Orca',
  palette: {
    read: '#4dd0e1',
    write: '#64b5f6',
    run: '#81c784',
    search: '#ba68c8',
    web: '#ffb74d',
    mcp: '#90caf9',
    other: '#e0e0e0',
    user: '#64b5f6',
    fg: '#e0e0e0',
    muted: '#666666',
    surface: '#1f1f1f',
    zebra: '#171717',
    ok: '#81c784',
    err: '#e57373',
    warn: '#ffb74d',
  },
  spinner: ['Diving', 'Echolocating', 'Gliding', 'Breaching', 'Hunting', 'Surfacing'],
  done: ['Surfaced', 'Breached', 'Caught', 'Landed'],
}

export default skin
