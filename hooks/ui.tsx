// What Sparkmine draws, as plain trees. The render hooks read the state and
// hand these builders the surface's elements and the actions to call.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { Mine, ProducerId, Save, View } from '../types'
import { CRYSTAL_BONUS, CRYSTAL_UNIT, PRODUCERS, TOOL_NAMES, type Upgrade } from './data.ts'
import { commas, fmt, fmtRate } from './format.ts'
import * as game from './game.ts'
import { sceneCells, sceneSvg, type SceneSpec } from './scene.ts'

type Elements = ElementTable<RenderSurface>

/** CSS pixels per scene pixel on the desktop. */
export const SCALE = 4
/** Columns the band's text needs beside the terminal scene. */
export const HUD_COLUMNS = 30

export const specOf = (save: Save, view: View): SceneSpec => ({
  mode: view.mode,
  carts: Math.min(6, game.owned(save, 'cart')),
  goblins: Math.min(1, game.owned(save, 'goblin')),
})

const specKey = (spec: SceneSpec) => `${spec.mode}:${spec.carts}:${spec.goblins}`
const svgs = new Map<string, string>()
const cells = new Map<string, ReturnType<typeof sceneCells>>()

export function svgFor(spec: SceneSpec): string {
  const key = specKey(spec)
  let svg = svgs.get(key)
  if (svg === undefined) {
    svg = sceneSvg(spec, SCALE)
    svgs.set(key, svg)
  }
  return svg
}

export function cellsFor(spec: SceneSpec): ReturnType<typeof sceneCells> {
  const key = specKey(spec)
  let scene = cells.get(key)
  if (scene === undefined) {
    scene = sceneCells(spec)
    cells.set(key, scene)
  }
  return scene
}

export type BandActions = { mine: () => unknown; shop: () => unknown }

/** The one line the band keeps while Claude is idle. */
export function idleBand(el: Elements, mine: Mine, view: View, act: BandActions): RenderElement {
  const { Box, Text, Button } = el
  const save = mine.save
  const idle = game.idleShare(save)
  const notes = [view.lastTurn > 0 ? `last turn +${fmt(view.lastTurn)}` : 'mines while Claude works']
  if (idle > 0) notes.push(`crew at ${Math.round(idle * 100)}%`)
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text color="claude">{`✻ ${fmt(save.sparks)}`}</Text>
      <Text dimColor>{`· ${notes.join(' · ')}`}</Text>
      <Button key="shop" label="Shop" plain dimColor onPress={() => act.shop()} />
    </Box>
  )
}

/** The text and buttons beside the scene while Claude works. */
export function hud(el: Elements, mine: Mine, view: View, act: BandActions): RenderElement {
  const { Box, Text, Button } = el
  const save = mine.save
  const m = game.multipliers(save)
  const turn = Math.max(0, save.lifetime - view.turnStart)
  const last = view.last === null ? 'Every tool call Claude makes is ore' : `${view.last.label} +${fmt(view.last.value)} ✻`
  return (
    <Box flexDirection="column">
      <Text color="claude" bold>{`✻ ${fmt(save.sparks)}`}</Text>
      <Text dimColor>{`${fmtRate(game.rate(save, m))}/s · this turn +${fmt(turn)}`}</Text>
      <Text dimColor>{last}</Text>
      {view.mode === 'pause' ? (
        <Text color="warning">Claude is waiting for you</Text>
      ) : (
        <Box flexDirection="row" columnGap={1}>
          <Button
            key="mine"
            variant="primary"
            hotkey="m"
            label={`⛏ Mine +${fmt(game.clickValue(save, m))}`}
            onPress={() => act.mine()}
          />
          <Button key="shop" hotkey="s" label="Shop" onPress={() => act.shop()} />
        </Box>
      )}
    </Box>
  )
}

export function unlockText(u: Upgrade): string {
  const n = commas(u.unlock.n)
  switch (u.unlock.kind) {
    case 'clicks':
      return `after ${n} clicks`
    case 'tools':
      return `after ${n} tool calls`
    case 'turns':
      return `after ${n} turns`
    case 'mined':
      return `after ${n} ${TOOL_NAMES[u.unlock.tool]} calls`
    case 'owned': {
      const p = game.producer(u.unlock.id)
      return `with ${n} ${u.unlock.n === 1 ? p.name : p.plural}`
    }
    case 'crew':
      return `with ${n} producers`
    case 'earned':
      return `after ${fmt(u.unlock.n)} sparks in all`
  }
}

export type ShopActions = {
  buy: (id: ProducerId) => unknown
  upgrade: (id: string) => unknown
  amount: (n: number) => unknown
  collapse: () => unknown
}

