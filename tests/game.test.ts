import { describe, expect, test } from 'claude-code/testing'

import type { Mine, Save } from '../types'
import { ACHIEVEMENTS, PRODUCERS, UPGRADES } from '../hooks/data.ts'
import { fmt, fmtRate } from '../hooks/format.ts'
import * as game from '../hooks/game.ts'

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
})

describe('income', () => {
  test('producers, upgrades, ancient stones and achievements set the rate', () => {
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 } })))).toBe(0.5)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, upgrades: ['apprentice-1'] })))).toBe(0.75)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, stones: 5 })))).toBe(0.75)
    // First vein and Big turn: 2% each.
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, veins: 1, bestTurn: 2e6 })))).toBe(0.52)
  })

  test('picks multiply clicks, and muscle memory adds a share of the rate', () => {
    expect(game.clickValue(saveWith({}))).toBe(1)
    expect(game.clickValue(saveWith({ upgrades: ['pick-1', 'pick-2', 'grip-1'] }))).toBe(8)
    expect(near(game.clickValue(saveWith({ producers: { cart: 100 }, upgrades: ['pick-4'] })))).toBe(1.5)
    expect(near(game.clickValue(saveWith({ producers: { cart: 100 }, upgrades: ['pick-4', 'pick-5', 'strike-1'] })))).toBe(4)
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

  test('there are 63 upgrades, each with its own id', () => {
    expect(UPGRADES).toHaveLength(63)
    expect(new Set(UPGRADES.map(u => u.id)).size).toBe(63)
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
      saveWith({ sparks: 5e6, lifetime: 125e6, allTime: 2e8, clicks: 40, producers: { cart: 9 }, upgrades: ['pick-1'], stones: 3, deepest: 450 }),
      'next',
    )
    expect(after).toMatchObject({ runId: 'next', sparks: 0, lifetime: 0, allTime: 2e8, stones: 8, deepest: 510, shafts: 1, clicks: 40 })
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
    expect(near(game.idleShare(saveWith({ lifetime: 1e10, upgrades: ['idle-1'] })))).toBe(0.125)
    expect(game.veinAfter('run', 1, 2).seconds).toBe(Math.round(game.veinAfter('run', 1).seconds / 2))
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
    expect(game.workEvent(run)).toBe('tests')
    expect(game.workEvent({ ...run, isError: true })).toBeNull()
    expect(game.workEvent({ ...run, background: true })).toBeNull()
    expect(game.workEvent({ ...run, command: 'git commit -m x', committed: true })).toBe('commit')
    expect(game.workEvent({ ...run, tool: 'Read' })).toBeNull()
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
})

describe('depth', () => {
  test('a hundred metres more for every tenfold of the run', () => {
    expect(game.depth(saveWith({ lifetime: 0 }))).toBe(0)
    expect(game.depth(saveWith({ lifetime: 9_000 }))).toBe(100)
    expect(game.depth(saveWith({ lifetime: 999_000 }))).toBe(300)
    expect(game.depth(saveWith({ lifetime: 99_999_000 }))).toBe(500)
    expect([0, 99, 100, 299, 300, 499, 500, 699, 700, 849, 850, 999, 1_000, 5_000].map(game.biomeAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
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
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`w${i}`, i + 1]))
    expect(Object.keys(game.normalize({ v: 1, runId: 'x', writes: { ...many, bad: -1 } })?.writes ?? {})).toHaveLength(32)
  })
})
