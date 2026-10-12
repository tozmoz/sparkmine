// The mine above the prompt, drawn pixel by pixel. One picture, two outputs:
// an SVG whose own CSS animates it (desktop), and Raster cells, two pixels to
// a cell, that a timer repaints (terminal).
//
// While Claude works the miner digs an endless tunnel. He stays where he is
// and the camera follows him: each swing the world slides CUT pixels left,
// fresh rock comes in from the right, and what he dug falls behind him with
// its timbers, lanterns and spoil heaps. The world repeats every PERIOD
// pixels, so when the slide wraps around the picture is the same and the loop
// never shows a seam.

import type { FindId, Mode, Season } from '../types'

export const W = 64
export const H = 24
/** Terminal rows: each cell is an upper half block, so two pixels tall. */
export const ROWS = H / 2

const CLEAR = -1

/** `pick` is the miner's pick, 0 worn iron to 4 obsidian, as the pick upgrades make it. */
export type SceneSpec = {
  mode: Mode
  carts: number
  goblins: number
  pick: number
  biome: number
  /** A bug on the rock while tests fail, or the splat where the pick got it. */
  bug?: 'crawl' | 'splat'
  /** What upgrades bought, there to see: a caged canary, work gloves, warmer lanterns, a coffee mug. */
  canary?: boolean
  gloves?: boolean
  warm?: boolean
  coffee?: boolean
  /** Claude asked to ultrathink: the lanterns flare. */
  flare?: boolean
  /** A find on the rock, there to catch. */
  find?: FindId
  /** A pumpkin on the cart the last week of October; a Santa hat, and snow on the topsoil, in December. */
  season?: Season
  /** A pull request merged: confetti falls for a moment. */
  confetti?: boolean
  /**
   * How the miner stands still: facing you while Claude asks, tipping his
   * helmet when thanked, with a coffee a while into Claude's idle, asleep after a long one.
   */
  pose?: 'facing' | 'tip' | 'coffee' | 'sleep'
}

/** One pose of the miner: `t` runs from the strike (0) to the raised pick (1); null rests. */
export type Frame = { at: number; t: number | null; bob: number; chips: boolean }

export const SWING_MS = 900
export const IMPACT_AT = 0.64
export const SWING: readonly Frame[] = [
  { at: 0, t: 0.3, bob: 0, chips: false },
  { at: 0.1, t: 0.6, bob: 0, chips: false },
  { at: 0.2, t: 0.85, bob: 0, chips: false },
  { at: 0.3, t: 1, bob: 0, chips: false },
  { at: 0.56, t: 0.5, bob: 0, chips: false },
  { at: IMPACT_AT, t: 0, bob: 1, chips: true },
  { at: 0.76, t: 0, bob: 0, chips: false },
]

export const REST_MS = 1600
export const REST: readonly Frame[] = [
  { at: 0, t: null, bob: 0, chips: false },
  { at: 0.5, t: null, bob: 1, chips: false },
]

/** Pixels the world slides per swing, and the width after which it repeats. */
export const CUT = 2
export const PERIOD = 32
/** Swings in one loop of the slide. */
export const CUTS = PERIOD / CUT
export const LOOP_MS = SWING_MS * CUTS
/** Every this many swings the pick strikes ore and sparkles. */
const SPARK_EVERY = 4
const SPARK_FOR = 0.25
const WHEEL_MS = 450

const cutAt = (k: number) => (k + IMPACT_AT) / CUTS

