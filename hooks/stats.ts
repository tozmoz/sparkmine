// The shop's stats, all time: where the sparks came from, the best turn, and
// what was found. A Client, so the numbers keep up without the shop being
// redrawn, which would hand its buttons new handles mid-press.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { StatsProps } from '../types'

const POLL_MS = 1_000
const BAR = 10
const NAME = 8

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

const Stats: ClientModule<StatsProps, { isPolling: true }> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ isPolling: true })
    surface.every(POLL_MS, () => surface.post({ poll: true }))
    surface.post({ poll: true })
  }
  const by = props.bySource ?? {}
  const events = props.events ?? {}
  const groups = [
    { name: 'Crew', value: by.crew ?? 0 },
    { name: 'Clicks', value: by.click ?? 0 },
    { name: 'Tools', value: by.tool ?? 0 },
    { name: 'Bonuses', value: (by.turn ?? 0) + (by.event ?? 0) + (by.vein ?? 0) },
  ]
  const total = groups.reduce((sum, g) => sum + g.value, 0)
  const line = (children: unknown[]) => Box({ flexDirection: 'row', columnGap: 1, children: children as never[] })
  const dim = (text: string) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })

  const rows: unknown[] = []
  if (total <= 0) rows.push(dim('Nothing mined since the stats began.'))
  for (const g of total <= 0 ? [] : groups) {
    const share = g.value / total
    const filled = Math.max(0, Math.min(BAR, Math.round(share * BAR)))
    rows.push(
      line([
        Text({ children: [g.name.padEnd(NAME)] }),
        Text({ color: 'claude', children: ['▰'.repeat(filled) + '▱'.repeat(BAR - filled)] }),
        dim(`${Math.round(share * 100)}% · ✻ ${short(g.value)}`),
      ]),
    )
  }
  rows.push(dim(`Best turn +${short(props.bestTurn ?? 0)} · Deepest ${commas(props.deepest ?? 0)} m · Shafts ${commas(props.shafts ?? 0)}`))
  rows.push(dim(`Gems ${commas(props.gems ?? 0)} · Veins ${commas(props.veins ?? 0)}`))
  rows.push(dim(`Tests passed ${commas(events.tests ?? 0)} · Commits ${commas(events.commit ?? 0)} · Long shifts ${commas(events.longShift ?? 0)}`))
  rows.push(dim(`Clicks ${commas(props.clicks ?? 0)} · Tool calls ${commas(props.tools ?? 0)} · Turns ${commas(props.turns ?? 0)}`))
  return Box({ flexDirection: 'column', children: rows as never[] })
}

export default Stats
