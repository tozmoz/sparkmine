// The live numbers in the band and the shop, and the band's Mine button. A
// Client draws them, so they change without the band being redrawn and the
// scene never flickers.
//
// The Mine button lives here so a press answers at once: the HUD counts it,
// adds it to the counter and pops what it mined before the hooks have heard of
// it. Each post carries the running total of presses, so the hooks count every
// one even when a frame's posts merge into one, and the props they answer say
// how many they have counted.
//
// A press reaches the HUD two ways: the pointer going down over its region,
// at once and whatever was redrawn since, and the button's own press after.
// The pointer counts it; the button's press it already counted is let go.
//
// Its height is fixed and its width follows its text, which changes only when
// new numbers arrive: a surface unmounts a Client whose size changes frame
// after frame on its own. The pop sits in a slot of its own fixed width.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { HudProps } from '../types'

/** What a run of presses has mined, shown beside the counter until it fades. */
type Pop = { value: number; age: number; isGem: boolean }
type State = {
  instance: string
  /** Presses counted, in all: what each post reports. */
  total: number
  /** When the last second's presses came, to keep under MAX_PER_SECOND. */
  recent: number[]
  /** Pointer presses whose button press has not come yet. */
  unmatched: number[]
  gemSeq: number
  pop: Pop | null
}

const POLL_MS = 100
const FRAME_MS = 60
/** Frames a pop stays up, and stays bright before it dims. A gem stays longer. */
const POP_FRAMES = 10
const POP_BRIGHT = 4
const GEM_FRAMES = 20
const GEM_BRIGHT = 12
/** Cells the pop's slot takes, whether or not a pop is up. */
const POP_WIDTH = 10
/** The hooks count no more presses than this a second, so the HUD shows no more. */
const MAX_PER_SECOND = 20
/** How long after the pointer's press the button's own press can still come. */
const MATCH_MS = 1_000
const GEM_COLOR = '#5dcaa5'
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

const Hud: ClientModule<HudProps, State> = (props, surface) => {
  const { Box, Button, Text } = surface.elements
  const gem = props.gem ?? null
  const acked = props.acked ?? 0

  // A HUD an older version drew keeps other state: this one starts afresh.
  let s = surface.state !== undefined && Array.isArray(surface.state.unmatched) ? surface.state : undefined
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, total: 0, recent: [], unmatched: [], gemSeq: gem?.seq ?? 0, pop: null }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ instance, total: surface.state?.total ?? 0 }))
    // Ages the pop; does nothing at all while there is none.
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || now.pop === null) return
      const age = now.pop.age + 1
      const life = now.pop.isGem ? GEM_FRAMES : POP_FRAMES
      surface.setState({ ...now, pop: age >= life ? null : { ...now.pop, age } })
    })
    surface.post({ instance, total: 0 })
  } else if (gem !== null && gem.seq > s.gemSeq) {
    // The hooks struck a gem among the presses they counted: the pop takes its worth.
    const pop = props.variant === 'band' ? { value: (s.pop?.value ?? 0) + gem.bonus, age: 0, isGem: true } : s.pop
    s = { ...s, gemSeq: gem.seq, pop }
    surface.setState(s)
  }

  const isWorking = props.variant === 'band' && props.mode === 'work'
  const press = (source: 'pointer' | 'button') => {
    const now = surface.state ?? s
    const at = Date.now()
    let unmatched = now.unmatched.filter(t => at - t < MATCH_MS)
    if (source === 'button' && unmatched.length > 0) {
      surface.setState({ ...now, unmatched: unmatched.slice(1) })
      return
    }
    if (source === 'pointer') unmatched = [...unmatched, at]
    const recent = now.recent.filter(t => at - t < 1000)
    if (!isWorking || recent.length >= MAX_PER_SECOND) {
      if (source === 'pointer') surface.setState({ ...now, unmatched })
      return
    }
    const total = now.total + 1
    const keep = now.pop !== null && now.pop.age < (now.pop.isGem ? GEM_FRAMES : POP_FRAMES)
    const pop = { value: (keep ? (now.pop?.value ?? 0) : 0) + props.click, age: 0, isGem: keep && now.pop?.isGem === true }
    surface.setState({ ...now, total, recent: [...recent, at], unmatched, pop })
    surface.post({ instance: now.instance, total })
  }
  // Set on every draw, so it presses with the latest numbers.
  if (props.variant === 'band') {
    surface.onPointer(event => {
      if (event.type === 'down' && (event.button === undefined || event.button === 'left')) press('pointer')
    })
  }

  // Presses the hooks have not counted yet are already on the counter.
  const waiting = Math.max(0, s.total - acked)
  const counter = `✻ ${short(props.sparks + waiting * props.click)}`

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
  const pop = s.pop
  const isBright = pop !== null && pop.age < (pop.isGem ? GEM_BRIGHT : POP_BRIGHT)
  const popText =
    pop === null
      ? []
      : [
          Text({
            color: pop.isGem ? GEM_COLOR : 'claude',
            bold: isBright,
            dimColor: !isBright,
            wrap: 'truncate-end',
            children: [`${pop.isGem ? '◆ ' : ''}+${short(pop.value)}`],
          }),
        ]
  const slot = Box({ key: 'pop', width: POP_WIDTH, flexShrink: 0, children: popText as never[] })
  const mine = Button({
    key: 'mine',
    label: props.surface === 'terminal' ? 'Mine' : '⛏ Mine',
    ...(props.surface === 'terminal' ? { hotkey: 'm' } : {}),
    ...(isWorking ? {} : { dimColor: true }),
    onPress: () => press('button'),
  })
  return Box({
    height: props.height,
    flexDirection: 'row',
    columnGap: 2,
    alignItems: 'center',
    children: [mine, box([line([count, dim(`${perSecond(props.rate)}/s`), slot]), second, third])],
  })
}

export default Hud
