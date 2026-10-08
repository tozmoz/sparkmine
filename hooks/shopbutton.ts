// The band's Shop button on the desktop: a wooden sign. A desktop draws every
// Button as its own native one, so the sign is a Client the mod draws itself,
// and the whole region is the sign: a pointer going down anywhere on it is a
// press. The hooks hear it as a post and open the shop.

import type { ClientModule } from 'claude-code'

type State = { pressed: number }

const FRAME_MS = 60
/** Frames the sign stays pressed in after a press. */
const PRESS_FRAMES = 2

const WOOD = '#4b2f1c'
const WOOD_LIT = '#5e3b22'
const WOOD_PRESSED = '#3a2410'
const GRAIN = '#8a5a2b'
const GRAIN_LIT = '#a8703a'
const CREAM = '#f2d39a'

const ShopButton: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box, Text } = surface.elements
  let s = surface.state
  if (s === undefined) {
    s = { pressed: 0 }
    surface.setState(s)
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now !== undefined && now.pressed > 0) surface.setState({ pressed: now.pressed - 1 })
    })
  }
  surface.onPointer(event => {
    if (event.type !== 'down' || (event.button !== undefined && event.button !== 'left')) return
    surface.setState({ pressed: PRESS_FRAMES })
    surface.post({ open: true })
  })
  return Box({
    key: 'shop',
    borderStyle: 'round',
    borderColor: GRAIN,
    backgroundColor: s.pressed > 0 ? WOOD_PRESSED : WOOD,
    hover: { backgroundColor: WOOD_LIT, borderColor: GRAIN_LIT },
    paddingX: 1,
    children: [Text({ bold: true, color: CREAM, children: ['✻ Shop'] })],
  })
}

export default ShopButton
