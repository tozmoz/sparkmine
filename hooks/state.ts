// The session's state and everything that changes it. The economy's rules
// live in game.ts and what the drawings show in model.ts; this file holds the
// store sync and the actions the hooks and buttons call.

import type { Band, EventKind, Mine, Mode, ProducerId, Save, ShopModel, VeinKind, View } from '../types'
import { EVENTS, LONG_SHIFT_MS, PRODUCERS, VEIN } from './data.ts'
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
/** The person's settings, kept beside the save so every session follows them. */
export const COMPACT_KEY = 'compact'
export const STOPPED_KEY = 'stopped'
export const TICK_MS = 100
export const SYNC_MS = 5_000
/**
 * Each sync waits up to this much longer, at random. Sessions an update
 * reloaded together would otherwise sync together for good, and two syncs at
 * once write over each other.
 */
export const SYNC_JITTER_MS = 1_000
/** A tool call this recent keeps the miner busy, so background agents count as work. */
export const RECENT_MS = 4_000
export const MAX_CLICKS_PER_SECOND = 20
/**
 * A purchase redraws the shop at once, right after the press, when the next
 * press is furthest away. Then the band and the shop's other changes wait
 * this long after the last purchase: a redraw hands every button a new handle,
 * and a redraw landing mid-run would lose the press that crossed it.
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
  gem: null,
  vein: null,
  veinWork: 0,
  veinCount: 0,
  frenzy: null,
  event: null,
  turnEvents: [],
}

export const INITIAL_BAND: Band = {
  isLoaded: false,
  mode: 'idle',
  isHidden: false,
  carts: 0,
  goblins: 0,
  pick: 0,
  crew: [],
  biome: 0,
  isCompact: false,
  isStopped: false,
}

/** A view or a band as this version reads it: one kept from before an update lacks the newer fields. */
export const fillView = (view: View): View => ({ ...INITIAL_VIEW, ...view })
export const fillBand = (band: Band): Band => ({ ...INITIAL_BAND, ...band })

/** The multiplier a caught frenzy puts on everything until it runs out. */
export const boostAt = (view: View, now: number): number => (view.frenzy !== null && now < view.frenzy.until ? view.frenzy.mult : 1)

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
      biome: game.biomeAt(game.depth(mine.save)),
    }
  })
  if (!isHeld) await patch(io.readShop, io.shop, () => model.shopModel(mine.save, view.amount, mine.isLoaded))
  return band
}

/** Shows a purchase in the shop now, and holds everything else still: see HOLD_MS. */
async function showPurchase(io: Io): Promise<void> {
  heldUntil = (await io.now()) + HOLD_MS
  const mine = await io.readMine()
  const view = await io.readView()
  await patch(io.readShop, io.shop, () => model.shopModel(mine.save, view.amount, mine.isLoaded))
}

let loading: Promise<void> | null = null

/** Reads the save from the store the first time anything needs it. */
export async function ensureLoaded(io: Io): Promise<void> {
  if ((await io.readMine()).isLoaded) return
  loading ??= (async () => {
    const stored = game.normalize(await io.get(SAVE_KEY))
    const save = stored ?? game.fresh(newRunId())
    await io.mine(mine => (mine.isLoaded ? mine : { ...game.newMine(save.runId), save, isLoaded: true, writer: newRunId() }))
    if (stored === null) await io.put(SAVE_KEY, save)
    await readSettings(io)
    await refreshReward(io, false)
    await refresh(io)
  })().finally(() => {
    loading = null
  })
  await loading
}

let syncing: Promise<void> | null = null

/**
 * Merges this session's changes into the store, and takes in what other
 * sessions mined. Changes another session wrote over go in again: see game.syncMine.
 */
