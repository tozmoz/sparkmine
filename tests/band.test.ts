import { expect, test } from 'claude-code/testing'

import * as game from '../hooks/game.ts'
import { sceneSvg } from '../hooks/scene.ts'
import * as state from '../hooks/state.ts'
import { band, command, committed, endSession, failed, finishTurn, pane, seeded, start, wait, world } from './kit.ts'

/** Lets the HUD poll once, so it holds fresh numbers. */
const POLL = 150

/** Lets the vein poll once: it asks less often than the HUD. */
const VEIN_POLL = 300

/** The bug's pink and the splat's green: no rock or ore has either. */
const BUG_PINK = '#ff4fa3'
const SPLAT_GREEN = '#b5e08a'

/** A press of the desktop's gold Mine sign: the pointer going down on the HUD. */
const DOWN = { type: 'down', x: 1, y: 0, button: 'left', in: 'hud' } as const

test('a session kept from before an update reads its ×100 as Max', () => {
  expect(state.fillView({ ...state.INITIAL_VIEW, amount: 100 as never }).amount).toBe('max')
  expect(state.fillView({ ...state.INITIAL_VIEW, amount: 10 }).amount).toBe(10)
})

test('the band keeps one line while Claude is idle', async ($, on) => {
  world(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    await ui.advance(POLL)
    expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 0' })).toBeDefined()
    expect(await ui.find({ in: 'hud', type: 'Text', text: '· mines while Claude works' })).toBeDefined()
    expect(await ui.find(surface === 'desktop' ? { in: 'shopbtn', key: 'shop' } : { key: 'shop' })).toBeDefined()
    expect(await ui.find({ in: 'hud', key: 'mine' })).toBeUndefined()
    await ui.unmount()
  }
})

test('while Claude works, the Mine button and tool calls mine', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect((await ui.find({ in: 'hud', key: 'mine' }))?.props).toMatchObject({ backgroundColor: '#f2b632' })
  expect(await ui.find({ in: 'hud', type: 'Text', text: '⛏ Mine' })).toBeDefined()
  // The gold lightens under the pointer: the surface applies the hover, no hook runs.
  expect(JSON.stringify((await ui.find({ in: 'hud', type: 'Box' }))?.children[0])).toContain('"hover":{"backgroundColor":"#ffcd52"}')
  await ui.pointer(DOWN)
  await ui.pointer(DOWN)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 2' })).toBeDefined()
  await $.tool.call({ tool: 'Read', file_path: '/tmp/project/a.ts' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Read +1 ✻' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 3' })).toBeDefined()
  await finishTurn($, 't1')
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ in: 'hud', key: 'mine' })).toBeUndefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '· last turn +3' })).toBeDefined()
})

test('a press shows on the counter and pops at once, before the hooks answer', async ($, on) => {
  world(on, { save: seeded({ upgrades: ['pick-1', 'pick-2'], clicks: 100 }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  await ui.pointer(DOWN)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 4' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^\+4$/ })).toBeDefined()
  // The sign is pressed in for a moment, then comes back up.
  expect((await ui.find({ in: 'hud', key: 'mine' }))?.props.backgroundColor).toBe('#d9951f')
  // A run of presses adds up in one pop.
  await ui.pointer(DOWN)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^\+8$/ })).toBeDefined()
  // The hooks count each press once, and the counter agrees.
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 8' })).toBeDefined()
  await ui.advance(1_000)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^\+\d/ })).toBeUndefined()
  expect((await ui.find({ in: 'hud', key: 'mine' }))?.props.backgroundColor).toBe('#f2b632')
})

test("on the terminal Mine is the band's own button: each press of it or its m mines, and the HUD pops it", async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('terminal', { bodyColumns: 140 }))
  await ui.advance(POLL)
  expect((await ui.find({ key: 'mine' }))?.props).toMatchObject({ label: 'Mine', hotkey: 'm' })
  expect(await ui.find({ in: 'hud', key: 'mine' })).toBeUndefined()
  for (let i = 0; i < 3; i += 1) await ui.press({ key: 'mine' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 3' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '+3' })).toBeDefined()
  // The numbers are no button on the terminal.
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'hud' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 3' })).toBeDefined()
})

