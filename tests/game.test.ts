import { describe, expect, test } from 'claude-code/testing'

import type { Mine, Save } from '../types'
import { UPGRADES } from '../hooks/data.ts'
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

  test('affordable counts what the sparks on hand buy', () => {
    expect(game.affordable(saveWith({ sparks: 100 }), 'apprentice', 100)).toBe(4)
    expect(game.affordable(saveWith({ sparks: 14 }), 'apprentice', 10)).toBe(0)
  })
})

describe('income', () => {
  test('producers, upgrades and crystals set the rate', () => {
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 } })))).toBe(0.5)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, upgrades: ['apprentice-1'] })))).toBe(0.75)
    expect(near(game.rate(saveWith({ producers: { apprentice: 10 }, crystals: 5 })))).toBe(0.55)
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

describe('collapse', () => {
  test('crystals come from the cube root of all-time sparks', () => {
    expect(game.crystalGain(saveWith({ allTime: 999_999 }))).toBe(0)
    expect(game.crystalGain(saveWith({ allTime: 8_000_000 }))).toBe(2)
    expect(game.crystalGain(saveWith({ allTime: 8_000_000, crystals: 1 }))).toBe(1)
  })

  test('the mine resets, and crystals, all-time sparks and counters stay', () => {
    const after = game.collapse(
      saveWith({ sparks: 5e6, lifetime: 8e6, allTime: 8e6, clicks: 40, producers: { cart: 9 }, upgrades: ['pick-1'] }),
      'next',
    )
    expect(after).toMatchObject({ runId: 'next', sparks: 0, lifetime: 0, allTime: 8e6, crystals: 2, clicks: 40 })
    expect(after?.producers).toEqual({})
    expect(after?.upgrades).toEqual([])
    expect(game.collapse(saveWith({ allTime: 10 }), 'next')).toBeNull()
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
