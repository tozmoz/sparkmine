// Sparkmine: a pixel mining clicker above the prompt. Claude works, you click.

import { atom, read, update } from 'claude-code'
import type { RenderElement, Register, Timer } from 'claude-code'

import type { HudProps } from '../types'
import { newMine, producer } from './game.ts'
import { iconSvg } from './icons.ts'
import { EMPTY_HUD, EMPTY_SHOP, hudProps } from './model.ts'
import { H, ROWS, W, momentAt, momentKey, sceneCells, sceneSvg, type SceneSpec } from './scene.ts'
import * as state from './state.ts'
import { INITIAL_BAND, INITIAL_VIEW, type Io } from './state.ts'
import * as ui from './ui.tsx'

// The session's values. The band draws from BAND and the shop from SHOP alone:
// both change rarely, so a click or a tick never redraws the scene. The live
// numbers reach the screen through the HUD Clients instead.
const MINE = atom({ plugin: 'sparkmine', key: 'mine' } as const, newMine('unloaded'))
const VIEW = atom({ plugin: 'sparkmine', key: 'view' } as const, INITIAL_VIEW)
const BAND = atom({ plugin: 'sparkmine', key: 'band' } as const, INITIAL_BAND)
const SHOP = atom({ plugin: 'sparkmine', key: 'shop' } as const, EMPTY_SHOP)
const REWARD = atom({ plugin: 'sparkmine', key: 'reward' } as const, null)

/** The shop pane's id. */
const PANE = 'sparkmine'
/** CSS pixels per scene pixel: the band's scene, and the smaller one atop the shop. */
const SCALE = 3
const HEADER_SCALE = 2
/** Columns the HUD and the buttons need beside the terminal scene. */
const HUD_COLUMNS = 44
/**
 * The HUD's fixed height in rows, and how far its sparks may fly. Its width
 * follows its text: a desktop draws a width in cells much wider than the text.
 */
const HUD_WORK = { width: 30, height: 3 } as const
const HUD_IDLE = { width: 40, height: 1 } as const
const HUD_SHOP = { width: 50, height: 4 } as const

/** Tools that wait on the person, so the miner rests while they decide. */
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

const specKey = (spec: SceneSpec) => `${spec.mode}:${spec.carts}:${spec.goblins}:${spec.pick}`
const svgs = new Map<string, string>()

function svgFor(spec: SceneSpec, scale: number, fluid = false): string {
  const key = `${specKey(spec)}@${scale}${fluid ? ':fluid' : ''}`
  let svg = svgs.get(key)
  if (svg === undefined) {
    svg = sceneSvg(spec, scale, fluid)
    svgs.set(key, svg)
  }
  return svg
}

const cells = new Map<string, string>()

function cellsFor(spec: SceneSpec, ms: number): { key: string; cells: string } {
  const m = momentAt(spec.mode, ms)
  const key = `${specKey(spec)}|${momentKey(m)}`
  let hit = cells.get(key)
  if (hit === undefined) {
    if (cells.size > 256) cells.clear()
    hit = sceneCells(spec, m)
    cells.set(key, hit)
  }
  return { key, cells: hit }
}

