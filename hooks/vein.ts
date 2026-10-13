// The vein: now and then, while Claude works, a gold vein shows beside the Shop
// sign for a few seconds, and a press catches it. A Client of its own, so it
// shows and goes without the band being redrawn, and the whole region is the
// vein: the pointer going down anywhere on it catches it. While a frenzy runs
// it says how long is left.
//
// The band's tree holds no vein; the answers to its polls do. A surface may
// hand that tree in again (the desktop does, each time something else on
// screen changes), so the vein keeps the newest answer it has had, and the
// tree never hides a vein that shows.

import type { ClientModule } from 'claude-code'

import type { VeinProps } from '../types'

type State = { pulse: number; caught: number; isShowing: boolean; latest?: VeinProps }

const POLL_MS = 250
const PULSE_MS = 300

const ORE = { face: '#3a2410', lit: '#5e3b1d', edge: '#f2b632', ink: '#ffe08a' }
/** The theme's gold, so a light theme darkens it. */
const FRENZY = 'warning'

const Vein: ClientModule<VeinProps, State> = (handed, surface) => {
  const { Box, Text } = surface.elements

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
  // The newest answer it has had: the band's tree, handed in again, holds none.
  const kept = s.latest
  const isNewer = kept === undefined || (handed.isAnswer === true && JSON.stringify(handed) !== JSON.stringify(kept))
  const props = isNewer || kept === undefined ? handed : kept
  const vein = props.vein ?? null
  const frenzy = props.frenzy ?? null
  let next = isNewer ? { ...s, latest: handed } : s
  const isShowing = vein !== null && vein.id !== next.caught
  if (isShowing !== next.isShowing) next = { ...next, isShowing }
  if (next !== s) {
    s = next
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
      children: [Text({ bold: true, color: ORE.ink, children: [`✦ ${vein.label ?? 'Vein!'} ${vein.left}s`] })],
    })
  }
  if (frenzy !== null) return Text({ bold: true, color: FRENZY, children: [`Frenzy ×${frenzy.mult} · ${frenzy.left}s`] })
  return Box({ key: 'vein' })
}

export default Vein
