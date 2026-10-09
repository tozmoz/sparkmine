// Everything the shop sells, and the numbers behind it.

import type { EventKind, ProducerId, ToolKind } from '../types'

export type Producer = {
  id: ProducerId
  name: string
  plural: string
  blurb: string
  /** Price of the first one; each next one costs GROWTH times more. */
  cost: number
  /** Sparks per second each one mines while Claude works. */
  rate: number
}

export const GROWTH = 1.17

export const PRODUCERS: readonly Producer[] = [
  { id: 'apprentice', name: 'Apprentice', plural: 'Apprentices', blurb: 'Swings a tiny pick when nobody is looking.', cost: 15, rate: 0.05 },
  { id: 'cart', name: 'Mine cart', plural: 'Mine carts', blurb: 'Rolls loose ore up to the surface.', cost: 110, rate: 0.5 },
  { id: 'goblin', name: 'Grep goblin', plural: 'Grep goblins', blurb: 'Finds veins by pattern.', cost: 1_200, rate: 4 },
  { id: 'drill', name: 'Steam drill', plural: 'Steam drills', blurb: 'Loud, hot and very persuasive.', cost: 13_000, rate: 23.5 },
  { id: 'crew', name: 'Subagent crew', plural: 'Subagent crews', blurb: 'Digs five tunnels in parallel.', cost: 140_000, rate: 130 },
  { id: 'cache', name: 'Cache vein', plural: 'Cache veins', blurb: 'Ore you already mined, mined again.', cost: 1_500_000, rate: 700 },
  { id: 'refinery', name: 'Token refinery', plural: 'Token refineries', blurb: 'Smelts raw tokens into sparks.', cost: 21_000_000, rate: 3_900 },
  { id: 'core', name: 'Context core', plural: 'Context cores', blurb: 'A million tokens of solid ore.', cost: 340_000_000, rate: 22_000 },
]

/** Sparks one tool call mines before any upgrade. */
export const TOOL_BASE: Readonly<Record<ToolKind, number>> = {
  read: 1,
  edit: 4,
  bash: 2,
  web: 3,
  agent: 8,
  mcp: 2,
  other: 1,
}

export const TOOL_NAMES: Readonly<Record<ToolKind, string>> = {
  read: 'Read, Grep and Glob',
  edit: 'Edit and Write',
  bash: 'Bash',
  web: 'Web',
  agent: 'Agent',
  mcp: 'MCP',
  other: 'Other',
}

export type Effect =
  | { kind: 'click'; mult: number }
  /** Each click also mines this percent of the per-second rate. */
  | { kind: 'clickRate'; pct: number }
  /** Each click also mines this many sparks for every producer owned. */
  | { kind: 'clickCrew'; per: number }
  /** Adds this chance that a click strikes a gem. */
  | { kind: 'gem'; chance: number }
  /** Gems are worth this many times more. */
  | { kind: 'gemWorth'; mult: number }
  | { kind: 'producer'; id: ProducerId; mult: number }
  | { kind: 'tool'; tool: ToolKind; mult: number }
  /** Each tool call also mines this many seconds of the rate. */
  | { kind: 'ore'; seconds: number }
  /** The share of the rate the crew mines while Claude is idle. */
  | { kind: 'idle'; share: number }
  /** Each finished turn mines this many seconds of the rate. */
  | { kind: 'shift'; seconds: number }
  | { kind: 'global'; mult: number }

export type Unlock =
  | { kind: 'clicks'; n: number }
  | { kind: 'tools'; n: number }
  | { kind: 'turns'; n: number }
  | { kind: 'mined'; tool: ToolKind; n: number }
  | { kind: 'owned'; id: ProducerId; n: number }
  | { kind: 'crew'; n: number }
  | { kind: 'earned'; n: number }

/** What a gem is worth, in clicks, before any upgrade. */
export const GEM_WORTH = 10

export type Upgrade = {
  id: string
  name: string
  blurb: string
  cost: number
  effect: Effect
  unlock: Unlock
  /** The cheaper upgrade that does just the same: this one goes on sale once that is bought. */
  after?: string
}

const TIERS = [
  { at: 1, times: 10 },
  { at: 5, times: 50 },
  { at: 25, times: 500 },
  { at: 50, times: 50_000 },
] as const

