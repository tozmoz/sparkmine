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

export type View = {
  mode: Mode
  isTurn: boolean
  lastToolAt: number
  /** Tool calls waiting on the person: a permission dialog or a question. */
  waiting: string[]
  last: { label: string; value: number } | null
  /** Lifetime sparks when the turn started, so the band can say what it earned. */
  turnStart: number
  lastTurn: number
  isHidden: boolean
  /** How many producers one press of a buy button buys. */
  amount: number
}

declare module 'claude-code' {
  interface PluginState {
    sparkmine: {
      mine: Mine
      view: View
      reward: string | null
    }
  }
}
