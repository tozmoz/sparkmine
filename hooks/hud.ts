// The live numbers in the band and the shop. A Client draws them, so a click
// redraws this small region alone: the scene beside it is never touched.
// It asks the hooks module for fresh numbers a few times a second, and sends
// the clicks along with that ask.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { HudProps } from '../types'

type Pop = { id: number; text: string; age: number }
type State = { instance: string; total: number; shake: number; pops: Pop[]; nextPop: number }

const POLL_MS = 250
const FRAME_MS = 50
/** How far the counter is nudged on each frame after a click: a small shake. */
const SHAKE = [2, 0, 2, 1] as const
const REST = 1
/** Frames a "+1" stays up: bright at first, then dim. */
const POP_FRAMES = 12
const POP_BRIGHT = 5

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

const Hud: ClientModule<HudProps, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements

  let state = surface.state
  if (state === undefined) {
    const instance = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
    state = { instance, total: 0, shake: 0, pops: [], nextPop: 0 }
    surface.setState(state)
    surface.every(POLL_MS, () => surface.post({ instance, total: surface.state?.total ?? 0 }))
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
  }
  const s = state

  const mine = () => {
    const now = surface.state ?? s
    const total = now.total + 1
    const pop = { id: now.nextPop, text: `+${short(props.click)}`, age: 0 }
    surface.setState({ ...now, total, shake: SHAKE.length, pops: [...now.pops, pop].slice(-3), nextPop: now.nextPop + 1 })
    surface.post({ instance: now.instance, total })
  }

  const count = Text({ color: 'claude', bold: true, children: [`✻ ${short(props.sparks)}`] })
  const pops = s.pops.map(pop =>
    Text({ color: 'claude', bold: pop.age < POP_BRIGHT, dimColor: pop.age >= POP_BRIGHT, children: [pop.text] }),
  )

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
  const top = Box({
    flexDirection: 'row',
    columnGap: 1,
    paddingLeft: nudge,
    children: [count, Text({ dimColor: true, children: [`${perSecond(props.rate)}/s`] }), ...pops],
  })
  const bottom =
    props.mode === 'pause'
      ? Text({ color: 'warning', children: ['Claude is waiting for you'] })
      : Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({ key: 'mine', label: '⛏ Mine', variant: 'primary', hotkey: 'm', onPress: mine }),
            Text({ dimColor: true, children: [props.last ?? `this turn +${short(props.turn)}`] }),
          ],
        })
  return Box({ flexDirection: 'column', children: [top, bottom] })
}

export default Hud
