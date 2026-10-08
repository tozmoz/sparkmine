// The live numbers in the band and the shop. A Client draws them, so they
// change without the band being redrawn and the scene never flickers.
//
// Its height is fixed and its width follows its text, which changes only when
// new numbers arrive: a surface unmounts a Client whose size changes frame
// after frame on its own. What moves inside, the sparks a click throws and
// the "+4" beside the counter, is placed absolutely and never changes the size.
//
// It asks the hooks module for fresh numbers a few times a second. When the
// click count it is handed grows, the counter throws a few small sparks.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { HudProps } from '../types'

type Pop = { text: string; age: number }
type Spark = { x: number; y: number; dx: number; dy: number; age: number; glyph: string; color: string }
type State = { instance: string; seen: number; pop: Pop | null; sparks: Spark[]; burst: number }

const POLL_MS = 150
const FRAME_MS = 60
/** Frames a "+4" stays up: bright at first, then dim. */
const POP_FRAMES = 10
const POP_BRIGHT = 4
/** Frames a spark lives, and how many a click throws. */
const SPARK_FRAMES = 7
const SPARKS_PER_CLICK = 5
const MAX_SPARKS = 15
const GLYPHS = ['✦', '·', '⋆', '•', '✧'] as const
const COLORS = ['#ffe08a', '#f2b632', '#fff4b8'] as const
/** Directions, in cells per frame, for one burst: out to the sides and up. */
const PATHS = [
  [1, -0.5],
  [-1, -0.4],
  [1.5, 0.2],
  [-0.6, -0.7],
  [0.6, 0.5],
] as const
const BAR = 10

function commas(n: number): string {
  const whole = Math.floor(Math.abs(n)).toString()
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

function short(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (Math.abs(n) < 100_000) return commas(n)
  let tier = Math.floor(Math.log10(Math.abs(n)) / 3)
  let scaled = n / 10 ** (tier * 3)
  let digits = scaled >= 100 ? 1 : 2
  if (Number(scaled.toFixed(digits)) >= 1000) {
    tier += 1
    scaled /= 1000
    digits = 2
  }
  const suffix = SUFFIXES[tier]
  return suffix === undefined ? n.toExponential(2) : `${scaled.toFixed(digits)}${suffix}`
}

function perSecond(n: number): string {
  const tenths = Math.round(n * 10) / 10
  return tenths < 10 ? tenths.toFixed(1) : short(Math.round(n))
}

function bar(have: number, need: number): string {
  const filled = need <= 0 ? BAR : Math.max(0, Math.min(BAR, Math.floor((have / need) * BAR)))
  return '▰'.repeat(filled) + '▱'.repeat(BAR - filled)
}

/** A burst of sparks from the end of the counter. */
function burst(originX: number, burstNo: number): Spark[] {
  return PATHS.slice(0, SPARKS_PER_CLICK).map(([dx, dy], i) => ({
    x: originX,
    y: 0,
    dx,
    dy,
    age: 0,
    glyph: GLYPHS[(i + burstNo) % GLYPHS.length] ?? '·',
    color: COLORS[(i + burstNo) % COLORS.length] ?? '#ffe08a',
  }))
}

const Hud: ClientModule<HudProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const counter = `✻ ${short(props.sparks)}`

  let s = surface.state
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, seen: props.clicks, pop: null, sparks: [], burst: 0 }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ instance, total: 0 }))
    // Moves the sparks and ages the pop; does nothing at all while there are none.
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || (now.pop === null && now.sparks.length === 0)) return
      const age = (now.pop?.age ?? 0) + 1
      surface.setState({
        ...now,
        pop: now.pop === null || age >= POP_FRAMES ? null : { ...now.pop, age },
        sparks: now.sparks.map(spark => ({ ...spark, age: spark.age + 1 })).filter(spark => spark.age < SPARK_FRAMES),
      })
    })
    surface.post({ instance, total: 0 })
  } else if (props.clicks !== s.seen) {
    // Clicks landed: pop what they earned and throw a few sparks.
    const clicks = Math.max(0, props.clicks - s.seen)
    const isBand = props.variant === 'band' && props.mode === 'work'
    s =
      clicks > 0 && isBand
        ? {
            ...s,
            seen: props.clicks,
            pop: { text: `+${short(clicks * props.click)}`, age: 0 },
            sparks: [...s.sparks, ...burst(counter.length + 1, s.burst)].slice(-MAX_SPARKS),
            burst: s.burst + 1,
          }
        : { ...s, seen: props.clicks }
    surface.setState(s)
  }

  const box = (children: unknown[]) => Box({ height: props.height, flexDirection: 'column', children: children as never[] })
  const line = (children: unknown[]) => Box({ flexDirection: 'row', columnGap: 1, children: children as never[] })
  const dim = (text: string) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })
  const count = Text({ color: 'claude', bold: true, children: [counter] })
  const goal = props.goal === null ? null : `Next: ${props.goal.name}`

  if (props.variant === 'shop') {
    const idle = props.idle > 0 ? ` · ${Math.round(props.idle * 100)}% while idle` : ''
    const rows: unknown[] = [line([count]), dim(`${perSecond(props.rate)}/s while Claude works${idle}`)]
    if (props.goal !== null) {
      rows.push(line([dim(goal ?? ''), Text({ color: 'claude', children: [`${bar(props.goal.have, props.goal.need)} ${commas(props.goal.have)}/${commas(props.goal.need)}`] })]))
    }
    rows.push(dim(`Clicks ${commas(props.clicks)} · Tool calls ${commas(props.tools)} · Turns ${commas(props.turns)}`))
    return box(rows)
  }

  if (props.mode === 'idle') {
    const notes = [props.lastTurn > 0 ? `last turn +${short(props.lastTurn)}` : 'mines while Claude works']
    if (props.idle > 0) notes.push(`crew at ${Math.round(props.idle * 100)}%`)
    return box([line([count, dim(`· ${notes.join(' · ')}`)])])
  }

  const second =
    props.mode === 'pause'
      ? Text({ color: 'warning', wrap: 'truncate-end', children: ['Claude is waiting for you'] })
      : dim(props.last ?? `this turn +${short(props.turn)}`)
  const third =
    props.goal === null
      ? Text({ children: [' '] })
      : line([dim(goal ?? ''), Text({ color: 'claude', children: [bar(props.goal.have, props.goal.need)] })])
  const moving: unknown[] = s.sparks.map(spark =>
    Box({
      position: 'absolute',
      left: Math.max(0, Math.min(props.width - 1, Math.round(spark.x + spark.dx * spark.age))),
      top: Math.max(0, Math.min(props.height - 1, Math.round(spark.y + spark.dy * spark.age))),
      children: [Text({ color: spark.color, bold: spark.age < 3, dimColor: spark.age >= 5, children: [spark.glyph] })],
    }),
  )
  if (s.pop !== null) {
    moving.push(
      Box({
        position: 'absolute',
        top: 0,
        left: Math.min(props.width - 4, counter.length + perSecond(props.rate).length + 4),
        children: [Text({ color: 'claude', bold: s.pop.age < POP_BRIGHT, dimColor: s.pop.age >= POP_BRIGHT, children: [s.pop.text] })],
      }),
    )
  }
  return box([line([count, dim(`${perSecond(props.rate)}/s`)]), second, third, ...moving])
}

export default Hud