export async function sync(io: Io): Promise<void> {
  syncing ??= (async () => {
    if (!(await io.readMine()).isLoaded) return
    const stored = game.normalize(await io.get(SAVE_KEY))
    const writer = newRunId()
    const out: { write: Save | null } = { write: null }
    await io.mine(mine => {
      const next = game.syncMine(stored, mine, writer)
      out.write = next.isWrite ? next.save : null
      return next.mine
    })
    if (out.write !== null) await io.put(SAVE_KEY, out.write)
    await readSettings(io)
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

/** Runs every TICK_MS: the crew's income, the switch between work and idle, and the veins. */
export async function tick(io: Io): Promise<void> {
  const now = await io.now()
  const seconds = lastTick === 0 ? 0 : Math.min(2, Math.max(0, (now - lastTick) / 1000))
  lastTick = now
  const mine = await io.readMine()
  if (!mine.isLoaded) return
  const band = await refresh(io, now)
  if (band.isStopped) return
  const view = await io.readView()
  const share = band.mode === 'idle' ? game.idleShare(mine.save) : 1
  const amount = game.rate(mine.save) * share * seconds * boostAt(view, now)
  if (amount > 0) await io.mine(m => game.earn(m, amount, { kind: 'crew' }))
  await growVeins(io, band.mode, seconds, now, mine.save.runId)
}

/**
 * Veins show while Claude works: after so many seconds of work one shows for
 * a few seconds, and goes when it is not caught. A frenzy runs out on its own.
 */
async function growVeins(io: Io, mode: Mode, seconds: number, now: number, runId: string): Promise<void> {
  await patchView(io, view => {
    let next = view
    if (next.vein !== null && now > next.vein.until) next = { ...next, vein: null }
    if (next.frenzy !== null && now >= next.frenzy.until) next = { ...next, frenzy: null }
    if (mode !== 'work' || next.vein !== null) return next
    const work = next.veinWork + seconds
    const due = game.veinAfter(runId, next.veinCount)
    if (work < due.seconds) return { ...next, veinWork: work }
    const id = next.veinCount + 1
    return { ...next, veinWork: 0, veinCount: id, vein: { id, kind: due.kind, until: now + VEIN.showMs } }
  })
}

/** A press on the vein while it shows: a rich one pays at once, a frenzy multiplies everything for a while. */
export async function catchVein(io: Io, id: number): Promise<VeinKind | null> {
  const now = await io.now()
  if ((await io.readBand()).isStopped) return null
  const hit: { kind: VeinKind | null } = { kind: null }
  await patchView(io, view => {
    hit.kind = null
    if (view.vein === null || view.vein.id !== id || now > view.vein.until) return view
    hit.kind = view.vein.kind
    const frenzy = view.vein.kind === 'frenzy' ? { mult: VEIN.frenzyMult, until: now + VEIN.frenzyMs } : view.frenzy
    return { ...view, vein: null, frenzy }
  })
  const kind = hit.kind
  if (kind === null) return null
  let value = 0
  await io.mine(m => {
    value = kind === 'rich' ? game.veinValue(m.save) : 0
    return game.earn(m, value, { kind: 'vein' })
  })
  const label = kind === 'rich' ? 'Rich vein' : `Frenzy ×${VEIN.frenzyMult}`
  await io.view(view => ({ ...view, event: { label, value, at: now } }))
  await refresh(io, now)
  return kind
}

let pressed: number[] = []

/**
 * Presses of the Mine button, counted while Claude works and at most
 * MAX_CLICKS_PER_SECOND. Each may strike a gem; the view keeps the latest,
 * so the HUD can pop it. A frenzy multiplies what they mine.
 */
export async function clicks(io: Io, n: number): Promise<{ counted: number; gems: number }> {
  const now = await io.now()
  pressed = pressed.filter(at => now - at < 1000)
  const band = await io.readBand()
  const mine = await io.readMine()
  const counted = Math.max(0, Math.min(Math.floor(n), MAX_CLICKS_PER_SECOND - pressed.length))
  if (!mine.isLoaded || band.mode !== 'work' || band.isStopped || counted === 0) return { counted: 0, gems: 0 }
  for (let i = 0; i < counted; i += 1) pressed.push(now)
  const boost = boostAt(await io.readView(), now)
  let gems = 0
  let bonus = 0
  await io.mine(m => {
    gems = 0
    bonus = 0
    const mult = game.multipliers(m.save)
    let next = m
    for (let i = 0; i < counted; i += 1) {
      const hit = game.strike(next.save, mult)
      if (hit.isGem) {
        gems += 1
        bonus += (hit.value - game.clickValue(next.save, mult)) * boost
      }
      next = game.earn(next, hit.value * boost, { kind: 'click', isGem: hit.isGem })
    }
    return next
  })
  if (gems > 0) await io.view(view => ({ ...view, gem: { seq: (view.gem?.seq ?? 0) + gems, bonus } }))
  await refresh(io, now)
  return { counted, gems }
}

/**
 * Pays a work event, once a turn for each kind: green tests, a commit, a long
 * shift. The view keeps it a moment, so the HUD can say what paid.
 */
async function reward(io: Io, kind: EventKind, now: number): Promise<number> {
  const fresh = { isNew: false }
  await patchView(io, view => {
    fresh.isNew = !view.turnEvents.includes(kind)
    return fresh.isNew ? { ...view, turnEvents: [...view.turnEvents, kind] } : view
  })
  if (!fresh.isNew) return 0
  let value = 0
  await io.mine(m => {
    value = game.eventValue(m.save, kind)
    return game.earn(m, value, { kind: 'event', event: kind })
  })
  await io.view(view => ({ ...view, event: { label: EVENTS[kind].label, value, at: now } }))
  return value
}

/** A tool call Claude finished: the miner mines it, and green tests or a commit pay a little more. */
export async function minedTool(io: Io, outcome: game.ToolOutcome): Promise<number> {
  await ensureLoaded(io)
  if ((await io.readBand()).isStopped) return 0
  const kind = game.classifyTool(outcome.tool)
  let value = 0
  await io.mine(m => {
    value = game.toolValue(m.save, kind)
    return game.earn(m, value, { kind: 'tool', tool: kind })
  })
  const now = await io.now()
  const label = kind === 'mcp' ? 'MCP' : outcome.tool
  await io.view(view => ({ ...view, last: { label, value }, lastToolAt: now }))
  const event = game.workEvent(outcome)
  if (event !== null) await reward(io, event, now)
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
  await io.view(view => ({ ...view, isTurn: true, turnStart: mine.save.lifetime, turnEvents: [] }))
  await refresh(io)
}

/** A finished turn: shift pay, the long-shift reward for a long one, and the best turn yet. */
export async function endTurn(io: Io, durationMs = 0): Promise<number> {
  await ensureLoaded(io)
  const isStopped = (await io.readBand()).isStopped
  let bonus = 0
  if (!isStopped) {
    await io.mine(m => {
      bonus = game.shiftValue(m.save)
      return game.earn(m, bonus, { kind: 'turn' })
    })
    if (durationMs >= LONG_SHIFT_MS) await reward(io, 'longShift', await io.now())
  }
  const mine = await io.readMine()
  const { turnStart } = await io.readView()
  const earned = Math.max(0, mine.save.lifetime - turnStart)
  if (!isStopped) await io.mine(m => game.recordTurn(m, earned))
  await io.view(view => ({
    ...view,
    isTurn: false,
    waiting: [],
    lastToolAt: 0,
    lastTurn: earned,
  }))
  await refresh(io)
  void sync(io).catch(() => undefined)
  return bonus
}

/** Buys the amount the shop is set to, all of it or none: a short purse says how short. */
export async function buyProducer(io: Io, id: ProducerId): Promise<number> {
  const { amount } = await io.readView()
  let bought = 0
  await io.mine(mine => {
    bought = 0
    const next = game.buyProducer(mine, id, amount)
    if (next === null) return mine
    bought = amount
    return next
  })
  if (bought === 0) {
    const { save } = await io.readMine()
    const short = game.priceOf(game.producer(id), game.owned(save, id), amount) - save.sparks
    io.toast(`Need ${fmt(Math.max(1, short))} more ✻`)
  } else {
    await showPurchase(io)
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
    await showPurchase(io)
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

/** One line even while Claude works, in every session. */
export async function setCompact(io: Io, isCompact: boolean): Promise<void> {
  await io.put(COMPACT_KEY, isCompact)
  await patch(io.readBand, io.band, band => (band.isCompact === isCompact ? band : { ...band, isCompact }))
}

/** Stops the game in every session: nothing mines and the band goes, until it starts again. */
export async function setStopped(io: Io, isStopped: boolean): Promise<void> {
  await io.put(STOPPED_KEY, isStopped)
  await patch(io.readBand, io.band, band => (band.isStopped === isStopped ? band : { ...band, isStopped }))
  if (isStopped) await patchView(io, view => (view.vein === null && view.frenzy === null ? view : { ...view, vein: null, frenzy: null }))
}

/** Takes in the settings another session may have changed. */
async function readSettings(io: Io): Promise<void> {
  const isCompact = (await io.get(COMPACT_KEY)) === true
  const isStopped = (await io.get(STOPPED_KEY)) === true
  await patch(io.readBand, io.band, band =>
    band.isCompact === isCompact && band.isStopped === isStopped ? band : { ...band, isCompact, isStopped },
  )
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
    `Collapse the mine for ${gain} ◆? Sparks, producers, upgrades and depth reset. Crystals stay, and each adds 2% to everything.`,
    'Collapse',
    'Keep mining',
  )
  if (!isSure) return false
  await sync(io)
  const next = game.collapse((await io.readMine()).save, newRunId())
  if (next === null) return false
  await io.put(SAVE_KEY, next)
  await io.mine(mine => ({ ...mine, save: next, pending: game.emptyDelta(next.runId), inflight: [], isLoaded: true }))
  await refresh(io, undefined, true)
  io.toast(`The mine collapsed. You hold ${next.crystals} ◆.`)
  return true
}

export async function resetMine(io: Io): Promise<boolean> {
  const isSure = await confirm(io, 'Reset Sparkmine? This deletes every spark, producer, upgrade and crystal.', 'Reset', 'Keep it')
  if (!isSure) return false
  const save = game.fresh(newRunId())
  await io.put(SAVE_KEY, save)
  await io.mine(mine => ({ ...mine, save, pending: game.emptyDelta(save.runId), inflight: [], isLoaded: true }))
  await io.reward(() => null)
  await refresh(io, undefined, true)
  return true
}