export const SHOP_LIMIT = 8

/** The shop pane: producers, upgrades and the collapse. */
export function shopTree(el: Elements, mine: Mine, view: View, act: ShopActions): RenderElement {
  const { Box, Text, Button } = el
  if (!mine.isLoaded) return <Text dimColor>Opening the mine…</Text>
  const save = mine.save
  const m = game.multipliers(save)
  const amount = view.amount

  const top = PRODUCERS.reduce((high, p, i) => (game.owned(save, p.id) > 0 ? i : high), -1)
  const teaser = PRODUCERS[top + 2]
  const producers = PRODUCERS.slice(0, top + 2).map(p => {
    const n = game.owned(save, p.id)
    const canBuy = save.sparks >= game.priceOf(p, n)
    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Box flexDirection="column" flexShrink={1}>
          <Text bold>{n > 0 ? `${p.name} ×${n}` : p.name}</Text>
          <Text dimColor>{`${fmtRate(game.unitRate(save, p.id, m))}/s each · ${p.blurb}`}</Text>
        </Box>
        <Button
          key={`buy-${p.id}`}
          label={`${amount > 1 ? `×${amount} ` : ''}${fmt(game.priceOf(p, n, amount))} ✻`}
          dimColor={!canBuy}
          onPress={() => act.buy(p.id)}
        />
      </Box>
    )
  })

  const { onSale, next } = game.shopUpgrades(save)
  const upgrades = onSale.slice(0, SHOP_LIMIT).map(u => (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexDirection="column" flexShrink={1}>
        <Text bold>{u.name}</Text>
        <Text dimColor>{u.blurb}</Text>
      </Box>
      <Button key={`up-${u.id}`} label={`${fmt(u.cost)} ✻`} dimColor={save.sparks < u.cost} onPress={() => act.upgrade(u.id)} />
    </Box>
  ))
  let hint: RenderElement | null = null
  if (next !== null) {
    const p = game.progress(save, next)
    hint = <Text dimColor>{`Next: ${next.name}, ${unlockText(next)} (${commas(Math.min(p.have, p.need))}/${commas(p.need)})`}</Text>
  }

  const gain = game.crystalGain(save)
  const nextCrystalAt = (save.crystals + gain + 1) ** 3 * CRYSTAL_UNIT
  const showCollapse = save.crystals > 0 || save.allTime >= CRYSTAL_UNIT / 10
  const idle = m.idle > 0 ? ` · ${Math.round(m.idle * 100)}% while idle` : ''

  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Text color="claude" bold>{`✻ ${fmt(save.sparks)}`}</Text>
          {save.crystals > 0 ? (
            <Text color="permission">{`◆ ${save.crystals} · +${Math.round(save.crystals * CRYSTAL_BONUS * 100)}%`}</Text>
          ) : null}
        </Box>
        <Text dimColor>{`${fmtRate(game.rate(save, m))}/s while Claude works${idle}`}</Text>
        <Text dimColor>
          {`Click +${fmt(game.clickValue(save, m))} · Read +${fmt(game.toolValue(save, 'read', m))} · Edit +${fmt(game.toolValue(save, 'edit', m))}`}
        </Text>
      </Box>

      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Text bold>Producers</Text>
          {[1, 10, 100].map(n => (
            <Button key={`amount-${n}`} label={`×${n}`} plain dimColor={amount !== n} onPress={() => act.amount(n)} />
          ))}
        </Box>
        {producers}
        {teaser === undefined ? null : <Text dimColor>{`??? · ${fmt(teaser.cost)} ✻`}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold>Upgrades</Text>
        {upgrades.length > 0 ? upgrades : <Text dimColor>Nothing on sale yet.</Text>}
        {onSale.length > SHOP_LIMIT ? <Text dimColor>{`+${onSale.length - SHOP_LIMIT} more on sale`}</Text> : null}
        {hint}
      </Box>

      {showCollapse ? (
        <Box flexDirection="column">
          <Text bold>Collapse the mine</Text>
          <Text dimColor>
            {gain > 0
              ? `Trade this run for ${gain} ◆. Each ◆ adds ${Math.round(CRYSTAL_BONUS * 100)}% to everything, for good.`
              : `The next ◆ comes at ${fmt(nextCrystalAt)} sparks in all.`}
          </Text>
          <Button key="collapse" label={gain > 0 ? `Collapse for ${gain} ◆` : 'Collapse'} dimColor={gain < 1} onPress={() => act.collapse()} />
        </Box>
      ) : null}

      <Text dimColor>{`Clicks ${commas(save.clicks)} · Tool calls ${commas(save.tools)} · Turns ${commas(save.turns)}`}</Text>
    </Box>
  )
}