export function framesFor(mode: Mode): { frames: readonly Frame[]; ms: number } {
  if (mode === 'work') return { frames: SWING, ms: SWING_MS }
  if (mode === 'pause') return { frames: REST.slice(0, 1), ms: REST_MS }
  return { frames: REST, ms: REST_MS }
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Which of `frames` shows at `share` (0 to 1) of its loop. */
export function frameIndex(frames: readonly Frame[], share: number): number {
  let index = 0
  frames.forEach((frame, i) => {
    if (frame.at <= share) index = i
  })
  return index
}

/** Everything that moves, `ms` into the animation. */
export type Moment = { frame: number; scroll: number; spark: boolean; wheel: number }

export function momentAt(mode: Mode, ms: number): Moment {
  if (mode !== 'work') {
    const { frames, ms: loop } = framesFor(mode)
    return { frame: frameIndex(frames, mod(ms, loop) / loop), scroll: 0, spark: false, wheel: 0 }
  }
  const at = mod(ms, LOOP_MS)
  const swing = Math.floor(at / SWING_MS)
  const within = (at - swing * SWING_MS) / SWING_MS
  const cuts = swing + (within >= IMPACT_AT ? 1 : 0)
  return {
    frame: frameIndex(SWING, within),
    scroll: mod(cuts * CUT, PERIOD),
    spark: swing % SPARK_EVERY === SPARK_EVERY - 1 && within >= IMPACT_AT && within < IMPACT_AT + SPARK_FOR,
    wheel: Math.floor(mod(ms, WHEEL_MS * 2) / WHEEL_MS),
  }
}

export const momentKey = (m: Moment) => `${m.frame}:${m.scroll}:${m.spark ? 1 : 0}:${m.wheel}`

class Pixels {
  readonly w: number
  readonly h: number
  data: Int32Array

  constructor(w = W, h = H, from?: Pixels) {
    this.w = w
    this.h = h
    this.data = from ? from.data.slice() : new Int32Array(w * h).fill(CLEAR)
  }

  copy(): Pixels {
    return new Pixels(this.w, this.h, this)
  }

  set(x: number, y: number, color: number): void {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px >= 0 && px < this.w && py >= 0 && py < this.h) this.data[py * this.w + px] = color
  }

  get(x: number, y: number): number {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return CLEAR
    return this.data[y * this.w + x] ?? CLEAR
  }

  /** Draws `over` on top, its clear pixels letting this one show. */
  stamp(over: Pixels): void {
    for (let y = 0; y < over.h; y += 1) {
      for (let x = 0; x < over.w; x += 1) {
        const color = over.get(x, y)
        if (color !== CLEAR) this.set(x, y, color)
      }
    }
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

/** An ore's colors: its body, its glint and its shadow. */
type Ore = readonly [number, number, number]

/** The colors of one layer the mine digs through. */
type Strata = {
  cave: number
  caveDark: number
  caveLight: number
  rock: readonly [number, number, number]
  ceiling: readonly [number, number, number]
  dirt: number
  dirtSpeck: number
  pebble: number
  pile: number
  pileTop: number
  /** The two ores in the rock: the first is the one the pick throws sparks of. */
  ores: readonly [Ore, Ore]
  /** Daylight where the tunnel's back wall would be: the far side, out through the planet. */
  sky?: Sky
}

/**
 * The far side's sky, seen upside down: its bands from the top row down, palest
 * by the turf overhead, the clouds' color, the sun low in the frame, and the turf.
 */
type Sky = {
  bands: readonly (readonly [number, number])[]
  cloud: number
  sun: readonly [number, number]
  turf: readonly [number, number, number]
}

/**
 * Deeper is stranger: the mine passes from topsoil through stone, ancient ruins
 * and crystal caves into magma, then groundwater and the core, and on through
 * the inner core and a hollow earth out into daylight on the far side. One per
 * BIOMES entry, in its order.
 */
const STRATA: readonly Strata[] = [
  // Topsoil: warm brown earth with gold and teal.
  {
    cave: 0x211915, caveDark: 0x1a1310, caveLight: 0x2a201b,
    rock: [0x2b221e, 0x4a3c34, 0x57473d], ceiling: [0x2b221e, 0x3d322b, 0x4a3c34],
    dirt: 0x2a201b, dirtSpeck: 0x3a2c25, pebble: 0x4a3c34, pile: 0x6b4a2f, pileTop: 0x8a6240,
    ores: [GOLD, TEAL],
  },
  // Stone: cold grey granite with gold and silver.
  {
    cave: 0x1b1c20, caveDark: 0x141518, caveLight: 0x24262b,
    rock: [0x2a2c31, 0x4a4d55, 0x5f636c], ceiling: [0x2a2c31, 0x3a3d44, 0x4a4d55],
    dirt: 0x24262b, dirtSpeck: 0x34373e, pebble: 0x4a4d55, pile: 0x575b63, pileTop: 0x7a7f88,
    ores: [GOLD, [0xd0d6de, 0xffffff, 0x8a919b]],
  },
  // Ancient ruins: carved sandstone, set with old gold and jade.
  {
    cave: 0x221a10, caveDark: 0x18120a, caveLight: 0x2e2416,
    rock: [0x2e2416, 0x5a4626, 0x7a6236], ceiling: [0x2e2416, 0x4a3a20, 0x5a4626],
    dirt: 0x2a2014, dirtSpeck: 0x4a3a20, pebble: 0x5a4626, pile: 0x7a6236, pileTop: 0xd9b45f,
    ores: [[0xd9b45f, 0xfff0b8, 0xa8862e], [0x5dcaa5, 0xb5f0dc, 0x2f8a6c]],
  },
  // Crystal caves: indigo rock grown through with amethyst and diamond.
  {
    cave: 0x17142a, caveDark: 0x100e1e, caveLight: 0x221e3a,
    rock: [0x221d3a, 0x3a3263, 0x4b4280], ceiling: [0x221d3a, 0x2e2850, 0x3a3263],
    dirt: 0x1d1930, dirtSpeck: 0x2e2850, pebble: 0x3a3263, pile: 0x4b4280, pileTop: 0x7f77dd,
    ores: [[0xb6a6ff, 0xe0d8ff, 0x7f77dd], [0x5fd4e8, 0xd8fbff, 0x2a8fa8]],
  },
  // Magma: black basalt, its seams running with lava and ruby.
  {
    cave: 0x241210, caveDark: 0x180b09, caveLight: 0x341a15,
    rock: [0x1a1414, 0x2e2522, 0x4a271d], ceiling: [0x1a1414, 0x2e2522, 0x3d302b],
    dirt: 0x2a1410, dirtSpeck: 0x5a1f10, pebble: 0x3d302b, pile: 0x4a2a20, pileTop: 0x6a3a28,
    ores: [[0xff7a2f, 0xffd36e, 0xc2412d], [0xe24b4a, 0xf7c1c1, 0x8f2e20]],
  },
  // Groundwater: dark wet slate, seeping with aquamarine and pearl.
  {
    cave: 0x0f1d24, caveDark: 0x0a151a, caveLight: 0x15283a,
    rock: [0x13242c, 0x1f3d4a, 0x2b5566], ceiling: [0x13242c, 0x1a3340, 0x1f3d4a],
    dirt: 0x10202a, dirtSpeck: 0x1f3d4a, pebble: 0x2b5566, pile: 0x2b5566, pileTop: 0x4fb3d9,
    ores: [[0x4fb3d9, 0xd8f4ff, 0x2a7fa8], [0xe6edf3, 0xffffff, 0x9aa8b4]],
  },
  // The core: rock glowing red from within, veined with white-hot gold.
  {
    cave: 0x2a0c06, caveDark: 0x1e0804, caveLight: 0x3a120a,
    rock: [0x5a1608, 0x9a2e10, 0xd9531c], ceiling: [0x4a1208, 0x6e200c, 0x9a2e10],
    dirt: 0x3a120a, dirtSpeck: 0x6e200c, pebble: 0x9a2e10, pile: 0xc2411a, pileTop: 0xffd36e,
    ores: [[0xffe9a8, 0xffffff, 0xf2b632], [0xffd36e, 0xfff4b8, 0xff7a2f]],
  },
  // Inner core: white-hot gold under such pressure that it grows diamonds.
  {
    cave: 0x2b1d08, caveDark: 0x1f1405, caveLight: 0x3b2a0e,
    rock: [0x7a4e10, 0xc48a26, 0xf2c45a], ceiling: [0x5e3c0c, 0x7a4e10, 0xa86e1a],
    dirt: 0x3b2a0e, dirtSpeck: 0x7a4e10, pebble: 0xa86e1a, pile: 0xc48a26, pileTop: 0xfff0b8,
    ores: [[0xe8fbff, 0xffffff, 0x8fd8e8], [0xfff4b8, 0xffffff, 0xf2b632]],
  },
  // Hollow earth: a lost green world inside the planet, its rock lit by emerald and glowing spores.
  {
    cave: 0x0d1f15, caveDark: 0x08150d, caveLight: 0x15301f,
    rock: [0x14281a, 0x24472c, 0x3a6a3e], ceiling: [0x14281a, 0x1c3a24, 0x24472c],
    dirt: 0x112418, dirtSpeck: 0x24472c, pebble: 0x3a6a3e, pile: 0x3a6a3e, pileTop: 0x7bd88f,
    ores: [[0x3ecf6e, 0xc8f7d4, 0x1d8a45], [0xd08cff, 0xf3e0ff, 0x8a4fc0]],
  },
  // The far side: through the planet and out. Daylight behind the timbers, the
  // other side's turf overhead, and its last crust ahead, set with sapphire.
  {
    cave: 0x7cb8ec, caveDark: 0x5598dc, caveLight: 0xa8d4f7,
    rock: [0x3b2a1c, 0x6b4a2f, 0x8a6240], ceiling: [0x5e3b1d, 0x5e3b1d, 0x6b4a2f],
    dirt: 0x3b2a1c, dirtSpeck: 0x5e3b1d, pebble: 0x6b4a2f, pile: 0x6b4a2f, pileTop: 0x5fb84a,
    ores: [[0x7fd3ff, 0xe0f6ff, 0x3a8fd0], GOLD],
    sky: {
      bands: [[0, 0xd6ecff], [7, 0xa8d4f7], [11, 0x7cb8ec], [16, 0x5598dc]],
      cloud: 0xffffff,
      sun: [25, 17],
      turf: [0x2f6e2c, 0x3f8f3a, 0x5fb84a],
    },
  },
]

const strataOf = (biome: number): Strata => STRATA[Math.max(0, Math.min(STRATA.length - 1, biome))] ?? (STRATA[0] as Strata)

/** What the rock throws when an iron or steel pick strikes it: its ore and its own stone. */
const rockSparks = (st: Strata): readonly number[] => [st.ores[0][1], st.rock[2], st.rock[1], st.rock[1], st.ores[0][0], st.rock[2]]

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

const GLOVE = 0xc8862a
const MUG_RED = 0xe24b4a

// Facing you, the lamp in the middle of his helmet and a hand at each side.
const MINER_FRONT = [
  '....KKKKK.....',
  '...KYYYYYK....',
  '..KYYLLLYYK...',
  '..KYYYYYYYK...',
  '.KyyyyyyyyyK..',
  '..KSSSSSSSK...',
  '..KSESSSESK...',
  '..KSSSSSSSK...',
  '..KBSSSSSBK...',
  '..KBBBBBBBK...',
  '..KRBBBBBRK...',
  '.KRRRBBBRRRK..',
  '.KRROOOOORRK..',
  '.KHrOOOOOrHK..',
  '.KKKGGGGGKKK..',
  '..KOOOOOOOK...',
  '..KOOoKoOOK...',
  '..KOOK.KOOK...',
  '.KGGGK.KGGGK..',
  '.KKKKK.KKKKK..',
] as const

// Thanked: facing you, bald as an egg, his helmet raised in his right hand.
const MINER_TIP = [
  '.........KKKK.',
  '........KYYYYK',
  '........KyLyyK',
  '....KKKKK.KHK.',
  '...KSSSSSK.HK.',
  '..KSSSSSSSKHK.',
  '..KSESSSESKRK.',
  '..KSSSSSSSKRK.',
  '..KBSSSSSBRRK.',
  '..KBBBBBBBRK..',
  '..KRBBBBBRK...',
  '.KRRRBBBRRK...',
  '.KRROOOOORK...',
  '.KHrOOOOOrK...',
  '.KKKGGGGGKK...',
  '..KOOOOOOOK...',
  '..KOOoKoOOK...',
  '..KOOK.KOOK...',
  '.KGGGK.KGGGK..',
  '.KKKKK.KKKKK..',
] as const

// Sitting with a mug, legs out toward the wall.
const MINER_SIT = [
  '..............',
  '..............',
  '..............',
  '..............',
  '....KKKKK.....',
  '...KYYYYYK....',
  '..KYYYYYYYKLL.',
  '.KyyyyyyyyyKK.',
  '..KSSSSSSSK...',
  '..KSSSSSESK...',
  '..KSSSSSSSSK..',
  '..KBBSSSSSK...',
  '..KBBBBBBBK...',
  '..KRBBBBBRKWWK',
  '.KRRRBBBRHWWK.',
  '.KRROOOOORRK..',
  '.KKKGGGGGKKK..',
  '..KOOOOOOOOOK.',
  '..KOOOOOOOGGK.',
  '..KKKKKKKKKKK.',
] as const

// Asleep where he sat, his lamp out and his eye shut.
const MINER_SLEEP = [
  '..............',
  '..............',
  '..............',
  '..............',
  '..............',
  '....KKKKK.....',
  '...KYYYYYK....',
  '..KYYYYYYYKll.',
  '.KyyyyyyyyyKK.',
  '..KSSSSSSSK...',
  '..KSSSSSeSK...',
  '..KSSSSSSSSK..',
  '..KBBSSSSSK...',
  '..KBBBBBBBK...',
  '.KRRRBBBRRRK..',
  '.KRROOOOORRK..',
  '.KKKGGGGGKKK..',
  '..KOOOOOOOOOK.',
  '..KOOOOOOOGGK.',
  '..KKKKKKKKKKK.',
] as const

// A beetle seen from above, in a pink no layer's rock or ore has, so it shows on every one.
const BUG = ['.K..K.', '..KK..', 'KPPPPK', '.PpPP.', 'KPPPPK', '.K..K.'] as const
const SPLAT = ['g..G.g', '.GgGG.', 'GgGGgG', '.G.gG.'] as const
// Steel bars, so the yellow bird inside stands out.
const CAGE = ['...K...', '..MMM..', '.M...M.', 'M..YY.M', 'M.YYKOM', 'MYYYY.M', 'M.WWW.M', 'MMMMMMM'] as const
const NOTE = ['.LL', '.L.', 'LL.', 'LL.'] as const
const MUG = ['LLL.', 'RRRK', 'RRR.'] as const
const MUG_STEAMING = ['..z.', '.z..', 'LLL.', 'RRRK', 'RRR.'] as const
const ZBIG = ['LLLL', '..L.', '.L..', 'LLLL'] as const
// What three layers hide in the rock: an ammonite, a rubber duck, a pharaoh's gold mask.
const FIND_SPRITES: Readonly<Record<FindId, readonly string[]>> = {
  fossil: ['..bbb.', '.b...b', 'b.dd.b', 'b.d..b', '.b..b.', '..bb..'],
  'rubber-duck': ['..YYY.', '..YKYO', 'Y.YYY.', 'YYYYYY', '.YYYY.'],
  pharaoh: ['.ABBA.', 'ABAABA', 'BAKAKB', 'BAAAAB', '.AAAA.', '..AA..'],
}
const FIND_AT = [55, 9] as const
// A jack-o'-lantern, its face lit from within.
const PUMPKIN = ['..vv..', '.OOOO.', 'OfOOfO', 'OOOOOO', 'OffffO', '.OOOO.'] as const
const PUMPKIN_AT = [13, 5] as const
const SANTA_RED = 0xd03a2f
const SNOW = 0xf4f8fb

/** Confetti for a merged pull request: where each bit starts, and its color. */
const CONFETTI_COLORS = [0xff6b6b, 0xffd93d, 0x6bcbff, 0xc77dff, 0x7dff9a] as const
const CONFETTI: readonly (readonly [number, number])[] = [
  [3, 3], [9, 6], [15, 2], [21, 8], [27, 4], [12, 11], [24, 13], [6, 15], [18, 16], [30, 10], [36, 2], [42, 7], [45, 13], [39, 15], [33, 5], [48, 3],
]
/** How far the confetti falls each step, and in how many steps it loops. */
const CONFETTI_FALL = 2
const CONFETTI_STEPS = 4

function confetti(px: Pixels, step: number): void {
  CONFETTI.forEach(([x, y], i) => px.set(x, y + step * CONFETTI_FALL, CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? GOLD[0]))
}
const ZSMALL = ['LLL', '.L.', 'LLL'] as const

const DETAIL_PALETTE: Readonly<Record<string, number>> = {
  K: OUTLINE,
  R: MUG_RED,
  P: 0xff4fa3,
  p: 0xb0306f,
  g: 0xb5e08a,
  G: 0x6fa84a,
  M: 0x9aa3ad,
  Y: 0xffd84a,
  O: 0xff7a2f,
  W: WOOD[1],
  L: LAMP,
  z: 0xb4b2a9,
  b: 0xeadfc4,
  d: 0xb8a888,
  f: 0xffd36e,
  v: 0x4f8a2a,
  A: GOLD[0],
  B: 0x3a6ea5,
}

/** Where the bug crawls on the rock, a quarter of the loop at each. */
const BUG_AT: readonly (readonly [number, number])[] = [[56, 2], [57, 7], [54, 12], [56, 16]]
const SPLAT_AT = [51, 9] as const
/** The canary's pole stands at the cart's front, its cage hung between the cart and the miner. */
const CAGE_AT = [22, 4] as const
const MUG_AT = [23, 16] as const

/** The details that stay put on screen: the canary on its pole, the mug on the ground. */
function fixedDetails(px: Pixels, spec: SceneSpec): void {
  if (spec.canary === true) {
    for (let y = 3; y < 13; y += 1) px.set(21, y, WOOD[1])
    for (let x = 21; x <= 25; x += 1) px.set(x, 3, WOOD[0])
    px.sprite(CAGE, DETAIL_PALETTE, CAGE_AT[0], CAGE_AT[1])
  }
  if (spec.coffee === true && spec.pose === undefined) px.sprite(MUG_STEAMING, DETAIL_PALETTE, MUG_AT[0], MUG_AT[1])
  if (spec.bug === 'splat') px.sprite(SPLAT, DETAIL_PALETTE, SPLAT_AT[0], SPLAT_AT[1])
  if (spec.find !== undefined) px.sprite(FIND_SPRITES[spec.find], DETAIL_PALETTE, FIND_AT[0], FIND_AT[1])
  if (spec.season === 'halloween' && spec.carts > 0) px.sprite(PUMPKIN, DETAIL_PALETTE, PUMPKIN_AT[0], PUMPKIN_AT[1])
}

const GOBLIN_PALETTE: Readonly<Record<string, number>> = {
  g: 0x6fa84a,
  E: 0xffe08a,
  b: 0x7a4a26,
  K: OUTLINE,
}

const GOBLIN = ['g....g', 'gggggg', 'gEggEg', '.gggg.', '.bbbb.', '.bbbb.', '.K..K.'] as const

const HEAP: readonly (readonly [number, number])[] = [
  [14, 12], [15, 12], [13, 12], [16, 12], [12, 12], [17, 12], [11, 12], [18, 12], [10, 12], [19, 12],
  [14, 11], [15, 11], [13, 11], [16, 11], [12, 11], [17, 11], [11, 11], [18, 11],
  [14, 10], [15, 10], [13, 10], [16, 10],
]

/** Where the miner stands. */
const SX = 32
const SY = 2

/** The rock face, row by row: everything from this column right is still rock. */
const FACE = [51, 51, 50, 50, 51, 52, 52, 51, 50, 50, 50, 51, 51, 52, 51, 50, 50, 51, 51, 50, 51, 52, 52, 51] as const
const faceAt = (y: number) => FACE[y] ?? 50

/** In the world's tile: a timber post, a lantern and a spoil heap every PERIOD pixels. */
const POST_X = 4
const LANTERN_X = 21
const LANTERN_Y = 6
const SPOIL = { x: 12, heights: [1, 2, 3, 3, 2, 1] } as const
const ORES: readonly (readonly [number, number, 0 | 1])[] = [
  [6, 5, 0],
  [19, 9, 1],
  [10, 15, 0],
  [26, 18, 1],
  [28, 3, 0],
]

/**
 * How each pick looks: its handle, the wrap where he holds it, its head, and
 * what flies when it strikes; null for the rock's own chips.
 */
type PickLook = { handle: number; grip: number | null; head: number; edge: number; shade: number; sparks: readonly number[] | null }

const PICKS: readonly PickLook[] = [
  // Worn iron, the pick he starts with.
  { handle: HANDLE, grip: null, head: 0x8a8f96, edge: 0xb7bcc2, shade: 0x5c6168, sparks: null },
  // Sharpened: the same iron, its points bright.
  { handle: HANDLE, grip: null, head: 0x9aa1a9, edge: 0xffffff, shade: 0x5c6168, sparks: null },
  // Steel, with a red wrap on the handle.
  { handle: 0x7a4a26, grip: SHIRT, head: STEEL, edge: STEEL_LIGHT, shade: STEEL_DARK, sparks: null },
  // Diamond, on a dark handle with a gold wrap: it throws diamond glints.
  { handle: 0x5e3b1d, grip: GOLD[0], head: 0x5fd4e8, edge: 0xd8fbff, shade: 0x2a8fa8, sparks: [0xd8fbff, 0x5fd4e8, 0xffffff, 0x2a8fa8, 0xd8fbff, 0x5fd4e8] },
  // Obsidian, black and violet.
  { handle: 0x2b2440, grip: 0x7f77dd, head: 0x3a2f5a, edge: 0xb6a6ff, shade: 0x151021, sparks: [0xb6a6ff, 0x7f77dd, 0xe0d8ff, 0x3a2f5a, 0xb6a6ff, 0x7f77dd] },
]

const lookOf = (pick: number): PickLook => PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))] ?? (PICKS[0] as PickLook)

