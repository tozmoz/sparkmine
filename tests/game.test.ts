import { describe, expect, test } from 'claude-code/testing'

import type { Mine, Save } from '../types'
import { ACHIEVEMENTS, PRODUCERS, UPGRADES } from '../hooks/data.ts'
import { fmt, fmtRate } from '../hooks/format.ts'
import * as game from '../hooks/game.ts'
import * as model from '../hooks/model.ts'

const saveWith = (patch: Partial<Save>): Save => ({ ...game.fresh('run'), ...patch })
/** Rounds away float noise, since the kit's expect has no toBeCloseTo. */
const near = (n: number) => Math.round(n * 1e6) / 1e6
const mineWith = (patch: Partial<Save>): Mine => ({ ...game.newMine('run'), save: saveWith(patch), isLoaded: true })

describe('prices', () => {
  test('each producer costs 17% more than the last, rounded up', () => {
    const apprentice = game.producer('apprentice')
    expect(game.priceOf(apprentice, 0)).toBe(15)
    expect(game.priceOf(apprentice, 1)).toBe(18)
    expect(game.priceOf(apprentice, 10)).toBe(73)
    expect(game.priceOf(apprentice, 0, 10)).toBe(341)
  })

  test('Max buys all the purse allows, in steps the label keeps a while', () => {
    const apprentice = game.producer('apprentice')
    for (const have of [0, 37, 111]) {
      for (const sparks of [1e3, 1e6, 1e9, 1e12]) {
        const n = game.affordable(apprentice, have, sparks)
        expect(game.priceOf(apprentice, have, n) <= sparks && game.priceOf(apprentice, have, n + 1) > sparks).toBe(true)
      }
    }
    expect(game.affordable(apprentice, 0, 14)).toBe(0)
    expect(game.maxCount(apprentice, 0, 14)).toBe(1)
    expect(game.maxCount(apprentice, 0, 2_000)).toBe(20)
    // 63 fit in two million: the label says 50, until 75 fit.
    expect(game.affordable(apprentice, 0, 2e6)).toBe(63)
    expect(game.maxCount(apprentice, 0, 2e6)).toBe(50)
    expect(game.maxCount(apprentice, 0, 1e9)).toBe(100)
  })
})

describe('income', () => {
  test('producers, upgrades, ancient stones and achievements set the rate', () => {
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 } })))).toBe(0.5)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, upgrades: ['apprentice-1'] })))).toBe(0.75)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, stones: 1 })))).toBe(0.55)
    // First vein and Big turn: 2% each.
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, veins: 1, bestTurn: 2e6 })))).toBe(0.52)
  })

  test('each next ancient stone adds a little less: ten add half, a hundred two and a half times', () => {
    expect(game.stoneBonus(0)).toBe(0)
    expect(near(game.stoneBonus(1))).toBe(0.1)
    expect(Math.round(game.stoneBonus(10) * 100)).toBe(50)
    expect(Math.round(game.stoneBonus(100) * 100)).toBe(251)
  })

  test('picks multiply clicks, and muscle memory adds a share of the rate', () => {
    expect(game.clickValue(saveWith({}))).toBe(1)
    expect(game.clickValue(saveWith({ upgrades: ['pick-1', 'pick-2', 'grip-1'] }))).toBe(8)
    // 100 carts mine 50/s: 2% of it, then 2 + 4 + 6%.
    expect(near(game.clickValue(saveWith({ producers: { cart: 100 }, upgrades: ['pick-4'] })))).toBe(2)
    expect(near(game.clickValue(saveWith({ producers: { cart: 100 }, upgrades: ['pick-4', 'pick-5', 'strike-1'] })))).toBe(7)
  })

  test("the foreman's upgrades grow each click with the crew, and the picks leave that share alone", () => {
    const crew = { apprentice: 10, cart: 10 }
    expect(near(game.clickValue(saveWith({ producers: crew, upgrades: ['foreman-1'] })))).toBe(1 + 0.2 * 20)
    expect(near(game.clickValue(saveWith({ producers: crew, upgrades: ['foreman-1', 'pick-1'] })))).toBe(2 + 0.2 * 20)
    expect(near(game.clickValue(saveWith({ producers: crew, upgrades: ['foreman-1', 'foreman-2'] })))).toBe(1 + 1.2 * 20)
  })

  test('a gem is worth ten clicks, and the loupe and geode sense grow them', () => {
    // A save's rolls are the same every time, so the gems it strikes are too.
    const at = (clicks: number) => game.clickRoll(saveWith({ clicks }))
    expect(at(7)).toBe(at(7))
    let gem = 0
    while (at(gem) >= 0.04) gem += 1
    let miss = 0
    while (at(miss) < 0.08) miss += 1
    const lucky = ['pick-1', 'gem-1']
    expect(game.strike(saveWith({ clicks: gem, upgrades: lucky }))).toEqual({ value: 20, isGem: true })
    expect(game.strike(saveWith({ clicks: miss, upgrades: lucky }))).toEqual({ value: 2, isGem: false })
    expect(game.strike(saveWith({ clicks: gem, upgrades: [...lucky, 'gem-2'] })).value).toBe(40)
    expect(game.strike(saveWith({ clicks: gem, upgrades: ['pick-1'] }))).toEqual({ value: 2, isGem: false })
    expect(game.multipliers(saveWith({ upgrades: ['gem-1', 'gem-3'] })).gemChance).toBe(0.08)
  })

  test('about 1 click in 25 strikes a gem', () => {
    let gems = 0
    for (let clicks = 0; clicks < 20_000; clicks += 1) if (game.clickRoll(saveWith({ clicks })) < 0.04) gems += 1
    expect(gems).toBeGreaterThan(700)
    expect(gems).toBeLessThan(900)
  })

  test('a tool call is worth its base, its multiplier and seconds of the rate', () => {
    expect(game.toolValue(saveWith({}), 'edit')).toBe(4)
    expect(game.toolValue(saveWith({}), 'read')).toBe(1)
    expect(near(game.toolValue(saveWith({ producers: { cart: 10 }, upgrades: ['tool-edit', 'ore-1'] }), 'edit'))).toBe(37)
  })

  test('the crew rests while Claude is idle until a shift upgrade', () => {
    expect(game.idleShare(saveWith({}))).toBe(0)
    expect(game.idleShare(saveWith({ upgrades: ['idle-1'] }))).toBe(0.1)
    expect(game.idleShare(saveWith({ upgrades: ['idle-1', 'idle-2'] }))).toBe(0.25)
  })
})

