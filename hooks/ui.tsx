// The shop pane, as a plain tree built from its model. The render hook reads
// the model, picks the surface's elements and hands in what only it can make:
// the pictures (desktop only) and the live Clients. The pane shows one tab at
// a time, so however much the shop holds, it stays short.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { Amount, IconId, ProducerId, RelicId, ShopItem, ShopModel, ShopTab } from '../types'
import { ACHIEVEMENT_BONUS, RELICS } from './data.ts'
import { commas, fmt, plural } from './format.ts'

type Elements = ElementTable<RenderSurface>

export type ShopActions = {
  buy: (id: ProducerId) => unknown
  upgrade: (id: string) => unknown
  amount: (amount: Amount) => unknown
  shaft: () => unknown
  tab: (tab: ShopTab) => unknown
  relic: (id: RelicId) => unknown
}

export type ShopParts = {
  /** A picture of the icon, `size` CSS pixels square, or null where the surface draws none. */
  icon: (id: IconId, isDim: boolean, size?: number) => RenderElement | null
  /** The mine itself, at the top of the pane. */
  header: RenderElement | null
  /** The Client that keeps the sparks counter live. */
  live: RenderElement
  /** The Client that keeps the stats live, where the surface draws one. */
  stats: RenderElement | null
  /** A line above everything, such as that the game is stopped. */
  notice: RenderElement | null
  /** The desktop's pictures: the layers in sight, the badge wall, a bar. Null where the surface draws them in text. */
  pictures: {
    strata: RenderElement
    badgeWall: RenderElement
    bar: (share: number, color: string) => RenderElement
  } | null
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

/** What a press of a producer's button can buy: one, ten, or as many as the purse allows. */
const AMOUNTS: readonly Amount[] = [1, 10, 'max']

/** The tabs, in order, and the glyph the desktop shows before each name. */
const TABS: readonly { tab: ShopTab; glyph: string; name: string }[] = [
  { tab: 'shop', glyph: '⛏', name: 'Shop' },
  { tab: 'shaft', glyph: '◈', name: 'Shaft' },
  { tab: 'badges', glyph: '★', name: 'Badges' },
  { tab: 'stats', glyph: '▤', name: 'Stats' },
]

/** On the desktop the owned relics' names take a column as wide as the longest, so what each does lines up. */
const RELIC_NAME_WIDTH = Math.max(...RELICS.map(r => r.name.length))

/** The gold of an earned badge and a bar of them: the theme's, so a light theme darkens it. */
const GOLD = 'warning'
/** The same gold for the desktop's pictures, which draw no theme colors. */
const PICTURE_GOLD = '#f2b632'

/** A bar in text: `have` of `need` filled. */
function textBar(have: number, need: number, width: number): string {
  const filled = need <= 0 ? width : Math.max(0, Math.min(width, Math.floor((have / need) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/** A sentence that goes on after another: its first letter small, unless it names Claude. */
const lower = (text: string): string => (text.startsWith('Claude') ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`)

/** What the stones and achievements add to everything, once there are any. */
function bonusLine(el: Elements, model: ShopModel): RenderElement | null {
  const { Text } = el
  const b = model.bonus
  if (b.stones === 0 && b.achievements === 0) return null
  const parts = [
    ...(b.stones > 0 ? [`◈ ${plural(b.stones, 'stone', 'stones')} +${b.stonesPct}%`] : []),
    ...(b.achievements > 0 ? [`★ ${plural(b.achievements, 'achievement', 'achievements')} +${b.achievementsPct}%`] : []),
  ]
  return <Text color="permission">{parts.join(' · ')}</Text>
}

/** A section's name in bold, and a note on it. */
function heading(el: Elements, name: string, note?: string): RenderElement {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text bold>{name}</Text>
      {note === undefined ? null : <Text dimColor>{note}</Text>}
    </Box>
  )
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
        <Box flexDirection="row" columnGap={1}>
          <Text bold>{name}</Text>
          {item.isBest === true ? <Text color="success">best buy</Text> : null}
        </Box>
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

/** Bordered cards stand apart by a row, so their edges never touch. */
function cards(el: Elements, parts: ShopParts, list: RenderElement[]): RenderElement | RenderElement[] {
  const { Box } = el
  return parts.isRoomy ? <Box flexDirection="column" rowGap={1}>{list}</Box> : list
}

/** The mine's picture, the live counter, what a click and a tool call mine, and the bonuses. */
function header(el: Elements, model: ShopModel, parts: ShopParts): RenderElement {
  const { Box, Text } = el
  const v = model.values
  return (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      {parts.header}
      <Box flexDirection="column">
        {parts.live}
        <Text dimColor>{`Click +${fmt(v.click)} · Read +${fmt(v.read)} · Edit +${fmt(v.edit)}`}</Text>
        {bonusLine(el, model)}
      </Box>
    </Box>
  )
}

/** The tabs: the one showing lit, the rest dim. The terminal draws no glyph, which an emoji font could widen. */
function tabRow(el: Elements, model: ShopModel, parts: ShopParts, act: ShopActions): RenderElement {
  const { Box, Button } = el
  return (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      {TABS.map(t => {
        const count = t.tab === 'badges' ? ` ${model.badges.earned}/${model.badges.total}` : ''
        const label = `${parts.isRoomy ? `${t.glyph} ` : ''}${t.name}${count}`
        return t.tab === model.tab ? (
          <Button key={`tab-${t.tab}`} label={label} variant="primary" onPress={() => act.tab(t.tab)} />
        ) : (
          <Button key={`tab-${t.tab}`} label={label} dimColor onPress={() => act.tab(t.tab)} />
        )
      })}
    </Box>
  )
}

/** Producers and upgrades. */
function shopTab(el: Elements, model: ShopModel, parts: ShopParts, act: ShopActions): RenderElement[] {
  const { Box, Text, Button } = el
  const amount = model.amount
  const producers = model.producers.map(item =>
    card(
      el,
      parts,
      item,
      priceButton(el, `buy-${item.id}`, `${amount === 1 ? '' : `×${item.count} `}${fmt(item.price)} ✻`, item.canBuy, () =>
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
  const notes = [...(model.more > 0 ? [`+${model.more} more on sale`] : []), ...(model.next === null ? [] : [`Next: ${model.next.name}, ${model.next.text}`])]
  return [
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Text bold>Producers</Text>
        {AMOUNTS.map(n => (
          <Button key={`amount-${n}`} label={n === 'max' ? 'Max' : `×${n}`} plain dimColor={amount !== n} onPress={() => act.amount(n)} />
        ))}
      </Box>
      {cards(el, parts, producers)}
      {teaser}
    </Box>,
    <Box flexDirection="column">
      <Text bold>Upgrades</Text>
      {upgrades.length > 0 ? cards(el, parts, upgrades) : <Text dimColor>Nothing on sale yet.</Text>}
      {notes.length > 0 ? <Text dimColor>{notes.join(' · ')}</Text> : null}
    </Box>,
  ]
}

/** The layers in sight in text: reached ones solid in their colors, the next shaded, the ones below dotted. */
function textStrata(el: Elements, model: ShopModel): RenderElement {
  const { Text } = el
  return (
    <Text>
      {model.depth.strata.map(s =>
        s.state === 'ahead' ? <Text dimColor>{'····· '}</Text> : <Text color={s.color}>{s.state === 'next' ? '░░░░░ ' : '█████ '}</Text>,
      )}
    </Text>
  )
}

/** How deep this run is and what its layers add, the new shaft, and the relics stones buy. */
function shaftTab(el: Elements, model: ShopModel, parts: ShopParts, act: ShopActions): RenderElement[] {
  const { Box, Text } = el
  const d = model.depth
  const s = model.shaft
  const r = model.relics
  const depth = (
    <Box flexDirection="column">
      {heading(el, 'Depth', d.deepest > d.metres ? `${commas(d.metres)} m · deepest ${commas(d.deepest)} m` : `${commas(d.metres)} m`)}
      {parts.pictures?.strata ?? textStrata(el, model)}
      <Text dimColor>
        <Text color={d.here.color} bold>
          {d.here.name}
        </Text>
        {d.next === null ? ' now: the deepest layer there is.' : ' now · '}
        {d.next === null ? null : (
          <Text color={d.next.color} bold>
            {d.next.name}
          </Text>
        )}
        {d.next === null ? null : ` at ${commas(d.next.from)} m: ${lower(d.next.text)}`}
      </Text>
      <Text dimColor>{d.perks.length > 0 ? `Your layers add: ${d.perks.join(' · ')}.` : 'Each layer you reach adds its perk for the rest of the run.'}</Text>
    </Box>
  )
  // The shaft pays stones, it costs none: so the card says what it finds, and
  // what there is to spend then, in the words the relics use.
  const canOpen = s.gain > 0
  const total = r.found + s.gain
  const shaft = card(
    el,
    parts,
    {
      id: 'shaft',
      icon: 'stone',
      name: canOpen ? `Open it now to find ◈ ${plural(s.gain, 'stone', 'stones')}` : `Opens at ${s.at} m`,
      detail: canOpen
        ? `Start over in fresh rock with ◈ ${commas(r.toSpend + s.gain)} to spend on relics. ${total === 1 ? 'The stone then adds' : `All ${commas(total)} stones then add`} ${s.pct}% to everything${r.found > 0 ? `, up from ${model.bonus.stonesPct}%` : ', for good'}. Badges, stats and relics stay.`
        : `A new shaft opens once this one reaches ${s.at} m, and finds more ◈ stones the deeper it gets.`,
      owned: 0,
      count: 1,
      price: 0,
      canBuy: canOpen,
    },
    priceButton(el, 'shaft', 'Open', canOpen, () => act.shaft()),
  )
  const spent = r.found - r.toSpend
  const about =
    r.found === 0
      ? 'New shafts find ◈ ancient stones to spend here. They add to everything for good, and spending them never lowers that.'
      : spent === 0
        ? `You found ${plural(r.found, 'stone', 'stones')}. ${r.found === 1 ? 'It adds' : 'They add'} ${model.bonus.stonesPct}% to everything, and spending ${r.found === 1 ? 'it' : 'them'} never lowers that.`
        : `You found ${plural(r.found, 'stone', 'stones')} and spent ${commas(spent)} on relics. All ${commas(r.found)} still add ${model.bonus.stonesPct}% to everything: spending never lowers it.`
  // The relics owned and what each does: where there is room, beside the
  // names in a column of their own; elsewhere, under each name.
  const owned =
    r.owned.length === 0 ? null : (
      <Box flexDirection="column">
        {r.owned.map(o => (
          <Box flexDirection="row" columnGap={1} alignItems="flex-start">
            <Text color="success">✓</Text>
            {parts.icon(o.icon, false, 18)}
            <Box flexDirection={parts.isRoomy ? 'row' : 'column'} columnGap={2} flexGrow={1} flexShrink={1}>
              <Box {...(parts.isRoomy ? { width: RELIC_NAME_WIDTH } : {})} flexShrink={0}>
                <Text bold>{o.name}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor>{o.text}</Text>
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
    )
  const forSale = r.forSale.map(item => card(el, parts, item, priceButton(el, `relic-${item.id}`, `◈ ${commas(item.price)}`, item.canBuy, () => act.relic(item.id as RelicId))))
  return [
    depth,
    <Box flexDirection="column">
      <Text bold>New shaft</Text>
      {shaft}
    </Box>,
    <Box flexDirection="column" rowGap={parts.isRoomy ? 1 : 0}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text bold>Relics</Text>
          <Text color="permission" bold>{`◈ ${commas(r.toSpend)} to spend`}</Text>
        </Box>
        <Text dimColor>{about}</Text>
      </Box>
      {owned}
      {forSale.length > 0 ? cards(el, parts, forSale) : <Text dimColor>Every relic is yours.</Text>}
    </Box>,
  ]
}

/** The badges in text: a line of each group, earned ones in gold. */
function textWall(el: Elements, model: ShopModel): RenderElement {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      {model.badges.groups.map(g => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={22} flexShrink={0}>
            <Text dimColor>{`${g.title} ${g.items.filter(b => b.isEarned).length}/${g.items.length}`}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={1}>
            {g.items.map(b => (b.isEarned ? <Text color={GOLD}>{`★ ${b.name}`}</Text> : <Text dimColor>{`☆ ${b.name}`}</Text>))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** How many badges are earned, the closest one to go, and every badge. */
function badgesTab(el: Elements, model: ShopModel, parts: ShopParts): (RenderElement | null)[] {
  const { Box, Text } = el
  const b = model.badges
  const next = b.next
  return [
    <Box flexDirection="column">
      {heading(el, `${b.earned} of ${b.total}`, `· each adds ${Math.round(ACHIEVEMENT_BONUS * 100)}% to everything, for good`)}
      {parts.pictures?.bar(b.earned / Math.max(1, b.total), PICTURE_GOLD) ?? <Text color={GOLD}>{textBar(b.earned, b.total, 21)}</Text>}
    </Box>,
    next === null ? null : (
      <Box
        flexDirection="row"
        columnGap={1}
        alignItems="center"
        paddingX={1}
        {...(parts.isRoomy ? { borderStyle: 'round', borderColor: 'claude' } : {})}
      >
        {parts.icon(next.icon, false)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold>{`Next: ${next.name}`}</Text>
          <Text dimColor>
            {`${next.text} · `}
            <Text color="claude">{`${textBar(next.have, next.need, 10)} ${fmt(next.have)}/${fmt(next.need)}`}</Text>
          </Text>
        </Box>
      </Box>
    ),
    parts.pictures?.badgeWall ?? textWall(el, model),
  ]
}

export function shopTree(el: Elements, model: ShopModel, parts: ShopParts, act: ShopActions): RenderElement {
  const { Box, Text } = el
  if (!model.isLoaded) return <Text dimColor>Opening the mine…</Text>
  const content =
    model.tab === 'shaft'
      ? shaftTab(el, model, parts, act)
      : model.tab === 'badges'
        ? badgesTab(el, model, parts)
        : model.tab === 'stats'
          ? [parts.stats ?? <Text dimColor>The stats show in the desktop app and the terminal.</Text>]
          : shopTab(el, model, parts, act)
  return (
    <Box flexDirection="column" rowGap={1}>
      {parts.notice}
      {header(el, model, parts)}
      {tabRow(el, model, parts, act)}
      {content}
    </Box>
  )
}
