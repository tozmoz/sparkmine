// The live numbers in the band and the shop. A Client draws them, so they
// change without the band being redrawn: the scene beside them never flickers.
// It asks the hooks module for fresh numbers a few times a second. When the
// click count it is handed grows, from the Mine button or from a tap on the
// scene, the counter shakes and pops what the clicks earned.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { HudProps } from '../types'

type Pop = { id: number; text: string; age: number }
type State = { instance: string; seen: number; shake: number; pops: Pop[]; nextPop: number }

const POLL_MS = 200
const FRAME_MS = 50
/** How far the counter is nudged on each frame after a click: a small shake. */
const SHAKE = [2, 0, 2, 1] as const
const REST = 1
/** Frames a "+4" stays up: bright at first, then dim. */
const POP_FRAMES = 12
const POP_BRIGHT = 5
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
  const { Box, Text } = surface.elements

  let s = surface.state
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, seen: props.clicks, shake: 0, pops: [], nextPop: 0 }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ instance, total: 0 }))
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || (now.shake === 0 && now.pops.length === 0)) return
      surface.setState({
        ...now,
        shake: Math.max(0, now.shake - 1),
        pops: now.pops.map(pop => ({ ...pop, age: pop.age + 1 })).filter(pop => pop.age < POP_FRAMES),
      })
    })
    surface.post({ instance, total: 0 })
  } else if (props.clicks !== s.seen) {
    // New clicks arrived with these props: shake, and pop what they earned.
    const gained = Math.max(0, props.clicks - s.seen) * props.click
    const pops = gained > 0 && props.variant === 'band' ? [...s.pops, { id: s.nextPop, text: `+${short(gained)}`, age: 0 }].slice(-3) : s.pops
    s = { ...s, seen: props.clicks, shake: gained > 0 ? SHAKE.length : s.shake, pops, nextPop: s.nextPop + 1 }
    surface.setState(s)
  }

  const count = Text({ color: 'claude', bold: true, children: [`✻ ${short(props.sparks)}`] })

  if (props.variant === 'shop') {
    const idle = props.idle > 0 ? ` · ${Math.round(props.idle * 100)}% while idle` : ''
    return Box({
      flexDirection: 'column',
      children: [count, Text({ dimColor: true, children: [`${perSecond(props.rate)}/s while Claude works${idle}`] })],
    })
  }

  if (props.mode === 'idle') {
    const notes = [props.lastTurn > 0 ? `last turn +${short(props.lastTurn)}` : 'mines while Claude works']
    if (props.idle > 0) notes.push(`crew at ${Math.round(props.idle * 100)}%`)
    return Box({ flexDirection: 'row', columnGap: 1, children: [count, Text({ dimColor: true, children: [`· ${notes.join(' · ')}`] })] })
  }

  const nudge = s.shake > 0 ? (SHAKE[SHAKE.length - s.shake] ?? REST) : REST
  const pops = s.pops.map(pop =>
    Text({ color: 'claude', bold: pop.age < POP_BRIGHT, dimColor: pop.age >= POP_BRIGHT, children: [pop.text] }),
  )
  const rows = [
    Box({ flexDirection: 'row', columnGap: 1, paddingLeft: nudge, children: [count, Text({ dimColor: true, children: [`${perSecond(props.rate)}/s`] }), ...pops] }),
    props.mode === 'pause'
      ? Box({ paddingLeft: REST, children: [Text({ color: 'warning', children: ['Claude is waiting for you'] })] })
      : Box({ paddingLeft: REST, children: [Text({ dimColor: true, children: [props.last ?? `this turn +${short(props.turn)}`] })] }),
  ]
  if (props.goal !== null) {
    rows.push(
      Box({
        flexDirection: 'row',
        columnGap: 1,
        paddingLeft: REST,
        children: [
          Text({ dimColor: true, children: [`Next: ${props.goal.name}`] }),
          Text({ color: 'claude', children: [bar(props.goal.have, props.goal.need)] }),
        ],
      }),
    )
  }
  return Box({ flexDirection: 'column', children: rows })
}

export default Hud
