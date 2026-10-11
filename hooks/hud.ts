// The live numbers in the band and the shop, and on the desktop the band's
// Mine button. A Client draws them, so they change without the band being
// redrawn and the scene never flickers.
//
// On the desktop the button is a gold sign the HUD draws itself, since a
// desktop draws every Button as its own native one, and it lives here so a
// press answers at once: the HUD counts it, adds it to the counter and pops
// what it mined before the hooks have heard of it. A press reaches the HUD the
// moment the pointer goes down over its region, whatever was redrawn since.
// Each post carries the running total of presses, so the hooks count every one
// even when a frame's posts merge into one, and the props they answer say how
// many they have counted.
//
// On the terminal Mine is the band's own Button: a Client's Buttons take no
// hotkey there, and its `m` is how a terminal mines fast. The hooks count its
// presses and say how many, and the HUD pops what they mined.
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
  /** The band's own Mine presses the hooks had counted when the HUD last drew. */
  taps: number
  gemSeq: number
  pop: Pop | null
  /** Frames the gold sign stays pressed in after a press. */
  pressed: number
  /** The counter's thousands (K, M, B ...), and frames of gold left since it passed into new ones. */
  tier?: number
  shimmer?: number
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
// The text's colors are the theme's own, so they read on a light theme as on a dark one.
/** A gem pops in green. */
const GEM_COLOR = 'success'
/** A reward or a frenzy reads in gold. */
const REWARD_COLOR = 'warning'
const BAR = 10
const PRESS_FRAMES = 2
/** Frames the counter shines when it passes 1K, 1M, 1B and on, between gold and the text's own color. */
const SHIMMER_FRAMES = 10
const SHIMMER = ['warning', 'text'] as const

/** Which thousands a count is in: 0 under a thousand, 1 for K, 2 for M, 3 for B. */
const tierOf = (n: number): number => (n >= 1000 ? Math.floor(Math.log10(n) / 3) : 0)

