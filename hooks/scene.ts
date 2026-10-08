// The mine above the prompt, drawn pixel by pixel. One picture, two outputs:
// an SVG whose CSS animates the miner (desktop), and Raster cells, two
// pixels to a cell, that a timer flips through (terminal).

import type { Mode } from '../types'

export const W = 64
export const H = 24
/** Terminal rows: each cell is an upper half block, so two pixels tall. */
export const ROWS = H / 2

const CLEAR = -1

export type SceneSpec = { mode: Mode; carts: number; goblins: number }

/** One pose of the miner: `t` runs from the strike (0) to the raised pick (1); null rests. */
export type Frame = { at: number; t: number | null; bob: number; chips: boolean }

export const SWING_MS = 900
export const SWING: readonly Frame[] = [
  { at: 0, t: 0.3, bob: 0, chips: false },
  { at: 0.1, t: 0.6, bob: 0, chips: false },
  { at: 0.2, t: 0.85, bob: 0, chips: false },
  { at: 0.3, t: 1, bob: 0, chips: false },
  { at: 0.56, t: 0.5, bob: 0, chips: false },
  { at: 0.64, t: 0, bob: 1, chips: true },
  { at: 0.76, t: 0, bob: 0, chips: false },
]
export const IMPACT_AT = 0.64

export const REST_MS = 1600
export const REST: readonly Frame[] = [
  { at: 0, t: null, bob: 0, chips: false },
  { at: 0.5, t: null, bob: 1, chips: false },
]

export function framesFor(mode: Mode): { frames: readonly Frame[]; ms: number } {
  if (mode === 'work') return { frames: SWING, ms: SWING_MS }
  if (mode === 'pause') return { frames: REST.slice(0, 1), ms: REST_MS }
  return { frames: REST, ms: REST_MS }
}

/** Which frame shows `ms` into the loop. */
export function frameAt(frames: readonly Frame[], loopMs: number, ms: number): number {
  const at = (((ms % loopMs) + loopMs) % loopMs) / loopMs
  let index = 0
  frames.forEach((frame, i) => {
    if (frame.at <= at) index = i
  })
  return index
}

class Pixels {
  data: Int32Array

  constructor(from?: Pixels) {
    this.data = from ? from.data.slice() : new Int32Array(W * H).fill(CLEAR)
  }

  set(x: number, y: number, color: number): void {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px >= 0 && px < W && py >= 0 && py < H) this.data[py * W + px] = color
  }

  get(x: number, y: number): number {
    return this.data[y * W + x] ?? CLEAR
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const tx = Math.round(x1)
    const ty = Math.round(y1)
    const dx = Math.abs(tx - x)
    const dy = -Math.abs(ty - y)
    const sx = x < tx ? 1 : -1
    const sy = y < ty ? 1 : -1
    let err = dx + dy
    for (let i = 0; i < 256; i += 1) {
      this.set(x, y, color)
      if (x === tx && y === ty) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  sprite(rows: readonly string[], palette: Readonly<Record<string, number>>, x: number, y: number): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx += 1) {
        const color = palette[row[dx] ?? '.']
        if (color !== undefined) this.set(x + dx, y + dy, color)
      }
    })
  }
}

function rng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OUTLINE = 0x1d1512
const CAVE = 0x211915
const CAVE_DARK = 0x1a1310
const ROCK = [0x2b221e, 0x4a3c34, 0x57473d] as const
const CEILING = [0x2b221e, 0x3d322b, 0x4a3c34] as const
const DIRT = 0x2a201b
const DIRT_SPECK = 0x3a2c25
const RAIL = 0x9aa3ad
const TIE = 0x5e3b1d
const WOOD = [0xa8743f, 0x8a5a2e, 0x5e3b1d] as const
const HANDLE = 0x9c6b3c
const STEEL = 0xaab4bf
const STEEL_LIGHT = 0xe6edf3
const STEEL_DARK = 0x6c7682
const LAMP = 0xfff4b8
const GLOW = 0xffc86e
const GOLD = [0xf2b632, 0xffe08a, 0xc7861d] as const
const TEAL = [0x5dcaa5, 0xb5f0dc, 0x1d9e75] as const
const SHIRT = 0xc2412d
const SKIN = 0xf0c08a

