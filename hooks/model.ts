// What the drawings show, computed from the save as plain data. The shop
// draws its model and the HUD its props, so neither reads the mine itself and
// neither is redrawn when nothing it shows has changed.

import type { Amount, Badge, BadgeArt, Band, EventKind, HudProps, IconId, Save, ShopModel, ShopTab, StatsProps, ToolKind, VeinProps, View } from '../types'
import { ACHIEVEMENT_BONUS, ACHIEVEMENTS, BIOMES, FINDS, PRODUCERS, RELICS, SHAFT_DEPTH, TOOL_NAMES, type Achievement, type Goal, type Upgrade } from './data.ts'
import { commas, fmt, fmtRate, fmtSpan, plural } from './format.ts'
import * as game from './game.ts'

export const SHOP_LIMIT = 8
/** The topsoil's color, where a layer is missing. */
const TOPSOIL = '#b8804f'

const TOOL_ICONS: Readonly<Record<ToolKind, IconId>> = {
  read: 'glasses',
  edit: 'dynamite',
  bash: 'terminal',
  web: 'globe',
  mcp: 'plug',
  agent: 'crew',
  other: 'pick',
}

/** The icon of an upgrade that makes work events pay more, by the first event it names. */
const EVENT_ICONS: Readonly<Record<EventKind, IconId>> = {
  tests: 'check',
  fix: 'check',
  build: 'terminal',
  lint: 'terminal',
  commit: 'clock',
  pr: 'glasses',
  merge: 'glasses',
  longShift: 'clock',
  streak: 'clock',
}

export function upgradeIcon(u: Upgrade): IconId {
  if (u.id === 'pick-3') return 'pickDiamond'
  if (u.id === 'pick-6') return 'pickObsidian'
  if (u.id === 'grip-1') return 'glove'
  switch (u.effect.kind) {
    case 'click':
    case 'clickAll':
      return 'pick'
    case 'clickRate':
      return 'bolt'
    case 'clickCrew':
    case 'clickCrewRate':
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
    case 'events':
      return EVENT_ICONS[u.effect.events[0] ?? 'tests']
    case 'veinSpeed':
      return 'rod'
    case 'frenzy':
      return 'nugget'
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
    case 'veins':
      return `after ${n} veins caught`
    case 'events':
      return `after ${n} ${u.unlock.label}`
  }
}

/** When the next upgrade goes on sale: at its unlock, or once this run has mined enough for its price. */
function nextText(save: Save, u: Upgrade): string {
  const p = game.progress(save, u)
  return p.isSparks === true ? `once this shaft has mined ${fmt(p.need)} ✻` : unlockText(u)
}

export const EMPTY_SHOP: ShopModel = {
  isLoaded: false,
  tab: 'shop',
  amount: 1,
  producers: [],
  teaser: null,
  upgrades: [],
  more: 0,
  next: null,
  values: { click: 1, read: 1, edit: 4 },
  bonus: { stones: 0, stonesPct: 0, achievements: 0, achievementsPct: 0 },
  depth: { metres: 0, deepest: 0, strata: [], here: { name: 'Topsoil', color: TOPSOIL }, next: null, perks: [] },
  shaft: { gain: 0, at: SHAFT_DEPTH, pct: 0 },
  relics: { found: 0, toSpend: 0, owned: [], forSale: [] },
  badges: { earned: 0, total: ACHIEVEMENTS.length, pct: 0, next: null, groups: [] },
}

/** The shaft tab's top: the layers in sight, the one the mine is in, the next, and what the reached ones add. */
function depthOf(save: Save): ShopModel['depth'] {
  const metres = game.depth(save)
  const here = game.biomeAt(metres)
  const stateOf = (i: number): ShopModel['depth']['strata'][number]['state'] =>
    i < here ? 'reached' : i === here ? 'here' : i === here + 1 ? 'next' : 'ahead'
  // A hidden layer comes in sight once the mine is a layer above it.
  const strata = BIOMES.flatMap((b, i) => (b.isHidden === true && i > here + 1 ? [] : [{ name: b.name, color: b.color, state: stateOf(i) }]))
  const at = BIOMES[here] ?? BIOMES[0]
  const below = BIOMES[here + 1]
  return {
    metres,
    deepest: game.deepestOf(save),
    strata,
    here: { name: at?.name ?? 'Topsoil', color: at?.color ?? TOPSOIL },
    next: below === undefined ? null : { name: below.name, color: below.color, from: below.from, text: below.text },
    perks: BIOMES.slice(0, here + 1).flatMap(b => (b.short === '' ? [] : [b.short])),
  }
}

/** Stones found and still to spend, and the relics: owned with what each does, and for sale at their price in stones. */
function relicsOf(save: Save): ShopModel['relics'] {
  const toSpend = game.stonesToSpend(save)
  return {
    found: save.stones,
    toSpend,
    owned: game.ownedRelics(save).map(r => ({ id: r.id, name: r.name, icon: r.icon, text: r.blurb })),
    forSale: RELICS.filter(r => !game.hasRelic(save, r.id)).map(r => ({
      id: r.id,
      icon: r.icon,
      name: r.name,
      detail: r.blurb,
      owned: 0,
      count: 1,
      price: r.cost,
      canBuy: toSpend >= r.cost,
    })),
  }
}

