// The shop pane, as a plain tree built from its model. The render hook reads
// the model, picks the surface's elements and hands in what only it can make:
// the pictures (desktop only) and the live counter.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { IconId, ProducerId, ShopItem, ShopModel } from '../types'
import { STONE_BONUS } from './data.ts'
import { fmt } from './format.ts'

type Elements = ElementTable<RenderSurface>

export type ShopActions = {
  buy: (id: ProducerId) => unknown
  upgrade: (id: string) => unknown
  amount: (n: number) => unknown
  shaft: () => unknown
}

export type ShopParts = {
  /** A picture of the icon, or null where the surface draws none. */
  icon: (id: IconId, isDim: boolean) => RenderElement | null
  /** The mine itself, at the top of the pane. */
  header: RenderElement | null
  /** The Client that keeps the sparks counter live. */
  live: RenderElement
  /** The Client that keeps the stats live, where the surface draws one. */
  stats: RenderElement | null
  /** A line above everything, such as that the game is stopped. */
  notice: RenderElement | null
  /** Cards get a border where there is room for one. */
  isRoomy: boolean
}

/** Where a Button's closure is held: what a surface names when it presses the Button. */
export type Press = { plugin: string; handle: number }

/**
 * Keeps each Button's handle from one drawing of the shop to the next. Every
 * Button built gets a new handle and a redraw lets the old ones go, so a press
 * the desktop sent under one just let go reached nothing: a purchase made as
 * the shop redrew was lost. A Button whose key was drawn before keeps that
 * handle, with this drawing's label and closure.
 *
 * @param held the handles drawn so far, by key, kept from drawing to drawing
 */
export function keepHandles(tree: RenderElement, held: Map<string, Press>): RenderElement {
  const keep = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(keep)
    if (node === null || typeof node !== 'object') return node
    const el = node as { type?: unknown; props?: { key?: unknown }; press?: unknown; children?: unknown }
    if (el.type === 'Button' && typeof el.props?.key === 'string' && typeof el.press === 'object' && el.press !== null) {
      const before = held.get(el.props.key)
      if (before !== undefined) return { ...el, press: before }
      held.set(el.props.key, el.press as Press)
      return node
    }
    return el.children === undefined ? node : { ...el, children: keep(el.children) }
  }
  return keep(tree) as RenderElement
}

/** The gold of an earned achievement, the Mine sign's own. */
const GOLD = '#f2b632'

/** What the stones and achievements add to everything, once there are any. */
function bonusLine(el: Elements, model: ShopModel): RenderElement | null {
  const { Text } = el
  const b = model.bonus
  if (b.stones === 0 && b.achievements === 0) return null
  const parts = [
    ...(b.stones > 0 ? [`◈ ${b.stones} stones +${b.stonesPct}%`] : []),
    ...(b.achievements > 0 ? [`★ ${b.achievements} achievements +${b.achievementsPct}%`] : []),
  ]
  return <Text color="permission">{parts.join(' · ')}</Text>
}

