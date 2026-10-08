// The economy, as pure functions over plain data. No `$` in here, so the
// rules can be tested on their own and shared by every drawing.

import type { Counts, Delta, Mine, ProducerId, Save, ToolKind } from '../types'
import {
  CRYSTAL_BONUS,
  CRYSTAL_UNIT,
  GEM_WORTH,
  GROWTH,
  PRODUCERS,
  REWARDS,
  TOOL_BASE,
  UPGRADES,
  type Producer,
  type Unlock,
  type Upgrade,
} from './data.ts'

export const TOOL_KINDS: readonly ToolKind[] = ['read', 'edit', 'bash', 'web', 'agent', 'mcp', 'other']

export function fresh(runId: string): Save {
  return {
    v: 1,
    runId,
    sparks: 0,
    lifetime: 0,
    allTime: 0,
    crystals: 0,
    clicks: 0,
    tools: 0,
    turns: 0,
    mined: {},
    producers: {},
    upgrades: [],
  }
}

export function emptyDelta(runId: string): Delta {
  return { runId, sparks: 0, earned: 0, clicks: 0, tools: 0, turns: 0, mined: {}, producers: {}, upgrades: [] }
}

export function newMine(runId: string): Mine {
  return { save: fresh(runId), pending: emptyDelta(runId), isLoaded: false }
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

function counts<K extends string>(value: unknown, keys: readonly K[]): Counts<K> {
  const out: Counts<K> = {}
  if (value === null || typeof value !== 'object') return out
  for (const key of keys) {
    const n = num((value as Record<string, unknown>)[key])
    if (n > 0) out[key] = Math.floor(n)
  }
  return out
}

const PRODUCER_IDS = PRODUCERS.map(p => p.id)
const UPGRADE_IDS = new Set(UPGRADES.map(u => u.id))

/** A save read back from the store, checked field by field; null when it is not one. */
export function normalize(raw: unknown): Save | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || typeof r.runId !== 'string') return null
  return {
    v: 1,
    runId: r.runId,
    sparks: num(r.sparks),
    lifetime: num(r.lifetime),
    allTime: num(r.allTime),
    crystals: Math.floor(num(r.crystals)),
    clicks: Math.floor(num(r.clicks)),
    tools: Math.floor(num(r.tools)),
    turns: Math.floor(num(r.turns)),
    mined: counts(r.mined, TOOL_KINDS),
    producers: counts(r.producers, PRODUCER_IDS),
    upgrades: Array.isArray(r.upgrades)
      ? [...new Set(r.upgrades.filter((id): id is string => typeof id === 'string' && UPGRADE_IDS.has(id)))]
      : [],
  }
}

export function classifyTool(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp'
  switch (name) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'LS':
    case 'NotebookRead':
      return 'read'
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit'
    case 'Bash':
    case 'BashOutput':
    case 'PowerShell':
      return 'bash'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    case 'Agent':
    case 'Task':
      return 'agent'
    default:
      return 'other'
  }
}

export const owned = (save: Save, id: ProducerId): number => save.producers[id] ?? 0

export const crewSize = (save: Save): number =>
  PRODUCERS.reduce((sum, p) => sum + owned(save, p.id), 0)

/** The price of the next `n` of a producer when `have` are owned. */
export function priceOf(producer: Producer, have: number, n = 1): number {
  let total = 0
  for (let i = 0; i < n; i += 1) total += Math.ceil(producer.cost * GROWTH ** (have + i))
  return total
}

export function producer(id: ProducerId): Producer {
  const found = PRODUCERS.find(p => p.id === id)
  if (found === undefined) throw new Error(`no producer ${id}`)
  return found
}

export const upgrade = (id: string): Upgrade | undefined => UPGRADES.find(u => u.id === id)

export type Multipliers = {
  global: number
  click: number
  clickRate: number
  /** Sparks a click adds for every producer owned. */
  clickCrew: number
  /** The chance a click strikes a gem, and how many clicks a gem is worth. */
  gemChance: number
  gemWorth: number
  producer: Record<ProducerId, number>
  tool: Record<ToolKind, number>
  ore: number
  idle: number
  shift: number
}

export function multipliers(save: Save): Multipliers {
  const m: Multipliers = {
    global: 1 + CRYSTAL_BONUS * save.crystals,
    click: 1,
    clickRate: 0,
    clickCrew: 0,
    gemChance: 0,
    gemWorth: GEM_WORTH,
    producer: Object.fromEntries(PRODUCERS.map(p => [p.id, 1])) as Record<ProducerId, number>,
    tool: Object.fromEntries(TOOL_KINDS.map(k => [k, 1])) as Record<ToolKind, number>,
    ore: 0,
    idle: 0,
    shift: 0,
  }
  for (const id of save.upgrades) {
    const effect = upgrade(id)?.effect
    if (effect === undefined) continue
    switch (effect.kind) {
      case 'click':
        m.click *= effect.mult
        break
      case 'clickRate':
        m.clickRate += effect.pct / 100
        break
      case 'clickCrew':
        m.clickCrew += effect.per
        break
      case 'gem':
        m.gemChance += effect.chance
        break
      case 'gemWorth':
        m.gemWorth *= effect.mult
        break
      case 'producer':
        m.producer[effect.id] *= effect.mult
        break
      case 'tool':
        m.tool[effect.tool] *= effect.mult
        break
      case 'ore':
        m.ore += effect.seconds
        break
      case 'idle':
        m.idle = Math.max(m.idle, effect.share)
        break
      case 'shift':
        m.shift += effect.seconds
        break
      case 'global':
        m.global *= effect.mult
        break
    }
  }
  return m
}

