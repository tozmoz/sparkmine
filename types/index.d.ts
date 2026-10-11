// The shapes Sparkmine keeps: in $.store across sessions, and in $.state
// for the drawings of this session.

export type ToolKind = 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'mcp' | 'other'

export type ProducerId =
  | 'apprentice'
  | 'cart'
  | 'goblin'
  | 'drill'
  | 'crew'
  | 'cache'
  | 'refinery'
  | 'core'
  | 'furnace'
  | 'datacenter'

export type Counts<K extends string> = { [P in K]?: number }

/** Where sparks come from, for the shop's stats. */
export type SourceKind = 'crew' | 'click' | 'tool' | 'turn' | 'event' | 'vein'

/**
 * What Claude's own work turns into a reward: green tests, a bug squashed
 * (tests that failed, then passed), a build, a clean lint, a commit, a pull
 * request opened or merged, a long shift, and a streak of good turns.
 */
export type EventKind = 'tests' | 'fix' | 'build' | 'lint' | 'commit' | 'pr' | 'merge' | 'longShift' | 'streak'

/** A vein pays at once, starts a frenzy, or is a find: a secret of the layer it shows in. */
export type VeinKind = 'rich' | 'frenzy' | 'find'

/** A time of year the mine dresses up for, by the person's own calendar. */
export type Season = 'halloween' | 'winter'

/** What a layer hides in its rock, once for good. */
export type FindId = 'fossil' | 'rubber-duck' | 'pharaoh'

/** A secret found: an achievement that shows as ??? until then. */
export type SecretId =
  | 'absolutely-right'
  | 'good-manners'
  | 'deep-thinker'
  | 'groundbreaking'
  | 'friday-deploy'
  | 'midnight-oil'
  | 'fossil'
  | 'rubber-duck'
  | 'pharaoh'

/** The mine as $.store keeps it, shared by every session on the machine. */
export type Save = {
  v: 1
  /** Changes when a new shaft opens (prestige), so stale deltas can be told apart. */
  runId: string
  sparks: number
  /** Sparks earned in this run, since the last new shaft. */
  lifetime: number
  /** Sparks earned in every run. */
  allTime: number
  /** Ancient stones, from new shafts: each adds to everything for good. */
  stones: number
  /** The deepest a finished run reached, in metres; this run's depth comes from `lifetime`. */
  deepest: number
  /** New shafts opened. */
  shafts: number
  clicks: number
  tools: number
  turns: number
  mined: Counts<ToolKind>
  producers: Counts<ProducerId>
  upgrades: string[]
  /** All-time stats, kept through a new shaft: sparks by where they came from, and what was found. */
  bySource: Counts<SourceKind>
  /** The most sparks one turn has mined. */
  bestTurn: number
  /** The most good turns in a row a session has worked. */
  bestStreak: number
  gems: number
  veins: number
  events: Counts<EventKind>
  /** Secrets found, for good. */
  secrets: SecretId[]
  /**
   * The crew's idle pace is the mine's, not a session's: every open session
   * mines it, and the save holds it up to this moment. A session adds only
   * what came after, so it is paid once however many sessions are open.
   */
  idleAt: number
  /**
   * The number of each session's last write this save holds, newest last. A
   * session whose write is missing knows another wrote over it.
   */
  writes: Record<string, number>
  /**
   * Names the unbroken run of writes `writes` records. An older version of the
   * mod writes the save without either, so the next write starts a new chain.
   */
  chain: string
}

/** Sparks of the crew's idle pace a session mined, and the moments they span. */
export type IdleSpan = { amount: number; from: number; to: number }

/** What this session changed since it last synced with the store. */
export type Delta = {
  runId: string
  sparks: number
  earned: number
  clicks: number
  tools: number
  turns: number
  mined: Counts<ToolKind>
  producers: Counts<ProducerId>
  upgrades: string[]
  bySource: Counts<SourceKind>
  bestTurn: number
  bestStreak: number
  gems: number
  veins: number
  events: Counts<EventKind>
  secrets: SecretId[]
  /**
   * The idle pace this session mined since it last synced. The save takes
   * only the part of it that no other session gave it yet: see Save `idleAt`.
   */
  idle: IdleSpan | null
}

