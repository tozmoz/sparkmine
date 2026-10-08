// The session's state and everything that changes it. The economy's rules
// live in game.ts; this file holds the atoms, the store sync and the actions
// the hooks and buttons call.

import type { Mine, Mode, ProducerId, Save, View } from '../types'
import { fmt } from './format.ts'
import * as game from './game.ts'

/**
 * What the actions need from the engine. The hooks module builds it from `$`
 * once a session starts, since `$` itself is only ever spelled at a call site.
 */
export type Io = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  put: (key: string, value: unknown) => Promise<void>
  toast: (text: string) => void
  ask: (question: string, options: readonly string[]) => Promise<string>
  mine: (change: (mine: Mine) => Mine) => Promise<Mine>
  view: (change: (view: View) => View) => Promise<View>
  reward: (change: (word: string | null) => string | null) => Promise<string | null>
  readMine: () => Promise<Mine>
  readView: () => Promise<View>
  readReward: () => Promise<string | null>
}

export const SAVE_KEY = 'save'
export const TICK_MS = 250
export const SYNC_MS = 5_000
/** A tool call this recent keeps the miner busy, so background agents count as work. */
export const RECENT_MS = 4_000
export const MAX_CLICKS_PER_SECOND = 20

export const INITIAL_VIEW: View = {
  mode: 'idle',
  isTurn: false,
  lastToolAt: 0,
  waiting: [],
  last: null,
  turnStart: 0,
  lastTurn: 0,
  isHidden: false,
  amount: 1,
}


