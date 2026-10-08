// The shop pane, as a plain tree built from its model. The render hook reads
// the model, picks the surface's elements and hands in what only it can make:
// the pictures (desktop only) and the live counter.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { IconId, ProducerId, ShopItem, ShopModel } from '../types'
import { CRYSTAL_BONUS } from './data.ts'
import { commas, fmt } from './format.ts'

type Elements = ElementTable<RenderSurface>

export type ShopActions = {
  buy: (id: ProducerId) => unknown
  upgrade: (id: string) => unknown
  amount: (n: number) => unknown
  collapse: () => unknown
}

export type ShopParts = {
  /** A picture of the icon, or null where the surface draws none. */
  icon: (id: IconId, isDim: boolean) => RenderElement | null
  /** The mine itself, at the top of the pane. */
  header: RenderElement | null
  /** The Client that keeps the sparks counter live. */
  live: RenderElement
  /** Cards get a border where there is room for one. */
  isRoomy: boolean
}

/** ▰▰▰▱▱▱▱▱▱▱ */
export function bar(have: number, need: number, width = 10): string {
  const filled = need <= 0 ? width : Math.max(0, Math.min(width, Math.floor((have / need) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
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
        {model.crystals > 0 ? (
          <Text color="permission">{`◆ ${model.crystals} · +${Math.round(model.crystals * CRYSTAL_BONUS * 100)}% to everything`}</Text>
        ) : null}
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

  const upgrades = model.upgrades.map(item =>
    card(el, parts, item, priceButton(el, `up-${item.id}`, `${fmt(item.price)} ✻`, item.canBuy, () => act.upgrade(item.id))),
  )
  const next =
    model.next === null ? null : (
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
        {parts.icon(model.next.icon, true)}
        <Box flexDirection="column">
          <Text dimColor>{`Next: ${model.next.name}, ${model.next.text}`}</Text>
          <Text color="claude">{`${bar(model.next.have, model.next.need)} ${commas(model.next.have)}/${commas(model.next.need)}`}</Text>
        </Box>
      </Box>
    )

  const collapse = model.showCollapse ? (
    <Box flexDirection="column">
      <Text bold>Collapse the mine</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
        {parts.icon('crystal', model.gain < 1)}
        <Text dimColor>
          {model.gain > 0
            ? `Trade this run for ${model.gain} ◆. Each ◆ adds ${Math.round(CRYSTAL_BONUS * 100)}% to everything, for good.`
            : `The next ◆ comes at ${fmt(model.nextCrystalAt)} sparks in all.`}
        </Text>
        {priceButton(el, 'collapse', model.gain > 0 ? `Collapse for ${model.gain} ◆` : 'Collapse', model.gain > 0, () => act.collapse())}
      </Box>
    </Box>
  ) : null

  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Text bold>Producers</Text>
          {[1, 10, 100].map(n => (
            <Button key={`amount-${n}`} label={`×${n}`} plain dimColor={amount !== n} onPress={() => act.amount(n)} />
          ))}
        </Box>
        {producers}
        {teaser}
      </Box>
      <Box flexDirection="column">
        <Text bold>Upgrades</Text>
        {upgrades.length > 0 ? upgrades : <Text dimColor>Nothing on sale yet.</Text>}
        {model.more > 0 ? <Text dimColor>{`+${model.more} more on sale`}</Text> : null}
        {next}
      </Box>
      {collapse}
      <Text dimColor>{`Clicks ${commas(model.stats.clicks)} · Tool calls ${commas(model.stats.tools)} · Turns ${commas(model.stats.turns)}`}</Text>
    </Box>
  )
}