describe('buying', () => {
  test('a producer costs sparks and is recorded for the next sync', () => {
    const next = game.buyProducer(mineWith({ sparks: 100 }), 'apprentice', 2)
    expect(next?.save.sparks).toBe(100 - 15 - 18)
    expect(next?.save.producers.apprentice).toBe(2)
    expect(next?.pending.producers.apprentice).toBe(2)
    expect(next?.pending.sparks).toBe(-33)
    expect(game.buyProducer(mineWith({ sparks: 10 }), 'apprentice', 1)).toBeNull()
  })

  test('an upgrade waits for its unlock', () => {
    expect(game.buyUpgrade(mineWith({ sparks: 1_000, clicks: 24 }), 'pick-1')).toBeNull()
    const bought = game.buyUpgrade(mineWith({ sparks: 1_000, clicks: 25 }), 'pick-1')
    expect(bought?.save.upgrades).toEqual(['pick-1'])
    expect(bought?.save.sparks).toBe(900)
    expect(game.buyUpgrade(bought ?? mineWith({}), 'pick-1')).toBeNull()
  })

  test('the shop lists what is on sale and the closest unlock', () => {
    const { onSale, next } = game.shopUpgrades(saveWith({ clicks: 30, producers: { apprentice: 1 } }))
    expect(onSale.map(u => u.id)).toEqual(['pick-1', 'apprentice-1'])
    expect(next?.id).toBe('pick-2')
  })

  test('a line of upgrades doing the same goes on sale a tier at a time', () => {
    const drills = saveWith({ producers: { drill: 5 } })
    const ids = (save: Save) => game.shopUpgrades(save).onSale.map(u => u.id)
    expect(ids(drills)).toContain('drill-1')
    expect(ids(drills)).not.toContain('drill-2')
    const bought = saveWith({ producers: { drill: 5 }, upgrades: ['drill-1'] })
    expect(ids(bought)).toContain('drill-2')
    expect(game.buyUpgrade(mineWith({ sparks: 1e9, producers: { drill: 5 } }), 'drill-2')).toBeNull()
    expect(UPGRADES.find(u => u.id === 'drill-2')).toMatchObject({ name: 'Pressure valves', blurb: 'Steam drills mine 50% more again.', after: 'drill-1' })
    // A tier waits behind the one before it: no goal that the shop could not sell when reached.
    expect(game.shopUpgrades(saveWith({ clicks: 30 })).next?.id).toBe('pick-2')
    expect(game.shopUpgrades(saveWith({ clicks: 150 })).next?.id).not.toBe('grip-1')
  })

  test('no two upgrades on sale do the same, and every line runs cheapest first', () => {
    for (const u of UPGRADES) {
      if (u.after === undefined) continue
      const before = UPGRADES.find(o => o.id === u.after)
      expect(before === undefined ? null : [JSON.stringify(before.effect), before.cost < u.cost]).toEqual([JSON.stringify(u.effect), true])
    }
    const everything = saveWith({ clicks: 1e6, tools: 1e6, turns: 1e6, allTime: 1e12, producers: Object.fromEntries(PRODUCERS.map(p => [p.id, 100])) })
    const effects = game.shopUpgrades(everything).onSale.map(u => JSON.stringify(u.effect))
    expect(new Set(effects).size).toBe(effects.length)
  })

  test('there are 79 upgrades, each with its own id', () => {
    expect(UPGRADES).toHaveLength(79)
    expect(new Set(UPGRADES.map(u => u.id)).size).toBe(79)
  })

  test('a mine with a crew of 59 finds the new click upgrades on sale', () => {
    const save = saveWith({ clicks: 2_930, producers: { apprentice: 34, cart: 16, goblin: 8, drill: 1 }, upgrades: ['pick-1', 'pick-2', 'pick-3'] })
    const onSale = game.shopUpgrades(save).onSale.map(u => u.id)
    expect(onSale).toContain('grip-1')
    expect(onSale).toContain('foreman-1')
    expect(onSale).toContain('gem-1')
    expect(onSale).toContain('pick-4')
  })
})