const CHIPS = [
  { x: 51, y: 11, dx1: -3, dy1: -4, dx2: -6, dy2: 1 },
  { x: 51, y: 13, dx1: -4, dy1: -2, dx2: -8, dy2: 3 },
  { x: 50, y: 12, dx1: -2, dy1: -5, dx2: -4, dy2: -1 },
  { x: 51, y: 15, dx1: -3, dy1: -1, dx2: -5, dy2: 5 },
  { x: 50, y: 10, dx1: -1, dy1: -4, dx2: -2, dy2: 0 },
  { x: 51, y: 14, dx1: -5, dy1: -3, dx2: -9, dy2: 2 },
] as const

/** The colors the chips fly in: the pick's own, or the rock's. */
const sparksOf = (look: PickLook, st: Strata): readonly number[] => look.sparks ?? rockSparks(st)

function mix(a: number, b: number, share: number): number {
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff
    return Math.round(x + (y - x) * share) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

/** The far side's sky behind the timbers: its bands, clouds and sun, and its turf hanging overhead. */
function skyTile(t: Pixels, sky: Sky, r: () => number): void {
  for (let y = 0; y < H; y += 1) {
    let color = sky.bands[0]?.[1] ?? 0
    for (const [from, band] of sky.bands) if (y >= from) color = band
    for (let x = 0; x < PERIOD; x += 1) t.set(x, y, color)
  }
  for (const y of [5, 9, 13]) {
    let x = Math.floor(r() * 8)
    while (x < PERIOD) {
      const len = 3 + Math.floor(r() * 4)
      for (let i = 0; i < len; i += 1) t.set(x + i, y, sky.cloud)
      for (let i = 1; i < len - 1; i += 1) t.set(x + i, y - 1, sky.cloud)
      x += len + 6 + Math.floor(r() * 8)
    }
  }
  const [sx, sy] = sky.sun
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) t.set(sx + dx, sy + dy, GOLD[0])
  t.set(sx, sy, LAMP)
  const [deep, mid, light] = sky.turf
  for (let x = 0; x < PERIOD; x += 1) {
    t.set(x, 1, deep)
    t.set(x, 2, mid)
    if (x % 2 === 0) t.set(x, 3, light)
    if (x % 5 === 1) t.set(x, 4, light)
  }
}

