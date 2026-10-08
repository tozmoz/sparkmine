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
}

/** What the band's drawing depends on. It changes rarely, so the scene is not redrawn on every click. */
export type Band = {
  isLoaded: boolean
  mode: Mode
  isHidden: boolean
  carts: number
  goblins: number
  /** The producers owned, in shop order: the crew the band shows on its right. */
  crew: { id: ProducerId; owned: number }[]
}

/** The live numbers the band's and the shop's Client draw, answered to their polls. */
export type HudProps = {
  variant: 'band' | 'shop'
  mode: Mode
  sparks: number
  rate: number
  /** What one click mines now. */
  click: number
  /** Clicks counted so far: when it grows, the HUD shakes and pops what they earned. */
  clicks: number
  idle: number
  turn: number
  lastTurn: number
  last: string | null
  /** The upgrade closest to unlocking, and how close. */
  goal: { name: string; have: number; need: number } | null
}

/** What the clickable layer over the scene is handed. */
export type TapProps = {
  mode: Mode
  click: number
}

export type IconId =
  | ProducerId
  | 'pick'
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
  next: { name: string; icon: IconId; text: string; have: number; need: number } | null
  values: { click: number; read: number; edit: number }
  crystals: number
  gain: number
  nextCrystalAt: number
  showCollapse: boolean
  stats: { clicks: number; tools: number; turns: number }
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
