// The shop's stats, all time: where the sparks came from, the records, and
// what Claude's work paid. A Client, so the numbers keep up without the shop
// being redrawn. The desktop draws a bar and tiles; the terminal, lines.
//
// A surface module has no `$` and takes nothing from the plugin's other files,
// so it carries its own number formatting.

import type { ClientModule } from 'claude-code'

import type { StatsProps } from '../types'

const POLL_MS = 1_000
/** Cells the terminal's bar takes. */
const TEXT_BAR = 40
/** The desktop's tiles: a see-through grey, so they read on a light theme as on a dark one. */
const TILE_FILL = 'rgba(128,128,128,0.10)'
const TILE_LINE = 'rgba(128,128,128,0.28)'

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

/** Where the sparks came from, each in a color of the theme: the crew in Claude's own. */
const SOURCES = [
  { name: 'Crew', color: 'claude', of: (by: StatsProps['bySource']) => by.crew ?? 0 },
  { name: 'Tools', color: 'suggestion', of: (by: StatsProps['bySource']) => by.tool ?? 0 },
  { name: 'Bonuses', color: 'warning', of: (by: StatsProps['bySource']) => (by.turn ?? 0) + (by.event ?? 0) + (by.vein ?? 0) },
  { name: 'Clicks', color: 'success', of: (by: StatsProps['bySource']) => by.click ?? 0 },
] as const

const Stats: ClientModule<StatsProps, { isPolling: true }> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ isPolling: true })
    surface.every(POLL_MS, () => surface.post({ poll: true }))
    surface.post({ poll: true })
  }
  const by = props.bySource ?? {}
  const events = props.events ?? {}
  const sources = SOURCES.map(s => ({ name: s.name, color: s.color, value: s.of(by) }))
  const total = sources.reduce((sum, s) => sum + s.value, 0)
  const pct = (value: number) => Math.round((value / Math.max(1, total)) * 100)
  const column = (children: unknown[], gap = 0) => Box({ flexDirection: 'column', rowGap: gap, children: children as never[] })
  const row = (children: unknown[], gap = 1) => Box({ flexDirection: 'row', columnGap: gap, children: children as never[] })
  const dim = (text: string) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })
  const bold = (text: string) => Text({ bold: true, children: [text] })

  const records = [
    [`+${short(props.bestTurn ?? 0)}`, 'Best turn'],
    [commas(props.bestStreak ?? 0), 'Best streak'],
    [`${commas(props.deepest ?? 0)} m`, 'Deepest'],
    [commas(props.shafts ?? 0), 'Shafts'],
    [commas(props.gems ?? 0), 'Gems'],
    [commas(props.veins ?? 0), 'Veins'],
  ] as const
  const work = [
    [commas(events.tests ?? 0), 'Tests passed'],
    [commas(events.fix ?? 0), 'Bugs squashed'],
    [commas(events.build ?? 0), 'Builds'],
    [commas(events.lint ?? 0), 'Clean lints'],
    [commas(events.commit ?? 0), 'Commits'],
    [commas(events.pr ?? 0), 'PRs opened'],
    [commas(events.merge ?? 0), 'PRs merged'],
    [commas(events.longShift ?? 0), 'Long shifts'],
  ] as const
  const totals = dim(`Clicks ${commas(props.clicks ?? 0)} · Tool calls ${commas(props.tools ?? 0)} · Turns ${commas(props.turns ?? 0)}`)
  const heading = row([bold('Where your sparks came from'), dim(total > 0 ? `${short(total)} in all` : 'nothing mined yet')])

  if (props.surface === 'desktop') {
    // The bar: each source's share of one row, in its color.
    const bar = Box({
      flexDirection: 'row',
      height: 1,
      children: (total > 0 ? sources.filter(s => s.value > 0) : [{ name: 'None', color: TILE_LINE, value: 1 }]).map(s =>
        Box({ flexGrow: Math.max(1, Math.round((s.value / Math.max(1, total)) * 1000)), height: 1, backgroundColor: s.color, children: [] }),
      ) as never[],
    })
    const legendItem = (s: (typeof sources)[number]) =>
      row([Text({ color: s.color, children: ['■'] }), Text({ children: [s.name] }), dim(`${pct(s.value)}% · ✻ ${short(s.value)}`)])
    // Two columns of the legend, the first two sources over the other two.
    const legend = row(
      [0, 1].map(c => Box({ flexDirection: 'column', flexGrow: 1, width: 0, children: sources.filter((_, i) => i % 2 === c).map(legendItem) as never[] })),
      2,
    )
    const tile = ([value, name]: readonly [string, string]) =>
      Box({
        flexDirection: 'column',
        flexGrow: 1,
        width: 0,
        paddingX: 1,
        borderStyle: 'round',
        borderColor: TILE_LINE,
        backgroundColor: TILE_FILL,
        // A long name wraps rather than losing its end: the row's tiles grow alike.
        children: [Text({ bold: true, children: [value] }), Text({ dimColor: true, wrap: 'wrap', children: [name] })] as never[],
      })
    const grid = (list: readonly (readonly [string, string])[], perRow: number) =>
      column(
        Array.from({ length: Math.ceil(list.length / perRow) }, (_, r) => row(list.slice(r * perRow, (r + 1) * perRow).map(tile))),
        1,
      )
    return column(
      [
        column([heading, bar, legend], 1),
        column([bold('Records'), grid(records, 3)]),
        column([bold("Claude's work"), grid(work, 4)]),
        totals,
      ],
      1,
    )
  }

  // The terminal's bar: a run of blocks in each source's color.
  let left = TEXT_BAR
  const runs = sources
    .filter(s => s.value > 0)
    .map((s, i, all) => {
      const width = i === all.length - 1 ? left : Math.min(left, Math.round((s.value / Math.max(1, total)) * TEXT_BAR))
      left -= width
      return Text({ color: s.color, children: ['█'.repeat(Math.max(0, width))] })
    })
  // Two to a line, the second in line with the one above it.
  const line = (pair: readonly (typeof sources)[number][]) =>
    row(
      pair.map((s, i) =>
        Box({
          ...(i === 0 ? { width: 30, flexShrink: 0 } : {}),
          children: [row([Text({ color: s.color, children: ['■'] }), Text({ children: [s.name] }), dim(`${pct(s.value)}% · ✻ ${short(s.value)}`)])] as never[],
        }),
      ),
      1,
    )
  const named = (title: string, list: readonly (readonly [string, string])[]) =>
    row([Box({ width: 14, flexShrink: 0, children: [bold(title)] }), Text({ wrap: 'wrap', children: [list.map(([value, name]) => `${name} ${value}`).join(' · ')] })])
  return column(
    [
      heading,
      total > 0 ? Text({ children: runs as never[] }) : dim('▱'.repeat(TEXT_BAR)),
      line(sources.slice(0, 2)),
      line(sources.slice(2)),
      Text({ children: [' '] }),
      named('Records', records),
      named("Claude's work", work),
      totals,
    ],
    0,
  )
}

export default Stats