export type Mine = {
  save: Save
  pending: Delta
  isLoaded: boolean
  /** This session's name in the save's `writes`; empty until its first sync. */
  writer: string
  /** The number of this session's last write, and the chain it went on. */
  seq: number
  chain: string
  /** The changes that write carried, kept until the store is seen to hold them. */
  inflight: Delta[]
}

export type Mode = 'idle' | 'work' | 'pause'

/** How many producers one press of a buy button buys: one, ten, or as many as the purse allows. */
export type Amount = 1 | 10 | 'max'

/** What changes while Claude works. Nothing draws from it directly, so it can change often. */
export type View = {
  isTurn: boolean
  lastToolAt: number
  /** Tool calls waiting on the person: a permission dialog or a question. */
  waiting: string[]
  last: { label: string; value: number } | null
  /** Lifetime sparks when the turn started, so the band can say what it earned. */
  turnStart: number
  lastTurn: number
  /** How many producers one press of a buy button buys. */
  amount: Amount
  /** Gems struck so far this session, and what the latest ones added beyond their clicks. */
  gem: { seq: number; bonus: number } | null
  /** The vein showing now, until when it can be caught. */
  vein: { id: number; kind: VeinKind; until: number; find?: FindId } | null
  /** Seconds of work since the last vein showed, and how many have shown this session. */
  veinWork: number
  veinCount: number
  /** A caught frenzy: everything mines `mult` times as much until then. */
  frenzy: { mult: number; until: number } | null
  /** The latest reward, which the HUD shows for a moment. */
  event: { label: string; value: number; at: number } | null
  /** The work events already rewarded this turn: each pays once a turn. */
  turnEvents: EventKind[]
  /** Tool calls this turn: a turn Claude did no work in neither makes nor breaks a streak. */
  turnTools: number
  /** Good turns in a row: each ended in an answer, after some work. */
  streak: number
  /** A test run failed and none has passed since: the next green run squashes a bug. */
  testsFailing: boolean
  /** When the pick last squashed that bug: the splat shows for a moment. */
  squashedAt: number
  /** Since when Claude has done nothing here: a turn's end, a tool call, or the session's start. */
  restSince: number
  /** Thanked: the miner tips his hat until then. */
  tipUntil: number
  /** Asked to ultrathink: the lantern flares until the turn ends. */
  flare: boolean
  /** When a pull request last merged: confetti for a moment. */
  confettiAt: number
  /** Now and then a turn's spinner says something rarer than the mine's word. */
  word: string | null
}

/** How long Claude has been idle shows on the miner: a coffee after a while, asleep after a long while. */
export type Nap = 'coffee' | 'sleep'

/** Upgrades there to see in the mine: the caged canary, work gloves, warmer lanterns, a coffee mug. */
export type Extras = { canary: boolean; gloves: boolean; warm: boolean; coffee: boolean }

/** What the band's drawing depends on. It changes rarely, so the scene is not redrawn on every click. */
export type Band = {
  isLoaded: boolean
  mode: Mode
  isHidden: boolean
  carts: number
  goblins: number
  /** Which pick the miner holds: 0 worn iron, up to 4 obsidian. */
  pick: number
  /** The producers owned, in shop order: the crew the band shows on its right. */
  crew: { id: ProducerId; owned: number }[]
  /** The layer the mine has reached, an index of BIOMES: 0 topsoil, 1 stone, ... 9 the far side. */
  biome: number
  /** One line even while Claude works: `/mine compact`. */
  isCompact: boolean
  /** Stopped by `/mine stop`: nothing mines and the band is gone. */
  isStopped: boolean
  /** Sounds off, by `/mine sound`, in every session. */
  isMuted: boolean
  /** A bug on the rock while tests fail, and the splat a moment after the pick got it. */
  bug: 'crawl' | 'splat' | null
  extras: Extras
  /** Only while Claude is idle. */
  nap: Nap | null
  tip: boolean
  flare: boolean
  /** A find showing on the rock, until it is caught or gone. */
  find: FindId | null
  season: Season | null
  confetti: boolean
  /** This turn's rare spinner word, if it has one. */
  word: string | null
}