const TIER_NAMES: Readonly<Record<ProducerId, readonly [string, string, string, string]>> = {
  apprentice: ['Hard hats', 'Coffee rations', 'Union contract', 'Guild charter'],
  cart: ['Greased axles', 'Double rails', 'Express track', 'Maglev carts'],
  goblin: ['Regex lessons', 'Case folding', 'Multiline mode', 'Ripgrep blood'],
  drill: ['Tungsten bits', 'Pressure valves', 'Twin turbines', 'Diamond crowns'],
  crew: ['Shared context', 'Worktrees', 'Background agents', 'Swarm protocol'],
  cache: ['Warm cache', 'Longer TTL', 'Prefix reuse', 'Perfect hit rate'],
  refinery: ['Better tokenizer', 'Batch smelting', 'Speculative pours', 'Distillation'],
  core: ['Long context', 'Auto compaction', 'Memory files', 'Total recall'],
}

const producerUpgrades: Upgrade[] = PRODUCERS.flatMap(p =>
  TIERS.map((tier, i) => ({
    id: `${p.id}-${i + 1}`,
    name: TIER_NAMES[p.id][i] ?? `${p.name} ${i + 1}`,
    blurb: i === 0 ? `${p.plural} mine 50% more.` : `${p.plural} mine 50% more again.`,
    cost: p.cost * tier.times,
    effect: { kind: 'producer', id: p.id, mult: 1.5 },
    unlock: { kind: 'owned', id: p.id, n: tier.at },
  })),
)

