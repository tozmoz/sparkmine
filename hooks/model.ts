// What the drawings show, computed from the save as plain data. The shop
// draws its model and the HUD its props, so neither reads the mine itself and
// neither is redrawn when nothing it shows has changed.

import type { Band, HudProps, IconId, Save, ShopModel, StatsProps, ToolKind, VeinProps, View } from '../types'
import { ACHIEVEMENT_BONUS, ACHIEVEMENTS, BIOMES, PRODUCERS, SHAFT_DEPTH, STONE_BONUS, TOOL_NAMES, type Upgrade } from './data.ts'
import { commas, fmt, fmtRate } from './format.ts'
import * as game from './game.ts'

export const SHOP_LIMIT = 8
/** The shop starts to show the new shaft this far above the depth where it opens. */
const SHAFT_LEAD = 200

const TOOL_ICONS: Readonly<Record<ToolKind, IconId>> = {
  read: 'glasses',
  edit: 'dynamite',
  bash: 'terminal',
  web: 'globe',
  mcp: 'plug',
  agent: 'crew',
  other: 'pick',
}

export function upgradeIcon(u: Upgrade): IconId {
  if (u.id === 'pick-3') return 'pickDiamond'
  if (u.id === 'pick-6') return 'pickObsidian'
  if (u.id === 'grip-1') return 'glove'
  switch (u.effect.kind) {
    case 'click':
      return 'pick'
    case 'clickRate':
      return 'bolt'
    case 'clickCrew':
      return 'whistle'
    case 'gem':
    case 'gemWorth':
      return 'gem'
    case 'producer':
      return u.effect.id
    case 'tool':
      return TOOL_ICONS[u.effect.tool]
    case 'ore':
      return 'nugget'
    case 'idle':
      return 'moon'
    case 'shift':
      return 'clock'
    case 'global':
      return 'lantern'
  }
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

export const EMPTY_SHOP: ShopModel = {
  isLoaded: false,
  amount: 1,
  producers: [],
  teaser: null,
  upgrades: [],
  more: 0,
  next: null,
  values: { click: 1, read: 1, edit: 4 },
  bonus: { stones: 0, stonesPct: 0, achievements: 0, achievementsPct: 0 },
  layers: [],
  achievements: [],
  nextAchievement: null,
  shaft: null,
}

export function shopModel(save: Save, amount: number, isLoaded: boolean): ShopModel {
  const m = game.multipliers(save)
  const top = PRODUCERS.reduce((high, p, i) => (game.owned(save, p.id) > 0 ? i : high), -1)
  const producers = PRODUCERS.slice(0, top + 2).map(p => {
    const owned = game.owned(save, p.id)
    return {
      id: p.id,
      icon: p.id,
      name: p.name,
      detail: `${fmtRate(game.unitRate(save, p.id, m))}/s each · ${p.blurb}`,
      owned,
      price: game.priceOf(p, owned, amount),
      // Lit only when the whole amount is affordable: ×100 buys a hundred or none.
      canBuy: save.sparks >= game.priceOf(p, owned, amount),
    }
  })
  const { onSale, next } = game.shopUpgrades(save)
  const upgrades = onSale.slice(0, SHOP_LIMIT).map(u => ({
    id: u.id,
    icon: upgradeIcon(u),
    name: u.name,
    detail: u.blurb,
    owned: 0,
    price: u.cost,
    canBuy: save.sparks >= u.cost,
  }))
  const nextUp: ShopModel['next'] = next === null ? null : { name: next.name, icon: upgradeIcon(next), text: unlockText(next) }
  const metres = game.depth(save)
  const here = game.biomeAt(metres)
  const won = new Set(game.achievements(save).map(a => a.id))
  const goal = game.nextAchievement(save)
  return {
    isLoaded,
    amount,
    producers,
    teaser: PRODUCERS[top + 2]?.cost ?? null,
    upgrades,
    more: Math.max(0, onSale.length - SHOP_LIMIT),
    next: nextUp,
    values: {
      click: game.clickValue(save, m),
      read: game.toolValue(save, 'read', m),
      edit: game.toolValue(save, 'edit', m),
    },
    bonus: {
      stones: save.stones,
      stonesPct: Math.round(save.stones * STONE_BONUS * 100),
      achievements: won.size,
      achievementsPct: Math.round(won.size * ACHIEVEMENT_BONUS * 100),
    },
    layers: BIOMES.map((b, i) => ({ name: b.name, from: b.from, color: b.color, text: b.text, isReached: i <= here, isHere: i === here })),
    achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, isEarned: won.has(a.id) })),
    nextAchievement: goal === null ? null : { name: goal.name, text: goal.text },
    shaft: save.shafts > 0 || metres >= SHAFT_DEPTH - SHAFT_LEAD ? { gain: game.stoneGain(save), at: SHAFT_DEPTH } : null,
  }
}

/** Where a shared card sends people. */
const HOME = 'github.com/tozmoz/sparkmine'

const plural = (n: number, one: string, many: string) => `${commas(n)} ${n === 1 ? one : many}`

/**
 * A card of the mine to paste anywhere, Wordle-style: how deep this shaft is
 * and where, the layers reached in squares of their colors, what was mined
 * and earned, and where the game is. A record not made yet is left out.
 */