export const register: Register = on => {
  let io: Io | null = null
  let isRunning = false
  /** The last numbers the HUD was handed, so a redraw of the band starts from them. */
  let lastHud: HudProps = EMPTY_HUD
  /** The terminal's scene, which a timer repaints moment by moment. */
  let live: { requestId: string; spec: SceneSpec; shown: string } | null = null
  let animation: Timer | null = null

  on('session.start', async ($, e, next) => {
    const engine: Io = {
      now: () => $.clock.now(),
      get: key => $.store.get(key),
      put: (key, value) => $.store.set(key, value),
      toast: text => $.ui.toast(text),
      ask: (question, options) => $.ui.ask(question, options),
      mine: change => update($, MINE, change),
      view: change => update($, VIEW, change),
      band: change => update($, BAND, change),
      shop: change => update($, SHOP, change),
      reward: change => update($, REWARD, change),
      readMine: () => read($, MINE),
      readView: () => read($, VIEW),
      readBand: () => read($, BAND),
      readShop: () => read($, SHOP),
      readReward: () => read($, REWARD),
    }
    io = engine

    await $.command.register({
      name: 'mine',
      description: 'Open the Sparkmine shop',
      argumentHint: '[hide|show|reset]',
      immediate: true,
    })
    await state.ensureLoaded(engine)

    if (!isRunning) {
      isRunning = true
      const step = async () => {
        const scene = live
        if (scene === null) return
        const frame = cellsFor(scene.spec, await $.clock.now())
        if (frame.key === scene.shown) return
        scene.shown = frame.key
        const painted = await $.ui.blit({ requestId: scene.requestId, key: 'scene', cells: frame.cells, columns: W, rows: ROWS })
        if ('deny' in painted && painted.deny !== undefined) live = null
      }
      $.clock.every(state.TICK_MS, () => {
        void state
          .tick(engine)
          .then(() => {
            const wanted = live !== null && live.spec.mode !== 'pause'
            if (wanted && animation === null) animation = $.clock.every(100, () => void step().catch(() => (live = null)))
            if (!wanted && animation !== null) {
              animation.cancel()
              animation = null
            }
          })
          .catch(() => undefined)
      })
      $.clock.every(state.SYNC_MS, () => {
        void state.sync(engine).catch(() => undefined)
      })
    }
    return next(e)
  })

  // /clear, /resume and /branch reset $.state, so the mine is read again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    if (io !== null) await state.ensureLoaded(io)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (io !== null) await state.sync(io).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (io !== null) await state.startTurn(io)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (io !== null && e.agentId === undefined) await state.endTurn(io)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const asks = ASKS_PERSON.has(tool)
    if (io !== null && asks) await state.setWaiting(io, e.tool_use_id, true)
    let result
    try {
      result = await next(e)
    } finally {
      if (io !== null) await state.setWaiting(io, e.tool_use_id, false)
    }
    if (io !== null && result.deny === undefined && !asks) await state.minedTool(io, tool)
    return result
  }).catch(($, e, next) => next(e))

  // A permission prompt is about to wait on the person: the miner waits with them.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (io !== null && verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      await state.setWaiting(io, e.tool_use_id, true)
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // The HUD Clients ask for fresh numbers a few times a second.
  on('ui.message', { element: ['hud', 'shophud'] }, async ($, e) => {
    const mine = await read($, MINE)
    const view = await read($, VIEW)
    const band = await read($, BAND)
    const size = e.element === 'shophud' ? HUD_SHOP : band.mode === 'idle' ? HUD_IDLE : HUD_WORK
    const props: HudProps = { ...hudProps(mine.save, view, band.mode, e.element === 'shophud' ? 'shop' : 'band'), ...size }
    if (e.element === 'hud') lastHud = props
    return { props }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = await read($, BAND)
    if (e.props.hasSurvey || !band.isLoaded || band.isHidden) {
      live = null
      return next(e)
    }
    const hudSize = band.mode === 'idle' ? HUD_IDLE : HUD_WORK
    const props: HudProps = { ...lastHud, variant: 'band', mode: band.mode, ...hudSize }
    const spec: SceneSpec = { mode: band.mode, carts: band.carts, goblins: band.goblins, pick: band.pick }
    const openShop = () => $.ui.open({ id: PANE, title: 'Sparkmine', focus: true, closeOnEscape: true })
    const mine = () => (io === null ? 0 : state.click(io))
    let ours: RenderElement

    if (e.surface === 'desktop') {
      live = null
      const { Box, Button, Client, Svg, Text } = $.ui.resolve(e)
      const hud = <Client key="hud" module="./hud.ts" props={props} height={hudSize.height} />
      const shop = <Button key="shop" label="Shop" dimColor={band.mode === 'idle'} onPress={openShop} />
      if (band.mode === 'idle') {
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center">
            {hud}
            {shop}
          </Box>
        )
      } else {
        // Each producer owned, with its count: the crew fills the band's right side.
        const crew =
          band.crew.length === 0 ? null : (
            <Box flexDirection="row" columnGap={2} alignItems="flex-end">
              {band.crew.map(member => (
                <Box flexDirection="column" alignItems="center">
                  <Svg source={iconSvg(member.id, 24)} alt={producer(member.id).name} width={24} height={24} />
                  <Text dimColor>{`×${member.owned}`}</Text>
                </Box>
              ))}
            </Box>
          )
        // One row, in order, nothing stretched apart: where room runs out the crew is cut, never overlapped.
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center" borderStyle="round" borderColor="#5e3b1d" paddingX={1}>
            <Svg
              source={svgFor(spec, SCALE, true)}
              alt="A pixel miner digs into a rock wall"
              width={W * SCALE}
              height={H * SCALE}
              isInteractive
            />
            {hud}
            <Box flexDirection="column" rowGap={1} flexShrink={0}>
              {band.mode === 'work' ? <Button key="mine" label="⛏ Mine" onPress={mine} /> : null}
              {shop}
            </Box>
            {crew === null ? null : (
              <Box flexShrink={1} overflow="hidden" marginLeft={2}>
                {crew}
              </Box>
            )}
          </Box>
        )
      }
    } else if (e.surface === 'terminal') {
      const { Box, Button, Client, Raster } = $.ui.resolve(e)
      const hud = <Client key="hud" module="./hud.ts" props={props} height={hudSize.height} />
      const shop = <Button key="shop" label="Shop" dimColor={band.mode === 'idle'} onPress={openShop} />
      const buttons =
        band.mode === 'work' ? (
          <Box flexDirection="column">
            <Button key="mine" label="Mine" hotkey="m" onPress={mine} />
            {shop}
          </Box>
        ) : (
          shop
        )
      const hasRoom = e.props.bodyColumns >= W + HUD_COLUMNS && e.props.maxRows >= ROWS + 2
      if (band.mode === 'idle' || !hasRoom) {
        live = null
        ours = (
          <Box flexDirection="row" columnGap={2}>
            {hud}
            {buttons}
          </Box>
        )
      } else {
        const frame = cellsFor(spec, await $.clock.now())
        live = { requestId: e.requestId, spec, shown: frame.key }
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center" borderStyle="round" borderColor="#5e3b1d">
            <Raster key="scene" columns={W} rows={ROWS} cells={frame.cells} />
            {hud}
            {buttons}
          </Box>
        )
      }
    } else {
      live = null
      return next(e)
    }

    // Other mods share the band: keep what they draw under ours.
    const theirs = await next(e)
    if (theirs.type === 'engine') return ours
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {ours}
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'sparkmine' }, async ($, e) => {
    const shop = await read($, SHOP)
    const band = await read($, BAND)
    const act: ui.ShopActions = {
      buy: id => (io === null ? 0 : state.buyProducer(io, id)),
      upgrade: id => (io === null ? false : state.buyUpgrade(io, id)),
      amount: n => (io === null ? undefined : state.setAmount(io, n)),
      collapse: () => (io === null ? false : state.collapseMine(io)),
    }
    const props: HudProps = { ...lastHud, variant: 'shop', mode: band.mode, ...HUD_SHOP }
    if (e.surface === 'desktop') {
      const { Client, Svg } = $.ui.resolve(e)
      const header: SceneSpec = { mode: 'pause', carts: band.carts, goblins: band.goblins, pick: band.pick }
      return ui.shopTree($.ui.resolve(e), shop, {
        icon: (id, isDim) => <Svg source={iconSvg(id, 24, isDim)} alt={id} width={24} height={24} />,
        header: <Svg source={svgFor(header, HEADER_SCALE)} alt="The mine" width={W * HEADER_SCALE} height={H * HEADER_SCALE} />,
        live: <Client key="shophud" module="./hud.ts" props={props} height={HUD_SHOP.height} />,
        isRoomy: true,
      }, act)
    }
    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)
      return ui.shopTree($.ui.resolve(e), shop, {
        icon: () => null,
        header: null,
        live: <Client key="shophud" module="./hud.ts" props={props} height={HUD_SHOP.height} />,
        isRoomy: false,
      }, act)
    }
    const { Text } = $.ui.resolve(e)
    return ui.shopTree($.ui.resolve(e), shop, { icon: () => null, header: null, live: <Text bold>{`✻ ${Math.floor(lastHud.sparks)}`}</Text>, isRoomy: false }, act)
  })

  // The spinner says what the mine has unlocked. On the desktop its word names
  // the step Claude is on, so only the plain "Working" changes there.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const word = await read($, REWARD)
    if (word === null) return next(e)
    if (e.surface === 'desktop' && e.props.word !== 'Working') return next(e)
    return next({ ...e, props: { ...e.props, word } })
  })

  on('command.run', { command: 'mine' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '' || arg === 'shop') {
      await $.ui.open({ id: PANE, title: 'Sparkmine', focus: true, closeOnEscape: true })
      return {}
    }
    if (io === null) return { text: 'Sparkmine is still starting.' }
    switch (arg) {
      case 'hide':
        await state.setHidden(io, true)
        return { text: 'Sparkmine is hidden. /mine show brings it back.' }
      case 'show':
        await state.setHidden(io, false)
        return { text: 'Sparkmine is back above the prompt.' }
      case 'reset':
        return { text: (await state.resetMine(io)) ? 'Sparkmine was reset.' : 'Nothing was reset.' }
      default:
        return { text: 'Usage: /mine [shop|hide|show|reset]' }
    }
  })
}