test('a click that strikes a gem pops it in green', async ($, on) => {
  // The first click count from 2,000 on whose roll strikes a gem, for the kit's run.
  let clicks = 2_000
  while (game.clickRoll(seeded({ clicks })) >= 0.04) clicks += 1
  world(on, { save: seeded({ clicks, upgrades: ['pick-1', 'pick-2', 'gem-1'] }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  await ui.pointer(DOWN)
  await ui.advance(POLL)
  const pop = await ui.find({ in: 'hud', type: 'Text', text: '◆ +40' })
  expect(pop?.props).toMatchObject({ color: '#5dcaa5' })
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 40' })).toBeDefined()
})

test('the HUD keeps one size while the pop fades, and the scene is never redrawn', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const scene = await ui.find({ type: 'Svg' })
  await ui.pointer(DOWN)
  await ui.pointer(DOWN)
  await ui.advance(150)
  // The boxes and their sizes stay put frame after frame, the pop's slot
  // whether or not a pop is in it; only the words and their colors change.
  type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const shape = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return 'text'
    const { type, props = {}, children = [] } = node as Node
    if (type === 'Text') return 'text'
    const { key, width, height, flexDirection, label } = props
    return { type, width, height, flexDirection, label, children: key === 'pop' ? [] : children.map(shape) }
  }
  const layout = async () => JSON.stringify(shape(await ui.find({ in: 'hud', type: 'Box' })))
  const first = await layout()
  expect(first).toContain('"height":2')
  expect(first).toContain('"width":10')
  for (let frame = 0; frame < 12; frame += 1) {
    await ui.advance(60)
    expect(await layout()).toBe(first)
  }
  expect(await ui.find({ type: 'Svg' })).toEqual(scene)
})

test('the crew fills the rest of the band, and the next goal is left to the shop', async ($, on) => {
  world(on, { save: seeded({ clicks: 30, producers: { apprentice: 17, cart: 6 } }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect(await ui.find({ type: 'Text', text: '×17' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '×6' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^Next:/ })).toBeUndefined()
  const shop = await $.ui.mount(pane('desktop'))
  await shop.advance(POLL)
  expect(await shop.find({ in: 'shophud', type: 'Text', text: "Next: Foreman's whistle" })).toBeDefined()
})

test('the wooden Shop sign opens the shop', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ in: 'shopbtn', key: 'shop' }))?.props).toMatchObject({ backgroundColor: '#4b2f1c' })
  expect(await ui.find({ in: 'shopbtn', type: 'Text', text: '✻ Shop' })).toBeDefined()
  // The sign keeps its own width under the HUD instead of stretching across the column.
  const column = (await ui.findAll({ type: 'Box' })).find(box => box.props.flexDirection === 'column' && JSON.stringify(box).includes('"shopbtn"'))
  expect(column?.props).toMatchObject({ alignItems: 'flex-start' })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'shopbtn' })
  await ui.advance(POLL)
  expect(w.opened).toEqual(['sparkmine'])
})

test('buying the Diamond pick puts it in the miner\'s hands', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 20_000, clicks: 600, upgrades: ['pick-1', 'pick-2', 'grip-1'] }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const before = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(before).not.toContain('#5fd4e8')
  const shop = await $.ui.mount(pane('desktop'))
  await shop.press({ key: 'up-pick-3' })
  await w.clock.advance(1_000)
  await ui.redraw()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('#5fd4e8')
})

test('the terminal draws the scene when it has room, and the HUD alone when not', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const wide = await $.ui.mount(band('terminal', { bodyColumns: 140 }))
  expect(await wide.find({ type: 'Raster' })).toBeDefined()
  await wide.press({ key: 'mine' })
  await wide.advance(POLL)
  expect(await wide.find({ in: 'hud', type: 'Text', text: '✻ 1' })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount(band('terminal', { bodyColumns: 80 }))
  expect(await narrow.find({ type: 'Raster' })).toBeUndefined()
  expect((await narrow.find({ key: 'mine' }))?.props).toMatchObject({ label: 'Mine', hotkey: 'm' })
})