/** One PERIOD-wide tile of the dug tunnel: back wall, timbers, lantern, rails, spoil. */
function tunnelTile(st: Strata): Pixels {
  const r = rng(11)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T
  const t = new Pixels(PERIOD, H)
  if (st.sky !== undefined) return skyTunnel(t, st, st.sky, r, pick)
  t.data.fill(st.cave)
  for (const y of [5, 9, 13, 17]) {
    let x = Math.floor(r() * 4)
    while (x < PERIOD) {
      const len = 3 + Math.floor(r() * 5)
      for (let i = 0; i < len; i += 1) t.set(x + i, y, st.caveDark)
      t.set(x + len, y + 1, st.caveDark)
      x += len + 2 + Math.floor(r() * 3)
    }
  }
  for (let i = 0; i < 10; i += 1) t.set(Math.floor(r() * PERIOD), 3 + Math.floor(r() * 16), r() < 0.5 ? st.caveLight : st.caveDark)
  for (let x = 0; x < PERIOD; x += 1) {
    t.set(x, 0, pick(st.ceiling))
    t.set(x, 1, WOOD[0])
    t.set(x, 2, WOOD[2])
  }
  for (let y = 3; y < 21; y += 1) {
    t.set(POST_X, y, WOOD[0])
    t.set(POST_X + 1, y, WOOD[1])
    t.set(POST_X + 2, y, WOOD[2])
  }
  SPOIL.heights.forEach((height, i) => {
    for (let k = 0; k < height; k += 1) t.set(SPOIL.x + i, 20 - k, k === height - 1 ? st.pileTop : st.pile)
  })
  for (let y = 22; y < H; y += 1) for (let x = 0; x < PERIOD; x += 1) t.set(x, y, r() < 0.12 ? st.dirtSpeck : st.dirt)
  for (let i = 0; i < 3; i += 1) t.set(Math.floor(r() * PERIOD), 22, st.pebble)
  for (let x = 0; x < PERIOD; x += 1) {
    t.set(x, 21, RAIL)
    if (x % 4 < 2) t.set(x, 22, TIE)
  }
  t.set(LANTERN_X, 3, STEEL_DARK)
  for (let x = LANTERN_X - 1; x <= LANTERN_X + 1; x += 1) {
    t.set(x, 4, OUTLINE)
    t.set(x, 7, OUTLINE)
  }
  for (let y = 5; y < 7; y += 1) {
    t.set(LANTERN_X - 1, y, OUTLINE)
    t.set(LANTERN_X, y, LAMP)
    t.set(LANTERN_X + 1, y, OUTLINE)
  }
  return t
}