/** The desktop's Mine sign: gold ore while Claude works, dull while it waits. */
const GOLD = { face: '#f2b632', lit: '#ffcd52', pressed: '#d9951f', edge: '#a8691a', ink: '#3a2410' }
const DULL = { face: '#5c4d2e', edge: '#463a22', ink: '#a8987a' }
/** The topsoil's color, for props from before the HUD knew the layer. */
const TOPSOIL = '#b8804f'

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
  const { Box, Text } = surface.elements
  const gem = props.gem ?? null
  const acked = props.acked ?? 0

  const taps = props.taps ?? 0

  // A HUD an older version drew keeps other state: this one starts afresh.
  const old = surface.state
  let s = old !== undefined && typeof old.taps === 'number' && typeof old.pressed === 'number' ? old : undefined
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, total: 0, recent: [], taps, gemSeq: gem?.seq ?? 0, pop: null, pressed: 0, tier: tierOf(props.sparks), shimmer: 0 }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ instance, total: surface.state?.total ?? 0 }))
    // Ages the pop, lets the sign back up and dims the shine; does nothing at all while none is showing.
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || (now.pop === null && now.pressed === 0 && (now.shimmer ?? 0) === 0)) return
      let pop = now.pop
      if (pop !== null) {
        const age = pop.age + 1
        pop = age >= (pop.isGem ? GEM_FRAMES : POP_FRAMES) ? null : { ...pop, age }
      }
      surface.setState({ ...now, pop, pressed: Math.max(0, now.pressed - 1), shimmer: Math.max(0, (now.shimmer ?? 0) - 1) })
    })
    surface.post({ instance, total: 0 })
  } else {
    const isGem = gem !== null && gem.seq > s.gemSeq
    if (isGem || taps !== s.taps) {
      // Presses of the band's own Mine button, and gems among the presses the
      // hooks counted: the pop takes what they mined. Fewer taps than before is
      // the hooks starting over (an update), and pops nothing.
      const mined = Math.max(0, taps - s.taps) * props.click + (isGem ? gem.bonus : 0)
      const pop = props.variant === 'band' && mined > 0 ? { value: (s.pop?.value ?? 0) + mined, age: 0, isGem: isGem || s.pop?.isGem === true } : s.pop
      s = { ...s, taps, gemSeq: isGem ? gem.seq : s.gemSeq, pop }
      surface.setState(s)
    }
    // Passing into new thousands, the counter shines a moment; a new shaft's fall says nothing.
    const tier = tierOf(props.sparks)
    if (tier !== (s.tier ?? tier)) {
      s = { ...s, tier, shimmer: tier > (s.tier ?? tier) ? SHIMMER_FRAMES : (s.shimmer ?? 0) }
      surface.setState(s)
    } else if (s.tier === undefined) {
      s = { ...s, tier }
      surface.setState(s)
    }
  }

  const isWorking = props.variant === 'band' && props.mode === 'work'
  /** A press of the desktop's gold sign: counted here at once, and posted to the hooks. */
  const press = () => {
    const now = surface.state ?? s
    const at = Date.now()
    const recent = now.recent.filter(t => at - t < 1000)
    if (!isWorking || recent.length >= MAX_PER_SECOND) return
    const total = now.total + 1
    const keep = now.pop !== null && now.pop.age < (now.pop.isGem ? GEM_FRAMES : POP_FRAMES)
    const pop = { value: (keep ? (now.pop?.value ?? 0) : 0) + props.click, age: 0, isGem: keep && now.pop?.isGem === true }
    surface.setState({ ...now, total, recent: [...recent, at], pop, pressed: PRESS_FRAMES })
    surface.post({ instance: now.instance, total })
  }
  // Set on every draw, so it presses with the latest numbers. On the terminal the band's Button mines.
  if (props.variant === 'band' && props.surface !== 'terminal') {
    surface.onPointer(event => {
      if (event.type === 'down' && (event.button === undefined || event.button === 'left')) press()
    })
  }

  // Presses the hooks have not counted yet are already on the counter.
  const waiting = Math.max(0, s.total - acked)
  const counter = `✻ ${short(props.sparks + waiting * props.click)}`

  const box = (children: unknown[]) => Box({ height: props.height, flexDirection: 'column', children: children as never[] })
  const line = (children: unknown[]) => Box({ flexDirection: 'row', columnGap: 1, children: children as never[] })
  const dim = (text: string) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })
  const shine = s.shimmer ?? 0
  const count = Text({ color: shine > 0 ? SHIMMER[shine % 2] : 'claude', bold: true, children: [counter] })
  const goal = props.goal === null ? null : `Next: ${props.goal.name}`

  // How deep the mine is, in the color of its layer; a reward for a moment; a frenzy on the rate.
  const deep = Text({ color: props.layer?.color ?? TOPSOIL, children: [`${commas(props.depth ?? 0)} m`] })
  const event = props.event ?? null
  const reward = event === null ? null : Text({ color: REWARD_COLOR, bold: true, wrap: 'truncate-end', children: [`★ ${event.label} +${short(event.value)} ✻`] })
  const frenzy = props.frenzy ?? null
  const rate =
    frenzy === null
      ? dim(`${perSecond(props.rate)}/s`)
      : Text({ color: REWARD_COLOR, bold: true, children: [`${perSecond(props.rate * frenzy.mult)}/s ×${frenzy.mult}`] })

  if (props.variant === 'shop') {
    const idle = props.idle > 0 ? ` · ${Math.round(props.idle * 100)}% while idle` : ''
    const rows: unknown[] = [
      line([count]),
      dim(`${perSecond(props.rate)}/s while Claude works${idle}`),
      line([Text({ color: props.layer?.color ?? TOPSOIL, children: [props.layer?.name ?? 'Topsoil'] }), dim(`· ${commas(props.depth ?? 0)} m deep`)]),
    ]
    if (props.goal !== null) {
      rows.push(line([dim(goal ?? ''), Text({ color: 'claude', children: [`${bar(props.goal.have, props.goal.need)} ${commas(props.goal.have)}/${commas(props.goal.need)}`] })]))
    }
    return box(rows)
  }

  if (props.mode === 'idle') {
    const notes = [props.lastTurn > 0 ? `last turn +${short(props.lastTurn)}` : 'mines while Claude works']
    if (props.idle > 0) notes.push(`crew at ${Math.round(props.idle * 100)}%`)
    // The miner's own break, a while into Claude's: a cup, then a snooze.
    if (props.nap === 'coffee') notes.push('☕')
    if (props.nap === 'sleep') notes.push('💤')
    return box([line([count, dim('·'), deep, reward === null ? dim(`· ${notes.join(' · ')}`) : line([dim('·'), reward])])])
  }

  // The band leaves the next goal to the shop, where its numbers explain it.
  const news =
    props.mode === 'pause'
      ? Text({ color: 'warning', wrap: 'truncate-end', children: ['Claude is waiting for you'] })
      : (reward ?? dim(props.last ?? `this turn +${short(props.turn)}`))
  const second = line([deep, dim('·'), news])
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
  const mine =
    props.surface === 'terminal'
      ? null
      : Box({
          key: 'mine',
          borderStyle: 'round',
          borderColor: isWorking ? GOLD.edge : DULL.edge,
          backgroundColor: !isWorking ? DULL.face : s.pressed > 0 ? GOLD.pressed : GOLD.face,
          ...(isWorking ? { hover: { backgroundColor: GOLD.lit } } : {}),
          paddingX: 1,
          flexShrink: 0,
          children: [Text({ bold: true, color: isWorking ? GOLD.ink : DULL.ink, children: ['⛏ Mine'] })],
        })
  // Compact: everything on one line beside the sign.
  const text = props.isCompact === true ? box([line([count, rate, slot, dim('·'), deep, dim('·'), news])]) : box([line([count, rate, slot]), second])
  return Box({
    height: props.height,
    flexDirection: 'row',
    columnGap: 2,
    alignItems: 'center',
    children: mine === null ? [text] : [mine, text],
  })
}

export default Hud