const MINER_PALETTE: Readonly<Record<string, number>> = {
  K: OUTLINE,
  Y: 0xf2b632,
  y: 0xc7861d,
  L: LAMP,
  S: SKIN,
  E: OUTLINE,
  B: 0x7a4a26,
  R: SHIRT,
  r: 0x8f2e20,
  O: 0x3a6ea5,
  o: 0x2a5180,
  G: 0x4b2f1c,
}

// 14 x 20, facing the wall on the right.
const MINER = [
  '....KKKKK.....',
  '...KYYYYYK....',
  '..KYYYYYYYK...',
  '..KYYYYYYYKLL.',
  '.KyyyyyyyyyKK.',
  '..KSSSSSSSK...',
  '..KSSSSSESK...',
  '..KSSSSSSSSK..',
  '..KBBSSSSSK...',
  '..KBBBBBBBK...',
  '..KRBBBBBRK...',
  '.KRRRBBBRRRK..',
  '.KRROOOOORRK..',
  '.KrrOOOOOrrK..',
  '.KKKGGGGGKKK..',
  '..KOOOOOOOK...',
  '..KOOoKOOoK...',
  '..KOOK.KOOK...',
  '.KGGGK.KGGGK..',
  '.KKKKK.KKKKK..',
] as const

const GOBLIN_PALETTE: Readonly<Record<string, number>> = {
  g: 0x6fa84a,
  E: 0xffe08a,
  b: 0x7a4a26,
  K: OUTLINE,
}

const GOBLIN = ['g....g', 'gggggg', 'gEggEg', '.gggg.', '.bbbb.', '.bbbb.', '.K..K.'] as const

const ORES: readonly (readonly [number, number, 0 | 1])[] = [
  [54, 4, 0],
  [59, 7, 1],
  [55, 11, 0],
  [61, 13, 0],
  [57, 16, 1],
  [53, 19, 0],
  [60, 19, 0],
]

const HEAP: readonly (readonly [number, number])[] = [
  [14, 12], [15, 12], [13, 12], [16, 12], [12, 12], [17, 12], [11, 12], [18, 12], [10, 12], [19, 12],
  [14, 11], [15, 11], [13, 11], [16, 11], [12, 11], [17, 11], [11, 11], [18, 11],
  [14, 10], [15, 10], [13, 10], [16, 10],
]

/** Where the miner stands, and where the pick meets the wall. */
const SX = 32
const SY = 2

const CHIPS = [
  { x: 51, y: 11, dx1: -3, dy1: -4, dx2: -6, dy2: 1, color: GOLD[1] },
  { x: 51, y: 13, dx1: -4, dy1: -2, dx2: -8, dy2: 3, color: ROCK[2] },
  { x: 50, y: 12, dx1: -2, dy1: -5, dx2: -4, dy2: -1, color: 0x8a7a6e },
  { x: 51, y: 15, dx1: -3, dy1: -1, dx2: -5, dy2: 5, color: ROCK[1] },
  { x: 50, y: 10, dx1: -1, dy1: -4, dx2: -2, dy2: 0, color: GOLD[0] },
  { x: 51, y: 14, dx1: -5, dy1: -3, dx2: -9, dy2: 2, color: 0x8a7a6e },
] as const