describe('a new shaft', () => {
  test('pays the cube root of the run\'s sparks in stones, from 500 m down', () => {
    // 50M is 470 m: not yet. 125M is 510 m, and the cube root of 125 is 5.
    expect(game.stoneGain(saveWith({ lifetime: 50e6 }))).toBe(0)
    expect(game.stoneGain(saveWith({ lifetime: 125e6 }))).toBe(5)
    expect(game.stoneGain(saveWith({ lifetime: 1e9 }))).toBe(10)
  })

  test('starts the mine over, and the stones, records and counters stay', () => {
    const after = game.openShaft(
      saveWith({ sparks: 5e6, lifetime: 125e6, allTime: 2e8, clicks: 40, producers: { cart: 9 }, upgrades: ['pick-1'], stones: 3, deepest: 450, idleAt: 9 }),
      'next',
    )
    expect(after).toMatchObject({ runId: 'next', sparks: 0, lifetime: 0, allTime: 2e8, stones: 8, deepest: 510, shafts: 1, clicks: 40, idleAt: 9 })
    expect(after?.producers).toEqual({})
    expect(after?.upgrades).toEqual([])
    expect(game.openShaft(saveWith({ lifetime: 50e6, allTime: 50e6 }), 'next')).toBeNull()
    // The layers' perks went with the run; the achievements stay.
    if (after === null) throw new Error('no shaft')
    expect(game.multipliers(after).veinSpeed).toBe(1)
    expect(game.achievements(after).map(a => a.id)).toEqual(['hard-rock', 'crystal-caves', 'magma', 'shaft'])
  })
})

describe('layers', () => {
  test('each layer reached adds its perk for the rest of the run', () => {
    const at = (lifetime: number) => game.multipliers(saveWith({ lifetime }))
    // 9K is 100 m, the stone: clicks mine 50% more, and Hard rock adds 2%.
    expect(near(game.clickValue(saveWith({ lifetime: 9_000 })))).toBe(1.53)
    expect(at(1e6).gemChance).toBe(0.02)
    expect(at(1e8)).toMatchObject({ veinSpeed: 2, idleMult: 1, events: 1 })
    expect(at(1e10)).toMatchObject({ veinSpeed: 2, idleMult: 1.25, events: 1 })
    expect(at(3.2e11)).toMatchObject({ idleMult: 1.25, events: 2 })
    // The core: 25% more, and six depth achievements add 12%.
    expect(near(at(1e13).global)).toBe(1.4)
    // Past it: gems worth twice as much, tool calls mining twice as much, and on the far side half again the stones.
    expect(at(1e14).gemWorth).toBe(20)
    expect(at(1e15).tool).toMatchObject({ read: 2, edit: 2, bash: 2, mcp: 2 })
    expect(game.stoneGain(saveWith({ lifetime: 1e15 }))).toBe(1_000)
    expect(game.stoneGain(saveWith({ lifetime: 1e16 }))).toBe(3_231)
    expect(near(game.idleShare(saveWith({ lifetime: 1e10, upgrades: ['idle-1'] })))).toBe(0.125)
    expect(game.veinAfter('run', 1, 2).seconds).toBe(Math.round(game.veinAfter('run', 1).seconds / 2))
  })
})

describe('the shared card', () => {
  test('leaves out what is not done yet, and names the core as a place', () => {
    expect(model.shareCard(saveWith({}))).toBe(['⛏️ Sparkmine · 0 m in the Topsoil', '🟫⬛⬛⬛⬛⬛⬛⬛⬛⬛', '✻ 0 mined · ★ 0/42', 'github.com/tozmoz/sparkmine'].join('\n'))
    const core = model.shareCard(saveWith({ lifetime: 1e13, allTime: 3e13, stones: 1, veins: 1 }))
    expect(core.split('\n').slice(0, 4)).toEqual(['⛏️ Sparkmine · 1,000 m at the core', '🟫⬜🟪🟧🟦🟨🟥⬛⬛⬛', '✻ 30.00T mined · ◈ 1 stone · ★ 9/42', '1 vein'])
    const far = model.shareCard(saveWith({ lifetime: 2e16, allTime: 2e16 }))
    expect(far.split('\n').slice(0, 2)).toEqual(['⛏️ Sparkmine · 1,330 m on the far side', '🟫⬜🟪🟧🟦🟨🟥💎🟩🌏'])
  })
})