/** Sparks per second one of this producer mines while Claude works. */
export function unitRate(save: Save, id: ProducerId, m = multipliers(save)): number {
  return producer(id).rate * m.producer[id] * m.global
}

/** Sparks per second the whole crew mines while Claude works. */
export function rate(save: Save, m = multipliers(save)): number {
  return PRODUCERS.reduce((sum, p) => sum + owned(save, p.id) * unitRate(save, p.id, m), 0)
}

/** What one click mines, gems aside. The crew's share is not doubled by the picks. */
export function clickValue(save: Save, m = multipliers(save)): number {
  return (m.click + m.clickCrew * crewSize(save)) * m.global + rate(save, m) * m.clickRate
}

function mix(h: number): number {
  let x = h
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}

/**
 * Where the next click lands in [0, 1). The run and the click count decide it,
 * so a save always strikes the same gems and nothing rerolls a miss.
 */
export function clickRoll(save: Save): number {
  let seed = 2166136261
  for (let i = 0; i < save.runId.length; i += 1) seed = Math.imul(seed ^ save.runId.charCodeAt(i), 16777619)
  return mix(seed ^ Math.imul(save.clicks + 1, 0x9e3779b9)) / 2 ** 32
}

/** What the next click mines, and whether it strikes a gem. */
export function strike(save: Save, m = multipliers(save)): { value: number; isGem: boolean } {
  const value = clickValue(save, m)
  const isGem = m.gemChance > 0 && clickRoll(save) < m.gemChance
  return { value: isGem ? value * m.gemWorth : value, isGem }
}

export function toolValue(save: Save, kind: ToolKind, m = multipliers(save)): number {
  return TOOL_BASE[kind] * m.tool[kind] * m.global + rate(save, m) * m.ore
}

export function shiftValue(save: Save, m = multipliers(save)): number {
  return rate(save, m) * m.shift
}

export const idleShare = (save: Save): number => multipliers(save).idle

function have(save: Save, unlock: Unlock): number {
  switch (unlock.kind) {
    case 'clicks':
      return save.clicks
    case 'tools':
      return save.tools
    case 'turns':
      return save.turns
    case 'mined':
      return save.mined[unlock.tool] ?? 0
    case 'owned':
      return owned(save, unlock.id)
    case 'crew':
      return crewSize(save)
    case 'earned':
      return save.allTime
  }
}

export function progress(save: Save, u: Upgrade): { have: number; need: number } {
  return { have: have(save, u.unlock), need: u.unlock.n }
}

export const isUnlocked = (save: Save, u: Upgrade): boolean => have(save, u.unlock) >= u.unlock.n

export const hasUpgrade = (save: Save, id: string): boolean => save.upgrades.includes(id)

/** The pick upgrades, in the order the miner's pick gets better. */
export const PICK_TIERS = ['pick-1', 'pick-2', 'pick-3', 'pick-6'] as const

/** Which pick the miner holds: 0 for the worn iron one he starts with. */
export function pickTier(save: Save): number {
  let tier = 0
  PICK_TIERS.forEach((id, i) => {
    if (hasUpgrade(save, id)) tier = Math.max(tier, i + 1)
  })
  return tier
}

/** What the shop lists: the upgrades on sale, cheapest first, and the next one to unlock. */
export function shopUpgrades(save: Save): { onSale: Upgrade[]; next: Upgrade | null } {
  const left = UPGRADES.filter(u => !hasUpgrade(save, u.id))
  const onSale = left.filter(u => isUnlocked(save, u))
  const locked = left.filter(u => !isUnlocked(save, u))
  locked.sort((a, b) => {
    const pa = progress(save, a)
    const pb = progress(save, b)
    return pb.have / pb.need - pa.have / pa.need || a.cost - b.cost
  })
  return { onSale, next: locked[0] ?? null }
}

/** How many crystals collapsing the mine now would add. */
export function crystalGain(save: Save): number {
  return Math.max(0, Math.floor(Math.cbrt(save.allTime / CRYSTAL_UNIT)) - save.crystals)
}

export function rewardWord(allTime: number): string | null {
  let word: string | null = null
  for (const reward of REWARDS) if (allTime >= reward.at) word = reward.word
  return word
}