const otherUpgrades: Upgrade[] = [
  { id: 'pick-1', name: 'Sharpened pick', blurb: 'Clicks mine twice as much.', cost: 100, effect: { kind: 'click', mult: 2 }, unlock: { kind: 'clicks', n: 25 } },
  { id: 'pick-2', name: 'Steel pick', blurb: 'Clicks mine twice as much again.', cost: 500, effect: { kind: 'click', mult: 2 }, unlock: { kind: 'clicks', n: 100 } },
  { id: 'grip-1', name: 'Work gloves', blurb: 'Clicks mine twice as much again.', cost: 3_000, effect: { kind: 'click', mult: 2 }, unlock: { kind: 'clicks', n: 250 } },
  { id: 'pick-3', name: 'Diamond pick', blurb: 'Clicks mine twice as much again.', cost: 10_000, effect: { kind: 'click', mult: 2 }, unlock: { kind: 'clicks', n: 500 } },
  { id: 'pick-4', name: 'Muscle memory', blurb: 'Each click also mines 1% of your rate.', cost: 50_000, effect: { kind: 'clickRate', pct: 1 }, unlock: { kind: 'clicks', n: 1_000 } },
  { id: 'pick-5', name: 'Deep strike', blurb: 'Each click mines another 2% of your rate.', cost: 5_000_000, effect: { kind: 'clickRate', pct: 2 }, unlock: { kind: 'clicks', n: 3_000 } },
  { id: 'pick-6', name: 'Obsidian edge', blurb: 'Clicks mine twice as much again.', cost: 500_000_000, effect: { kind: 'click', mult: 2 }, unlock: { kind: 'clicks', n: 10_000 } },
  { id: 'strike-1', name: 'Seismic tap', blurb: 'Each click mines another 3% of your rate.', cost: 50_000_000, effect: { kind: 'clickRate', pct: 3 }, unlock: { kind: 'clicks', n: 6_000 } },
  { id: 'strike-2', name: 'Fault line', blurb: 'Each click mines another 5% of your rate.', cost: 10_000_000_000, effect: { kind: 'clickRate', pct: 5 }, unlock: { kind: 'clicks', n: 15_000 } },

  // The crew cheers you on: clicks grow with every producer owned.
  { id: 'foreman-1', name: "Foreman's whistle", blurb: 'Each click also mines 0.2 for every producer you own.', cost: 10_000, effect: { kind: 'clickCrew', per: 0.2 }, unlock: { kind: 'crew', n: 25 } },
  { id: 'foreman-2', name: 'Work song', blurb: 'Each click mines another 1 per producer.', cost: 500_000, effect: { kind: 'clickCrew', per: 1 }, unlock: { kind: 'crew', n: 80 } },
  { id: 'foreman-3', name: 'Drill sergeant', blurb: 'Each click mines another 5 per producer.', cost: 50_000_000, effect: { kind: 'clickCrew', per: 5 }, unlock: { kind: 'crew', n: 160 } },
  { id: 'foreman-4', name: 'Hive mind', blurb: 'Each click mines another 30 per producer.', cost: 10_000_000_000, effect: { kind: 'clickCrew', per: 30 }, unlock: { kind: 'crew', n: 300 } },

  // Now and then a click strikes a gem, worth many clicks at once.
  { id: 'gem-1', name: "Prospector's luck", blurb: `1 click in 25 strikes a gem worth ${GEM_WORTH} clicks.`, cost: 25_000, effect: { kind: 'gem', chance: 0.04 }, unlock: { kind: 'clicks', n: 1_500 } },
  { id: 'gem-2', name: "Jeweler's loupe", blurb: 'Gems are worth twice as much.', cost: 5_000_000, effect: { kind: 'gemWorth', mult: 2 }, unlock: { kind: 'clicks', n: 4_000 } },
  { id: 'gem-3', name: 'Geode sense', blurb: 'Gems turn up twice as often.', cost: 1_000_000_000, effect: { kind: 'gem', chance: 0.04 }, unlock: { kind: 'clicks', n: 8_000 } },

  { id: 'tool-read', name: 'Reading glasses', blurb: 'Read, Grep and Glob calls mine 3x.', cost: 300, effect: { kind: 'tool', tool: 'read', mult: 3 }, unlock: { kind: 'mined', tool: 'read', n: 50 } },
  { id: 'tool-bash', name: 'Blasting caps', blurb: 'Bash calls mine 3x.', cost: 1_500, effect: { kind: 'tool', tool: 'bash', mult: 3 }, unlock: { kind: 'mined', tool: 'bash', n: 25 } },
  { id: 'tool-edit', name: 'Edit dynamite', blurb: 'Edit and Write calls mine 3x.', cost: 2_000, effect: { kind: 'tool', tool: 'edit', mult: 3 }, unlock: { kind: 'mined', tool: 'edit', n: 25 } },
  { id: 'tool-web', name: 'Surface survey', blurb: 'Web calls mine 3x.', cost: 3_000, effect: { kind: 'tool', tool: 'web', mult: 3 }, unlock: { kind: 'mined', tool: 'web', n: 10 } },
  { id: 'tool-mcp', name: 'MCP adapters', blurb: 'MCP tool calls mine 3x.', cost: 5_000, effect: { kind: 'tool', tool: 'mcp', mult: 3 }, unlock: { kind: 'mined', tool: 'mcp', n: 10 } },
  { id: 'tool-agent', name: 'Subagent swarm', blurb: 'Agent calls mine 3x.', cost: 8_000, effect: { kind: 'tool', tool: 'agent', mult: 3 }, unlock: { kind: 'mined', tool: 'agent', n: 5 } },
  { id: 'ore-1', name: 'Ore sense', blurb: 'Every tool call also mines 5s of your rate.', cost: 25_000, effect: { kind: 'ore', seconds: 5 }, unlock: { kind: 'tools', n: 200 } },
  { id: 'ore-2', name: 'Mother lode', blurb: 'Every tool call mines another 15s of your rate.', cost: 2_500_000, effect: { kind: 'ore', seconds: 15 }, unlock: { kind: 'tools', n: 1_000 } },

  { id: 'idle-1', name: 'Night shift', blurb: 'Your crew mines at 10% while Claude is idle.', cost: 10_000, effect: { kind: 'idle', share: 0.1 }, unlock: { kind: 'crew', n: 10 } },
  { id: 'idle-2', name: 'Graveyard shift', blurb: 'Your idle crew mines at 25%.', cost: 1_000_000, effect: { kind: 'idle', share: 0.25 }, unlock: { kind: 'crew', n: 50 } },
  { id: 'idle-3', name: 'Automation', blurb: 'Your idle crew mines at 50%.', cost: 1_000_000_000, effect: { kind: 'idle', share: 0.5 }, unlock: { kind: 'crew', n: 200 } },
  { id: 'shift-1', name: 'Overtime pay', blurb: 'Each finished turn pays 10s of your rate.', cost: 50_000, effect: { kind: 'shift', seconds: 10 }, unlock: { kind: 'turns', n: 50 } },
  { id: 'shift-2', name: 'Hazard pay', blurb: 'Each finished turn pays another 30s.', cost: 5_000_000, effect: { kind: 'shift', seconds: 30 }, unlock: { kind: 'turns', n: 250 } },

  { id: 'lamp-1', name: 'Brighter lanterns', blurb: 'Everything mines 10% more.', cost: 250_000, effect: { kind: 'global', mult: 1.1 }, unlock: { kind: 'earned', n: 1_000_000 } },
  { id: 'lamp-2', name: 'Canary in the mine', blurb: 'Everything mines 15% more.', cost: 25_000_000, effect: { kind: 'global', mult: 1.15 }, unlock: { kind: 'earned', n: 100_000_000 } },
]