describe('secrets', () => {
  test('a prompt finds thanks in a few languages, and ultrathink', () => {
    expect(game.promptSecrets('thanks, that works')).toEqual(['good-manners'])
    expect(game.promptSecrets('Teşekkürler!')).toEqual(['good-manners'])
    expect(game.promptSecrets('merci beaucoup')).toEqual(['good-manners'])
    expect(game.promptSecrets('ultrathink about the cache')).toEqual(['deep-thinker'])
    expect(game.promptSecrets('thank you, now ultrathink')).toEqual(['good-manners', 'deep-thinker'])
    expect(game.promptSecrets('fix the type error in the parser')).toEqual([])
  })

  test("Claude's catchphrase, a Friday after four, a turn through midnight, an initial commit", () => {
    expect(game.isAbsolutelyRight("You're absolutely right! The loop never ends.")).toBe(true)
    expect(game.isAbsolutelyRight('You are absolutely right.')).toBe(true)
    expect(game.isAbsolutelyRight('That is right.')).toBe(false)
    const friday = new Date(2026, 9, 16, 16, 30).getTime()
    expect(new Date(friday).getDay()).toBe(5)
    expect(game.isFridayAfternoon(friday)).toBe(true)
    expect(game.isFridayAfternoon(new Date(2026, 9, 16, 15, 59).getTime())).toBe(false)
    expect(game.isFridayAfternoon(new Date(2026, 9, 17, 17, 0).getTime())).toBe(false)
    const justAfter = new Date(2026, 9, 17, 0, 2).getTime()
    expect(game.crossesMidnight(justAfter, 5 * 60_000)).toBe(true)
    expect(game.crossesMidnight(justAfter, 60_000)).toBe(false)
    const commit = { tool: 'Bash', isError: false, interrupted: false, background: false, committed: true }
    expect(game.isInitialCommit({ ...commit, command: 'git add -A && git commit -m "Initial commit"' })).toBe(true)
    expect(game.isInitialCommit({ ...commit, command: 'git commit -m "Fix the parser"' })).toBe(false)
    expect(game.isInitialCommit({ ...commit, committed: false, command: 'git commit -m "Initial commit"' })).toBe(false)
  })

  test('a secret is kept for good: through a sync, a new shaft and a save read back', () => {
    const found = game.findSecret(mineWith({ lifetime: 125e6 }), 'good-manners')
    expect(game.findSecret(found, 'good-manners')).toBe(found)
    const merged = game.applyDelta(saveWith({ secrets: ['groundbreaking'] }), found.pending)
    expect(merged.secrets).toEqual(['groundbreaking', 'good-manners'])
    expect(game.openShaft(found.save, 'next')?.secrets).toEqual(['good-manners'])
    expect(game.normalize({ v: 1, runId: 'x', secrets: ['good-manners', 'nonsense', 'good-manners'] })?.secrets).toEqual(['good-manners'])
  })

  test('a secret shows as ??? until found, and is never the next goal', () => {
    const names = (save: Save) => model.shopModel(save, 1, true).achievements.filter(a => a.id === 'good-manners').map(a => a.name)
    expect(names(saveWith({}))).toEqual(['???'])
    expect(names(saveWith({ secrets: ['good-manners'] }))).toEqual(['Good manners'])
    expect(ACHIEVEMENTS.filter(a => a.goal.kind === 'secret')).toHaveLength(9)
    // Everything but the secrets earned: no goal is left to show.
    const almost = saveWith({ allTime: 1e13, deepest: 1_300, veins: 100, gems: 1_000, clicks: 10_000, tools: 1_000, shafts: 10, stones: 500, bestTurn: 1e9, bestStreak: 25,
      events: { tests: 100, commit: 100, longShift: 10, fix: 25, merge: 10 } })
    expect(game.nextAchievement(almost)).toBeNull()
  })
})

describe('achievements', () => {
  test('are read off the records, and the closest unearned one is next', () => {
    expect(game.achievements(saveWith({}))).toEqual([])
    const save = saveWith({ veins: 20, bestTurn: 2e6, deepest: 520, events: { commit: 3 } })
    expect(game.achievements(save).map(a => a.name)).toEqual(['First vein', 'Hard rock', 'Crystal caves', 'Into the magma', 'Big turn'])
    expect(game.nextAchievement(save)?.name).toBe('Vein hunter')
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length)
  })
})