/** The badge wall's groups, by what each badge counts, in the order they show. */
const BADGE_GROUPS: readonly { title: string; kinds: readonly Goal['kind'][] }[] = [
  { title: 'Depth', kinds: ['deepest'] },
  { title: 'Veins and gems', kinds: ['veins', 'gems'] },
  { title: 'Records', kinds: ['clicks', 'tools', 'allTime'] },
  { title: "Claude's work", kinds: ['event', 'bestStreak', 'bestTurn'] },
  { title: 'Shafts and stones', kinds: ['shafts', 'stones'] },
  { title: 'Secrets', kinds: ['secret'] },
]

/** Each badge's own picture, none like another's; a depth badge is a lump of its layer's rock instead. */
const BADGE_ICONS: Readonly<Record<string, IconId>> = {
  'first-vein': 'nugget',
  'vein-hunter': 'ore',
  'veins-100': 'bars',
  'gems-100': 'gem',
  'gems-1k': 'crown',
  'clicks-10k': 'glove',
  'tools-1k': 'terminal',
  billion: 'coins',
  trillion: 'chest',
  'tests-100': 'check',
  'commits-100': 'ship',
  'long-shifts-10': 'owl',
  'fixes-25': 'bug',
  'merges-10': 'train',
  'streak-10': 'flame',
  'streak-25': 'bolt',
  'turn-1m': 'clock',
  'turn-1b': 'trophy',
  shaft: 'pick',
  'shafts-5': 'pickDiamond',
  'shafts-10': 'pickObsidian',
  'stones-25': 'stone',
  'stones-100': 'henge',
  'stones-500': 'pyramid',
  'absolutely-right': 'speech',
  'good-manners': 'apprentice',
  'deep-thinker': 'lantern',
  groundbreaking: 'shovel',
  'friday-deploy': 'rocket',
  'midnight-oil': 'moon',
  fossil: 'fossil',
  'rubber-duck': 'duck',
  pharaoh: 'mask',
}

/** A badge's picture: a lump of its layer's rock for a depth, else its own icon. */
export function badgeArt(a: Achievement): BadgeArt {
  if (a.goal.kind === 'deepest') return { kind: 'rock', color: BIOMES[game.biomeAt(a.goal.n)]?.color ?? TOPSOIL }
  return { kind: 'icon', id: BADGE_ICONS[a.id] ?? 'badge' }
}

/** Every badge by group, how many are earned, and the closest unearned one. A surprise shows nothing of itself until earned. */
function badgesOf(save: Save, won: ReadonlySet<string>): ShopModel['badges'] {
  const badge = (a: Achievement): Badge => {
    const isEarned = won.has(a.id)
    const isSurprise = !isEarned && game.isSurprise(a)
    return {
      id: a.id,
      name: isSurprise ? '???' : a.name,
      text: isSurprise ? '???' : a.text,
      art: isSurprise ? { kind: 'icon', id: 'locked' } : badgeArt(a),
      isEarned,
      isSurprise,
    }
  }
  const goal = game.nextAchievement(save)
  const art = goal === null ? null : badgeArt(goal)
  return {
    earned: won.size,
    total: ACHIEVEMENTS.length,
    pct: Math.round(won.size * ACHIEVEMENT_BONUS * 100),
    next:
      goal === null || art === null
        ? null
        : { name: goal.name, text: goal.text, icon: art.kind === 'icon' ? art.id : 'stone', ...game.achievementProgress(save, goal) },
    groups: BADGE_GROUPS.map(g => ({ title: g.title, items: ACHIEVEMENTS.filter(a => g.kinds.includes(a.goal.kind)).map(badge) })),
  }
}

/** How soon a purchase pays for itself, in words. */
function paysBack(back: game.Payback): string {
  const count = (one: string, many: string) => plural(Math.ceil(back.n), one, many)
  switch (back.per) {
    case 'work':
      return `pays back in ${fmtSpan(back.n)} of work`
    case 'click':
      return `pays back in ${count('click', 'clicks')}`
    case 'call':
      return `pays back in ${count('call', 'calls')}`
    case 'turn':
      return `pays back in ${count('turn', 'turns')}`
    case 'idle':
      return `pays back in ${fmtSpan(back.n)} idle`
  }
}