/** The live numbers the band's and the shop's Client draw, answered to their polls. */
export type HudProps = {
  variant: 'band' | 'shop'
  mode: Mode
  /** Where it draws: the terminal's Mine button takes a hotkey, the desktop's a pick. */
  surface: 'terminal' | 'desktop' | 'other'
  sparks: number
  rate: number
  /** What one click mines now, gems aside. */
  click: number
  /** Clicks counted in the save, for the shop's stats. */
  clicks: number
  /**
   * Presses of this HUD's Mine button the hooks have counted. The HUD shows
   * the ones still on their way at once, so a press never waits for a poll.
   */
  acked: number
  /**
   * Presses of the band's own Mine button the hooks have counted: the
   * terminal's, whose `m` a Client's Button cannot take. The HUD pops what
   * the new ones mined.
   */
  taps: number
  /** The latest gems struck: the HUD pops them when `seq` grows. */
  gem: { seq: number; bonus: number } | null
  /** How deep the mine is, in metres, and the layer it is in. */
  depth: number
  layer: { name: string; color: string }
  /** A reward from the last few seconds, which the HUD shows in place of the last tool call. */
  event: { label: string; value: number } | null
  /** A frenzy running now: the rate shows multiplied. */
  frenzy: { mult: number; left: number } | null
  /** One line even while Claude works. */
  isCompact: boolean
  idle: number
  turn: number
  lastTurn: number
  last: string | null
  /** The upgrade closest to unlocking, and how close. */
  goal: { name: string; have: number; need: number } | null
  tools: number
  turns: number
  /** Claude idle a while: the one-line band says so with a cup, then a snooze. */
  nap: Nap | null
  /** The HUD's fixed height in rows: a surface unmounts a Client whose size keeps changing. */
  height: number
}



export type IconId =
  | ProducerId
  | 'pick'
  | 'pickDiamond'
  | 'pickObsidian'
  | 'glasses'
  | 'dynamite'
  | 'terminal'
  | 'globe'
  | 'plug'
  | 'nugget'
  | 'moon'
  | 'clock'
  | 'lantern'
  | 'stone'
  | 'badge'
  | 'locked'
  | 'glove'
  | 'whistle'
  | 'bolt'
  | 'gem'
  | 'check'
  | 'rod'

/** What the vein Client draws: a vein to catch, or the frenzy one started. */
export type VeinProps = {
  /** What the vein's button says it is: a vein, or a find. */
  vein: { id: number; kind: VeinKind; left: number; label: string } | null
  frenzy: { mult: number; left: number } | null
  surface: 'terminal' | 'desktop' | 'other'
}

/** What the shop's stats Client draws. */
export type StatsProps = {
  bySource: Counts<SourceKind>
  bestTurn: number
  /** The deepest any run reached, this one included, in metres. */
  deepest: number
  shafts: number
  bestStreak: number
  gems: number
  veins: number
  events: Counts<EventKind>
  clicks: number
  tools: number
  turns: number
}

export type ShopItem = {
  id: string
  icon: IconId
  name: string
  detail: string
  owned: number
  /** How many one press buys, and what they cost: for Max, as many as the purse allows, and one when it allows none. */
  count: number
  price: number
  canBuy: boolean
}

/** What the shop pane draws. Rebuilt on every change, written only when it differs. */
export type ShopModel = {
  isLoaded: boolean
  amount: Amount
  producers: ShopItem[]
  /** The price of the next producer, still hidden. */
  teaser: number | null
  upgrades: ShopItem[]
  more: number
  /** The next unlock; how close it is lives in the live counter, so clicks do not redraw the pane. */
  next: { name: string; icon: IconId; text: string } | null
  values: { click: number; read: number; edit: number }
  /** Ancient stones held, achievements earned, and what each adds to everything, in percent. */
  bonus: { stones: number; stonesPct: number; achievements: number; achievementsPct: number }
  /** The layers this run reached and the next one, deepest last, and whether more lie beyond that, hidden ones aside. */
  layers: { name: string; from: number; color: string; text: string; isReached: boolean; isHere: boolean }[]
  hasDeeper: boolean
  /** Every achievement in order, earned or not, and the closest unearned one. */
  achievements: { id: string; name: string; isEarned: boolean }[]
  nextAchievement: { name: string; text: string } | null
  /**
   * The new shaft, once the run is deep enough to think of one: the stones it
   * pays now, none until SHAFT_DEPTH, and what all the stones would add to
   * everything then, in percent. Its depth lives in the live counter.
   */
  shaft: { gain: number; at: number; pct: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    sparkmine: {
      mine: Mine
      view: View
      band: Band
      shop: ShopModel
      reward: string | null
    }
  }
}