describe('the idle pace', () => {
  // 100 carts mine 50/s, and Night shift keeps a tenth of it, 5/s, while Claude is idle.
  const stored = saveWith({ producers: { cart: 100 }, upgrades: ['idle-1'], chain: 'c' })
  const idleFor = (mine: Mine, from: number, to: number) => game.payCrew(mine, 5 * ((to - from) / 1000), 0, from, to)

  test('is paid once, however many sessions mine it', () => {
    // Two sessions idle through the same ten seconds, and sync one after the other.
    const a = game.syncMine(stored, idleFor(mineWith(stored), 0, 10_000), 'a')
    const b = idleFor(mineWith(stored), 0, 10_000)
    expect(near(b.save.sparks)).toBe(50)
    const synced = game.syncMine(a.save, b, 'b')
    expect(near(synced.save.sparks)).toBe(50)
    expect(near(synced.save.bySource.crew ?? 0)).toBe(50)
    expect(synced.save.idleAt).toBe(10_000)
    // Each counter ran on smoothly: the save holds just what each one showed.
    expect(near(synced.mine.save.sparks)).toBe(50)
    // Moments no other session reached yet are paid.
    expect(near(game.syncMine(synced.save, idleFor(a.mine, 10_000, 14_000), 'a').save.sparks)).toBe(70)
  })

  test('a write another session wrote over does not pay it twice', () => {
    // Both read the same save, and the other session's write lands last.
    const first = game.syncMine(stored, idleFor(mineWith(stored), 0, 10_000), 'a')
    const other = game.syncMine(stored, idleFor(mineWith(stored), 0, 12_000), 'b')
    expect(near(other.save.sparks)).toBe(60)
    // The first lays its lost write over again, but the other paid those moments already.
    const again = game.syncMine(other.save, idleFor(first.mine, 10_000, 15_000), 'x')
    expect(near(again.save.sparks)).toBe(75)
    expect(again.save.idleAt).toBe(15_000)
  })

  test("Claude's work lifts the crew to its full rate on top of it, once", () => {
    // One session idles while the other works: 50/s in all, as one session working alone.
    const idle = game.syncMine(stored, idleFor(mineWith(stored), 0, 10_000), 'a')
    const working = game.syncMine(idle.save, game.payCrew(mineWith(stored), 50, 450, 0, 10_000), 'b')
    expect(near(working.save.sparks)).toBe(500)
    expect(near(working.save.bySource.crew ?? 0)).toBe(500)
  })
})

describe('sync', () => {
  test('two sessions mining at once both count', () => {
    const stored = saveWith({ sparks: 100, lifetime: 100, allTime: 100 })
    const first = game.earn(mineWith(stored), 50, { kind: 'tool', tool: 'read' }).pending
    const second = game.buyProducer(mineWith(stored), 'apprentice', 1)?.pending
    const merged = game.applyDelta(game.applyDelta(stored, first), second ?? game.emptyDelta('run'))
    expect(merged.sparks).toBe(100 + 50 - 15)
    expect(merged.allTime).toBe(150)
    expect(merged.producers.apprentice).toBe(1)
    expect(merged.mined.read).toBe(1)
  })

  test('after a collapse elsewhere, only earnings carry over', () => {
    const stored = saveWith({ runId: 'new', sparks: 0 })
    const delta = { ...game.emptyDelta('old'), sparks: -10, earned: 30, producers: { cart: 2 } }
    const merged = game.applyDelta(stored, delta)
    expect(merged.sparks).toBe(30)
    expect(merged.producers).toEqual({})
  })

  test('a purchase another session wrote over goes in again, once', () => {
    const stored = saveWith({ sparks: 100, lifetime: 100, allTime: 100, chain: 'c' })
    const bought = game.buyProducer(mineWith(stored), 'apprentice', 1)
    const mined = game.earn(mineWith(stored), 10, { kind: 'crew' })
    if (bought === null) throw new Error('could not buy')
    // Both read the same save; the other session's write lands last and drops the purchase.
    const first = game.syncMine(stored, bought, 'a')
    const other = game.syncMine(stored, mined, 'b')
    expect(other.save.producers).toEqual({})
    // The next sync sees its write is missing and lays the purchase over again: it never shows undone.
    const again = game.syncMine(other.save, first.mine, 'x')
    expect(again.isWrite).toBe(true)
    expect(again.save).toMatchObject({ sparks: 100 - 15 + 10, producers: { apprentice: 1 } })
    expect(again.mine.save.producers).toEqual({ apprentice: 1 })
    // Once the store holds it, it is not counted twice, and the other session takes it in.
    const settled = game.syncMine(again.save, again.mine, 'x')
    expect(settled.isWrite).toBe(false)
    expect(settled.mine.save.sparks).toBe(95)
    expect(game.syncMine(again.save, other.mine, 'x').mine.save.producers).toEqual({ apprentice: 1 })
  })

  test('a write another session built on is not laid over again', () => {
    const stored = saveWith({ sparks: 100 })
    const bought = game.buyProducer(mineWith(stored), 'apprentice', 1)
    if (bought === null) throw new Error('could not buy')
    const first = game.syncMine(stored, bought, 'a')
    const other = game.syncMine(first.save, game.earn(mineWith(first.save), 10, { kind: 'crew' }), 'b')
    const next = game.syncMine(other.save, first.mine, 'x')
    expect(next.isWrite).toBe(false)
    expect(next.mine.save).toMatchObject({ sparks: 95, producers: { apprentice: 1 } })
    expect(Object.keys(next.mine.save.writes)).toEqual(['a', 'b'])
  })

  test('after a write by an older version, nothing is laid over twice', () => {
    const stored = saveWith({ sparks: 100, chain: 'c' })
    const bought = game.buyProducer(mineWith(stored), 'apprentice', 1)
    if (bought === null) throw new Error('could not buy')
    const first = game.syncMine(stored, bought, 'a')
    // An older version reads that write and writes it back without the record; then a new one writes.
    const older = game.normalize({ ...first.save, writes: undefined, chain: undefined })
    if (older === null) throw new Error('not a save')
    const other = game.syncMine(older, game.earn(mineWith(older), 10, { kind: 'crew' }), 'b')
    expect(other.save.chain).toBe('b')
    const next = game.syncMine(other.save, first.mine, 'x')
    expect(next.isWrite).toBe(false)
    expect(next.mine.save).toMatchObject({ sparks: 95, producers: { apprentice: 1 } })
  })

  test('a reset elsewhere is not undone by a lost write', () => {
    const bought = game.buyProducer(mineWith({ sparks: 100 }), 'apprentice', 1)
    if (bought === null) throw new Error('could not buy')
    const first = game.syncMine(saveWith({ sparks: 100 }), bought, 'a')
    const next = game.syncMine(game.fresh('new'), first.mine, 'x')
    expect(next.isWrite).toBe(false)
    expect(next.mine.save).toMatchObject({ runId: 'new', sparks: 0, producers: {} })
  })

  test('a save from the store is checked field by field', () => {
    expect(game.normalize(null)).toBeNull()
    expect(game.normalize({ v: 2, runId: 'x' })).toBeNull()
    const save = game.normalize({ v: 1, runId: 'x', sparks: -5, clicks: 3.7, upgrades: ['pick-1', 'nope', 'pick-1'], producers: { cart: 2, dragon: 9 } })
    expect(save).toMatchObject({ sparks: 0, clicks: 3, upgrades: ['pick-1'], producers: { cart: 2 } })
  })
})