export const newRunId = (): string =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 6).toString(36)}`

export function modeOf(view: View, now: number): Mode {
  if (view.waiting.length > 0) return 'pause'
  if (view.isTurn || (view.lastToolAt > 0 && now - view.lastToolAt < RECENT_MS)) return 'work'
  return 'idle'
}

/** Writes the view only when it changed, so idle ticks redraw nothing. */
export async function patchView(io: Io, change: (view: View) => View): Promise<View> {
  const before = await io.readView()
  const after = change(before)
  if (JSON.stringify(after) === JSON.stringify(before)) return before
  return io.view(change)
}

export async function refreshMode(io: Io, now?: number): Promise<View> {
  const at = now ?? (await io.now())
  return patchView(io, view => {
    const mode = modeOf(view, at)
    return mode === view.mode ? view : { ...view, mode }
  })
}

let loading: Promise<void> | null = null

/** Reads the save from the store the first time anything needs it. */
export async function ensureLoaded(io: Io): Promise<void> {
  if ((await io.readMine()).isLoaded) return
  loading ??= (async () => {
    const stored = game.normalize(await io.get(SAVE_KEY))
    const save = stored ?? game.fresh(newRunId())
    await io.mine(mine =>
      mine.isLoaded ? mine : { save, pending: game.emptyDelta(save.runId), isLoaded: true },
    )
    if (stored === null) await io.put(SAVE_KEY, save)
    await refreshReward(io, false)
  })().finally(() => {
    loading = null
  })
  await loading
}

let syncing: Promise<void> | null = null

/** Merges this session's changes into the store, and takes in what other sessions mined. */
export async function sync(io: Io): Promise<void> {
  syncing ??= (async () => {
    if (!(await io.readMine()).isLoaded) return
    const stored = game.normalize(await io.get(SAVE_KEY))
    let merged: Save | null = null
    let changed = false
    await io.mine(mine => {
      changed = !game.isEmptyDelta(mine.pending)
      merged = stored === null ? mine.save : game.applyDelta(stored, mine.pending)
      return { save: merged, pending: game.emptyDelta(merged.runId), isLoaded: true }
    })
    if (merged !== null && (changed || stored === null)) await io.put(SAVE_KEY, merged)
    await refreshReward(io, true)
  })().finally(() => {
    syncing = null
  })
  await syncing
}

/** Keeps the spinner word in step with all-time sparks. */
export async function refreshReward(io: Io, announce: boolean): Promise<void> {
  const mine = await io.readMine()
  const word = game.rewardWord(mine.save.allTime)
  const current = await io.readReward()
  if (word === current) return
  await io.reward(() => word)
  if (announce && word !== null) io.toast(`New spinner word unlocked: ${word}`)
}

let lastTick = 0

/** Runs every TICK_MS: the crew's income, and the switch between work and idle. */
export async function tick(io: Io): Promise<void> {
  const now = await io.now()
  const seconds = lastTick === 0 ? 0 : Math.min(2, Math.max(0, (now - lastTick) / 1000))
  lastTick = now
  const mine = await io.readMine()
  if (!mine.isLoaded) return
  const view = await refreshMode(io, now)
  const share = view.mode === 'idle' ? game.idleShare(mine.save) : 1
  const amount = game.rate(mine.save) * share * seconds
  if (amount > 0) await io.mine(m => game.earn(m, amount, { kind: 'crew' }))
}

let clicks: number[] = []

/** A press of the Mine button. Counts only while Claude works. */
export async function click(io: Io): Promise<number> {
  const now = await io.now()
  clicks = clicks.filter(at => now - at < 1000)
  if (clicks.length >= MAX_CLICKS_PER_SECOND) return 0
  const view = await io.readView()
  const mine = await io.readMine()
  if (!mine.isLoaded || view.mode !== 'work') return 0
  clicks.push(now)
  let value = 0
  await io.mine(m => {
    value = game.clickValue(m.save)
    return game.earn(m, value, { kind: 'click' })
  })
  return value
}

/** A tool call Claude finished: the miner mines it. */
export async function minedTool(io: Io, tool: string): Promise<number> {
  await ensureLoaded(io)
  const kind = game.classifyTool(tool)
  let value = 0
  await io.mine(m => {
    value = game.toolValue(m.save, kind)
    return game.earn(m, value, { kind: 'tool', tool: kind })
  })
  const now = await io.now()
  const label = kind === 'mcp' ? 'MCP' : tool
  await io.view(view => {
    const next = { ...view, last: { label, value }, lastToolAt: now }
    return { ...next, mode: modeOf(next, now) }
  })
  return value
}

/** Marks a tool call that waits on the person (a permission prompt, a question), or clears it. */
export async function setWaiting(io: Io, id: string, isWaiting: boolean): Promise<void> {
  const now = await io.now()
  await patchView(io, view => {
    if (view.waiting.includes(id) === isWaiting) return view
    const waiting = isWaiting ? [...view.waiting, id] : view.waiting.filter(other => other !== id)
    const next = { ...view, waiting }
    return { ...next, mode: modeOf(next, now) }
  })
}

export async function startTurn(io: Io): Promise<void> {
  await ensureLoaded(io)
  const mine = await io.readMine()
  const now = await io.now()
  await io.view(view => {
    const next = { ...view, isTurn: true, turnStart: mine.save.lifetime }
    return { ...next, mode: modeOf(next, now) }
  })
}

export async function endTurn(io: Io): Promise<number> {
  await ensureLoaded(io)
  let bonus = 0
  await io.mine(m => {
    bonus = game.shiftValue(m.save)
    return game.earn(m, bonus, { kind: 'turn' })
  })
  const mine = await io.readMine()
  const now = await io.now()
  await io.view(view => {
    const next = {
      ...view,
      isTurn: false,
      waiting: [],
      lastToolAt: 0,
      lastTurn: Math.max(0, mine.save.lifetime - view.turnStart),
    }
    return { ...next, mode: modeOf(next, now) }
  })
  void sync(io).catch(() => undefined)
  return bonus
}

export async function buyProducer(io: Io, id: ProducerId): Promise<number> {
  const { amount } = await io.readView()
  let bought = 0
  await io.mine(mine => {
    bought = 0
    const n = game.affordable(mine.save, id, amount)
    const next = n > 0 ? game.buyProducer(mine, id, n) : null
    if (next === null) return mine
    bought = n
    return next
  })
  if (bought === 0) {
    const { save } = await io.readMine()
    const short = game.priceOf(game.producer(id), game.owned(save, id)) - save.sparks
    io.toast(`Need ${fmt(Math.max(1, short))} more ✻`)
  }
  return bought
}

export async function buyUpgrade(io: Io, id: string): Promise<boolean> {
  let isBought = false
  await io.mine(mine => {
    const next = game.buyUpgrade(mine, id)
    isBought = next !== null
    return next ?? mine
  })
  if (!isBought) {
    const { save } = await io.readMine()
    const u = game.upgrade(id)
    if (u !== undefined) io.toast(`Need ${fmt(Math.max(1, u.cost - save.sparks))} more ✻`)
  }
  return isBought
}

export async function setAmount(io: Io, amount: number): Promise<void> {
  await patchView(io, view => (view.amount === amount ? view : { ...view, amount }))
}

export async function setHidden(io: Io, isHidden: boolean): Promise<void> {
  await patchView(io, view => (view.isHidden === isHidden ? view : { ...view, isHidden }))
}


async function confirm(io: Io, question: string, yes: string, no: string): Promise<boolean> {
  try {
    return (await io.ask(question, [no, yes])) === yes
  } catch {
    return false
  }
}

/** Prestige: trade this run for crystals, after the person confirms. */
export async function collapseMine(io: Io): Promise<boolean> {
  await sync(io)
  const gain = game.crystalGain((await io.readMine()).save)
  if (gain < 1) {
    io.toast('Mine more before the collapse pays a crystal')
    return false
  }
  const isSure = await confirm(
    io,
    `Collapse the mine for ${gain} ◆? Sparks, producers and upgrades reset. Crystals stay, and each adds 2% to everything.`,
    'Collapse',
    'Keep mining',
  )
  if (!isSure) return false
  await sync(io)
  const next = game.collapse((await io.readMine()).save, newRunId())
  if (next === null) return false
  await io.put(SAVE_KEY, next)
  await io.mine(() => ({ save: next, pending: game.emptyDelta(next.runId), isLoaded: true }))
  io.toast(`The mine collapsed. You hold ${next.crystals} ◆.`)
  return true
}

export async function resetMine(io: Io): Promise<boolean> {
  const isSure = await confirm(
    io,
    'Reset Sparkmine? This deletes every spark, producer, upgrade and crystal.',
    'Reset',
    'Keep it',
  )
  if (!isSure) return false
  const save = game.fresh(newRunId())
  await io.put(SAVE_KEY, save)
  await io.mine(() => ({ save, pending: game.emptyDelta(save.runId), isLoaded: true }))
  await io.reward(() => null)
  return true
}