const QUESTION = { question: 'Which database?', header: 'Database', options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite', description: 'A file' }], multiSelect: false }

/** A question the person takes their time over, and how to answer it. */
function slowPerson(w: ReturnType<typeof world>): () => void {
  let answer = () => {}
  w.answering = new Promise(resolve => {
    answer = resolve
  })
  return answer
}

test("Claude's question rests the miner until the person answers", async ($, on) => {
  const w = world(on)
  const answer = slowPerson(w)
  await start($)
  await $.turn.start({ text: 'pick for me', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] })
  await ui.advance(POLL)
  expect(w.asked).toEqual(['Which database?'])
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeDefined()
  // The miner turns to face you while you decide.
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(sceneSvg({ mode: 'pause', carts: 0, goblins: 0, pick: 0, biome: 0, pose: 'facing' }, 3, true))
  // The sign stays, dulled, so nothing moves; a press does nothing until Claude works again.
  expect((await ui.find({ in: 'hud', key: 'mine' }))?.props).toMatchObject({ backgroundColor: '#5c4d2e' })
  await ui.pointer(DOWN)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 0' })).toBeDefined()
  answer()
  await asked
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeUndefined()
})

test('a permission check that asks leaves the miner working: the mode settles most without anyone', async ($, on) => {
  const w = world(on)
  w.decision = 'ask'
  await start($)
  await $.turn.start({ text: 'clean up', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'call-1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeUndefined()
  await ui.pointer(DOWN)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 1' })).toBeDefined()
})

test("the mod's own question, a new shaft's, is not Claude waiting: the miner works on", async ($, on) => {
  const w = world(on, { save: seeded({ lifetime: 125e6, allTime: 2e8 }) })
  const answer = slowPerson(w)
  w.answers.push('Keep digging')
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const shop = await $.ui.mount(pane('desktop'))
  const pressed = shop.press({ key: 'shaft' })
  await ui.advance(POLL)
  expect(w.asked).toHaveLength(1)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeUndefined()
  answer()
  await pressed
})

test('a survey has the band to itself', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount(band('terminal', { hasSurvey: true }))
  expect(await ui.find({ key: 'shop' })).toBeUndefined()
})

test('/mine hide and /mine show', async ($, on) => {
  world(on)
  await start($)
  const hidden = await command($, 'hide')
  expect(hidden.text).toContain('hidden')
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await command($, 'show')
  await ui.redraw()
  expect(await ui.find({ in: 'shopbtn', key: 'shop' })).toBeDefined()
})

test('the spinner takes the word the mine unlocked', async ($, on) => {
  world(on, { save: seeded({ allTime: 2_000 }) })
  const seen: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    seen.push(`${e.surface}:${e.props.word}`)
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.word] })
  })
  await start($)
  const spinner = { plugin: 'sparkmine', component: 'Spinner' as const, props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
  await $.ui.mount({ ...spinner, surface: 'terminal' })
  await $.ui.mount({ ...spinner, surface: 'desktop', props: { ...spinner.props, word: 'Creating notes.md' } })
  await $.ui.mount({ ...spinner, surface: 'desktop', props: { ...spinner.props, word: 'Working' } })
  expect(seen).toEqual(['terminal:Mining', 'desktop:Creating notes.md', 'desktop:Mining'])
})

test('green tests and a commit pay once a turn, and the HUD says what paid', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await $.tool.call({ tool: 'Bash', command: 'cd app && npm test' })
  await ui.advance(POLL)
  // Tests pay 30 seconds of the rate, and never less than 10 clicks: here, 10.
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Tests pass +10 ✻' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 12' })).toBeDefined()
  // A second green run in the same turn pays the tool call alone.
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 14' })).toBeDefined()
  // A red run pays nothing more, in the next turn too.
  await finishTurn($, 't1')
  await $.turn.start({ text: 'again', turnId: 't2' })
  w.bash = command => (command.includes('test') ? failed : command.startsWith('git commit') ? committed : undefined)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 16' })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Fix it"' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Commit +20 ✻' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 38' })).toBeDefined()
  // The reward shows a few seconds, then the last tool call is back.
  await w.clock.advance(6_000)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /★/ })).toBeUndefined()
})

