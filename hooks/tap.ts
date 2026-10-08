// The clickable layer over the scene: a tap anywhere on the mine mines, and
// what it earned pops up where you tapped and floats away. The scene itself is
// an SVG that animates on its own; this Client lies over it and draws nothing
// but the pops and, while the pointer is over the mine, a hint.

import type { ClientModule } from 'claude-code'

import type { TapProps } from '../types'

type Pop = { id: number; x: number; y: number; age: number; text: string }
type State = { instance: string; total: number; pops: Pop[]; next: number; isHover: boolean }

const FRAME_MS = 50
const POP_FRAMES = 14
const POP_BRIGHT = 6
/** Frames a pop takes to rise one row. */
const RISE_EVERY = 4

/** What a click mines now, kept fresh for the pointer handler set once at mount. */
let click = 1

function short(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (n < 100_000) return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const tier = Math.floor(Math.log10(n) / 3)
  const suffix = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'][tier]
  return suffix === undefined ? n.toExponential(2) : `${(n / 10 ** (tier * 3)).toFixed(1)}${suffix}`
}

const Tap: ClientModule<TapProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  click = props.click

  let s = surface.state
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, total: 0, pops: [], next: 0, isHover: false }
    surface.setState(s)
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || now.pops.length === 0) return
      surface.setState({ ...now, pops: now.pops.map(pop => ({ ...pop, age: pop.age + 1 })).filter(pop => pop.age < POP_FRAMES) })
    })
    surface.onPointer(event => {
      const now = surface.state
      if (now === undefined) return
      if (event.type === 'enter' || event.type === 'leave') {
        const isHover = event.type === 'enter'
        if (now.isHover !== isHover) surface.setState({ ...now, isHover })
        return
      }
      if (event.type !== 'down' || (event.button !== undefined && event.button !== 'left')) return
      const total = now.total + 1
      const pop = { id: now.next, x: event.x, y: event.y, age: 0, text: `+${short(click)}` }
      surface.setState({ ...now, total, isHover: true, pops: [...now.pops, pop].slice(-5), next: now.next + 1 })
      surface.post({ instance: now.instance, total })
    })
    // Ask once for what a click is worth now: the props the band was drawn with may be older.
    surface.post({ instance, total: 0 })
  }

  const children = s.pops.map(pop =>
    Box({
      position: 'absolute',
      top: Math.max(0, pop.y - Math.floor(pop.age / RISE_EVERY)),
      left: Math.max(0, pop.x - 1),
      children: [Text({ color: 'claude', bold: pop.age < POP_BRIGHT, dimColor: pop.age >= POP_BRIGHT, children: [pop.text] })],
    }),
  )
  if (s.isHover && s.pops.length === 0 && props.mode === 'work') {
    children.push(Box({ position: 'absolute', bottom: 0, left: 1, children: [Text({ color: 'claude', children: ['⛏ click to mine'] })] }))
  }
  return Box({ width: '100%', height: '100%', children })
}

export default Tap
