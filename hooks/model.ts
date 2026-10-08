// What the drawings show, computed from the save as plain data. The shop
// draws its model and the HUD its props, so neither reads the mine itself and
// neither is redrawn when nothing it shows has changed.

import type { HudProps, IconId, Mode, Save, ShopModel, ToolKind, View } from '../types'
import { CRYSTAL_UNIT, PRODUCERS, TOOL_NAMES, type Upgrade } from './data.ts'
import { commas, fmt, fmtRate } from './format.ts'
import * as game from './game.ts'

export const SHOP_LIMIT = 8

const TOOL_ICONS: Readonly<Record<ToolKind, IconId>> = {
  read: 'glasses',
  edit: 'dynamite',
  bash: 'terminal',
  web: 'globe',
  mcp: 'plug',
  agent: 'crew',
  other: 'pick',
}

export function upgradeIcon(u: Upgrade): IconId {
  switch (u.effect.kind) {
    case 'click':
    case 'clickRate':
      return 'pick'
    case 'producer':
      return u.effect.id
    case 'tool':
      return TOOL_ICONS[u.effect.tool]
    case 'ore':
      return 'nugget'
    case 'idle':
      return 'moon'
    case 'shift':
      return 'clock'
    case 'global':
      return 'lantern'
  }
}

export function unlockText(u: Upgrade): string {
  const n = commas(u.unlock.n)
  switch (u.unlock.kind) {
    case 'clicks':
      return `after ${n} clicks`
    case 'tools':
      return `after ${n} tool calls`
    case 'turns':
      return `after ${n} turns`
    case 'mined':
      return `after ${n} ${TOOL_NAMES[u.unlock.tool]} calls`
    case 'owned': {
      const p = game.producer(u.unlock.id)
      return `with ${n} ${u.unlock.n === 1 ? p.name : p.plural}`
    }
    case 'crew':
      return `with ${n} producers`
    case 'earned':
      return `after ${fmt(u.unlock.n)} sparks in all`
  }
}

export const EMPTY_SHOP: ShopModel = {
  isLoaded: false,
  amount: 1,
  producers: [],
  teaser: null,
  upgrades: [],
  more: 0,
  next: null,
  values: { click: 1, read: 1, edit: 4 },
  crystals: 0,
  gain: 0,
  nextCrystalAt: CRYSTAL_UNIT,
  showCollapse: false,
  stats: { clicks: 0, tools: 0, turns: 0 },
}

export function shopModel(save: Save, amount: number, isLoaded: boolean): ShopModel {
  const m = game.multipliers(save)
  const top = PRODUCERS.reduce((high, p, i) => (game.owned(save, p.id) > 0 ? i : high), -1)
  const producers = PRODUCERS.slice(0, top + 2).map(p => {
    const owned = game.owned(save, p.id)
    return {
      id: p.id,
      icon: p.id,
      name: p.name,
      detail: `${fmtRate(game.unitRate(save, p.id, m))}/s each · ${p.blurb}`,
      owned,
      price: game.priceOf(p, owned, amount),
      canBuy: save.sparks >= game.priceOf(p, owned),
    }
  })
  const { onSale, next } = game.shopUpgrades(save)
  const upgrades = onSale.slice(0, SHOP_LIMIT).map(u => ({
    id: u.id,
    icon: upgradeIcon(u),
    name: u.name,
    detail: u.blurb,
    owned: 0,
    price: u.cost,
    canBuy: save.sparks >= u.cost,
  }))
  let nextUp: ShopModel['next'] = null
  if (next !== null) {
    const p = game.progress(save, next)
    nextUp = { name: next.name, icon: upgradeIcon(next), text: unlockText(next), have: Math.min(p.have, p.need), need: p.need }
  }
  const gain = game.crystalGain(save)
  return {
    isLoaded,
    amount,
    producers,
    teaser: PRODUCERS[top + 2]?.cost ?? null,
    upgrades,
    more: Math.max(0, onSale.length - SHOP_LIMIT),
    next: nextUp,
    values: {
      click: game.clickValue(save, m),
      read: game.toolValue(save, 'read', m),
      edit: game.toolValue(save, 'edit', m),
    },
    crystals: save.crystals,
    gain,
    nextCrystalAt: (save.crystals + gain + 1) ** 3 * CRYSTAL_UNIT,
    showCollapse: save.crystals > 0 || save.allTime >= CRYSTAL_UNIT / 10,
    stats: { clicks: save.clicks, tools: save.tools, turns: save.turns },
  }
}

export const EMPTY_HUD: HudProps = {
  variant: 'band',
  mode: 'idle',
  sparks: 0,
  rate: 0,
  click: 1,
  idle: 0,
  turn: 0,
  lastTurn: 0,
  last: null,
}

export function hudProps(save: Save, view: View, mode: Mode, variant: HudProps['variant']): HudProps {
  const m = game.multipliers(save)
  return {
    variant,
    mode,
    sparks: save.sparks,
    rate: game.rate(save, m),
    click: game.clickValue(save, m),
    idle: m.idle,
    turn: Math.max(0, save.lifetime - view.turnStart),
    lastTurn: view.lastTurn,
    last: view.last === null ? null : `${view.last.label} +${fmt(view.last.value)} ✻`,
  }
}
