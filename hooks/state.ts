// The session's state and everything that changes it. The economy's rules
// live in game.ts and what the drawings show in model.ts; this file holds the
// store sync and the actions the hooks and buttons call.

import type { Band, FeedItem, Mine, Mode, ProducerId, Save, ShopModel, View } from '../types'
import { PRODUCERS } from './data.ts'
import { fmt } from './format.ts'
import * as game from './game.ts'
import * as model from './model.ts'

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
  band: (change: (band: Band) => Band) => Promise<Band>
  shop: (change: (shop: ShopModel) => ShopModel) => Promise<ShopModel>
  reward: (change: (word: string | null) => string | null) => Promise<string | null>
  readMine: () => Promise<Mine>
  readView: () => Promise<View>
  readBand: () => Promise<Band>
  readShop: () => Promise<ShopModel>
  readReward: () => Promise<string | null>
}

export const SAVE_KEY = 'save'
export const TICK_MS = 250
export const SYNC_MS = 5_000
/** A tool call this recent keeps the miner busy, so background agents count as work. */
export const RECENT_MS = 4_000
export const MAX_CLICKS_PER_SECOND = 20
/**
 * After a purchase the shop and the band hold still this long. A redraw hands
 * every button a new handle, so a quick second press on the old drawing was
 * lost; held still, a run of presses all land, and the drawing catches up once.
 */
export const HOLD_MS = 600

let heldUntil = 0

export const INITIAL_VIEW: View = {
  isTurn: false,
  lastToolAt: 0,
  waiting: [],
  last: null,
  turnStart: 0,
  lastTurn: 0,
  amount: 1,
}

export const INITIAL_BAND: Band = { isLoaded: false, mode: 'idle', isHidden: false, carts: 0, goblins: 0, pick: 0, crew: [] }

/** The latest earnings, for the scene to float up from the rock face. Lives with the module. */
const feed: FeedItem[] = []
let feedId = 0
const FEED_SIZE = 8

export function pushFeed(text: string): void {
  feedId += 1
  feed.push({ id: feedId, text })
  if (feed.length > FEED_SIZE) feed.splice(0, feed.length - FEED_SIZE)
}

export const recentFeed = (): FeedItem[] => feed.slice()