test('tests that failed and then pass squash a bug, which pays beside the tests', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  w.bash = () => failed
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  w.bash = undefined
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/project/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await ui.advance(POLL)
  // 10 clicks for the tests, 25 for the bug: one line, added up.
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Tests pass · Bug squashed +35 ✻' })).toBeDefined()
})

test('a failing test run puts a bug on the rock, and squashing it leaves a splat a moment', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const scene = async () => {
    await ui.advance(POLL)
    return String((await ui.find({ type: 'Svg' }))?.props.source)
  }
  expect(await scene()).not.toContain(BUG_PINK)
  w.bash = () => failed
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  w.bash = undefined
  expect(await scene()).toContain(BUG_PINK)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await scene()).not.toContain(BUG_PINK)
  expect(await scene()).toContain(SPLAT_GREEN)
  await w.clock.advance(state.SPLAT_MS)
  expect(await scene()).not.toContain(SPLAT_GREEN)
})

test('upgrades bought show in the mine: the canary, the gloves, warmer lanterns, a coffee', async ($, on) => {
  world(on, { save: seeded({ upgrades: ['lamp-1', 'lamp-2', 'grip-1', 'apprentice-2'] }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  const scene = String((await ui.find({ type: 'Svg' }))?.props.source)
  for (const color of ['#ffd84a', '#c8862a', '#ffa63d', '#e24b4a']) expect(scene).toContain(color)
})

test("a while into Claude's idle the miner has a coffee, then a nap: the line shows a cup, the shop's picture shows him", async ($, on) => {
  expect([0, state.COFFEE_MS - 1, state.COFFEE_MS, state.SLEEP_MS - 1, state.SLEEP_MS].map(state.napOf)).toEqual([null, null, 'coffee', 'coffee', 'sleep'])
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /☕/ })).toBeUndefined()
  await w.clock.advance(state.COFFEE_MS)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /· ☕$/ })).toBeDefined()
  const shop = await $.ui.mount(pane('desktop'))
  expect((await shop.find({ type: 'Svg' }))?.props.source).toBe(sceneSvg({ mode: 'pause', carts: 0, goblins: 0, pick: 0, biome: 0, pose: 'coffee' }, 2))
})

test('a build, a clean lint, a pull request opened and one merged each pay once a turn', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'ship it', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await $.tool.call({ tool: 'Bash', command: 'npm run lint && npm run build' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Build passes · Lint clean +12 ✻' })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Ship it" --body "Done."' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ PR opened +25 ✻' })).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1 --squash' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ PR merged +30 ✻' })).toBeDefined()
  // The same again this turn pays the tool call alone.
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ PR merged +30 ✻' })).toBeDefined()
})

test('every third good turn in a row pays a streak; a turn cut short ends it', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  const turn = async (id: string, reason: 'answer' | 'aborted' = 'answer') => {
    await $.turn.start({ text: 'go', turnId: id })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/project/a.ts' })
    await finishTurn($, id, 1_000, reason)
    await ui.redraw()
    await ui.advance(POLL)
  }
  await turn('t1')
  await turn('t2')
  expect(await ui.find({ in: 'hud', type: 'Text', text: /Streak/ })).toBeUndefined()
  await turn('t3')
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Streak ×3 +20 ✻' })).toBeDefined()
  // A turn without a tool call neither makes nor breaks it; an aborted one starts it over.
  await $.turn.start({ text: 'thanks', turnId: 't4' })
  await finishTurn($, 't4')
  await turn('t5', 'aborted')
  await turn('t6')
  await turn('t7')
  await w.clock.advance(6_000)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /Streak/ })).toBeUndefined()
  await turn('t8')
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Streak ×3 +20 ✻' })).toBeDefined()
  await endSession($)
  expect(w.store.get('save')).toMatchObject({ bestStreak: 3, events: { streak: 2 } })
})

test('a long shift pays when the turn ends', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await finishTurn($, 't1', 6 * 60_000)
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Long shift +30 ✻' })).toBeDefined()
})

