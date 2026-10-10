// The economy, as pure functions over plain data. No `$` in here, so the
// rules can be tested on their own and shared by every drawing.

import type { Counts, Delta, EventKind, IdleSpan, Mine, ProducerId, Save, SourceKind, ToolKind, VeinKind } from '../types'
import {
  ACHIEVEMENT_BONUS,
  ACHIEVEMENTS,
  BIOMES,
  EVENTS,
  GEM_WORTH,
  GROWTH,
  PRODUCERS,
  REWARDS,
  SHAFT_DEPTH,
  STONE_BONUS,
  STONE_POWER,
  STONE_UNIT,
  TOOL_BASE,
  UPGRADES,
  VEIN,
  type Achievement,
  type Goal,
  type Producer,
  type Unlock,
  type Upgrade,
} from './data.ts'

export const TOOL_KINDS: readonly ToolKind[] = ['read', 'edit', 'bash', 'web', 'agent', 'mcp', 'other']
export const SOURCE_KINDS: readonly SourceKind[] = ['crew', 'click', 'tool', 'turn', 'event', 'vein']
export const EVENT_KINDS: readonly EventKind[] = ['tests', 'fix', 'build', 'lint', 'commit', 'pr', 'merge', 'longShift', 'streak']

export function fresh(runId: string): Save {
  return {
    v: 1,
    runId,
    sparks: 0,
    lifetime: 0,
    allTime: 0,
    stones: 0,
    deepest: 0,
    shafts: 0,
    clicks: 0,
    tools: 0,
    turns: 0,
    mined: {},
    producers: {},
    upgrades: [],
    bySource: {},
    bestTurn: 0,
    bestStreak: 0,
    gems: 0,
    veins: 0,
    events: {},
    idleAt: 0,
    writes: {},
    chain: '',
  }
}

export function emptyDelta(runId: string): Delta {
  return {
    runId,
    sparks: 0,
    earned: 0,
    clicks: 0,
    tools: 0,
    turns: 0,
    mined: {},
    producers: {},
    upgrades: [],
    bySource: {},
    bestTurn: 0,
    bestStreak: 0,
    gems: 0,
    veins: 0,
    events: {},
    idle: null,
  }
}

export function newMine(runId: string): Mine {
  return { save: fresh(runId), pending: emptyDelta(runId), isLoaded: false, writer: '', seq: 0, chain: '', inflight: [] }
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

/** The all-time stats a save or a delta carries, read field by field. */
function stats(r: Record<string, unknown>) {
  return {
    bySource: counts(r.bySource, SOURCE_KINDS),
    bestTurn: num(r.bestTurn),
    bestStreak: Math.floor(num(r.bestStreak)),
    gems: Math.floor(num(r.gems)),
    veins: Math.floor(num(r.veins)),
    events: counts(r.events, EVENT_KINDS),
  }
}

/** Sessions whose last write a save remembers: the newest this many. */
const MAX_WRITERS = 32

/** Each session's last write a save holds, read entry by entry, the newest kept. */
function writes(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(([, seq]) => num(seq) > 0)
  return Object.fromEntries(entries.slice(-MAX_WRITERS).map(([id, seq]) => [id, Math.floor(num(seq))]))
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
    // Crystals were the stones of the collapse a new shaft replaced.
    stones: Math.floor(num(r.stones ?? r.crystals)),
    deepest: Math.round(num(r.deepest)),
    shafts: Math.floor(num(r.shafts)),
    clicks: Math.floor(num(r.clicks)),
    tools: Math.floor(num(r.tools)),
    turns: Math.floor(num(r.turns)),
    mined: counts(r.mined, TOOL_KINDS),
    producers: counts(r.producers, PRODUCER_IDS),
    upgrades: Array.isArray(r.upgrades)
      ? [...new Set(r.upgrades.filter((id): id is string => typeof id === 'string' && UPGRADE_IDS.has(id)))]
      : [],
    ...stats(r),
    idleAt: num(r.idleAt),
    writes: writes(r.writes),
    chain: typeof r.chain === 'string' ? r.chain : '',
  }
}