export const newRunId = (): string =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 6).toString(36)}`

export function modeOf(view: View, now: number): Mode {
  if (view.waiting.length > 0) return 'pause'
  if (view.isTurn || (view.lastToolAt > 0 && now - view.lastToolAt < RECENT_MS)) return 'work'
  return 'idle'
}

/** Writes a value only when it changed, so nothing that reads it redraws for nothing. */
async function patch<T>(read: () => Promise<T>, write: (change: (value: T) => T) => Promise<T>, change: (value: T) => T): Promise<T> {
  const before = await read()
  const after = change(before)
  if (JSON.stringify(after) === JSON.stringify(before)) return before
  return write(change)
}

export const patchView = (io: Io, change: (view: View) => View): Promise<View> => patch(io.readView, io.view, change)

/**
 * Brings the band and the shop in line with the mine. Each is written only
 * when it changed, and right after a purchase only the band's mode is.
 */
export async function refresh(io: Io, now?: number, force = false): Promise<Band> {
  const at = now ?? (await io.now())
  const isHeld = !force && at < heldUntil
  const mine = await io.readMine()
  const view = await io.readView()
  const band = await patch(io.readBand, io.band, current => {
    const mode = { ...current, isLoaded: mine.isLoaded, mode: modeOf(view, at) }
    if (isHeld) return mode
    return {
      ...mode,
      carts: Math.min(6, game.owned(mine.save, 'cart')),
      goblins: Math.min(1, game.owned(mine.save, 'goblin')),
      pick: game.pickTier(mine.save),
      crew: PRODUCERS.filter(p => game.owned(mine.save, p.id) > 0).map(p => ({ id: p.id, owned: game.owned(mine.save, p.id) })),
    }
  })
  if (!isHeld) await patch(io.readShop, io.shop, () => model.shopModel(mine.save, view.amount, mine.isLoaded))
  return band
}

/** Holds the shop and the band still for a moment: see HOLD_MS. */
async function hold(io: Io): Promise<void> {
  heldUntil = (await io.now()) + HOLD_MS
}

let loading: Promise<void> | null = null

/** Reads the save from the store the first time anything needs it. */
export async function ensureLoaded(io: Io): Promise<void> {
  if ((await io.readMine()).isLoaded) return
  loading ??= (async () => {
    const stored = game.normalize(await io.get(SAVE_KEY))
    const save = stored ?? game.fresh(newRunId())
    await io.mine(mine => (mine.isLoaded ? mine : { save, pending: game.emptyDelta(save.runId), isLoaded: true }))
    if (stored === null) await io.put(SAVE_KEY, save)
    await refreshReward(io, false)
    await refresh(io)
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
    await refresh(io)
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
  const band = await refresh(io, now)
  const share = band.mode === 'idle' ? game.idleShare(mine.save) : 1
  const amount = game.rate(mine.save) * share * seconds
  if (amount > 0) await io.mine(m => game.earn(m, amount, { kind: 'crew' }))
}

let clicks: number[] = []

/** A press of the Mine button. Counts only while Claude works. */
export async function click(io: Io): Promise<number> {
  const now = await io.now()
  clicks = clicks.filter(at => now - at < 1000)
  if (clicks.length >= MAX_CLICKS_PER_SECOND) return 0
  const band = await io.readBand()
  const mine = await io.readMine()
  if (!mine.isLoaded || band.mode !== 'work') return 0
  clicks.push(now)
  let value = 0
  await io.mine(m => {
    value = game.clickValue(m.save)
    return game.earn(m, value, { kind: 'click' })
  })
  await refresh(io, now)
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
  await io.view(view => ({ ...view, last: { label, value }, lastToolAt: now }))
  pushFeed(`+${fmt(value)} ${label}`)
  await refresh(io, now)
  return value
}

/** Marks a tool call that waits on the person (a permission prompt, a question), or clears it. */
export async function setWaiting(io: Io, id: string, isWaiting: boolean): Promise<void> {
  const view = await patchView(io, current => {
    if (current.waiting.includes(id) === isWaiting) return current
    const waiting = isWaiting ? [...current.waiting, id] : current.waiting.filter(other => other !== id)
    return { ...current, waiting }
  })
  if (view.waiting.includes(id) === isWaiting) await refresh(io)
}

export async function startTurn(io: Io): Promise<void> {
  await ensureLoaded(io)
  const mine = await io.readMine()
  await io.view(view => ({ ...view, isTurn: true, turnStart: mine.save.lifetime }))
  await refresh(io)
}

export async function endTurn(io: Io): Promise<number> {
  await ensureLoaded(io)
  let bonus = 0
  await io.mine(m => {
    bonus = game.shiftValue(m.save)
    return game.earn(m, bonus, { kind: 'turn' })
  })
  const mine = await io.readMine()
  await io.view(view => ({
    ...view,
    isTurn: false,
    waiting: [],
    lastToolAt: 0,
    lastTurn: Math.max(0, mine.save.lifetime - view.turnStart),
  }))
  if (bonus > 0) pushFeed(`+${fmt(bonus)} shift pay`)
  await refresh(io)
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
  } else {
    await hold(io)
  }
  await refresh(io)
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
  } else {
    await hold(io)
  }
  await refresh(io)
  return isBought
}

export async function setAmount(io: Io, amount: number): Promise<void> {
  await patchView(io, view => (view.amount === amount ? view : { ...view, amount }))
  await refresh(io, undefined, true)
}

export async function setHidden(io: Io, isHidden: boolean): Promise<void> {
  await patch(io.readBand, io.band, band => (band.isHidden === isHidden ? band : { ...band, isHidden }))
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
  await refresh(io, undefined, true)
  io.toast(`The mine collapsed. You hold ${next.crystals} ◆.`)
  return true
}

export async function resetMine(io: Io): Promise<boolean> {
  const isSure = await confirm(io, 'Reset Sparkmine? This deletes every spark, producer, upgrade and crystal.', 'Reset', 'Keep it')
  if (!isSure) return false
  const save = game.fresh(newRunId())
  await io.put(SAVE_KEY, save)
  await io.mine(() => ({ save, pending: game.emptyDelta(save.runId), isLoaded: true }))
  await io.reward(() => null)
  await refresh(io, undefined, true)
  return true
}