function card(el: Elements, parts: ShopParts, item: ShopItem, button: RenderElement): RenderElement {
  const { Box, Text } = el
  const name = item.owned > 0 ? `${item.name} ×${item.owned}` : item.name
  return (
    <Box
      flexDirection="row"
      columnGap={1}
      alignItems="center"
      paddingX={1}
      {...(parts.isRoomy ? { borderStyle: 'round', borderColor: item.canBuy ? 'claude' : 'inactive' } : {})}
    >
      {parts.icon(item.icon, !item.canBuy && item.owned === 0)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold>{name}</Text>
        <Text dimColor>{item.detail}</Text>
      </Box>
      {button}
    </Box>
  )
}

function priceButton(el: Elements, key: string, label: string, canBuy: boolean, onPress: () => unknown): RenderElement {
  const { Button } = el
  return canBuy ? (
    <Button key={key} label={label} variant="primary" onPress={() => onPress()} />
  ) : (
    <Button key={key} label={label} dimColor onPress={() => onPress()} />
  )
}

export function shopTree(el: Elements, model: ShopModel, parts: ShopParts, act: ShopActions): RenderElement {
  const { Box, Text, Button } = el
  if (!model.isLoaded) return <Text dimColor>Opening the mine…</Text>
  const amount = model.amount
  const v = model.values

  const header = (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      {parts.header}
      <Box flexDirection="column">
        {parts.live}
        <Text dimColor>{`Click +${fmt(v.click)} · Read +${fmt(v.read)} · Edit +${fmt(v.edit)}`}</Text>
        {bonusLine(el, model)}
      </Box>
    </Box>
  )

  const producers = model.producers.map(item =>
    card(
      el,
      parts,
      item,
      priceButton(el, `buy-${item.id}`, `${amount > 1 ? `×${amount} ` : ''}${fmt(item.price)} ✻`, item.canBuy, () =>
        act.buy(item.id as ProducerId),
      ),
    ),
  )
  const teaser =
    model.teaser === null ? null : (
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
        {parts.icon('locked', true)}
        <Text dimColor>{`??? · ${fmt(model.teaser)} ✻`}</Text>
      </Box>
    )

  // Bordered cards stand apart by a row, so their edges never touch.
  const cards = (list: RenderElement[]) => (parts.isRoomy ? <Box flexDirection="column" rowGap={1}>{list}</Box> : list)

  const upgrades = model.upgrades.map(item =>
    card(el, parts, item, priceButton(el, `up-${item.id}`, `${fmt(item.price)} ✻`, item.canBuy, () => act.upgrade(item.id))),
  )
  const next =
    model.next === null ? null : (
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
        {parts.icon(model.next.icon, true)}
        <Text dimColor>{`Next: ${model.next.name}, ${model.next.text}`}</Text>
      </Box>
    )

  const shaft =
    model.shaft === null ? null : (
      <Box flexDirection="column">
        <Text bold>New shaft</Text>
        <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
          {parts.icon('stone', model.shaft.gain < 1)}
          <Text dimColor>
            {model.shaft.gain > 0
              ? `Start over in fresh rock for ${model.shaft.gain} ◈ ancient stones. Each adds ${Math.round(STONE_BONUS * 100)}% to everything, for good; achievements and stats stay.`
              : `A new shaft opens once this one reaches ${model.shaft.at} m, and pays more ◈ the deeper it gets.`}
          </Text>
          {priceButton(el, 'shaft', model.shaft.gain > 0 ? `Open for ${model.shaft.gain} ◈` : 'Open a new shaft', model.shaft.gain > 0, () => act.shaft())}
        </Box>
      </Box>
    )

  // The layers ahead: each one reached adds its perk for the rest of the run.
  const layers =
    model.layers.length === 0 ? null : (
      <Box flexDirection="column">
        <Text bold>Layers</Text>
        {model.layers.map(layer => (
          <Box flexDirection="row" columnGap={1} paddingX={1}>
            {layer.isReached ? <Text color={layer.color}>■</Text> : <Text dimColor>□</Text>}
            <Text bold={layer.isHere} dimColor={!layer.isReached}>{layer.name}</Text>
            <Text dimColor>{`${layer.from} m · ${layer.text}`}</Text>
            {layer.isHere ? <Text color={layer.color}>◀ here</Text> : null}
          </Box>
        ))}
      </Box>
    )

  const earned = model.achievements.filter(a => a.isEarned).length
  const achievements =
    model.achievements.length === 0 ? null : (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {parts.icon('badge', earned === 0)}
          <Text bold>Achievements</Text>
          <Text dimColor>{`${earned}/${model.achievements.length} · +${model.bonus.achievementsPct}% to everything`}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={1}>
          {model.achievements.map(a => (a.isEarned ? <Text color={GOLD}>{`★ ${a.name}`}</Text> : <Text dimColor>{`☆ ${a.name}`}</Text>))}
        </Box>
        {model.nextAchievement === null ? null : (
          <Box paddingX={1}>
            <Text dimColor>{`Next: ${model.nextAchievement.name}. ${model.nextAchievement.text}`}</Text>
          </Box>
        )}
      </Box>
    )

  const stats =
    parts.stats === null ? null : (
      <Box flexDirection="column">
        <Text bold>Stats</Text>
        {parts.stats}
      </Box>
    )

  return (
    <Box flexDirection="column" rowGap={1}>
      {parts.notice}
      {header}
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Text bold>Producers</Text>
          {[1, 10, 100].map(n => (
            <Button key={`amount-${n}`} label={`×${n}`} plain dimColor={amount !== n} onPress={() => act.amount(n)} />
          ))}
        </Box>
        {cards(producers)}
        {teaser}
      </Box>
      <Box flexDirection="column">
        <Text bold>Upgrades</Text>
        {upgrades.length > 0 ? cards(upgrades) : <Text dimColor>Nothing on sale yet.</Text>}
        {model.more > 0 ? <Text dimColor>{`+${model.more} more on sale`}</Text> : null}
        {next}
      </Box>
      {shaft}
      {layers}
      {achievements}
      {stats}
    </Box>
  )
}