/** A delta's idle span read back; null where it has none, as one kept from before an update. */
function idleSpan(value: unknown): IdleSpan | null {
  if (value === null || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const span = { amount: num(r.amount), from: num(r.from), to: num(r.to) }
  return span.amount > 0 && span.to >= span.from ? span : null
}

/**
 * The session's mine with every field a newer version reads: a mine kept in
 * the session's state from before an update lacks the stats and the sync's fields.
 */
export function normalizeMine(mine: Mine): Mine {
  const save = normalize(mine.save) ?? fresh('unloaded')
  const delta = (d: Delta): Delta => ({ ...emptyDelta(save.runId), ...d, ...stats(d as unknown as Record<string, unknown>), idle: idleSpan(d.idle) })
  return {
    save,
    pending: delta(mine.pending),
    isLoaded: mine.isLoaded,
    writer: typeof mine.writer === 'string' ? mine.writer : '',
    seq: Math.floor(num(mine.seq)),
    chain: typeof mine.chain === 'string' ? mine.chain : '',
    inflight: Array.isArray(mine.inflight) ? mine.inflight.map(delta) : [],
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

/** How many of a producer `sparks` buys, when `have` are owned: none when it is short of one. */
export function affordable(p: Producer, have: number, sparks: number): number {
  if (!(sparks >= priceOf(p, have))) return 0
  // The sum of the prices without their rounding up says nearly how many; the rounding is checked one by one.
  let n = Math.max(1, Math.floor(Math.log(1 + (sparks * (GROWTH - 1)) / (p.cost * GROWTH ** have)) / Math.log(GROWTH)))
  while (n > 1 && priceOf(p, have, n) > sparks) n -= 1
  while (priceOf(p, have, n + 1) <= sparks) n += 1
  return n
}

/**
 * What a press of Max buys: as many as `sparks` buys, rounded down to a step
 * (every count to nine, then fives, twenty-fives and hundreds), so its label
 * changes now and then rather than with every spark; one when none fits, so
 * the button still says what one costs.
 */
export function maxCount(p: Producer, have: number, sparks: number): number {
  const n = affordable(p, have, sparks)
  if (n < 10) return Math.max(1, n)
  if (n < 50) return Math.floor(n / 5) * 5
  if (n < 300) return Math.floor(n / 25) * 25
  return Math.floor(n / 100) * 100
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
  /** From the layers: how much more often veins show, what the idle crew and work events add. */
  veinSpeed: number
  idleMult: number
  events: number
  /** From the upgrades: what each work event pays more, and how much longer a frenzy lasts. */
  event: Record<EventKind, number>
  frenzyTime: number
  /** What a new shaft pays, from the layers: the far side pays more stones. */
  stones: number
}

/** What ancient stones add to everything, as a share: each next one adds a little less. */
export const stoneBonus = (stones: number): number => STONE_BONUS * Math.max(0, stones) ** STONE_POWER

export function multipliers(save: Save): Multipliers {
  const m: Multipliers = {
    global: (1 + stoneBonus(save.stones)) * (1 + ACHIEVEMENT_BONUS * achievements(save).length),
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
    veinSpeed: 1,
    idleMult: 1,
    events: 1,
    event: Object.fromEntries(EVENT_KINDS.map(k => [k, 1])) as Record<EventKind, number>,
    frenzyTime: 1,
    stones: 1,
  }
  // Every layer this run reached adds its perk.
  for (const biome of BIOMES.slice(0, biomeAt(depth(save)) + 1)) {
    const perk = biome.perk
    switch (perk.kind) {
      case 'none':
        break
      case 'click':
        m.click *= perk.mult
        break
      case 'gem':
        m.gemChance += perk.chance
        break
      case 'veins':
        m.veinSpeed *= perk.speed
        break
      case 'idle':
        m.idleMult *= perk.mult
        break
      case 'events':
        m.events *= perk.mult
        break
      case 'global':
        m.global *= perk.mult
        break
      case 'gemWorth':
        m.gemWorth *= perk.mult
        break
      case 'tools':
        for (const kind of TOOL_KINDS) m.tool[kind] *= perk.mult
        break
      case 'stones':
        m.stones *= perk.mult
        break
    }
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
      case 'events':
        for (const kind of effect.events) m.event[kind] *= effect.mult
        break
      case 'veinSpeed':
        m.veinSpeed *= effect.mult
        break
      case 'frenzy':
        m.frenzyTime *= effect.mult
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

/** A roll in [0, 1) for the run and a label: the same save always rolls the same. */
export function roll(runId: string, label: string): number {
  let seed = 2166136261
  for (const ch of `${runId}:${label}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619)
  return mix(seed) / 2 ** 32
}

/** How deep the mine is, in metres: a hundred more for every tenfold of this run's sparks. */
export const depth = (save: Save): number => Math.round(100 * Math.log10(1 + save.lifetime / 1_000))

/** The layer a depth is in, an index of BIOMES: 0 topsoil, 1 stone, ... 9 the far side. */
export function biomeAt(metres: number): number {
  let biome = 0
  BIOMES.forEach((b, i) => {
    if (metres >= b.from) biome = i
  })
  return biome
}

/** What a work event pays: seconds of the crew's rate, and never less than its clicks. */
export function eventValue(save: Save, kind: EventKind, m = multipliers(save)): number {
  const e = EVENTS[kind]
  return Math.max(rate(save, m) * e.seconds, clickValue(save, m) * e.clicks) * m.events * m.event[kind]
}

/** What a rich vein pays. */
export function veinValue(save: Save, m = multipliers(save)): number {
  return Math.max(rate(save, m) * VEIN.richSeconds, clickValue(save, m) * VEIN.richClicks)
}

/**
 * Seconds of work before the `n`th vein of a session shows, and what kind it
 * is; `speed` times as often in the magma and below.
 */
export function veinAfter(runId: string, n: number, speed = 1): { seconds: number; kind: VeinKind } {
  const wait = n === 0 ? VEIN.first : VEIN.next
  return {
    seconds: Math.round((wait.min + Math.floor(wait.spread * roll(runId, `vein-${n}`))) / speed),
    kind: roll(runId, `vein-kind-${n}`) < 0.5 ? 'rich' : 'frenzy',
  }
}

/** A test runner at the head of one step of a shell command. */
const TEST_RUNNERS: readonly RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
  /^(npx|bunx|pnpm\s+(exec|dlx)|yarn\s+dlx)\s+(vitest|jest|mocha|ava|playwright\s+test)\b/,
  /^(\.\/node_modules\/\.bin\/)?(vitest|jest|mocha|ava|pytest|rspec|phpunit|ctest)\b/,
  /^(go|cargo|deno|swift|dotnet|mix|flutter)\s+test\b/,
  /^cargo\s+nextest\b/,
  /^make\s+(test|check)\b/,
  /^python3?\s+-m\s+(pytest|unittest)\b/,
  /^(\.\/)?(mvnw?|gradlew?)\b.*\btest\b/,
  /^\S+\s+plugin\s+test\b/,
]

/** A build at the head of one step: a package's build script, a compiler, a bundler. */
const BUILDERS: readonly RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/,
  /^(npx\s+|bunx\s+|pnpm\s+exec\s+)?(vite|next|nuxt|astro|parcel|svelte-kit)\s+build\b/,
  /^(npx\s+|bunx\s+|pnpm\s+exec\s+)?(webpack|rollup|esbuild|tsup)\b/,
  /^(npx\s+|bunx\s+|pnpm\s+exec\s+)?tsc\b(?!.*--noEmit)/,
  /^(cargo|go|swift|dotnet|zig)\s+build\b/,
  /^make(\s+(build|all))?$/,
  /^(\.\/)?(mvnw?|gradlew?)\b.*\b(compile|package|build|assemble)\b/,
  /^(xcodebuild|bazel\s+build|cmake\s+--build|ninja)\b/,
  /^python3?\s+-m\s+build\b/,
]

/** A linter or a type check at the head of one step. */
const LINTERS: readonly RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|typecheck|type-check)\b/,
  /^(npx\s+|bunx\s+|pnpm\s+exec\s+)?(eslint|oxlint|stylelint|biome\s+(check|lint)|prettier\s+(--check|-c))\b/,
  /^(npx\s+|bunx\s+|pnpm\s+exec\s+)?tsc\b.*--noEmit\b/,
  /^(python3?\s+-m\s+)?(ruff\s+check|flake8|pylint|mypy|pyright|black\s+--check)\b/,
  /^(golangci-lint|staticcheck|go\s+vet)\b/,
  /^cargo\s+(clippy|fmt\s+--check)\b/,
  /^(rubocop|swiftlint|ktlint|shellcheck|hadolint)\b/,
  /^\S+\s+plugin\s+validate\b/,
]

/** A pull request opened, and one merged; `--auto` only asks to merge it later. */
const OPENS_PR: readonly RegExp[] = [/^gh\s+pr\s+create\b/]
const MERGES_PR: readonly RegExp[] = [/^gh\s+pr\s+merge\b(?!.*--auto)/]

/** Each step of a shell command, with the variables set before it dropped. */
const steps = (command: string): string[] =>
  command.split(/&&|\|\||;|\||\n/).map(step => step.trim().replace(/^(\w+=\S*\s+)+/, ''))

const runs = (command: string, heads: readonly RegExp[]): boolean => steps(command).some(step => heads.some(re => re.test(step)))

/** Whether a shell command runs a test suite, in any step of it. */
export const isTestCommand = (command: string): boolean => runs(command, TEST_RUNNERS)

/**
 * What a finished tool call tells about Claude's work, as plain data the hooks
 * read off it. `output` is the end of what a shell command printed.
 */
export type ToolOutcome = { tool: string; command?: string; isError: boolean; interrupted: boolean; background: boolean; committed: boolean; output?: string }

/** How much of a command's output is read: a test run's summary comes last. */
const OUTPUT_TAIL = 8_000

/** Reads a finished call's input and result as a ToolOutcome: nothing in either is changed. */
export function outcomeOf(tool: string, input: unknown, answer: { isError?: unknown; result?: unknown }): ToolOutcome {
  const args = (input ?? {}) as { command?: unknown; run_in_background?: unknown }
  const record = (answer.result ?? {}) as { interrupted?: unknown; backgroundTaskId?: unknown; stdout?: unknown; stderr?: unknown; gitOperation?: { commit?: { kind?: unknown } } }
  const tail = (text: unknown) => (typeof text === 'string' ? text.slice(-OUTPUT_TAIL) : '')
  const output = `${tail(record.stdout)}\n${tail(record.stderr)}`.trim()
  return {
    tool,
    ...(typeof args.command === 'string' ? { command: args.command } : {}),
    isError: answer.isError === true,
    interrupted: record.interrupted === true,
    background: args.run_in_background === true || typeof record.backgroundTaskId === 'string',
    committed: record.gitOperation?.commit?.kind === 'committed',
    ...(output === '' ? {} : { output }),
  }
}

/**
 * What test runners print when tests fail. A command whose last step is not
 * the runner (`npm test 2>&1 | tail`, `npm test; echo done`) succeeds even when
 * they did, so the output says it: mocha's "2 failing", jest's and pytest's
 * "1 failed", rspec's "3 failures", jest's and go's FAIL lines, cargo's
 * "test result: FAILED", unittest's "FAILED (failures=1)", TAP's "not ok".
 */
const FAILED: readonly RegExp[] = [
  /\b[1-9]\d* (failed|failing|failures?)\b/i,
  /^\s*(FAIL|FAILED)\b/m,
  /^--- FAIL\b/m,
  /\btest result: FAILED\b/,
  /\bFAILED \((failures|errors)=/,
  /^not ok \d+/m,
  /^# fail [1-9]/m,
]

/**
 * The work events a finished Bash call is, when it succeeded: tests, a build
 * and a lint that passed, a commit, a pull request opened or merged. One
 * command can be several (`npm run build && npm test`).
 */
export function workEvents(o: ToolOutcome): EventKind[] {
  if (o.tool !== 'Bash' || o.isError || o.interrupted || o.background) return []
  const command = o.command ?? ''
  const events: EventKind[] = []
  if (testRun(o) === 'passed') events.push('tests')
  if (runs(command, BUILDERS)) events.push('build')
  if (runs(command, LINTERS)) events.push('lint')
  if (o.committed) events.push('commit')
  if (runs(command, OPENS_PR)) events.push('pr')
  if (runs(command, MERGES_PR)) events.push('merge')
  return events
}

/**
 * How a finished Bash call ran the tests, if it did: failed when the call
 * failed or its output says tests failed. A run cut short or sent to the
 * background tells nothing.
 */
export function testRun(o: ToolOutcome): 'passed' | 'failed' | null {
  if (o.tool !== 'Bash' || o.interrupted || o.background || o.command === undefined || !isTestCommand(o.command)) return null
  return o.isError || FAILED.some(re => re.test(o.output ?? '')) ? 'failed' : 'passed'
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

export function idleShare(save: Save): number {
  const m = multipliers(save)
  return Math.min(1, m.idle * m.idleMult)
}

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
    case 'veins':
      return save.veins
    case 'events':
      return unlock.events.reduce((sum, kind) => sum + (save.events[kind] ?? 0), 0)
  }
}

export function progress(save: Save, u: Upgrade): { have: number; need: number } {
  return { have: have(save, u.unlock), need: u.unlock.n }
}

/** Whether the upgrade's own unlock is reached: so many clicks, producers, sparks. */
const isReached = (save: Save, u: Upgrade): boolean => have(save, u.unlock) >= u.unlock.n

/** Whether the cheaper upgrade that does the same is bought, when there is one. */
const isInTurn = (save: Save, u: Upgrade): boolean => u.after === undefined || save.upgrades.includes(u.after)

export const isUnlocked = (save: Save, u: Upgrade): boolean => isInTurn(save, u) && isReached(save, u)

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
  // The next goal is short of its unlock, and next in its line or behind one on sale now.
  const locked = left.filter(u => !isReached(save, u) && (isInTurn(save, u) || onSale.some(o => o.id === u.after)))
  locked.sort((a, b) => {
    const pa = progress(save, a)
    const pb = progress(save, b)
    return pb.have / pb.need - pa.have / pa.need || a.cost - b.cost
  })
  return { onSale, next: locked[0] ?? null }
}

/** The deepest any run reached, this one included, in metres. */
export const deepestOf = (save: Save): number => Math.max(save.deepest, depth(save))

/** How many ancient stones a new shaft would pay now: none until the run reaches SHAFT_DEPTH. */
export function stoneGain(save: Save): number {
  return depth(save) < SHAFT_DEPTH ? 0 : Math.floor(Math.cbrt(save.lifetime / STONE_UNIT) * multipliers(save).stones)
}

/** How far a save has come toward a goal: the record or count it measures. */
function reached(save: Save, goal: Goal): number {
  switch (goal.kind) {
    case 'veins':
      return save.veins
    case 'gems':
      return save.gems
    case 'clicks':
      return save.clicks
    case 'tools':
      return save.tools
    case 'shafts':
      return save.shafts
    case 'stones':
      return save.stones
    case 'bestTurn':
      return save.bestTurn
    case 'bestStreak':
      return save.bestStreak
    case 'allTime':
      return save.allTime
    case 'deepest':
      return deepestOf(save)
    case 'event':
      return save.events[goal.event] ?? 0
  }
}

export const isEarned = (save: Save, a: Achievement): boolean => reached(save, a.goal) >= a.goal.n

/**
 * The achievements a save has earned. Each counts a record that only grows and
 * survives a new shaft, so they are read off the save and never stored.
 */
export const achievements = (save: Save): Achievement[] => ACHIEVEMENTS.filter(a => isEarned(save, a))

/** The unearned achievement closest to done, by share of its goal. */
export function nextAchievement(save: Save): Achievement | null {
  let best: { a: Achievement; share: number } | null = null
  for (const a of ACHIEVEMENTS) {
    if (isEarned(save, a)) continue
    const share = reached(save, a.goal) / a.goal.n
    if (best === null || share > best.share) best = { a, share }
  }
  return best?.a ?? null
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
  | { kind: 'click'; isGem?: boolean }
  | { kind: 'tool'; tool: ToolKind }
  | { kind: 'turn' }
  | { kind: 'crew' }
  | { kind: 'event'; event: EventKind }
  | { kind: 'vein' }

/** Adds sparks to the mine, and counts what earned them. */
export function earn(mine: Mine, amount: number, source: Source): Mine {
  const gain = Number.isFinite(amount) && amount > 0 ? amount : 0
  const s = mine.save
  const d = mine.pending
  const clicks = source.kind === 'click' ? 1 : 0
  const tools = source.kind === 'tool' ? 1 : 0
  const turns = source.kind === 'turn' ? 1 : 0
  const gems = source.kind === 'click' && source.isGem === true ? 1 : 0
  const veins = source.kind === 'vein' ? 1 : 0
  const mined: Counts<ToolKind> = source.kind === 'tool' ? { [source.tool]: 1 } : {}
  const bySource: Counts<SourceKind> = gain > 0 ? { [source.kind]: gain } : {}
  const events: Counts<EventKind> = source.kind === 'event' ? { [source.event]: 1 } : {}
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
      bySource: add(s.bySource, bySource),
      gems: s.gems + gems,
      veins: s.veins + veins,
      events: add(s.events, events),
    },
    pending: {
      ...d,
      sparks: d.sparks + gain,
      earned: d.earned + gain,
      clicks: d.clicks + clicks,
      tools: d.tools + tools,
      turns: d.turns + turns,
      mined: add(d.mined, mined),
      bySource: add(d.bySource, bySource),
      gems: d.gems + gems,
      veins: d.veins + veins,
      events: add(d.events, events),
    },
  }
}

/**
 * The crew's pay for the moments from `from` to `to`. Its idle pace is the
 * mine's: every open session mines it, so each one's counter runs smoothly, and
 * the moments it spans go with it, so the save takes it once. What a session
 * adds on top is its own: Claude's work lifting the crew to its full rate, a
 * frenzy multiplying it.
 */
export function payCrew(mine: Mine, idle: number, more: number, from: number, to: number): Mine {
  const paid = earn(mine, idle + more, { kind: 'crew' })
  if (!(idle > 0) || !(to >= from)) return paid
  const span = paid.pending.idle
  const next: IdleSpan =
    span === null ? { amount: idle, from, to } : { amount: span.amount + idle, from: Math.min(span.from, from), to: Math.max(span.to, to) }
  return { ...paid, pending: { ...paid.pending, idle: next } }
}

/** Keeps the best turn yet, in the save and in what the next sync carries. */
export function recordTurn(mine: Mine, earned: number): Mine {
  if (!(earned > mine.save.bestTurn)) return mine
  return { ...mine, save: { ...mine.save, bestTurn: earned }, pending: { ...mine.pending, bestTurn: Math.max(mine.pending.bestTurn, earned) } }
}

/** Keeps the longest streak of good turns yet, in the save and in what the next sync carries. */
export function recordStreak(mine: Mine, streak: number): Mine {
  if (!(streak > mine.save.bestStreak)) return mine
  return { ...mine, save: { ...mine.save, bestStreak: streak }, pending: { ...mine.pending, bestStreak: Math.max(mine.pending.bestStreak, streak) } }
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
 * Prestige: a new shaft in fresh rock. Sparks, producers, upgrades and depth
 * go; ancient stones, all-time sparks, the records and the counters stay.
 * Null until the run is deep enough to pay a stone.
 */
export function openShaft(save: Save, runId: string): Save | null {
  const gain = stoneGain(save)
  if (gain < 1) return null
  return {
    ...fresh(runId),
    allTime: save.allTime,
    stones: save.stones + gain,
    deepest: deepestOf(save),
    shafts: save.shafts + 1,
    clicks: save.clicks,
    tools: save.tools,
    turns: save.turns,
    mined: save.mined,
    bySource: save.bySource,
    bestTurn: save.bestTurn,
    bestStreak: save.bestStreak,
    gems: save.gems,
    veins: save.veins,
    events: save.events,
    idleAt: save.idleAt,
  }
}

/**
 * The part of a delta's idle pace the save holds already: another session
 * mined the same moments and gave them first.
 */
function idlePaid(d: Delta, idleAt: number): number {
  const span = d.idle
  if (span === null || !(span.amount > 0) || idleAt <= span.from) return 0
  if (idleAt >= span.to) return span.amount
  return span.amount * ((idleAt - span.from) / (span.to - span.from))
}

/**
 * Lays one session's changes over the save in the store. Several sessions
 * can mine at once, so each keeps what it changed and adds it on sync, rather
 * than writing its own copy over theirs.
 */
export function applyDelta(stored: Save, d: Delta): Save {
  const sameRun = stored.runId === d.runId
  // The idle pace of moments the save holds already is not paid again.
  const paid = idlePaid(d, stored.idleAt)
  const earned = Math.max(0, d.earned - paid)
  const bySource = paid > 0 ? { ...d.bySource, crew: Math.max(0, (d.bySource.crew ?? 0) - paid) } : d.bySource
  return {
    ...stored,
    sparks: sameRun ? Math.max(0, stored.sparks + d.sparks - paid) : stored.sparks + earned,
    lifetime: stored.lifetime + earned,
    allTime: stored.allTime + earned,
    clicks: stored.clicks + d.clicks,
    tools: stored.tools + d.tools,
    turns: stored.turns + d.turns,
    mined: add(stored.mined, d.mined),
    producers: sameRun ? add(stored.producers, d.producers) : stored.producers,
    upgrades: sameRun ? [...new Set([...stored.upgrades, ...d.upgrades])] : stored.upgrades,
    bySource: add(stored.bySource, bySource),
    bestTurn: Math.max(stored.bestTurn, d.bestTurn),
    bestStreak: Math.max(stored.bestStreak, d.bestStreak),
    gems: stored.gems + d.gems,
    veins: stored.veins + d.veins,
    events: add(stored.events, d.events),
    idleAt: Math.max(stored.idleAt, d.idle?.to ?? 0),
  }
}

/** Notes a session's write in the save's `writes`, as its newest. */
function wrote(writes: Record<string, number>, writer: string, seq: number): Record<string, number> {
  const others = Object.entries(writes).filter(([id]) => id !== writer)
  return Object.fromEntries([...others.slice(-(MAX_WRITERS - 1)), [writer, seq]])
}

/**
 * Brings a session's mine in line with the save in the store, and says what
 * to write back. Every session writes the one save: it reads it, lays its own
 * changes over and writes it back. Two that read it at once both write, and the
 * later write drops the earlier one's changes, so a purchase would come undone.
 * So the save keeps the number of each session's last write, and a session
 * whose write is missing lays those changes over again.
 *
 * That record holds only along one chain of writes. Off it (an older version
 * of the mod wrote the save in between) the write may be in or not, and it is
 * left as it is: a change lost now and then, never one counted twice.
 *
 * @param newId a fresh id: the session's name in `writes` when it has none yet, and a new chain's
 */
export function syncMine(stored: Save | null, mine: Mine, newId: string): { mine: Mine; save: Save; isWrite: boolean } {
  const writer = mine.writer === '' ? newId : mine.writer
  const base = stored ?? mine.save
  const isLost = base.chain !== '' && base.chain === mine.chain && (base.writes[writer] ?? 0) < mine.seq
  // The changes of an older run went with it on purpose: a new shaft opened, or the mine was reset.
  const lost = isLost ? mine.inflight.filter(d => d.runId === base.runId) : []
  const deltas = isEmptyDelta(mine.pending) ? lost : [...lost, mine.pending]
  if (deltas.length === 0) {
    return { mine: { ...mine, writer, save: base, pending: emptyDelta(base.runId), inflight: [] }, save: base, isWrite: stored === null }
  }
  const seq = mine.seq + 1
  const merged = deltas.reduce((save, d) => applyDelta(save, d), base)
  const chain = base.chain === '' ? newId : base.chain
  const save = { ...merged, chain, writes: wrote(base.chain === '' ? {} : merged.writes, writer, seq) }
  return { mine: { ...mine, writer, seq, chain, save, pending: emptyDelta(save.runId), inflight: deltas }, save, isWrite: true }
}

export const isEmptyDelta = (d: Delta): boolean =>
  d.sparks === 0 &&
  d.earned === 0 &&
  d.clicks === 0 &&
  d.tools === 0 &&
  d.turns === 0 &&
  Object.keys(d.mined).length === 0 &&
  Object.keys(d.producers).length === 0 &&
  d.upgrades.length === 0 &&
  Object.keys(d.bySource).length === 0 &&
  d.bestTurn === 0 &&
  d.bestStreak === 0 &&
  d.gems === 0 &&
  d.veins === 0 &&
  Object.keys(d.events).length === 0 &&
  d.idle === null