/** The far side's tunnel: open to the sky, its timbers and rails still there, no lantern needed. */
function skyTunnel(t: Pixels, st: Strata, sky: Sky, r: () => number, pick: <T>(list: readonly T[]) => T): Pixels {
  skyTile(t, sky, r)
  for (let x = 0; x < PERIOD; x += 1) t.set(x, 0, pick(st.ceiling))
  for (let y = 3; y < 21; y += 1) {
    t.set(POST_X, y, WOOD[0])
    t.set(POST_X + 1, y, WOOD[1])
    t.set(POST_X + 2, y, WOOD[2])
  }
  SPOIL.heights.forEach((height, i) => {
    for (let k = 0; k < height; k += 1) t.set(SPOIL.x + i, 20 - k, k === height - 1 ? st.pileTop : st.pile)
  })
  for (let y = 22; y < H; y += 1) for (let x = 0; x < PERIOD; x += 1) t.set(x, y, r() < 0.12 ? st.dirtSpeck : st.dirt)
  for (let i = 0; i < 3; i += 1) t.set(Math.floor(r() * PERIOD), 22, st.pebble)
  for (let x = 0; x < PERIOD; x += 1) {
    t.set(x, 21, RAIL)
    if (x % 4 < 2) t.set(x, 22, TIE)
  }
  return t
}

/** One PERIOD-wide tile of the rock still ahead, with its ore. */
function rockTile(st: Strata): Pixels {
  const r = rng(29)
  const t = new Pixels(PERIOD, H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < PERIOD; x += 1) {
      const shade = r()
      let color: number = shade < 0.15 ? st.rock[0] : shade < 0.7 ? st.rock[1] : st.rock[2]
      if (y % 7 === 0 && r() < 0.6) color = st.rock[0]
      t.set(x, y, color)
    }
  }
  for (const [ox, oy, kind] of ORES) {
    const [main, light, dark] = st.ores[kind]
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) t.set(ox + dx, oy + dy, main)
    t.set(ox, oy, light)
    t.set(ox - 1, oy - 1, light)
    t.set(ox + 1, oy + 1, dark)
  }
  return t
}

