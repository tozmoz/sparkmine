// Sparkmine: a pixel mining clicker above the prompt. Claude works, you click.

import { atom, read, update } from 'claude-code'
import type { RenderElement, Register, Timer } from 'claude-code'

import type { HudProps, StatsProps } from '../types'
import { newMine, normalizeMine, outcomeOf, producer } from './game.ts'
import { iconSvg } from './icons.ts'
import { EMPTY_HUD, EMPTY_SHOP, EMPTY_STATS, hudProps, statsProps, veinProps } from './model.ts'
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
/** CSS pixels of each producer in the band's crew rack. */
const CREW_ICON = 20
/** Columns the Mine button, the HUD, the Shop button and a vein need beside the terminal scene. */
const HUD_COLUMNS = 64
/**
 * The HUD's fixed height in rows. Its width follows its text: a desktop draws
 * a width in cells much wider than the text.
 */
const HUD_WORK = { height: 2 } as const
const HUD_IDLE = { height: 1 } as const
const HUD_SHOP = { height: 4 } as const

/** Where the band draws, as the Clients' props say it. */
const surfaceOf = (surface: string): HudProps['surface'] => (surface === 'terminal' || surface === 'desktop' ? surface : 'other')

/** Tools that wait on the person, so the miner rests while they decide. */
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

const specKey = (spec: SceneSpec) => `${spec.mode}:${spec.carts}:${spec.goblins}:${spec.pick}:${spec.biome}`
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

/** The most presses one post is counted for, should a HUD send something odd. */
const MAX_PRESSES_PER_POST = state.MAX_CLICKS_PER_SECOND
/** HUD instances whose press totals are remembered: a band remounts now and then. */
const MAX_HUDS = 16

