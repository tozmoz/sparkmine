// The shop's pictures on the desktop: the layers in sight, the badge wall and
// progress bars, each an SVG document an Svg element draws. The terminal
// draws the same in text. Their greys are see-through, so they read on a light
// theme as on a dark one, and each is built only when what it shows changes.

import type { Badge, BadgeArt, ShopModel } from '../types'
import { iconBody } from './icons.ts'

/** The width the shop's pictures are drawn at; a narrower pane scales them down. */
export const PICTURE_WIDTH = 484

const GREY_FILL = 'rgba(128,128,128,.12)'
const GREY_LINE = 'rgba(128,128,128,.38)'
const GOLD = '#f2b632'
/** The color a pointer over a badge rings it in: the Claude orange. */
const HOVER = '#d97757'

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** An SVG document; the color scheme lets a frame that draws it stay see-through on either theme. */
const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="color-scheme:light dark">${body}</svg>`

/** A bar `share` full in `color`, rounded at both ends. */
export function barSvg(share: number, color: string, width = PICTURE_WIDTH, height = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * width)
  const r = height / 2
  return svg(
    width,
    height,
    `<clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>` +
      `<g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="${GREY_FILL}"/>` +
      (filled > 0 ? `<rect width="${filled}" height="${height}" fill="${color}"/>` : '') +
      '</g>',
  )
}

/**
 * The layers in sight as a row of blocks: the reached ones in their colors,
 * the one the mine is in ringed, the next one dashed, the ones below empty.
 */
export function strataSvg(strata: ShopModel['depth']['strata'], width = PICTURE_WIDTH): string {
  const pad = 4
  const height = 22
  const gap = 4
  const n = Math.max(1, strata.length)
  const w = (width - 2 * pad - gap * (n - 1)) / n
  const blocks = strata.map((s, i) => {
    const x = pad + i * (w + gap)
    const rect = (extra: string) => `<rect x="${x.toFixed(1)}" y="${pad}" width="${w.toFixed(1)}" height="${height}" rx="5" ${extra}/>`
    switch (s.state) {
      case 'reached':
        return rect(`fill="${s.color}"`)
      case 'here':
        return (
          rect(`fill="${s.color}"`) +
          `<rect x="${(x - 3).toFixed(1)}" y="${pad - 3}" width="${(w + 6).toFixed(1)}" height="${height + 6}" rx="7.5" fill="none" stroke="${s.color}" stroke-width="1.5"/>`
        )
      case 'next':
        return rect(`fill="${s.color}" fill-opacity=".12" stroke="${s.color}" stroke-width="1.5" stroke-dasharray="4 3"`)
      case 'ahead':
        return rect(`fill="none" stroke="${GREY_LINE}" stroke-width="1"`)
    }
  })
  return svg(width, height + 2 * pad, blocks.join(''))
}

const TILE = 40
const GAP = 7
/** Badges to a row: nine, as many as the depth, Claude's work and the secrets each have. */
const PER_ROW = 9
/** The wall's width: nine badges to a row, narrower than the pane so it never overflows it. */
export const WALL_WIDTH = PER_ROW * (TILE + GAP) - GAP

/** A lump of a layer's rock, 12 x 12: the layer's color with darker flecks. */
const ROCK = [
  '............',
  '....KKKK....',
  '..KKccccKK..',
  '.KccdcccccK.',
  '.KcccccdccK.',
  '.KcdccccccK.',
  '.KccccdcccK.',
  '.KcccccccdK.',
  '..KKccccKK..',
  '....KKKK....',
  '............',
  '............',
]

/** A color `k` of the way to black. */
function darker(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * (1 - k)))
  return `#${ch.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function rockBody(color: string): string {
  const fill: Record<string, string> = { K: '#1d1512', c: color, d: darker(color, 0.35) }
  let body = ''
  ROCK.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = fill[row[x] ?? '.']
      if (c !== undefined) body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`
    }
  })
  return body
}

/** The symbol a badge's picture is drawn from, added to `used` the first time. */
function symbolOf(art: BadgeArt, used: Map<string, string>): string {
  const id = art.kind === 'icon' ? `i-${art.id}` : `r-${art.color.slice(1)}`
  if (!used.has(id)) used.set(id, art.kind === 'icon' ? iconBody(art.id) : rockBody(art.color))
  return id
}

function tile(b: Badge, i: number, x: number, y: number, used: Map<string, string>): string {
  const kind = b.isEarned ? 'b won' : b.isSurprise ? 'b q' : 'b'
  const frame = `<rect class="f" x="${x + 0.75}" y="${y + 0.75}" width="${TILE - 1.5}" height="${TILE - 1.5}" rx="8"/>`
  const art = b.isSurprise
    ? `<text class="qm" x="${x + TILE / 2}" y="${y + TILE / 2 + 6}">?</text>`
    : `<use href="#${symbolOf(b.art, used)}" x="${x + 8}" y="${y + 8}" width="24" height="24" shape-rendering="crispEdges"${b.isEarned ? '' : ' opacity=".28"'}/>`
  return `<g class="${kind}" id="b${i}" aria-label="${esc(b.name)}">${frame}${art}</g>`
}

/** The hover note: a box with the badge's name, what it asks, and whether it is earned. */
const TIP_WIDTH = 216
const TIP_CHARS = 32
const TIP_PAD = 9
const TIP_LINE = 16

/** Words in lines of at most `chars` characters. */
function wrap(text: string, chars: number): string[] {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines.at(-1)
    if (last !== undefined && last.length + 1 + word.length <= chars) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

/**
 * A badge's note, there at once when the pointer is over it, where a title
 * would wait a second or more. Under the badge, or over it at the foot of the
 * wall, and kept inside it.
 */
function tip(b: Badge, i: number, x: number, y: number, width: number, height: number): string {
  const says = b.isSurprise ? ['Still a secret.'] : wrap(b.text, TIP_CHARS)
  const lines = [
    { text: b.name, cls: 'tn' },
    ...says.map(text => ({ text, cls: 'tt' })),
    ...(b.isEarned ? [{ text: 'Earned', cls: 'te' }] : []),
  ]
  const h = TIP_PAD * 2 + lines.length * TIP_LINE - 2
  const left = Math.max(0, Math.min(width - TIP_WIDTH, x + TILE / 2 - TIP_WIDTH / 2))
  const below = y + TILE + 6
  const top = below + h <= height ? below : Math.max(0, y - 6 - h)
  const text = lines
    .map((l, n) => `<tspan class="${l.cls}" x="${left + TIP_PAD + 1}" y="${top + TIP_PAD + 11 + n * TIP_LINE}">${esc(l.text)}</tspan>`)
    .join('')
  return `<g class="tip" id="t${i}"><rect x="${left + 0.5}" y="${top + 0.5}" width="${TIP_WIDTH - 1}" height="${h - 1}" rx="7"/><text>${text}</text></g>`
}

/**
 * Every badge, by group, in one picture: earned ones framed in gold, the rest
 * greyed, a surprise a dashed "?". Drawn interactive, so a pointer over a
 * badge rings it and opens its note at once. An interactive picture is drawn
 * in a frame, which takes the size it is given and no other: so the wall says
 * its own.
 */
export function badgeWall(groups: ShopModel['badges']['groups']): { source: string; width: number; height: number } {
  const width = WALL_WIDTH
  const cols = PER_ROW
  const used = new Map<string, string>()
  const labels: string[] = []
  const placed: { b: Badge; x: number; y: number }[] = []
  let y = 0
  for (const g of groups) {
    const won = g.items.filter(b => b.isEarned).length
    labels.push(`<text class="t" x="0" y="${y + 13}">${esc(g.title)} <tspan class="n">${won}/${g.items.length}</tspan></text>`)
    y += 20
    g.items.forEach((b, i) => placed.push({ b, x: (i % cols) * (TILE + GAP), y: y + Math.floor(i / cols) * (TILE + GAP) }))
    y += Math.ceil(g.items.length / cols) * (TILE + GAP) + 8
  }
  const height = Math.max(1, y - 8)
  const tiles = placed.map((p, i) => tile(p.b, i, p.x, p.y, used))
  // The notes come after every badge, so one is drawn over the badges below it,
  // and each opens from its own badge, a sibling before it.
  const tips = placed.map((p, i) => tip(p.b, i, p.x, p.y, width, height))
  const style =
    '<style>' +
    // A frame that sets the picture in a page of its own gives that page a margin: none here.
    'html,body{margin:0;padding:0;overflow:hidden}svg{display:block}' +
    `.t{font:12.5px system-ui,-apple-system,sans-serif;fill:#8a8880}.n{opacity:.75}` +
    `.f{fill:${GREY_FILL};stroke:${GREY_LINE};stroke-width:1}` +
    `.won .f{fill:rgba(242,182,50,.16);stroke:${GOLD};stroke-width:1.5}` +
    `.q .f{stroke-dasharray:3 3}` +
    `.qm{font:700 17px system-ui,-apple-system,sans-serif;fill:rgba(128,128,128,.85);text-anchor:middle}` +
    `.b:hover .f{stroke:${HOVER};stroke-width:1.5}` +
    // The notes: dark on either theme, as a system's own are.
    '.tip{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .08s}' +
    '.tip rect{fill:#2b2a27;stroke:#4a4945}' +
    '.tip text{font:12px system-ui,-apple-system,sans-serif}' +
    '.tn{font-weight:700;fill:#f5f4ef}.tt{fill:#c9c6bb}.te{fill:#f2b632;font-weight:600}' +
    placed.map((_, i) => `#b${i}:hover~#t${i}`).join(',') +
    '{opacity:1;visibility:visible}' +
    '</style>'
  const defs = [...used].map(([id, body]) => `<symbol id="${id}" viewBox="0 0 12 12">${body}</symbol>`).join('')
  return { source: svg(width, height, `${style}<defs>${defs}</defs>${labels.join('')}${tiles.join('')}${tips.join('')}`), width, height }
}