/** A tile repeated across `width`, so a window of W can slide a whole PERIOD. */
function strip(tile: Pixels, width: number): Pixels {
  const s = new Pixels(width, H)
  for (let y = 0; y < H; y += 1) for (let x = 0; x < width; x += 1) s.set(x, y, tile.get(x % PERIOD, y))
  return s
}

const STRIP = W + PERIOD
const lanterns = Array.from({ length: Math.ceil(STRIP / PERIOD) }, (_, k) => LANTERN_X + k * PERIOD)

const worlds = new Map<string, { tunnel: Pixels; rock: Pixels }>()

/** How the lanterns burn: as dug, warmer once Brighter lanterns are bought, flaring while Claude ultrathinks. */
type Glow = 'plain' | 'warm' | 'flare'

/**
 * Each glow's color; how much of it the terminal's tunnel takes near the
 * lantern and further out, and how far; the SVG's two rings and their opacity.
 */
const GLOWS: Readonly<Record<Glow, { color: number; near: number; far: number; inner: number; reach: number; rings: readonly [number, number]; opacity: string }>> = {
  plain: { color: GLOW, near: 0.12, far: 0.06, inner: 6, reach: 10, rings: [10, 6], opacity: '.07' },
  warm: { color: 0xffa63d, near: 0.22, far: 0.11, inner: 6, reach: 10, rings: [12, 7], opacity: '.13' },
  flare: { color: 0xfff2c4, near: 0.3, far: 0.15, inner: 8, reach: 13, rings: [14, 8], opacity: '.15' },
}

const glowOf = (spec: SceneSpec): Glow => (spec.flare === true ? 'flare' : spec.warm === true ? 'warm' : 'plain')

/** In December snow lies on the topsoil: on its ceiling, its spoil heaps and the rock ahead. */
const isSnowy = (spec: SceneSpec): boolean => spec.season === 'winter' && spec.biome === 0

/** The strips the window slides over, with the lanterns' glow mixed in when asked. Built once a layer, glow and snow. */
function world(withGlow: boolean, biome: number, glow: Glow = 'plain', snowy = false): { tunnel: Pixels; rock: Pixels } {
  const key = `${biome}:${withGlow}:${glow}:${snowy}`
  const hit = worlds.get(key)
  if (hit !== undefined) return hit
  const built = buildWorld(withGlow, strataOf(biome), GLOWS[glow], snowy)
  worlds.set(key, built)
  return built
}

function buildWorld(withGlow: boolean, st: Strata, glow: (typeof GLOWS)[Glow], snowy: boolean): { tunnel: Pixels; rock: Pixels } {
  const tunnel = strip(tunnelTile(st), STRIP)
  const rock = strip(rockTile(st), STRIP)
  if (snowy) {
    for (let x = 0; x < STRIP; x += 1) {
      if (x % 3 !== 1) tunnel.set(x, 0, SNOW)
      if (x % 2 === 0) rock.set(x, 0, SNOW)
      for (let y = 0; y < H; y += 1) if (tunnel.get(x, y) === st.pileTop) tunnel.set(x, y, SNOW)
    }
  }
  if (withGlow && st.sky === undefined) {
    for (const lx of lanterns) {
      for (let y = 0; y < H; y += 1) {
        for (let x = lx - glow.reach; x <= lx + glow.reach; x += 1) {
          const d = Math.hypot(x - lx, y - LANTERN_Y)
          const color = tunnel.get(x, y)
          if (d <= glow.reach && color !== CLEAR && color !== LAMP) tunnel.set(x, y, mix(color, glow.color, d <= glow.inner ? glow.near : glow.far))
        }
      }
    }
  }
  return { tunnel, rock }
}

/** The face's dark edge: the line between the tunnel and the rock. */
function faceEdge(st: Strata): Pixels {
  const edge = new Pixels()
  for (let y = 0; y < H; y += 1) edge.set(faceAt(y), y, st.rock[0])
  return edge
}

