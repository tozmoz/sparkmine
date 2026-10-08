// The live numbers in the band and the shop. A Client draws them, so they
// change without the band being redrawn. The hooks module gives it a fixed
// size, and nothing it draws changes that size: a surface unmounts a Client
// whose size moves on every frame.
//
// It asks the hooks module for fresh numbers a few times a second. When the
// click count it is handed grows, it pops what the clicks earned.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { HudProps } from '../types'

type Pop = { id: number; text: string; age: number }
type State = { instance: string; seen: number; pop: Pop | null; nextPop: number; hasClicked: boolean }

const POLL_MS = 200
const FRAME_MS = 60
/** Frames a "+4" stays up: bright at first, then dim. */
const POP_FRAMES = 10
const POP_BRIGHT = 4
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
  const line = (children: ReturnType<typeof Text>[]) => Box({ flexDirection: 'row', columnGap: 1, children })
  const dim = (text: string) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })

  let s = surface.state
  if (s === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    s = { instance, seen: props.clicks, pop: null, nextPop: 0, hasClicked: false }
    surface.setState(s)
    surface.every(POLL_MS, () => surface.post({ instance, total: 0 }))
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now === undefined || now.pop === null) return
      const age = now.pop.age + 1
      surface.setState({ ...now, pop: age < POP_FRAMES ? { ...now.pop, age } : null })
    })
    surface.post({ instance, total: 0 })
  } else if (props.clicks !== s.seen) {
    // New clicks arrived with these props: pop what they earned.
    const gained = Math.max(0, props.clicks - s.seen) * props.click
    const pop = gained > 0 ? { id: s.nextPop, text: `+${short(gained)}`, age: 0 } : s.pop
    s = { ...s, seen: props.clicks, pop, nextPop: s.nextPop + 1, hasClicked: s.hasClicked || gained > 0 }
    surface.setState(s)
  }

  const count = Text({ color: 'claude', bold: true, children: [`✻ ${short(props.sparks)}`] })
  const goal = props.goal === null ? null : `Next: ${props.goal.name}`

  if (props.variant === 'shop') {
    const idle = props.idle > 0 ? ` · ${Math.round(props.idle * 100)}% while idle` : ''
    const rows = [line([count]), dim(`${perSecond(props.rate)}/s while Claude works${idle}`)]
    if (props.goal !== null) {
      rows.push(line([dim(goal ?? ''), Text({ color: 'claude', children: [`${bar(props.goal.have, props.goal.need)} ${commas(props.goal.have)}/${commas(props.goal.need)}`] })]))
    }
    rows.push(dim(`Clicks ${commas(props.clicks)} · Tool calls ${commas(props.tools)} · Turns ${commas(props.turns)}`))
    return Box({ flexDirection: 'column', children: rows })
  }

  if (props.mode === 'idle') {
    const notes = [props.lastTurn > 0 ? `last turn +${short(props.lastTurn)}` : 'mines while Claude works']
    if (props.idle > 0) notes.push(`crew at ${Math.round(props.idle * 100)}%`)
    return line([count, dim(`· ${notes.join(' · ')}`)])
  }

  const pop =
    s.pop === null
      ? Text({ children: [' '] })
      : Text({ color: 'claude', bold: s.pop.age < POP_BRIGHT, dimColor: s.pop.age >= POP_BRIGHT, children: [s.pop.text] })
  const second =
    props.mode === 'pause'
      ? Text({ color: 'warning', wrap: 'truncate-end', children: ['Claude is waiting for you'] })
      : props.last === null && !s.hasClicked
        ? Text({ color: 'claude', wrap: 'truncate-end', children: ['⛏ Click the mine to dig'] })
        : dim(props.last ?? `this turn +${short(props.turn)}`)
  const third =
    props.goal === null
      ? Text({ children: [' '] })
      : line([dim(goal ?? ''), Text({ color: 'claude', children: [bar(props.goal.have, props.goal.need)] })])
  return Box({
    flexDirection: 'column',
    children: [line([count, dim(`${perSecond(props.rate)}/s`), pop]), second, third],
  })
}

export default Hud
