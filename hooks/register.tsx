// Sparkmine: a pixel mining clicker above the prompt. Claude works, you click.

import { atom, read, update } from 'claude-code'
import type { RenderElement, Register, Timer } from 'claude-code'

import { newMine } from './game.ts'
import { H, ROWS, W, frameAt, type Frame } from './scene.ts'
import * as state from './state.ts'
import { INITIAL_VIEW, type Io } from './state.ts'
import * as ui from './ui.tsx'

// The session's values: the mine (its save and what this session changed),
// the band's view, and the spinner word the mine has unlocked.
const MINE = atom({ plugin: 'sparkmine', key: 'mine' } as const, newMine('unloaded'))
const VIEW = atom({ plugin: 'sparkmine', key: 'view' } as const, INITIAL_VIEW)
const REWARD = atom({ plugin: 'sparkmine', key: 'reward' } as const, null)

/** The shop pane's id. */
const PANE = 'sparkmine'

/** Tools that wait on the person, so the miner rests while they decide. */
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** The Raster the terminal shows now, which a timer repaints frame by frame. */
type LiveScene = {
  requestId: string
  cells: readonly string[]
  frames: readonly Frame[]
  ms: number
  shown: number
}

export const register: Register = on => {
  let io: Io | null = null
  let live: LiveScene | null = null
  let animation: Timer | null = null
  let isRunning = false

  on('session.start', async ($, e, next) => {
    const engine: Io = {
      now: () => $.clock.now(),
      get: key => $.store.get(key),
      put: (key, value) => $.store.set(key, value),
      toast: text => $.ui.toast(text),
      ask: (question, options) => $.ui.ask(question, options),
      mine: change => update($, MINE, change),
      view: change => update($, VIEW, change),
      reward: change => update($, REWARD, change),
      readMine: () => read($, MINE),
      readView: () => read($, VIEW),
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
      // The terminal scene moves by repainting its Raster; the desktop's SVG animates itself.
      const step = async () => {
        const scene = live
        if (scene === null) return
        const index = frameAt(scene.frames, scene.ms, await $.clock.now())
        if (index === scene.shown) return
        scene.shown = index
        const painted = await $.ui.blit({ requestId: scene.requestId, key: 'scene', cells: scene.cells[index] ?? '', columns: W, rows: ROWS })
        if ('deny' in painted && painted.deny !== undefined) live = null
      }
      $.clock.every(state.TICK_MS, () => {
        void state
          .tick(engine)
          .then(() => {
            const wanted = live !== null && live.frames.length > 1
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mine = await read($, MINE)
    const view = await read($, VIEW)
    if (e.props.hasSurvey || !mine.isLoaded || view.isHidden) {
      live = null
      return next(e)
    }
    const act: ui.BandActions = {
      mine: () => (io === null ? 0 : state.click(io)),
      shop: () => $.ui.open({ id: PANE, title: 'Sparkmine', focus: true, closeOnEscape: true }),
    }
    let ours: RenderElement
    if (view.mode === 'idle') {
      live = null
      ours = ui.idleBand($.ui.resolve(e), mine, view, act)
    } else {
      const hud = ui.hud($.ui.resolve(e), mine, view, act)
      const spec = ui.specOf(mine.save, view)
      if (e.surface === 'desktop') {
        live = null
        const { Box, Svg } = $.ui.resolve(e)
        ours = (
          <Box flexDirection="row" columnGap={2} alignItems="center">
            <Svg
              source={ui.svgFor(spec)}
              alt="A pixel miner swings a pickaxe at a rock wall"
              width={W * ui.SCALE}
              height={H * ui.SCALE}
              isInteractive
            />
            {hud}
          </Box>
        )
      } else if (e.surface === 'terminal' && e.props.bodyColumns >= W + ui.HUD_COLUMNS && e.props.maxRows >= ROWS) {
        const { Box, Raster } = $.ui.resolve(e)
        const scene = ui.cellsFor(spec)
        const shown = frameAt(scene.frames, scene.ms, await $.clock.now())
        live = { requestId: e.requestId, cells: scene.cells, frames: scene.frames, ms: scene.ms, shown }
        ours = (
          <Box flexDirection="row" columnGap={2}>
            <Raster key="scene" columns={W} rows={ROWS} cells={scene.cells[shown] ?? ''} />
            {hud}
          </Box>
        )
      } else {
        live = null
        ours = hud
      }
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
    const mine = await read($, MINE)
    const view = await read($, VIEW)
    return ui.shopTree($.ui.resolve(e), mine, view, {
      buy: id => (io === null ? 0 : state.buyProducer(io, id)),
      upgrade: id => (io === null ? false : state.buyUpgrade(io, id)),
      amount: n => (io === null ? undefined : state.setAmount(io, n)),
      collapse: () => (io === null ? false : state.collapseMine(io)),
    })
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