test('the pick tier follows the pick upgrades', () => {
  expect(game.pickTier(saveWith({}))).toBe(0)
  expect(game.pickTier(saveWith({ upgrades: ['pick-1'] }))).toBe(1)
  expect(game.pickTier(saveWith({ upgrades: ['pick-1', 'pick-2', 'pick-3'] }))).toBe(3)
  expect(game.pickTier(saveWith({ upgrades: ['pick-4', 'pick-6'] }))).toBe(4)
})

test('tools are sorted into kinds', () => {
  expect(game.classifyTool('Grep')).toBe('read')
  expect(game.classifyTool('Write')).toBe('edit')
  expect(game.classifyTool('Bash')).toBe('bash')
  expect(game.classifyTool('WebFetch')).toBe('web')
  expect(game.classifyTool('Agent')).toBe('agent')
  expect(game.classifyTool('mcp__github__issue')).toBe('mcp')
  expect(game.classifyTool('TodoWrite')).toBe('other')
})

test('numbers read short', () => {
  expect(fmt(1_234)).toBe('1,234')
  expect(fmt(123_456)).toBe('123.5K')
  expect(fmt(999_999)).toBe('1.00M')
  expect(fmt(1_234_567)).toBe('1.23M')
  expect(fmtRate(2.25)).toBe('2.3')
  expect(fmtRate(9.96)).toBe('10')
})