function add<K extends string>(into: Counts<K>, from: Counts<K>): Counts<K> {
  const out: Counts<K> = { ...into }
  for (const key of Object.keys(from) as K[]) out[key] = (out[key] ?? 0) + (from[key] ?? 0)
  return out
}

export type Source =
  | { kind: 'click' }
  | { kind: 'tool'; tool: ToolKind }
  | { kind: 'turn' }
  | { kind: 'crew' }

/** Adds sparks to the mine, and counts what earned them. */
export function earn(mine: Mine, amount: number, source: Source): Mine {
  const gain = Number.isFinite(amount) && amount > 0 ? amount : 0
  const s = mine.save
  const d = mine.pending
  const clicks = source.kind === 'click' ? 1 : 0
  const tools = source.kind === 'tool' ? 1 : 0
  const turns = source.kind === 'turn' ? 1 : 0
  const mined: Counts<ToolKind> = source.kind === 'tool' ? { [source.tool]: 1 } : {}
  return {
    ...mine,
    save: {
      ...s,
      sparks: s.sparks + gain,
      lifetime: s.lifetime + gain,
      allTime: s.allTime + gain,
      clicks: s.clicks + clicks,
      tools: s.tools + tools,
      turns: s.turns + turns,
      mined: add(s.mined, mined),
    },
    pending: {
      ...d,
      sparks: d.sparks + gain,
      earned: d.earned + gain,
      clicks: d.clicks + clicks,
      tools: d.tools + tools,
      turns: d.turns + turns,
      mined: add(d.mined, mined),
    },
  }
}

export function buyProducer(mine: Mine, id: ProducerId, n: number): Mine | null {
  const count = Math.max(1, Math.floor(n))
  const price = priceOf(producer(id), owned(mine.save, id), count)
  if (mine.save.sparks < price) return null
  return {
    ...mine,
    save: {
      ...mine.save,
      sparks: mine.save.sparks - price,
      producers: add(mine.save.producers, { [id]: count }),
    },
    pending: {
      ...mine.pending,
      sparks: mine.pending.sparks - price,
      producers: add(mine.pending.producers, { [id]: count }),
    },
  }
}

/** How many of a producer the sparks on hand buy, up to `limit`. */
export function affordable(save: Save, id: ProducerId, limit: number): number {
  const p = producer(id)
  let n = 0
  let spent = 0
  while (n < limit) {
    const next = Math.ceil(p.cost * GROWTH ** (owned(save, id) + n))
    if (spent + next > save.sparks) break
    spent += next
    n += 1
  }
  return n
}

export function buyUpgrade(mine: Mine, id: string): Mine | null {
  const u = upgrade(id)
  if (u === undefined || hasUpgrade(mine.save, id) || !isUnlocked(mine.save, u)) return null
  if (mine.save.sparks < u.cost) return null
  return {
    ...mine,
    save: { ...mine.save, sparks: mine.save.sparks - u.cost, upgrades: [...mine.save.upgrades, id] },
    pending: {
      ...mine.pending,
      sparks: mine.pending.sparks - u.cost,
      upgrades: [...mine.pending.upgrades, id],
    },
  }
}

/**
 * Prestige: the mine collapses. Sparks, producers and upgrades go; crystals,
 * all-time sparks and the counters stay. Null while it would add no crystal.
 */
export function collapse(save: Save, runId: string): Save | null {
  const gain = crystalGain(save)
  if (gain < 1) return null
  return {
    ...fresh(runId),
    allTime: save.allTime,
    crystals: save.crystals + gain,
    clicks: save.clicks,
    tools: save.tools,
    turns: save.turns,
    mined: save.mined,
  }
}

/**
 * Lays one session's changes over the save in the store. Several sessions
 * can mine at once, so each keeps what it changed and adds it on sync, rather
 * than writing its own copy over theirs.
 */
export function applyDelta(stored: Save, d: Delta): Save {
  const sameRun = stored.runId === d.runId
  return {
    ...stored,
    sparks: sameRun ? Math.max(0, stored.sparks + d.sparks) : stored.sparks + d.earned,
    lifetime: stored.lifetime + d.earned,
    allTime: stored.allTime + d.earned,
    clicks: stored.clicks + d.clicks,
    tools: stored.tools + d.tools,
    turns: stored.turns + d.turns,
    mined: add(stored.mined, d.mined),
    producers: sameRun ? add(stored.producers, d.producers) : stored.producers,
    upgrades: sameRun ? [...new Set([...stored.upgrades, ...d.upgrades])] : stored.upgrades,
  }
}

export const isEmptyDelta = (d: Delta): boolean =>
  d.sparks === 0 &&
  d.earned === 0 &&
  d.clicks === 0 &&
  d.tools === 0 &&
  d.turns === 0 &&
  Object.keys(d.mined).length === 0 &&
  Object.keys(d.producers).length === 0 &&
  d.upgrades.length === 0