function mix(a: number, b: number, share: number): number {
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff
    return Math.round(x + (y - x) * share) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

const LANTERN = { x: 25, y: 6 } as const

function background(px: Pixels, spec: SceneSpec, withGlow: boolean): void {
  const r = rng(11)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T

  px.data.fill(CAVE)
  for (let i = 0; i < 30; i += 1) px.set(Math.floor(r() * 50), 2 + Math.floor(r() * 19), CAVE_DARK)

  for (let x = 0; x < W; x += 1) {
    px.set(x, 0, pick(CEILING))
    if (r() < 0.55) px.set(x, 1, pick(CEILING))
  }

  let edge = 50
  for (let y = 0; y < 22; y += 1) {
    if (y % 3 === 0) edge = 50 + Math.floor(r() * 3)
    for (let x = edge; x < W; x += 1) {
      const shade = r()
      let color: number = shade < 0.15 ? ROCK[0] : shade < 0.7 ? ROCK[1] : ROCK[2]
      if (y % 7 === 0 && r() < 0.6) color = ROCK[0]
      px.set(x, y, x === edge ? ROCK[0] : color)
    }
  }
  for (const [ox, oy, kind] of ORES) {
    const [main, light, dark] = kind === 1 ? TEAL : GOLD
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) px.set(ox + dx, oy + dy, main)
    px.set(ox, oy, light)
    px.set(ox - 1, oy - 1, light)
    px.set(ox + 1, oy + 1, dark)
  }

  for (let y = 22; y < H; y += 1) for (let x = 0; x < W; x += 1) px.set(x, y, r() < 0.12 ? DIRT_SPECK : DIRT)
  for (let x = 0; x < 31; x += 1) {
    px.set(x, 21, RAIL)
    if (x % 4 < 2) px.set(x, 22, TIE)
  }

  for (let x = 0; x < 30; x += 1) {
    px.set(x, 1, WOOD[0])
    px.set(x, 2, WOOD[2])
  }
  for (let y = 3; y < 21; y += 1) {
    px.set(27, y, WOOD[0])
    px.set(28, y, WOOD[1])
    px.set(29, y, WOOD[2])
  }

  if (spec.carts > 0) cart(px, spec.carts)

  if (withGlow) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const d = Math.hypot(x - LANTERN.x, y - LANTERN.y)
        if (d <= 10) px.set(x, y, mix(px.get(x, y), GLOW, d <= 6 ? 0.12 : 0.06))
      }
    }
  }

  px.set(25, 3, STEEL_DARK)
  for (let x = 24; x < 27; x += 1) {
    px.set(x, 4, OUTLINE)
    px.set(x, 7, OUTLINE)
  }
  for (let y = 5; y < 7; y += 1) {
    px.set(24, y, OUTLINE)
    px.set(25, y, LAMP)
    px.set(26, y, OUTLINE)
  }
}

function cart(px: Pixels, carts: number): void {
  for (let x = 8; x < 22; x += 1) {
    px.set(x, 13, STEEL)
    px.set(x, 18, OUTLINE)
  }
  for (let y = 14; y < 18; y += 1) {
    px.set(8, y, OUTLINE)
    px.set(21, y, OUTLINE)
    for (let x = 9; x < 21; x += 1) px.set(x, y, y === 15 && x % 3 === 0 ? STEEL : STEEL_DARK)
  }
  for (const cx of [11, 18]) {
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = 18; dy <= 20; dy += 1) px.set(cx + dx, dy, OUTLINE)
    px.set(cx, 19, STEEL_DARK)
  }
  const heap = Math.min(HEAP.length, 4 + carts * 3)
  HEAP.slice(0, heap).forEach(([x, y], i) => px.set(x, y, i % 4 === 1 ? TEAL[0] : i % 3 === 0 ? GOLD[1] : GOLD[0]))
}

function goblin(px: Pixels, bob: number): void {
  px.sprite(GOBLIN, GOBLIN_PALETTE, 1, 15 - bob)
}

type Pose = { hx: number; hy: number; angle: number }

const STRIKE: Pose = { hx: 12, hy: 10, angle: 10 }
const RAISED: Pose = { hx: 8, hy: 6, angle: -100 }
const RESTING: Pose = { hx: 10, hy: 10, angle: 72 }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function pose(frame: Frame): Pose {
  if (frame.t === null) return RESTING
  return {
    hx: lerp(STRIKE.hx, RAISED.hx, frame.t),
    hy: lerp(STRIKE.hy, RAISED.hy, frame.t),
    angle: lerp(STRIKE.angle, RAISED.angle, frame.t),
  }
}