/**
 * Upgrades that do just the same form a line, cheapest first: a producer's
 * tiers, the click doublers, the gem chances. Each goes on sale once the one
 * before it is bought, so the shop never offers the same thing at two prices.
 */
function inLines(list: Upgrade[]): Upgrade[] {
  const last = new Map<string, string>()
  return [...list]
    .sort((a, b) => a.cost - b.cost)
    .map(u => {
      const line = JSON.stringify(u.effect)
      const after = last.get(line)
      last.set(line, u.id)
      return after === undefined ? u : { ...u, after }
    })
}

export const UPGRADES: readonly Upgrade[] = inLines([...otherUpgrades, ...producerUpgrades])

/** Each ancient stone adds this share to everything the mine earns, for good. */
export const STONE_BONUS = 0.1
/** A new shaft pays the cube root of the run's sparks over this, in ancient stones. */
export const STONE_UNIT = 1_000_000
/** How deep a run must reach before a new shaft can be opened, in metres: the magma. */
export const SHAFT_DEPTH = 500

/**
 * What Claude's own work pays, once a turn each: seconds of the crew's rate,
 * and never less than this many clicks, so it counts before the crew does.
 */
export const EVENTS: Readonly<Record<EventKind, { label: string; seconds: number; clicks: number }>> = {
  tests: { label: 'Tests pass', seconds: 30, clicks: 10 },
  commit: { label: 'Commit', seconds: 45, clicks: 20 },
  longShift: { label: 'Long shift', seconds: 90, clicks: 30 },
}

/** A turn at least this long pays the long-shift reward when it ends. */
export const LONG_SHIFT_MS = 5 * 60_000

/** Veins: how long one shows, the seconds of work before one shows, and what one pays. */
export const VEIN = {
  showMs: 10_000,
  first: { min: 90, spread: 90 },
  next: { min: 300, spread: 300 },
  richSeconds: 120,
  richClicks: 30,
  frenzyMult: 5,
  frenzyMs: 30_000,
} as const

/** What reaching a layer adds for the rest of the run. */
export type Perk =
  | { kind: 'none' }
  | { kind: 'click'; mult: number }
  /** Adds this chance that a click strikes a gem. */
  | { kind: 'gem'; chance: number }
  /** Veins show this many times as often. */
  | { kind: 'veins'; speed: number }
  /** The idle crew mines this many times as much. */
  | { kind: 'idle'; mult: number }
  /** Work events pay this many times as much. */
  | { kind: 'events'; mult: number }
  | { kind: 'global'; mult: number }

export type Biome = { name: string; from: number; color: string; perk: Perk; text: string }

/**
 * The layers the mine digs through, from the depth where each starts, in
 * metres. A layer's perk holds from the moment the mine reaches it until the
 * run ends, so the deeper a run gets, the more of them it has.
 */
export const BIOMES: readonly Biome[] = [
  { name: 'Topsoil', from: 0, color: '#c8a27a', perk: { kind: 'none' }, text: 'Where every mine begins.' },
  { name: 'Stone', from: 100, color: '#9aa3ad', perk: { kind: 'click', mult: 1.5 }, text: 'Clicks mine 50% more.' },
  { name: 'Crystal caves', from: 300, color: '#b6a6ff', perk: { kind: 'gem', chance: 0.02 }, text: 'Each click gets another 2% chance of a gem.' },
  { name: 'Magma', from: 500, color: '#ff7a2f', perk: { kind: 'veins', speed: 2 }, text: 'Veins show twice as often.' },
  { name: 'Groundwater', from: 700, color: '#4fb3d9', perk: { kind: 'idle', mult: 1.25 }, text: 'The idle crew mines 25% more.' },
  { name: 'Ancient ruins', from: 850, color: '#d9b45f', perk: { kind: 'events', mult: 2 }, text: 'Tests, commits and long shifts pay double.' },
  { name: 'The core', from: 1_000, color: '#ffe9a8', perk: { kind: 'global', mult: 1.25 }, text: 'Everything mines 25% more.' },
]