describe('the work behind the mine', () => {
  test('test runs and commits are told from every other command', () => {
    for (const cmd of ['npm test', 'pnpm run test -- --watch=false', 'cd app && npx vitest run', 'go test ./...', 'cargo test', 'python -m pytest -q', 'CI=1 yarn test', '"$CLI" plugin test "$PWD" 2>&1 | tail -3']) {
      expect(game.isTestCommand(cmd)).toBe(true)
    }
    for (const cmd of ['ls tests', 'cat jest.config.js', 'grep -r vitest .', 'git commit -m test', 'echo npm test']) {
      expect(game.isTestCommand(cmd)).toBe(false)
    }
    const run = { tool: 'Bash', command: 'npm test', isError: false, interrupted: false, background: false, committed: false }
    expect(game.workEvents(run)).toEqual(['tests'])
    expect(game.workEvents({ ...run, isError: true })).toEqual([])
    expect(game.workEvents({ ...run, background: true })).toEqual([])
    expect(game.workEvents({ ...run, command: 'git commit -m x', committed: true })).toEqual(['commit'])
    expect(game.workEvents({ ...run, tool: 'Read' })).toEqual([])
  })

  test('builds, lints and pull requests are told apart, and one command can be several', () => {
    const run = (command: string) => game.workEvents({ tool: 'Bash', command, isError: false, interrupted: false, background: false, committed: false })
    for (const cmd of ['npm run build', 'pnpm build', 'npx tsc', 'cargo build --release', 'go build ./...', 'make', 'npx vite build', './gradlew assemble']) {
      expect([cmd, run(cmd)]).toEqual([cmd, ['build']])
    }
    for (const cmd of ['npm run lint', 'npx eslint src', 'npx tsc --noEmit', 'ruff check .', 'cargo clippy', 'golangci-lint run', '"$CLI" plugin validate .']) {
      expect([cmd, run(cmd)]).toEqual([cmd, ['lint']])
    }
    expect(run('gh pr create --title Fix --body Done')).toEqual(['pr'])
    expect(run('gh pr merge 15 --squash --delete-branch')).toEqual(['merge'])
    // --auto only asks to merge once the checks pass: nothing is merged yet.
    expect(run('gh pr merge 15 --auto --squash')).toEqual([])
    expect(run('npm run lint && npm run build && npm test')).toEqual(['tests', 'build', 'lint'])
    for (const cmd of ['make test', 'gh pr view 15', 'gh pr list', 'echo npm run build', 'cat Makefile']) {
      expect([cmd, run(cmd).filter(e => e !== 'tests')]).toEqual([cmd, []])
    }
  })

  test('a test run is read as passed or failed; one cut short or in the background says nothing', () => {
    const run = { tool: 'Bash', command: 'npm test', isError: false, interrupted: false, background: false, committed: false }
    expect(game.testRun(run)).toBe('passed')
    expect(game.testRun({ ...run, isError: true })).toBe('failed')
    expect(game.testRun({ ...run, interrupted: true })).toBeNull()
    expect(game.testRun({ ...run, background: true })).toBeNull()
    expect(game.testRun({ ...run, command: 'npm run build' })).toBeNull()
  })

  test('tests that fail behind a pipe or an echo are read off what they printed', () => {
    const piped = { tool: 'Bash', command: 'npm test 2>&1 | tail -20', isError: false, interrupted: false, background: false, committed: false }
    const failing = [
      '  3 passing\n  2 failing',
      'Tests:       1 failed, 4 passed, 5 total',
      'FAIL src/mine.test.ts',
      '=========== 1 failed, 12 passed in 0.31s ===========',
      '--- FAIL: TestDig (0.00s)\nFAIL\tsparkmine/dig\t0.01s',
      'test result: FAILED. 3 passed; 1 failed; 0 ignored',
      'FAILED (failures=1)',
      'not ok 2 - digs deeper',
      '5 examples, 1 failure',
    ]
    for (const output of failing) expect(game.testRun({ ...piped, output })).toBe('failed')
    for (const output of ['  5 passing', 'Tests:       0 failed, 5 passed', '12 passed in 0.2s', 'ok 1 - digs\n# fail 0', 'test result: ok. 4 passed; 0 failed']) {
      expect(game.testRun({ ...piped, output })).toBe('passed')
    }
    // A failing run pays no "Tests pass".
    expect(game.workEvents({ ...piped, output: '  2 failing' })).toEqual([])
    expect(game.workEvents({ ...piped, output: '  5 passing' })).toEqual(['tests'])
    expect(game.outcomeOf('Bash', { command: 'npm test; echo done' }, { result: { stdout: '1 failing\ndone', stderr: '', interrupted: false } }).output).toBe('1 failing\ndone')
  })

  test("a call's outcome is read off its input and result", () => {
    const commit = game.outcomeOf('Bash', { command: 'git commit -m x' }, { result: { interrupted: false, gitOperation: { commit: { sha: 'a', kind: 'committed' } } } })
    expect(commit).toMatchObject({ tool: 'Bash', committed: true, isError: false })
    expect(game.outcomeOf('Bash', { command: 'npm test', run_in_background: true }, { result: {} }).background).toBe(true)
    expect(game.outcomeOf('Bash', { command: 'npm test' }, { result: {}, isError: true }).isError).toBe(true)
  })

  test('work events pay seconds of the rate, and never less than their clicks', () => {
    expect(game.eventValue(saveWith({}), 'tests')).toBe(10)
    expect(near(game.eventValue(saveWith({ producers: { cart: 10 } }), 'tests'))).toBe(150)
    expect(near(game.eventValue(saveWith({ producers: { cart: 10 } }), 'longShift'))).toBe(450)
    expect(game.veinValue(saveWith({}))).toBe(30)
  })

  test('the work upgrades double their own events once Claude has done enough of them', () => {
    const ci = UPGRADES.find(u => u.id === 'ci-1')
    if (ci === undefined) throw new Error('no CI pipeline')
    expect(game.isUnlocked(saveWith({ events: { build: 20, lint: 4 } }), ci)).toBe(false)
    expect(game.isUnlocked(saveWith({ events: { build: 20, lint: 5 } }), ci)).toBe(true)
    expect(model.unlockText(ci)).toBe('after 25 passing builds and lints')
    const crew = { producers: { cart: 10 }, upgrades: ['ci-1'] }
    expect(near(game.eventValue(saveWith(crew), 'build'))).toBe(150)
    expect(near(game.eventValue(saveWith(crew), 'lint'))).toBe(150)
    expect(near(game.eventValue(saveWith(crew), 'tests'))).toBe(150)
  })
})