export function shopModel(save: Save, amount: Amount, tab: ShopTab, isLoaded: boolean): ShopModel {
  const m = game.multipliers(save)
  const each = game.unitRates(save, m)
  const top = PRODUCERS.reduce((high, p, i) => (game.owned(save, p.id) > 0 ? i : high), -1)
  const producers = PRODUCERS.slice(0, top + 2).map(p => {
    const owned = game.owned(save, p.id)
    const count = amount === 'max' ? game.maxCount(p, owned, save.sparks) : amount
    const price = game.priceOf(p, owned, count)
    const back = game.producerPayback(save, p.id, count, m)
    // Once its share of the producers above outgrows its own rate, the card says where the rest comes from.
    const from = each[p.id] >= 2 * game.ownRate(p, m) ? ', mostly from the producers above' : ''
    return {
      id: p.id,
      icon: p.id,
      name: p.name,
      detail: `${fmtRate(each[p.id])}/s each${from}${back === null ? '' : `, ${paysBack(back)}`} · ${p.blurb}`,
      owned,
      count,
      price,
      // Lit only when the whole count is affordable: ×10 buys ten or none.
      canBuy: save.sparks >= price,
    }
  })
  const { onSale, next } = game.shopUpgrades(save)
  const upgrades = onSale.slice(0, SHOP_LIMIT).map(u => {
    const back = game.upgradePayback(save, u, m)
    const words = back === null ? '' : paysBack(back)
    return {
      id: u.id,
      icon: upgradeIcon(u),
      name: u.name,
      detail: words === '' ? u.blurb : `${u.blurb} ${words.charAt(0).toUpperCase()}${words.slice(1)}.`,
      owned: 0,
      count: 1,
      price: u.cost,
      canBuy: save.sparks >= u.cost,
    }
  })
  const nextUp: ShopModel['next'] = next === null ? null : { name: next.name, icon: upgradeIcon(next), text: nextText(save, next) }
  const won = new Set(game.achievements(save).map(a => a.id))
  const gain = game.stoneGain(save)
  return {
    isLoaded,
    tab,
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
      stonesPct: Math.round(game.stoneBonus(save.stones) * 100),
      achievements: won.size,
      achievementsPct: Math.round(won.size * ACHIEVEMENT_BONUS * 100),
    },
    depth: depthOf(save),
    shaft: { gain, at: SHAFT_DEPTH, pct: Math.round(game.stoneBonus(save.stones + gain) * 100) },
    relics: relicsOf(save),
    badges: badgesOf(save, won),
  }
}

/** Where a shared card sends people. */
const HOME = 'github.com/tozmoz/sparkmine'

/**
 * A card of the mine to paste anywhere, Wordle-style: how deep this shaft is
 * and where, the layers reached in squares of their colors, what was mined
 * and earned, and where the game is. A record not made yet is left out, and a
 * hidden layer not reached yet has no square, so a card spoils no one's surprise.
 */
export function shareCard(save: Save): string {
  const metres = game.depth(save)
  const deepest = game.deepestOf(save)
  const here = BIOMES[game.biomeAt(metres)] ?? BIOMES[0]
  const name = here?.name ?? 'Topsoil'
  const place = here?.place ?? (name.startsWith('The ') ? `at ${name.toLowerCase()}` : `in the ${name}`)
  const reached = game.biomeAt(deepest)
  const squares = BIOMES.flatMap((b, i) => (i <= reached ? [b.square] : b.isHidden === true ? [] : ['⬛'])).join('')
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
  return { name: b?.name ?? 'Topsoil', color: b?.color ?? TOPSOIL }
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
  layer: { name: 'Topsoil', color: TOPSOIL },
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
  nap: null,
  height: 3,
  at: 0,
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
        : { name: next.name, have: Math.min(progress.have, progress.need), need: progress.need, ...(progress.isSparks === true ? { isSparks: true as const } : {}) },
    tools: save.tools,
    turns: save.turns,
    nap: band.nap,
    height: EMPTY_HUD.height,
    at: now,
  }
}

/** What the vein Client draws: the vein showing now, or the frenzy it started. */
export function veinProps(view: View, now: number, surface: VeinProps['surface']): VeinProps {
  const vein = view.vein !== null && now <= view.vein.until ? view.vein : null
  const frenzy = view.frenzy !== null && now < view.frenzy.until ? view.frenzy : null
  return {
    vein:
      vein === null
        ? null
        : { id: vein.id, kind: vein.kind, left: Math.ceil((vein.until - now) / 1000), label: vein.find === undefined ? 'Vein!' : FINDS[vein.find].label },
    frenzy: frenzy === null ? null : { mult: frenzy.mult, left: Math.ceil((frenzy.until - now) / 1000) },
    surface,
  }
}

/**
 * An answer to a HUD's poll, given its last: one that says what the last said
 * keeps the last one's time, so the surface finds the props unchanged and
 * draws nothing, and an idle band costs no redraws.
 */
export function answerOf<P extends { at: number }>(last: P | undefined, props: P): P {
  return last !== undefined && JSON.stringify({ ...last, at: 0 }) === JSON.stringify({ ...props, at: 0 }) ? { ...props, at: last.at } : props
}

/** What the shop's stats Client draws, all time. */
export function statsProps(save: Save, surface: StatsProps['surface']): StatsProps {
  return {
    surface,
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

export const EMPTY_STATS: StatsProps = { surface: 'other', bySource: {}, bestTurn: 0, deepest: 0, shafts: 0, bestStreak: 0, gems: 0, veins: 0, events: {}, clicks: 0, tools: 0, turns: 0 }