export function shareCard(save: Save): string {
  const metres = game.depth(save)
  const deepest = game.deepestOf(save)
  const here = BIOMES[game.biomeAt(metres)] ?? BIOMES[0]
  const name = here?.name ?? 'Topsoil'
  const place = name.startsWith('The ') ? `at ${name.toLowerCase()}` : `in the ${name}`
  const reached = game.biomeAt(deepest)
  const squares = BIOMES.map((b, i) => (i <= reached ? b.square : '⬛')).join('')
  const stones = save.stones > 0 ? [`◈ ${plural(save.stones, 'stone', 'stones')}`] : []
  const records = [
    ...(save.bestTurn > 0 ? [`Best turn +${fmt(save.bestTurn)}`] : []),
    ...(save.gems > 0 ? [plural(save.gems, 'gem', 'gems')] : []),
    ...(save.veins > 0 ? [plural(save.veins, 'vein', 'veins')] : []),
  ]
  return [
    `⛏️ Sparkmine · ${commas(metres)} m ${place}`,
    deepest > metres ? `${squares} deepest ${commas(deepest)} m` : squares,
    [`✻ ${fmt(save.allTime)} mined`, ...stones, `★ ${game.achievements(save).length}/${ACHIEVEMENTS.length}`].join(' · '),
    ...(records.length > 0 ? [records.join(' · ')] : []),
    HOME,
  ].join('\n')
}

/** The layer a depth is in, by name and color, for the drawings. */
export function layerAt(metres: number): { name: string; color: string } {
  const b = BIOMES[game.biomeAt(metres)] ?? BIOMES[0]
  return { name: b?.name ?? 'Topsoil', color: b?.color ?? '#c8a27a' }
}

/** How long the HUD shows a reward in place of the last tool call. */
export const EVENT_SHOW_MS = 5_000

export const EMPTY_HUD: HudProps = {
  variant: 'band',
  mode: 'idle',
  surface: 'other',
  sparks: 0,
  rate: 0,
  click: 1,
  clicks: 0,
  acked: 0,
  taps: 0,
  gem: null,
  depth: 0,
  layer: { name: 'Topsoil', color: '#c8a27a' },
  event: null,
  frenzy: null,
  isCompact: false,
  idle: 0,
  turn: 0,
  lastTurn: 0,
  last: null,
  goal: null,
  tools: 0,
  turns: 0,
  height: 3,
}

export function hudProps(save: Save, view: View, band: Band, variant: HudProps['variant'], now: number): HudProps {
  const m = game.multipliers(save)
  const { next } = game.shopUpgrades(save)
  const progress = next === null ? null : game.progress(save, next)
  const metres = game.depth(save)
  const boost = view.frenzy !== null && now < view.frenzy.until ? view.frenzy : null
  return {
    variant,
    mode: band.mode,
    surface: 'other',
    sparks: save.sparks,
    rate: game.rate(save, m),
    click: game.clickValue(save, m) * (boost?.mult ?? 1),
    clicks: save.clicks,
    acked: 0,
    taps: 0,
    gem: view.gem ?? null,
    depth: metres,
    layer: layerAt(metres),
    event: view.event !== null && now - view.event.at < EVENT_SHOW_MS ? { label: view.event.label, value: view.event.value } : null,
    frenzy: boost === null ? null : { mult: boost.mult, left: Math.ceil((boost.until - now) / 1000) },
    isCompact: band.isCompact,
    idle: m.idle,
    turn: Math.max(0, save.lifetime - view.turnStart),
    lastTurn: view.lastTurn,
    last: view.last === null ? null : `${view.last.label} +${fmt(view.last.value)} ✻`,
    goal:
      next === null || progress === null
        ? null
        : { name: next.name, have: Math.min(progress.have, progress.need), need: progress.need },
    tools: save.tools,
    turns: save.turns,
    height: EMPTY_HUD.height,
  }
}

/** What the vein Client draws: the vein showing now, or the frenzy it started. */
export function veinProps(view: View, now: number, surface: VeinProps['surface']): VeinProps {
  const vein = view.vein !== null && now <= view.vein.until ? view.vein : null
  const frenzy = view.frenzy !== null && now < view.frenzy.until ? view.frenzy : null
  return {
    vein: vein === null ? null : { id: vein.id, kind: vein.kind, left: Math.ceil((vein.until - now) / 1000) },
    frenzy: frenzy === null ? null : { mult: frenzy.mult, left: Math.ceil((frenzy.until - now) / 1000) },
    surface,
  }
}

/** What the shop's stats Client draws, all time. */
export function statsProps(save: Save): StatsProps {
  return {
    bySource: save.bySource,
    bestTurn: save.bestTurn,
    deepest: game.deepestOf(save),
    shafts: save.shafts,
    bestStreak: save.bestStreak,
    gems: save.gems,
    veins: save.veins,
    events: save.events,
    clicks: save.clicks,
    tools: save.tools,
    turns: save.turns,
  }
}

export const EMPTY_STATS: StatsProps = { bySource: {}, bestTurn: 0, deepest: 0, shafts: 0, bestStreak: 0, gems: 0, veins: 0, events: {}, clicks: 0, tools: 0, turns: 0 }