/** A run whose first vein is of the kind asked for. */
function runWithVein(kind: 'rich' | 'frenzy'): string {
  for (let i = 0; ; i += 1) if (game.veinAfter(`vein-run-${i}`, 0).kind === kind) return `vein-run-${i}`
}

test('a vein shows after a while of work, and a press catches it', async ($, on) => {
  const runId = runWithVein('rich')
  const w = world(on, { save: seeded({ runId }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Vein/ })).toBeUndefined()
  await wait(w, game.veinAfter(runId, 0).seconds + 1)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /^✦ Vein! \d+s$/ })).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'vein' })
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Vein/ })).toBeUndefined()
  // A rich vein pays two minutes of the rate, and never less than 30 clicks: here, 30.
  expect(await ui.find({ in: 'hud', type: 'Text', text: '★ Rich vein +30 ✻' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 30' })).toBeDefined()
  // The first vein is an achievement, and the next tick says so.
  await w.clock.advance(200)
  expect(w.toasts).toEqual(['Achievement: First vein. Everything mines 2% more.'])
})

test('a vein not caught in time goes', async ($, on) => {
  const runId = runWithVein('rich')
  const w = world(on, { save: seeded({ runId }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await wait(w, game.veinAfter(runId, 0).seconds + 1)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Vein/ })).toBeDefined()
  // It shows for twenty seconds.
  await w.clock.advance(15_000)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Vein/ })).toBeDefined()
  await w.clock.advance(6_000)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Vein/ })).toBeUndefined()
})

test('a frenzy vein makes every click count five times for half a minute', async ($, on) => {
  const runId = runWithVein('frenzy')
  const w = world(on, { save: seeded({ runId }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await wait(w, game.veinAfter(runId, 0).seconds + 1)
  await ui.advance(VEIN_POLL)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'vein' })
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /^Frenzy ×5 · \d+s$/ })).toBeDefined()
  await ui.pointer(DOWN)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 5' })).toBeDefined()
  await w.clock.advance(31_000)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Frenzy/ })).toBeUndefined()
  await ui.pointer(DOWN)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 6' })).toBeDefined()
})

test('with gold fever a frenzy lasts a minute', async ($, on) => {
  const runId = runWithVein('frenzy')
  const w = world(on, { save: seeded({ runId, upgrades: ['vein-2'] }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await wait(w, game.veinAfter(runId, 0).seconds + 1)
  await ui.advance(VEIN_POLL)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'vein' })
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: 'Frenzy ×5 · 60s' })).toBeDefined()
  await w.clock.advance(31_000)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /^Frenzy ×5 · \d+s$/ })).toBeDefined()
  await w.clock.advance(30_000)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /Frenzy/ })).toBeUndefined()
})

test('the mine gets deeper, and its rock turns with the layer', async ($, on) => {
  world(on, { save: seeded({ lifetime: 2_000_000, allTime: 2_000_000 }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  // Ten times the sparks is a hundred metres more: 2M is 330 m, in the crystal caves.
  expect((await ui.find({ in: 'hud', type: 'Text', text: '330 m' }))?.props).toMatchObject({ color: '#b6a6ff' })
  const scene = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(scene).toContain('#4b4280')
  expect(scene).not.toContain('#57473d')
})

test('compact keeps the band to one line while Claude works, in every session', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect((await command($, 'compact')).text).toContain('one line')
  expect(w.store.get('compact')).toBe(true)
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ in: 'hud', key: 'mine' })).toBeDefined()
  expect((await ui.find({ in: 'hud', type: 'Box' }))?.props).toMatchObject({ height: 1 })
  await command($, 'compact')
  await ui.redraw()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('stop takes the band away and stops the mining, and start brings both back', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect((await command($, 'stop')).text).toContain('stopped')
  expect(w.store.get('stopped')).toBe(true)
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await w.clock.advance(5_000)
  await command($, 'start')
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 0' })).toBeDefined()
  await $.tool.call({ tool: 'Read', file_path: '/tmp/project/a.ts' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 1' })).toBeDefined()
})