function cart(px: Pixels, carts: number, wheel: number): void {
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
    px.set(cx + (wheel === 0 ? -1 : 1), 19, STEEL)
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

function pickaxe(px: Pixels, hx: number, hy: number, angle: number, look: PickLook): void {
  const a = (angle * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  px.line(hx - dx, hy - dy, hx + dx * 8, hy + dy * 8, look.handle)
  if (look.grip !== null) {
    px.set(hx + dx * 2, hy + dy * 2, look.grip)
    px.set(hx + dx * 3, hy + dy * 3, look.grip)
  }
  const ex = hx + dx * 8
  const ey = hy + dy * 8
  const nx = -dy
  const ny = dx
  let prev: [number, number] | null = null
  for (let t = -4; t <= 4; t += 1) {
    const bend = 0.08 * t * t
    const x = ex + nx * t - dx * bend
    const y = ey + ny * t - dy * bend
    const color = Math.abs(t) >= 3 ? look.edge : look.head
    if (prev) px.line(prev[0], prev[1], x, y, color)
    else px.set(x, y, color)
    if (Math.abs(t) <= 2) px.set(x - dx, y - dy, look.shade)
    prev = [x, y]
  }
}

function miner(px: Pixels, frame: Frame, look: PickLook, spec?: SceneSpec): void {
  const hand = spec?.gloves === true ? GLOVE : SKIN
  // His hands, a shut eye, an unlit lamp, and the mug he holds: the one by the cart. In December his helmet is a Santa hat.
  const hat: Readonly<Record<string, number>> = spec?.season === 'winter' ? { Y: SANTA_RED, y: SNOW } : {}
  const palette = { ...MINER_PALETTE, H: hand, e: 0xc89a6a, l: 0x8a8460, W: MUG_RED, ...hat }
  if (spec?.pose === 'facing' || spec?.pose === 'tip') {
    // The pick stands head down beside him while he looks out at you.
    pickaxe(px, SX + 13, SY + 10, 90, look)
    px.sprite(spec.pose === 'tip' ? MINER_TIP : MINER_FRONT, palette, SX, SY)
    return
  }
  if (spec?.pose === 'coffee' || spec?.pose === 'sleep') {
    // The pick leans on the rock, its head on the ground.
    pickaxe(px, 48, 9, 80, look)
    px.sprite(spec.pose === 'coffee' ? MINER_SIT : MINER_SLEEP, palette, SX, SY)
    if (spec.pose === 'coffee') {
      px.set(SX + 11, SY + 11, 0xb4b2a9)
      px.set(SX + 12, SY + 10, 0xb4b2a9)
    } else {
      px.sprite(MUG, DETAIL_PALETTE, SX + 14, SY + 16)
      px.sprite(ZBIG, DETAIL_PALETTE, SX + 11, SY + 1)
      px.sprite(ZSMALL, DETAIL_PALETTE, SX + 15, SY - 1)
    }
    return
  }
  const p = pose(frame)
  const hx = SX + p.hx
  const hy = SY + p.hy + frame.bob
  pickaxe(px, hx, hy, p.angle, look)
  px.sprite(MINER, palette, SX, SY + frame.bob)
  // The hat's white bobble hangs at its back.
  if (spec?.season === 'winter') px.set(SX + 3, SY + 1 + frame.bob, SNOW)
  px.line(SX + 9, SY + 11 + frame.bob, hx, hy, SHIRT)
  px.set(hx, hy, hand)
  if (spec?.gloves === true) {
    px.set(hx + 1, hy, hand)
    px.set(hx, hy + 1, hand)
  }
}

function chips(px: Pixels, look: PickLook, st: Strata): void {
  const colors = sparksOf(look, st)
  CHIPS.forEach((chip, i) => px.set(chip.x + chip.dx1, chip.y + chip.dy1, colors[i] ?? st.rock[2]))
}

function sparkle(px: Pixels, look: PickLook, st: Strata): void {
  const ray = look.sparks === null ? st.ores[0][0] : (look.sparks[1] ?? GOLD[0])
  for (const [dx, dy] of [[0, -2], [0, -1], [0, 1], [0, 2], [-2, 0], [-1, 0], [1, 0], [2, 0]] as const) px.set(53 + dx, 11 + dy, ray)
  px.set(53, 11, LAMP)
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
const pct = (share: number) => `${(Math.min(1, Math.max(0, share)) * 100).toFixed(3)}%`

/** One <path> per color, each a run of same-colored pixels in a row. */
function paths(px: Pixels): string {
  const runs = new Map<number, string[]>()
  for (let y = 0; y < px.h; y += 1) {
    let x = 0
    while (x < px.w) {
      const color = px.get(x, y)
      if (color === CLEAR) {
        x += 1
        continue
      }
      let len = 1
      while (x + len < px.w && px.get(x + len, y) === color) len += 1
      const list = runs.get(color) ?? []
      list.push(`M${x} ${y}h${len}v1h-${len}z`)
      runs.set(color, list)
      x += len
    }
  }
  return [...runs].map(([color, d]) => `<path fill="${hex(color)}" d="${d.join('')}"/>`).join('')
}

function glowPath(cx: number, radius: number, glow: (typeof GLOWS)[Glow]): string {
  const d: string[] = []
  for (let dy = -radius; dy <= radius; dy += 1) {
    const w = Math.floor(Math.sqrt(radius * radius - dy * dy))
    const y = LANTERN_Y + dy
    if (y < 0 || y >= H) continue
    d.push(`M${cx - w} ${y}h${2 * w + 1}v1h-${2 * w + 1}z`)
  }
  return `<path fill="${hex(glow.color)}" fill-opacity="${glow.opacity}" d="${d.join('')}"/>`
}

/** Keyframes that switch a property at the given shares of the loop and hold it between. */
function stepKeyframes(name: string, prop: string, start: string, steps: readonly (readonly [number, string])[]): string {
  const body = [`0%{${prop}:${start}}`, ...steps.map(([at, value]) => `${pct(at)}{${prop}:${value}}`)]
  return `@keyframes ${name}{${body.join('')}}`
}

/** Shows a frame for its slice of the loop and hides it otherwise. */
function windowKeyframes(name: string, from: number, to: number): string {
  if (from === 0) return stepKeyframes(name, 'opacity', '1', to < 1 ? [[to, '0']] : [])
  return stepKeyframes(name, 'opacity', '0', to < 1 ? [[from, '1'], [to, '0']] : [[from, '1']])
}

/**
 * The scene as an SVG document whose own CSS animates it. `fluid` makes it fill
 * whatever box draws it, cropping rather than leaving a margin, for a surface
 * that may draw the box a little taller than asked.
 */
export function sceneSvg(spec: SceneSpec, scale: number, fluid = false): string {
  const st = strataOf(spec.biome)
  const { tunnel, rock } = world(false, spec.biome, glowOf(spec), isSnowy(spec))
  const look = lookOf(spec.pick)
  const { frames, ms } = framesFor(spec.mode)
  const isDigging = spec.mode === 'work'
  const css: string[] = [
    '.glow{animation:flicker 1.7s step-end infinite}',
    '@keyframes flicker{0%{opacity:.9}22%{opacity:.65}31%{opacity:1}64%{opacity:.8}83%{opacity:1}}',
  ]
  const clip = FACE.map((x, y) => `M${x} ${y}h${W - x}v1h-${W - x}z`).join('')
  const body: string[] = [`<defs><clipPath id="rock"><path d="${clip}"/></clipPath></defs>`]

  // The world: the tunnel behind, the rock ahead clipped to the face. While
  // Claude works both slide left a CUT at every strike, and wrap after PERIOD.
  if (isDigging) {
    css.push(
      `.slide{animation:slide ${LOOP_MS}ms step-end infinite}`,
      stepKeyframes(
        'slide',
        'transform',
        'translate(0px,0px)',
        Array.from({ length: CUTS }, (_, k) => [cutAt(k), `translate(${-mod((k + 1) * CUT, PERIOD)}px,0px)`] as const),
      ),
    )
  }
  const slide = isDigging ? ' class="slide"' : ''
  // Under the sky no lantern burns, so nothing flickers.
  const glow = GLOWS[glowOf(spec)]
  const glows = st.sky === undefined ? `<g class="glow">${lanterns.map(lx => `${glowPath(lx, glow.rings[0], glow)}${glowPath(lx, glow.rings[1], glow)}`).join('')}</g>` : ''
  body.push(`<g${slide}>${paths(tunnel)}${glows}</g>`)
  body.push(`<g clip-path="url(#rock)"><g${slide}>${paths(rock)}</g></g>`)
  body.push(paths(faceEdge(st)))

  // The crew that follows him stays put on screen while the world slides by.
  if (spec.carts > 0) {
    if (isDigging) {
      css.push('.wh{opacity:0;animation:900ms step-end infinite}')
      ;[0, 1].forEach(wheel => {
        const layer = new Pixels()
        cart(layer, spec.carts, wheel)
        css.push(`.wh${wheel}{animation-name:wh${wheel}}`, windowKeyframes(`wh${wheel}`, wheel * 0.5, wheel === 0 ? 0.5 : 1))
        body.push(`<g class="wh wh${wheel}">${paths(layer)}</g>`)
      })
    } else {
      const layer = new Pixels()
      cart(layer, spec.carts, 0)
      body.push(paths(layer))
    }
  }
  if (spec.goblins > 0) {
    css.push('.gb{opacity:0;animation:1.2s step-end infinite}')
    ;[0, 1].forEach(bob => {
      const layer = new Pixels()
      goblin(layer, bob)
      css.push(`.gb${bob}{animation-name:gb${bob}}`, windowKeyframes(`gb${bob}`, bob * 0.5, bob === 0 ? 0.5 : 1))
      body.push(`<g class="gb gb${bob}">${paths(layer)}</g>`)
    })
  }

  const fixed = new Pixels()
  fixedDetails(fixed, spec)
  body.push(paths(fixed))
  if (spec.bug === 'crawl') {
    const bug = new Pixels()
    const [bx, by] = BUG_AT[0] ?? [56, 2]
    bug.sprite(BUG, DETAIL_PALETTE, bx, by)
    if (isDigging) {
      const steps = BUG_AT.slice(1).map(([x, y], i) => [(i + 1) / BUG_AT.length, `translate(${x - bx}px,${y - by}px)`] as const)
      css.push(`.bug{animation:bug ${LOOP_MS}ms step-end infinite}`, stepKeyframes('bug', 'transform', 'translate(0px,0px)', steps))
      body.push(`<g class="bug">${paths(bug)}</g>`)
    } else {
      body.push(paths(bug))
    }
  }
  if (spec.confetti === true) {
    const bits = new Pixels()
    confetti(bits, 0)
    if (isDigging) {
      const steps = Array.from({ length: CONFETTI_STEPS - 1 }, (_, k) => [(k + 1) / CONFETTI_STEPS, `translate(0px,${(k + 1) * CONFETTI_FALL}px)`] as const)
      css.push(`.cf{animation:cf ${SWING_MS}ms step-end infinite}`, stepKeyframes('cf', 'transform', 'translate(0px,0px)', steps))
      body.push(`<g class="cf">${paths(bits)}</g>`)
    } else {
      body.push(paths(bits))
    }
  }
  if (spec.canary === true && isDigging) {
    const note = new Pixels()
    note.sprite(NOTE, DETAIL_PALETTE, 29, 6)
    css.push(`.nt{opacity:0;animation:nt ${LOOP_MS}ms step-end infinite}`, stepKeyframes('nt', 'opacity', '0', [[0.19, '1'], [0.31, '0'], [0.69, '1'], [0.81, '0']]))
    body.push(`<g class="nt">${paths(note)}</g>`)
  }

  if (frames.length === 1) {
    const layer = new Pixels()
    miner(layer, frames[0] as Frame, look, spec)
    body.push(paths(layer))
  } else {
    css.push(`.m{opacity:0;animation-duration:${ms}ms;animation-timing-function:step-end;animation-iteration-count:infinite}`)
    frames.forEach((frame, i) => {
      const layer = new Pixels()
      miner(layer, frame, look, spec)
      const to = frames[i + 1]?.at ?? 1
      css.push(`.m${i}{animation-name:m${i}}`, windowKeyframes(`m${i}`, frame.at, to))
      body.push(`<g class="m m${i}">${paths(layer)}</g>`)
    })
  }

  if (isDigging) {
    css.push(`.c{opacity:0;animation:${SWING_MS}ms linear infinite}`)
    CHIPS.forEach((chip, i) => {
      const a = IMPACT_AT
      css.push(
        `.c${i}{animation-name:c${i}}`,
        `@keyframes c${i}{0%,${pct(a - 0.001)}{opacity:0;transform:translate(0px,0px)}` +
          `${pct(a)}{opacity:1;transform:translate(0px,0px)}` +
          `${pct(a + 0.12)}{opacity:1;transform:translate(${chip.dx1}px,${chip.dy1}px)}` +
          `${pct(a + 0.3)}{opacity:0;transform:translate(${chip.dx2}px,${chip.dy2}px)}100%{opacity:0}}`,
      )
      body.push(`<rect class="c c${i}" x="${chip.x}" y="${chip.y}" width="1" height="1" fill="${hex(sparksOf(look, st)[i] ?? st.rock[2])}"/>`)
    })
    // Every few strikes the pick finds ore.
    const sparks: (readonly [number, string])[] = []
    for (let k = SPARK_EVERY - 1; k < CUTS; k += SPARK_EVERY) sparks.push([cutAt(k), '1'], [(k + IMPACT_AT + SPARK_FOR) / CUTS, '0'])
    const layer = new Pixels()
    sparkle(layer, look, st)
    css.push(`.sp{opacity:0;animation:sp ${LOOP_MS}ms step-end infinite}`, stepKeyframes('sp', 'opacity', '0', sparks))
    body.push(`<g class="sp">${paths(layer)}</g>`)
  }

  const size = fluid
    ? 'width="100%" height="100%" preserveAspectRatio="xMidYMid slice"'
    : `width="${W * scale}" height="${H * scale}"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${size} shape-rendering="crispEdges" style="display:block;background:${hex(st.cave)}">` +
    `<style>${css.join('')}</style>${body.join('')}</svg>`
  )
}

/** The scene at one moment, as pixels: what the terminal paints and the tests read. */
export function compose(spec: SceneSpec, m: Moment): Pixels {
  const st = strataOf(spec.biome)
  const { tunnel, rock } = world(true, spec.biome, glowOf(spec), isSnowy(spec))
  const px = new Pixels()
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) px.set(x, y, (x >= faceAt(y) ? rock : tunnel).get(x + m.scroll, y))
  }
  px.stamp(faceEdge(st))
  if (spec.carts > 0) cart(px, spec.carts, m.wheel)
  if (spec.goblins > 0) goblin(px, 0)
  fixedDetails(px, spec)
  if (spec.bug === 'crawl') {
    const [bx, by] = BUG_AT[spec.mode === 'work' ? Math.floor(m.scroll / (PERIOD / BUG_AT.length)) % BUG_AT.length : 0] ?? [56, 2]
    px.sprite(BUG, DETAIL_PALETTE, bx, by)
  }
  if (spec.canary === true && spec.mode === 'work' && (m.scroll === 6 || m.scroll === 22)) px.sprite(NOTE, DETAIL_PALETTE, 29, 6)
  if (spec.confetti === true) confetti(px, spec.mode === 'work' ? (m.scroll / CUT) % CONFETTI_STEPS : 0)
  const look = lookOf(spec.pick)
  const { frames } = framesFor(spec.mode)
  const frame = frames[m.frame] ?? frames[0]
  if (frame !== undefined) {
    miner(px, frame, look, spec)
    if (frame.chips) chips(px, look, st)
  }
  if (m.spark) sparkle(px, look, st)
  return px
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
export function cellsOf(px: Pixels): string {
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

/** The terminal's cells for one moment of the scene. */
export const sceneCells = (spec: SceneSpec, m: Moment): string => cellsOf(compose(spec, m))
