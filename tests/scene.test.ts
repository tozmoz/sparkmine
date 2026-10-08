import { describe, expect, test } from 'claude-code/testing'

import { CUT, CUTS, LOOP_MS, PERIOD, SWING_MS, compose, momentAt, sceneCells, sceneSvg, type SceneSpec } from '../hooks/scene.ts'
import { ICON_IDS, iconSvg } from '../hooks/icons.ts'

const WORK: SceneSpec = { mode: 'work', carts: 6, goblins: 1, pick: 0, biome: 0 }
const pixels = (ms: number) => compose(WORK, momentAt('work', ms)).data.join(',')

describe('the endless tunnel', () => {
  test('each strike slides the world one cut on, and it wraps after a period', () => {
    const scrollAt = (swing: number, within: number) => momentAt('work', (swing + within) * SWING_MS).scroll
    expect(scrollAt(0, 0.1)).toBe(0)
    expect(scrollAt(0, 0.7)).toBe(CUT)
    expect(scrollAt(4, 0.7)).toBe(5 * CUT)
    expect(scrollAt(CUTS - 1, 0.5)).toBe(PERIOD - CUT)
    expect(scrollAt(CUTS - 1, 0.7)).toBe(0)
  })

  test('the loop has no seam: a whole loop later the picture is the same', () => {
    for (const ms of [100, 700, 5_000]) expect(pixels(ms + LOOP_MS)).toBe(pixels(ms))
  })

  test('the world moves while he digs, and the last strike lands where the first began', () => {
    expect(pixels(0.7 * SWING_MS)).not.toBe(pixels(0.1 * SWING_MS))
    expect(pixels((CUTS - 1 + 0.7) * SWING_MS)).not.toBe(pixels((CUTS - 1 + 0.5) * SWING_MS))
  })

  test('every fourth strike finds ore', () => {
    const sparks = Array.from({ length: CUTS }, (_, swing) => momentAt('work', (swing + 0.7) * SWING_MS).spark)
    expect(sparks.filter(Boolean)).toHaveLength(CUTS / 4)
    expect(sparks[3]).toBe(true)
  })

  test('the miner rests when Claude does, and the world stands still', () => {
    expect(momentAt('idle', 5_000)).toMatchObject({ scroll: 0, spark: false })
    expect(momentAt('pause', 5_000)).toMatchObject({ frame: 0, scroll: 0 })
    expect(sceneCells(WORK, momentAt('work', 0)).length).toBeGreaterThan(0)
  })
})

test('every scene fits the size an Svg may have', () => {
  for (const mode of ['work', 'idle', 'pause'] as const) {
    for (const carts of [0, 6]) {
      const svg = sceneSvg({ mode, carts, goblins: 1, pick: 4, biome: 3 }, 3)
      expect(svg.length).toBeLessThan(131_072)
      expect(svg.startsWith('<svg')).toBe(true)
    }
  }
  expect(sceneSvg(WORK, 3)).toContain('@keyframes slide')
  expect(sceneSvg({ ...WORK, mode: 'idle' }, 3)).not.toContain('@keyframes slide')
})

test('the pick the miner holds is the one the upgrades bought', () => {
  const strike = momentAt('work', (3 + 0.66) * SWING_MS)
  const looks = [0, 1, 2, 3, 4].map(pick => compose({ ...WORK, pick }, strike).data.join(','))
  expect(new Set(looks).size).toBe(5)
  expect(sceneSvg({ ...WORK, pick: 3 }, 3)).toContain('#5fd4e8')
  expect(sceneSvg({ ...WORK, pick: 0 }, 3)).not.toContain('#5fd4e8')
})

test('every icon draws', () => {
  for (const id of ICON_IDS) expect(iconSvg(id, 24)).toContain('<path')
  expect(iconSvg('core', 24, true)).toContain('opacity=".3"')
})
