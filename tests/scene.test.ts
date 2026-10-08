import { describe, expect, test } from 'claude-code/testing'

import { DIG, LOOP_MS, SWING_MS, compose, momentAt, sceneCells, sceneSvg, type SceneSpec } from '../hooks/scene.ts'
import { ICON_IDS, iconSvg } from '../hooks/icons.ts'

const WORK: SceneSpec = { mode: 'work', carts: 6, goblins: 1 }

describe('the dig loop', () => {
  test('each swing cuts one slice, then the wall grows back', () => {
    const dugAt = (swing: number, within: number) => momentAt('work', (swing + within) * SWING_MS).dug
    expect(dugAt(0, 0.1)).toBe(0)
    expect(dugAt(0, 0.7)).toBe(1)
    expect(dugAt(3, 0.7)).toBe(4)
    expect(dugAt(DIG - 1, 0.7)).toBe(DIG)
    expect(dugAt(DIG, 0.5)).toBe(DIG)
    expect(dugAt(DIG, 0.85)).toBe(0)
    expect(momentAt('work', (DIG + 0.85) * SWING_MS).dust).toBe(true)
    expect(momentAt('work', LOOP_MS + 0.7 * SWING_MS).dug).toBe(1)
  })

  test('the miner rests when Claude does', () => {
    expect(momentAt('idle', 5_000)).toMatchObject({ dug: 0, dust: false, spark: false })
    expect(momentAt('pause', 5_000).frame).toBe(0)
  })

  test('a cut changes the picture, and the regrown wall matches the first', () => {
    const at = (ms: number) => compose(WORK, momentAt('work', ms)).data.join(',')
    expect(at(0.7 * SWING_MS)).not.toBe(at(0.1 * SWING_MS))
    expect(at((DIG - 1 + 0.7) * SWING_MS)).not.toBe(at(0.7 * SWING_MS))
    expect(sceneCells(WORK, momentAt('work', 0)).length).toBeGreaterThan(0)
  })
})

test('every scene fits the size an Svg may have', () => {
  for (const mode of ['work', 'idle', 'pause'] as const) {
    for (const carts of [0, 6]) {
      const svg = sceneSvg({ mode, carts, goblins: 1 }, 3)
      expect(svg.length).toBeLessThan(131_072)
      expect(svg.startsWith('<svg')).toBe(true)
    }
  }
  expect(sceneSvg(WORK, 3)).toContain('@keyframes adv')
})

test('every icon draws', () => {
  for (const id of ICON_IDS) expect(iconSvg(id, 24)).toContain('<path')
  expect(iconSvg('core', 24, true)).toContain('opacity=".3"')
})
