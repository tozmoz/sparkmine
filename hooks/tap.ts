// The clickable layer over the scene. A click anywhere on the mine mines, and
// what it earned pops up where you clicked and floats away. What Claude's tool
// calls earn floats up from the rock face the same way. The scene itself is an
// SVG that animates on its own; this Client lies over it, at the scene's size,
// and draws nothing but the floating numbers and, under the pointer, a hint.

import type { ClientModule } from 'claude-code'

import type { TapProps } from '../types'

type Pop = { id: string; x: number; y: number; age: number; text: string; color: string }
type State = { instance: string; total: number; pops: Pop[]; next: number; isHover: boolean; seenFeed: number; pointer: number }

const FRAME_MS = 60
const POLL_MS = 300
const POP_FRAMES = 14
const POP_BRIGHT = 6
/** Frames a pop takes to rise one row. */
const RISE_EVERY = 4
const MAX_POPS = 6
const CLICK_COLOR = '#ffe08a'
const FEED_COLOR = '#9fe1cb'

/** What a click mines now, kept fresh for the pointer handler set once at mount. */
let click = 1

function short(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (n < 100_000) return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const tier = Math.floor(Math.log10(n) / 3)
  const suffix = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'][tier]
  return suffix === undefined ? n.toExponential(2) : `${(n / 10 ** (tier * 3)).toFixed(1)}${suffix}`
}

const newest = (feed: TapProps['feed']) => feed.reduce((high, item) => Math.max(high, item.id), 0)

const Tap: ClientModule<TapProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  click = props.click

  let s = surface.state
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, total: 0, pops: [], next: 0, isHover: false, seenFeed: newest(props.feed), pointer: 0 }
    surface.setState(s)
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || now.pops.length === 0) return
      surface.setState({ ...now, pops: now.pops.map(pop => ({ ...pop, age: pop.age + 1 })).filter(pop => pop.age < POP_FRAMES) })
    })
    // Asks for the feed, and says how big the layer was laid out.
    surface.every(POLL_MS, () => {
      const now = surface.state
      surface.post({ instance, total: now?.total ?? 0, columns: surface.columns, rows: surface.rows, pointer: now?.pointer ?? 0 })
    })
    surface.onPointer(event => {
      const now = surface.state
      if (now === undefined) return
      const pointer = now.pointer + 1
      if (event.type === 'enter' || event.type === 'leave') {
        surface.setState({ ...now, pointer, isHover: event.type === 'enter' })
        return
      }
      if (event.type !== 'down' || (event.button !== undefined && event.button !== 'left')) {
        if (event.type === 'down') surface.setState({ ...now, pointer })
        return
      }
      const total = now.total + 1
      const pop = { id: `c${now.next}`, x: event.x, y: event.y, age: 0, text: `+${short(click)}`, color: CLICK_COLOR }
      surface.setState({ ...now, total, pointer, isHover: true, pops: [...now.pops, pop].slice(-MAX_POPS), next: now.next + 1 })
      surface.post({ instance: now.instance, total, columns: surface.columns, rows: surface.rows, pointer })
    })
    surface.post({ instance, total: 0, columns: surface.columns, rows: surface.rows, pointer: 0 })
  } else {
    // Earnings this layer has not shown yet float up from the rock face.
    const fresh = props.feed.filter(item => item.id > (s?.seenFeed ?? 0))
    if (fresh.length > 0) {
      const faceX = Math.max(0, Math.round(surface.columns * 0.7))
      const faceY = Math.max(0, Math.round(Math.max(surface.rows, props.rows) * 0.5))
      const pops = fresh.map((item, i) => ({
        id: `f${item.id}`,
        x: Math.max(0, faceX - (item.id % 3) * 2),
        y: Math.max(0, faceY - i),
        age: 0,
        text: item.text,
        color: FEED_COLOR,
      }))
      s = { ...s, pops: [...s.pops, ...pops].slice(-MAX_POPS), seenFeed: newest(props.feed) }
      surface.setState(s)
    }
  }

  const children = s.pops.map(pop =>
    Box({
      position: 'absolute',
      top: Math.max(0, pop.y - Math.floor(pop.age / RISE_EVERY)),
      left: Math.max(0, pop.x - 1),
      children: [Text({ color: pop.color, bold: pop.age < POP_BRIGHT, dimColor: pop.age >= POP_BRIGHT, children: [pop.text] })],
    }),
  )
  if (s.isHover && s.pops.length === 0 && props.mode === 'work') {
    children.push(Box({ position: 'absolute', bottom: 0, left: 1, children: [Text({ color: CLICK_COLOR, children: ['⛏ click to mine'] })] }))
  }
  // As tall as the scene: the desktop lays a Client out at the size of what it draws.
  return Box({ width: '100%', height: Math.max(1, props.rows), children })
}

export default Tap
