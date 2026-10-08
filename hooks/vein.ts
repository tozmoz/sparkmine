// The vein: now and then, while Claude works, a gold vein shows beside the Shop
// sign for a few seconds, and a press catches it. A Client of its own, so it
// shows and goes without the band being redrawn, and the whole region is the
// vein: the pointer going down anywhere on it catches it. While a frenzy runs
// it says how long is left.

import type { ClientModule } from 'claude-code'

import type { VeinProps } from '../types'

type State = { pulse: number; caught: number; isShowing: boolean }

const POLL_MS = 250
const PULSE_MS = 300

const ORE = { face: '#3a2410', lit: '#5e3b1d', edge: '#f2b632', ink: '#ffe08a' }
const FRENZY = '#ffd36e'

const Vein: ClientModule<VeinProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const vein = props.vein ?? null
  const frenzy = props.frenzy ?? null

  let s = surface.state
  if (s === undefined) {
    s = { pulse: 0, caught: 0, isShowing: false }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ poll: true }))
    // The vein glints while it shows; nothing runs while it does not.
    surface.every(PULSE_MS, () => {
      const now = surface.state
      if (now !== undefined && now.isShowing) surface.setState({ ...now, pulse: now.pulse + 1 })
    })
    surface.post({ poll: true })
  }
  const isShowing = vein !== null && vein.id !== s.caught
  if (isShowing !== s.isShowing) {
    s = { ...s, isShowing }
    surface.setState(s)
  }

  surface.onPointer(event => {
    if (event.type !== 'down' || (event.button !== undefined && event.button !== 'left')) return
    const now = surface.state ?? s
    if (vein === null || vein.id === now.caught) return
    surface.setState({ ...now, caught: vein.id, isShowing: false })
    surface.post({ catch: vein.id })
  })

  if (vein !== null && isShowing) {
    const isLit = s.pulse % 2 === 1
    return Box({
      key: 'vein',
      ...(props.surface === 'terminal' ? {} : { borderStyle: 'round', borderColor: ORE.edge }),
      backgroundColor: isLit ? ORE.lit : ORE.face,
      paddingX: 1,
      children: [Text({ bold: true, color: ORE.ink, children: [`✦ Vein! ${vein.left}s`] })],
    })
  }
  if (frenzy !== null) return Text({ bold: true, color: FRENZY, children: [`Frenzy ×${frenzy.mult} · ${frenzy.left}s`] })
  return Box({ key: 'vein' })
}

export default Vein