describe('depth', () => {
  test('a hundred metres more for every tenfold of the run', () => {
    expect(game.depth(saveWith({ lifetime: 0 }))).toBe(0)
    expect(game.depth(saveWith({ lifetime: 9_000 }))).toBe(100)
    expect(game.depth(saveWith({ lifetime: 999_000 }))).toBe(300)
    expect(game.depth(saveWith({ lifetime: 99_999_000 }))).toBe(500)
    expect([0, 99, 100, 299, 300, 499, 500, 699, 700, 849, 850, 999, 1_000, 1_099].map(game.biomeAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
    expect([1_100, 1_199, 1_200, 1_299, 1_300, 5_000].map(game.biomeAt)).toEqual([7, 7, 8, 8, 9, 9])
  })
})

describe('veins', () => {
  test('the first comes after a minute and a half to three of work, the rest after five to ten', () => {
    const kinds = new Set<string>()
    for (let n = 0; n < 40; n += 1) {
      const { seconds, kind } = game.veinAfter('run', n)
      kinds.add(kind)
      if (n === 0) expect(seconds >= 90 && seconds < 180).toBe(true)
      else expect(seconds >= 300 && seconds < 600).toBe(true)
    }
    expect([...kinds].sort()).toEqual(['frenzy', 'rich'])
  })

  test('the divining rod brings them half again as often, and gold fever makes a frenzy last twice as long', () => {
    const rod = game.multipliers(saveWith({ upgrades: ['vein-1'] }))
    expect(rod.veinSpeed).toBe(1.5)
    expect(game.veinAfter('run', 3, rod.veinSpeed).seconds).toBe(Math.round(game.veinAfter('run', 3).seconds / 1.5))
    expect(game.multipliers(saveWith({ upgrades: ['vein-2'] })).frenzyTime).toBe(2)
    const fever = UPGRADES.find(u => u.id === 'vein-2')
    if (fever === undefined) throw new Error('no Gold fever')
    expect(model.unlockText(fever)).toBe('after 25 veins caught')
  })
})

describe('stats', () => {
  test('earnings are counted by where they came from, and ride along a sync', () => {
    let mine = mineWith({})
    mine = game.earn(mine, 5, { kind: 'crew' })
    mine = game.earn(mine, 40, { kind: 'click', isGem: true })
    mine = game.earn(mine, 20, { kind: 'event', event: 'tests' })
    mine = game.earn(mine, 0, { kind: 'vein' })
    mine = game.recordTurn(mine, 65)
    expect(mine.save).toMatchObject({ bySource: { crew: 5, click: 40, event: 20 }, gems: 1, veins: 1, events: { tests: 1 }, bestTurn: 65 })
    const merged = game.applyDelta(saveWith({ bestTurn: 100, gems: 2 }), mine.pending)
    expect(merged).toMatchObject({ bySource: { crew: 5, click: 40, event: 20 }, gems: 3, veins: 1, events: { tests: 1 }, bestTurn: 100 })
  })

  test('stats survive a new shaft, and an older save reads with none', () => {
    const after = game.openShaft(saveWith({ lifetime: 125e6, allTime: 2e8, bySource: { crew: 9 }, gems: 4, bestTurn: 77 }), 'next')
    expect(after).toMatchObject({ bySource: { crew: 9 }, gems: 4, bestTurn: 77 })
    // The crystals of the collapse a new shaft replaced come back as stones.
    expect(game.normalize({ v: 1, runId: 'old', crystals: 3 })).toMatchObject({ stones: 3, deepest: 0, shafts: 0 })
    expect(game.normalize({ v: 1, runId: 'old', sparks: 5 })).toMatchObject({ bySource: {}, gems: 0, veins: 0, events: {}, bestTurn: 0 })
    const old = { ...game.newMine('old'), save: { v: 1, runId: 'old', sparks: 5 } as unknown as Save }
    expect(game.normalizeMine(old).save).toMatchObject({ sparks: 5, bySource: {}, events: {} })
    expect(game.normalizeMine(old).pending).toMatchObject({ bySource: {}, gems: 0 })
    expect(game.normalizeMine(old)).toMatchObject({ writer: '', seq: 0, inflight: [] })
    // Nothing of the idle pace is paid yet, and a delta kept from before an update carries none.
    expect(game.normalize({ v: 1, runId: 'old' })?.idleAt).toBe(0)
    expect(game.normalizeMine({ ...old, pending: { ...old.pending, idle: undefined } as never }).pending.idle).toBeNull()
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`w${i}`, i + 1]))
    expect(Object.keys(game.normalize({ v: 1, runId: 'x', writes: { ...many, bad: -1 } })?.writes ?? {})).toHaveLength(32)
  })
})