function pickaxe(px: Pixels, hx: number, hy: number, angle: number): void {
  const a = (angle * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  px.line(hx - dx, hy - dy, hx + dx * 8, hy + dy * 8, HANDLE)
  const ex = hx + dx * 8
  const ey = hy + dy * 8
  const nx = -dy
  const ny = dx
  let prev: [number, number] | null = null
  for (let t = -4; t <= 4; t += 1) {
    const bend = 0.08 * t * t
    const x = ex + nx * t - dx * bend
    const y = ey + ny * t - dy * bend
    const color = Math.abs(t) >= 3 ? STEEL_LIGHT : STEEL
    if (prev) px.line(prev[0], prev[1], x, y, color)
    else px.set(x, y, color)
    if (Math.abs(t) <= 2) px.set(x - dx, y - dy, STEEL_DARK)
    prev = [x, y]
  }
}

function miner(px: Pixels, frame: Frame): void {
  const p = pose(frame)
  const hx = SX + p.hx
  const hy = SY + p.hy + frame.bob
  pickaxe(px, hx, hy, p.angle)
  px.sprite(MINER, MINER_PALETTE, SX, SY + frame.bob)
  px.line(SX + 9, SY + 11 + frame.bob, hx, hy, SHIRT)
  px.set(hx, hy, SKIN)
}

function chips(px: Pixels): void {
  for (const chip of CHIPS) px.set(chip.x + chip.dx1, chip.y + chip.dy1, chip.color)
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
const pct = (share: number) => `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`

/** One <path> per color, each a run of same-colored pixels in a row. */
function paths(px: Pixels): string {
  const runs = new Map<number, string[]>()
  for (let y = 0; y < H; y += 1) {
    let x = 0
    while (x < W) {
      const color = px.get(x, y)
      if (color === CLEAR) {
        x += 1
        continue
      }
      let len = 1
      while (x + len < W && px.get(x + len, y) === color) len += 1
      const list = runs.get(color) ?? []
      list.push(`M${x} ${y}h${len}v1h-${len}z`)
      runs.set(color, list)
      x += len
    }
  }
  return [...runs].map(([color, d]) => `<path fill="${hex(color)}" d="${d.join('')}"/>`).join('')
}

function glowPath(radius: number): string {
  const d: string[] = []
  for (let dy = -radius; dy <= radius; dy += 1) {
    const w = Math.floor(Math.sqrt(radius * radius - dy * dy))
    const y = LANTERN.y + dy
    if (y < 0 || y >= H) continue
    d.push(`M${LANTERN.x - w} ${y}h${2 * w + 1}v1h-${2 * w + 1}z`)
  }
  return `<path fill="${hex(GLOW)}" fill-opacity=".07" d="${d.join('')}"/>`
}

/** Keyframes that show one frame for its slice of the loop and hide it otherwise. */
function frameKeyframes(name: string, from: number, to: number): string {
  const steps = [`0%{opacity:${from === 0 ? 1 : 0}}`]
  if (from > 0) steps.push(`${pct(from)}{opacity:1}`)
  if (to < 1) steps.push(`${pct(to)}{opacity:0}`)
  steps.push(`100%{opacity:${to < 1 ? 0 : 1}}`)
  return `@keyframes ${name}{${steps.join('')}}`
}

/** The scene as an SVG document whose own CSS animates it. */
export function sceneSvg(spec: SceneSpec, scale: number): string {
  const bg = new Pixels()
  background(bg, spec, false)
  const { frames, ms } = framesFor(spec.mode)
  const css: string[] = [
    '.glow{animation:flicker 1.7s step-end infinite}',
    '@keyframes flicker{0%{opacity:.9}22%{opacity:.65}31%{opacity:1}64%{opacity:.8}83%{opacity:1}}',
  ]
  const body: string[] = [paths(bg), `<g class="glow">${glowPath(10)}${glowPath(6)}</g>`]

  if (spec.goblins > 0) {
    css.push(`.gb{opacity:0;animation:1.2s step-end infinite}`)
    ;[0, 1].forEach(bob => {
      const layer = new Pixels()
      goblin(layer, bob)
      css.push(`.gb${bob}{animation-name:gb${bob}}`, frameKeyframes(`gb${bob}`, bob * 0.5, bob === 0 ? 0.5 : 1))
      body.push(`<g class="gb gb${bob}">${paths(layer)}</g>`)
    })
  }

  if (frames.length === 1) {
    const layer = new Pixels()
    miner(layer, frames[0] as Frame)
    body.push(`<g>${paths(layer)}</g>`)
  } else {
    css.push(`.m{opacity:0;animation-duration:${ms}ms;animation-timing-function:step-end;animation-iteration-count:infinite}`)
    frames.forEach((frame, i) => {
      const layer = new Pixels()
      miner(layer, frame)
      const to = frames[i + 1]?.at ?? 1
      css.push(`.m${i}{animation-name:m${i}}`, frameKeyframes(`m${i}`, frame.at, to))
      body.push(`<g class="m m${i}">${paths(layer)}</g>`)
    })
  }

  if (spec.mode === 'work') {
    css.push(`.c{opacity:0;animation:${ms}ms linear infinite}`)
    CHIPS.forEach((chip, i) => {
      const a = IMPACT_AT
      css.push(
        `.c${i}{animation-name:c${i}}`,
        `@keyframes c${i}{0%,${pct(a - 0.001)}{opacity:0;transform:translate(0px,0px)}` +
          `${pct(a)}{opacity:1;transform:translate(0px,0px)}` +
          `${pct(a + 0.12)}{opacity:1;transform:translate(${chip.dx1}px,${chip.dy1}px)}` +
          `${pct(a + 0.3)}{opacity:0;transform:translate(${chip.dx2}px,${chip.dy2}px)}100%{opacity:0}}`,
      )
      body.push(`<rect class="c c${i}" x="${chip.x}" y="${chip.y}" width="1" height="1" fill="${hex(chip.color)}"/>`)
    })
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges">` +
    `<style>${css.join('')}</style>${body.join('')}</svg>`
  )
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '') + (B64[(n >> 6) & 63] ?? '') + (B64[n & 63] ?? '')
  }
  const left = bytes.length - i
  if (left > 0) {
    const n = ((bytes[i] ?? 0) << 16) | (left === 2 ? (bytes[i + 1] ?? 0) << 8 : 0)
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '')
    out += left === 2 ? `${B64[(n >> 6) & 63] ?? ''}=` : '=='
  }
  return out
}

const UPPER_HALF = 0x2580

/** Packs pixels into Raster cells: the upper half block, top pixel as ink, bottom as paper. */
function cellsOf(px: Pixels): string {
  const view = new DataView(new ArrayBuffer(W * ROWS * 12))
  let offset = 0
  for (let row = 0; row < ROWS; row += 1) {
    for (let x = 0; x < W; x += 1) {
      view.setUint32(offset, UPPER_HALF, true)
      view.setUint32(offset + 4, px.get(x, row * 2) & 0xffffff, true)
      view.setUint32(offset + 8, px.get(x, row * 2 + 1) & 0xffffff, true)
      offset += 12
    }
  }
  return base64(new Uint8Array(view.buffer))
}

/** The scene's frames as Raster cells, for the terminal. */
export function sceneCells(spec: SceneSpec): { cells: string[]; frames: readonly Frame[]; ms: number } {
  const bg = new Pixels()
  background(bg, spec, true)
  if (spec.goblins > 0) goblin(bg, 0)
  const { frames, ms } = framesFor(spec.mode)
  const cells = frames.map(frame => {
    const px = new Pixels(bg)
    miner(px, frame)
    if (frame.chips) chips(px)
    return cellsOf(px)
  })
  return { cells, frames, ms }
}