export const register: Register = on => {
  let io: Io | null = null
  let isRunning = false
  /** The last numbers a HUD was handed, so a redraw of the band or the shop starts from them. */
  let lastHud: HudProps = EMPTY_HUD
  /** The presses the band's HUD was last told were counted: the shop's HUD has none. */
  let lastAcked = 0
  /** The stats the shop's Client was last handed, so a redraw of the shop starts from them. */
  let lastStats: StatsProps = EMPTY_STATS
  /** Presses each band HUD has posted so far, by instance. */
  const totals = new Map<string, number>()
  /** Presses of the terminal band's own Mine button the hooks have counted: see HudProps `taps`. */
  let taps = 0
  /** Presses of that button not yet counted, and the run counting them. */
  let queued = 0
  let counting: Promise<void> | null = null
  /**
   * A press of the terminal's Mine button. It returns at once: presses that
   * come while one is still being counted were lost, so `m` held down or tapped
   * fast mined once. They queue, and each round counts all that came.
   */
  const tap = () => {
    queued += 1
    counting ??= (async () => {
      while (queued > 0 && io !== null) {
        const n = queued
        queued = 0
        taps += (await state.clicks(io, n)).counted
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        counting = null
      })
  }
  /** The shop's Button handles, by surface and then key: see ui.keepHandles. */
  const shopHandles = new Map<string, Map<string, ui.Press>>()
  const handlesOn = (surface: string): Map<string, ui.Press> => {
    let held = shopHandles.get(surface)
    if (held === undefined) {
      held = new Map()
      shopHandles.set(surface, held)
    }
    return held
  }

  /**
   * Counts the presses a band HUD reports. Each post carries its running
   * total, so presses whose posts merged in one frame all count. An instance
   * heard for the first time (a new HUD, or this module reloaded under a
   * running one) is counted from there on. Answers how many are counted.
   */
  const countPresses = async (engine: Io, data: unknown): Promise<number> => {
    if (data === null || typeof data !== 'object') return 0
    const { instance, total } = data as { instance?: unknown; total?: unknown }
    if (typeof instance !== 'string' || typeof total !== 'number' || !Number.isFinite(total)) return 0
    const seen = totals.get(instance)
    totals.delete(instance)
    totals.set(instance, Math.max(total, seen ?? 0))
    if (totals.size > MAX_HUDS) totals.delete(totals.keys().next().value ?? instance)
    if (seen !== undefined && total > seen) await state.clicks(engine, Math.min(total - seen, MAX_PRESSES_PER_POST))
    return total
  }
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
      // Values kept in the session from before an update lack newer fields: every read fills them.
      mine: change => update($, MINE, m => change(normalizeMine(m))),
      view: change => update($, VIEW, v => change(state.fillView(v))),
      band: change => update($, BAND, b => change(state.fillBand(b))),
      shop: change => update($, SHOP, change),
      reward: change => update($, REWARD, change),
      readMine: async () => normalizeMine(await read($, MINE)),
      readView: async () => state.fillView(await read($, VIEW)),
      readBand: async () => state.fillBand(await read($, BAND)),
      readShop: () => read($, SHOP),
      readReward: () => read($, REWARD),
    }
    io = engine

    await $.command.register({
      name: 'mine',
      description: 'Open the Sparkmine shop',
      argumentHint: '[stop|start|compact|hide|show|reset]',
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
      const syncLater = () =>
        $.clock.after(state.SYNC_MS + Math.floor(Math.random() * state.SYNC_JITTER_MS), () => {
          void state
            .sync(engine)
            .catch(() => undefined)
            .finally(syncLater)
        })
      syncLater()
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
    if (io !== null && e.agentId === undefined) await state.endTurn(io, e.durationMs)
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
    // Read only: the outcome says whether tests passed or a commit landed, and the call goes on unchanged.
    if (io !== null && result.deny === undefined && !asks) await state.minedTool(io, outcomeOf(tool, e, result))
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

  // The desktop's wooden Shop sign is a Client of its own: a press posts, and the shop opens.
  on('ui.message', { element: 'shopbtn' }, async ($, e) => {
    const data = e.data
    if (data === null || typeof data !== 'object' || (data as { open?: unknown }).open !== true) return {}
    await $.ui.open({ id: PANE, title: 'Sparkmine', focus: true, closeOnEscape: true })
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane !== undefined && !pane.isPlaced) $.ui.toast('The shop opens in a wider window, or with /mine')
    return {}
  })

  // The vein asks four times a second whether one is showing, and says when it is caught.
  on('ui.message', { element: 'vein' }, async ($, e) => {
    if (io === null) return {}
    const data = e.data
    if (data !== null && typeof data === 'object' && typeof (data as { catch?: unknown }).catch === 'number') {
      await state.catchVein(io, (data as { catch: number }).catch)
    }
    return { props: veinProps(await io.readView(), await io.now(), surfaceOf(e.surface)) }
  })

  // The shop's stats ask for fresh numbers once a second.
  on('ui.message', { element: 'stats' }, async () => {
    if (io === null) return {}
    lastStats = statsProps((await io.readMine()).save)
    return { props: lastStats }
  })

  // The HUD Clients ask for fresh numbers ten times a second, and the band's
  // reports the presses of its Mine button.
  on('ui.message', { element: ['hud', 'shophud'] }, async ($, e) => {
    const isBand = e.element === 'hud'
    const acked = isBand && io !== null ? await countPresses(io, e.data) : 0
    const mine = normalizeMine(await read($, MINE))
    const view = state.fillView(await read($, VIEW))
    const band = state.fillBand(await read($, BAND))
    const size = !isBand ? HUD_SHOP : band.mode === 'idle' || band.isCompact ? HUD_IDLE : HUD_WORK
    const props: HudProps = {
      ...hudProps(mine.save, view, band, isBand ? 'band' : 'shop', await $.clock.now()),
      ...size,
      surface: surfaceOf(e.surface),
      acked,
      taps: isBand ? taps : 0,
    }
    lastHud = props
    if (isBand) lastAcked = acked
    return { props }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = state.fillBand(await read($, BAND))
    if (e.props.hasSurvey || !band.isLoaded || band.isHidden || band.isStopped) {
      live = null
      return next(e)
    }
    const isOneLine = band.mode === 'idle' || band.isCompact
    const hudSize = isOneLine ? HUD_IDLE : HUD_WORK
    const surface = surfaceOf(e.surface)
    // The Mine button is the HUD's own, so a press answers without a round trip.
    const props: HudProps = { ...lastHud, variant: 'band', mode: band.mode, surface, acked: lastAcked, taps, isCompact: band.isCompact, ...hudSize }
    const spec: SceneSpec = { mode: band.mode, carts: band.carts, goblins: band.goblins, pick: band.pick, biome: band.biome }
    const openShop = () => $.ui.open({ id: PANE, title: 'Sparkmine', focus: true, closeOnEscape: true })
    let ours: RenderElement

    if (e.surface === 'desktop') {
      live = null
      const { Box, Client, Svg, Text } = $.ui.resolve(e)
      const hud = <Client key="hud" module="./hud.ts" props={props} height={hudSize.height} />
      const shop = <Client key="shopbtn" module="./shopbutton.ts" props={{}} />
      // A vein to catch beside the Shop sign, or the frenzy one started; nothing the rest of the time.
      const vein = <Client key="vein" module="./vein.ts" props={{ vein: null, frenzy: null, surface }} />
      if (isOneLine) {
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center">
            {hud}
            {shop}
            {vein}
          </Box>
        )
      } else {
        // Each producer owned, with its count: the crew fills the band's right side.
        const crew =
          band.crew.length === 0 ? null : (
            <Box flexDirection="row" columnGap={1} alignItems="flex-end">
              {band.crew.map(member => (
                <Box flexDirection="column" alignItems="center">
                  <Svg source={iconSvg(member.id, CREW_ICON)} alt={producer(member.id).name} width={CREW_ICON} height={CREW_ICON} />
                  <Text dimColor>{`×${member.owned}`}</Text>
                </Box>
              ))}
            </Box>
          )
        // One row, in order, nothing stretched apart: where room runs out the crew is cut, never overlapped.
        // The gold Mine sign leads the HUD, and the wooden Shop sign sits under it at its own
        // width: a column stretches its children across by default, and a desktop does too.
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center" borderStyle="round" borderColor="#5e3b1d" paddingX={1}>
            <Svg
              source={svgFor(spec, SCALE, true)}
              alt="A pixel miner digs into a rock wall"
              width={W * SCALE}
              height={H * SCALE}
              isInteractive
            />
            <Box flexDirection="column" alignItems="flex-start" flexShrink={0}>
              {hud}
              <Box flexDirection="row" columnGap={1} alignItems="center">
                {shop}
                {vein}
              </Box>
            </Box>
            {crew === null ? null : (
              <Box flexShrink={1} overflow="hidden" marginLeft={1}>
                {crew}
              </Box>
            )}
          </Box>
        )
      }
    } else if (e.surface === 'terminal') {
      const { Box, Button, Client, Raster } = $.ui.resolve(e)
      // Mine is the band's own Button here, so its hotkey works: a press of `m`
      // while the band has the keyboard, which a quick run of clicks on one cell is not.
      const mine =
        band.mode === 'idle' ? null : (
          <Button
            key="mine"
            label="Mine"
            hotkey="m"
            dimColor={band.mode !== 'work'}
            onPress={tap}
          />
        )
      const hud = <Client key="hud" module="./hud.ts" props={props} height={hudSize.height} />
      const shop = <Button key="shop" label="Shop" dimColor={band.mode === 'idle'} onPress={openShop} />
      const vein = <Client key="vein" module="./vein.ts" props={{ vein: null, frenzy: null, surface }} />
      const hasRoom = e.props.bodyColumns >= W + HUD_COLUMNS && e.props.maxRows >= ROWS + 2
      if (isOneLine || !hasRoom) {
        live = null
        ours = (
          <Box flexDirection="row" columnGap={2}>
            {mine}
            {hud}
            {shop}
            {vein}
          </Box>
        )
      } else {
        const frame = cellsFor(spec, await $.clock.now())
        live = { requestId: e.requestId, spec, shown: frame.key }
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center" borderStyle="round" borderColor="#5e3b1d">
            <Raster key="scene" columns={W} rows={ROWS} cells={frame.cells} />
            {mine}
            {hud}
            {shop}
            {vein}
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
    const band = state.fillBand(await read($, BAND))
    const act: ui.ShopActions = {
      buy: id => (io === null ? 0 : state.buyProducer(io, id)),
      upgrade: id => (io === null ? false : state.buyUpgrade(io, id)),
      amount: n => (io === null ? undefined : state.setAmount(io, n)),
      // The question waits on the person, longer than a press may run: it goes on after the press.
      shaft: () => {
        if (io !== null) void state.newShaft(io).catch(() => undefined)
      },
    }
    const props: HudProps = { ...lastHud, variant: 'shop', mode: band.mode, acked: 0, ...HUD_SHOP }
    const held = handlesOn(e.surface)
    const { Text } = $.ui.resolve(e)
    const notice = band.isStopped ? <Text color="warning">Sparkmine is stopped. /mine start sets it going again.</Text> : null
    if (e.surface === 'desktop') {
      const { Client, Svg } = $.ui.resolve(e)
      const header: SceneSpec = { mode: 'pause', carts: band.carts, goblins: band.goblins, pick: band.pick, biome: band.biome }
      return ui.keepHandles(
        ui.shopTree($.ui.resolve(e), shop, {
          icon: (id, isDim) => <Svg source={iconSvg(id, 24, isDim)} alt={id} width={24} height={24} />,
          header: <Svg source={svgFor(header, HEADER_SCALE)} alt="The mine" width={W * HEADER_SCALE} height={H * HEADER_SCALE} />,
          live: <Client key="shophud" module="./hud.ts" props={props} height={HUD_SHOP.height} />,
          stats: <Client key="stats" module="./stats.ts" props={lastStats} />,
          notice,
          isRoomy: true,
        }, act),
        held,
      )
    }
    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)
      return ui.keepHandles(
        ui.shopTree($.ui.resolve(e), shop, {
          icon: () => null,
          header: null,
          live: <Client key="shophud" module="./hud.ts" props={props} height={HUD_SHOP.height} />,
          stats: <Client key="stats" module="./stats.ts" props={lastStats} />,
          notice,
          isRoomy: false,
        }, act),
        held,
      )
    }
    return ui.keepHandles(
      ui.shopTree($.ui.resolve(e), shop, { icon: () => null, header: null, live: <Text bold>{`✻ ${Math.floor(lastHud.sparks)}`}</Text>, stats: null, notice, isRoomy: false }, act),
      held,
    )
  })

  // The spinner says what the mine has unlocked. On the desktop its word names
  // the step Claude is on, so only the plain "Working" changes there.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const word = await read($, REWARD)
    if (word === null || state.fillBand(await read($, BAND)).isStopped) return next(e)
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
      case 'stop':
      case 'pause':
        await state.setStopped(io, true)
        return { text: 'Sparkmine is stopped in every session: nothing is mined and the band is gone. /mine start sets it going again.' }
      case 'start':
      case 'resume':
        await state.setStopped(io, false)
        return { text: 'Sparkmine is mining again.' }
      case 'compact': {
        const wasCompact = (await io.readBand()).isCompact
        await state.setCompact(io, !wasCompact)
        return { text: wasCompact ? 'The full band is back.' : 'Compact band: one line, even while Claude works. /mine compact again for the full band.' }
      }
      case 'hide':
        await state.setHidden(io, true)
        return { text: 'Sparkmine is hidden. /mine show brings it back.' }
      case 'show':
        await state.setHidden(io, false)
        return { text: (await io.readBand()).isStopped ? 'Sparkmine is stopped. /mine start sets it going again.' : 'Sparkmine is back above the prompt.' }
      case 'reset':
        return { text: (await state.resetMine(io)) ? 'Sparkmine was reset.' : 'Nothing was reset.' }
      default:
        return { text: 'Usage: /mine [shop|stop|start|compact|hide|show|reset]' }
    }
  })
}