/** What an achievement counts: a record of the save, or how often a work event paid. */
export type Goal =
  | { kind: 'veins' | 'gems' | 'clicks' | 'tools' | 'shafts' | 'stones' | 'bestTurn' | 'allTime' | 'deepest'; n: number }
  | { kind: 'event'; event: EventKind; n: number }

export type Achievement = { id: string; name: string; text: string; goal: Goal }

/** Each achievement adds this share to everything the mine earns, for good. */
export const ACHIEVEMENT_BONUS = 0.02

/** Records worth a badge. Each counts what a save keeps through a new shaft, so none is ever lost. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-vein', name: 'First vein', text: 'Catch a vein.', goal: { kind: 'veins', n: 1 } },
  { id: 'vein-hunter', name: 'Vein hunter', text: 'Catch 25 veins.', goal: { kind: 'veins', n: 25 } },
  { id: 'hard-rock', name: 'Hard rock', text: 'Dig down to the stone, 100 m.', goal: { kind: 'deepest', n: 100 } },
  { id: 'crystal-caves', name: 'Crystal caves', text: 'Reach the crystal caves, 300 m.', goal: { kind: 'deepest', n: 300 } },
  { id: 'magma', name: 'Into the magma', text: 'Reach the magma, 500 m.', goal: { kind: 'deepest', n: 500 } },
  { id: 'groundwater', name: 'Underground river', text: 'Reach the groundwater, 700 m.', goal: { kind: 'deepest', n: 700 } },
  { id: 'ruins', name: 'Lost ruins', text: 'Reach the ancient ruins, 850 m.', goal: { kind: 'deepest', n: 850 } },
  { id: 'core', name: 'The core', text: 'Reach the core, 1,000 m.', goal: { kind: 'deepest', n: 1_000 } },
  { id: 'tests-100', name: 'Green streak', text: 'Pass the tests 100 times.', goal: { kind: 'event', event: 'tests', n: 100 } },
  { id: 'commits-100', name: 'Ship it', text: 'Commit 100 times.', goal: { kind: 'event', event: 'commit', n: 100 } },
  { id: 'long-shifts-10', name: 'Night owl', text: 'Work 10 long shifts.', goal: { kind: 'event', event: 'longShift', n: 10 } },
  { id: 'turn-1m', name: 'Big turn', text: 'Mine 1M sparks in one turn.', goal: { kind: 'bestTurn', n: 1e6 } },
  { id: 'turn-1b', name: 'Legendary turn', text: 'Mine 1B sparks in one turn.', goal: { kind: 'bestTurn', n: 1e9 } },
  { id: 'clicks-10k', name: 'Calloused hands', text: 'Click 10,000 times.', goal: { kind: 'clicks', n: 10_000 } },
  { id: 'gems-100', name: 'Jeweler', text: 'Strike 100 gems.', goal: { kind: 'gems', n: 100 } },
  { id: 'tools-1k', name: 'Busy Claude', text: 'Mine 1,000 tool calls.', goal: { kind: 'tools', n: 1_000 } },
  { id: 'shaft', name: 'Fresh rock', text: 'Open a new shaft.', goal: { kind: 'shafts', n: 1 } },
  { id: 'stones-25', name: 'Stone collector', text: 'Hold 25 ancient stones.', goal: { kind: 'stones', n: 25 } },
  { id: 'billion', name: 'Billionaire', text: 'Mine 1B sparks in all.', goal: { kind: 'allTime', n: 1e9 } },
  { id: 'trillion', name: 'Trillionaire', text: 'Mine 1T sparks in all.', goal: { kind: 'allTime', n: 1e12 } },
]

/** Spinner words, unlocked by all-time sparks. */
export const REWARDS: readonly { at: number; word: string }[] = [
  { at: 1_000, word: 'Mining' },
  { at: 100_000, word: 'Tunneling' },
  { at: 10_000_000, word: 'Prospecting' },
  { at: 1_000_000_000, word: 'Smelting' },
  { at: 100_000_000_000, word: 'Excavating' },
]
