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

export type Counts<K extends string> = { [P in K]?: number }

/** The mine as $.store keeps it, shared by every session on the machine. */
export type Save = {
  v: 1
  /** Changes when the mine collapses (prestige), so stale deltas can be told apart. */
  runId: string
  sparks: number
  /** Sparks earned in this run, since the last collapse. */
  lifetime: number
  /** Sparks earned in every run. */
  allTime: number
  crystals: number
  clicks: number
  tools: number
  turns: number
  mined: Counts<ToolKind>
  producers: Counts<ProducerId>
  upgrades: string[]
}

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
}

export type Mine = {
  save: Save
  pending: Delta
  isLoaded: boolean
}

export type Mode = 'idle' | 'work' | 'pause'

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
  amount: number
  /** Gems struck so far this session, and what the latest ones added beyond their clicks. */
  gem: { seq: number; bonus: number } | null
}

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
  /** The latest gems struck: the HUD pops them when `seq` grows. */
  gem: { seq: number; bonus: number } | null
  idle: number
  turn: number
  lastTurn: number
  last: string | null
  /** The upgrade closest to unlocking, and how close. */
  goal: { name: string; have: number; need: number } | null
  tools: number
  turns: number
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
  | 'crystal'
  | 'locked'
  | 'glove'
  | 'whistle'
  | 'bolt'
  | 'gem'

export type ShopItem = {
  id: string
  icon: IconId
  name: string
  detail: string
  owned: number
  price: number
  canBuy: boolean
}

/** What the shop pane draws. Rebuilt on every change, written only when it differs. */
export type ShopModel = {
  isLoaded: boolean
  amount: number
  producers: ShopItem[]
  /** The price of the next producer, still hidden. */
  teaser: number | null
  upgrades: ShopItem[]
  more: number
  /** The next unlock; how close it is lives in the live counter, so clicks do not redraw the pane. */
  next: { name: string; icon: IconId; text: string } | null
  values: { click: number; read: number; edit: number }
  crystals: number
  gain: number
  nextCrystalAt: number
  showCollapse: boolean
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
