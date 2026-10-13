import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudProps, VeinProps } from '../types'
import * as game from '../hooks/game.ts'
import Hud from '../hooks/hud.ts'
import { EMPTY_HUD, answerOf } from '../hooks/model.ts'
import { sceneSvg } from '../hooks/scene.ts'
import Vein from '../hooks/vein.ts'
import * as state from '../hooks/state.ts'
import { CONFETTI_MS, TIP_MS } from '../hooks/data.ts'
import { band, client, command, committed, endSession, failed, finishTurn, pane, prompt, seeded, start, wait, world } from './kit.ts'

/** Lets the HUD poll once, so it holds fresh numbers. */
const POLL = 150

/** Lets the vein poll once: it asks less often than the HUD. */
const VEIN_POLL = 300

/** The confetti's sky blue: no rock, ore or detail has it. */
const CONFETTI_BLUE = '#6bcbff'

/** The fossil's bone, on the stone. */
const FOSSIL_BONE = '#eadfc4'

/** The bug's pink and the splat's green: no rock or ore has either. */
const BUG_PINK = '#ff4fa3'
const SPLAT_GREEN = '#b5e08a'

/** A press of the desktop's gold Mine sign: the pointer going down on the HUD. */
const DOWN = { type: 'down', x: 1, y: 0, button: 'left', in: 'hud' } as const

test('a shop model kept from before an update draws, with the newer sections empty', () => {
  const old = { isLoaded: true, amount: 1, producers: [], teaser: null, upgrades: [], more: 0, next: null, values: { click: 1, read: 1, edit: 4 } }
  const shop = state.fillShop(old as never)
  expect(shop).toMatchObject({ tab: 'shop', relics: { found: 0, forSale: [] }, badges: { groups: [] }, depth: { strata: [] } })
})

test('a session kept from before an update reads its ×100 as Max', () => {
  expect(state.fillView({ ...state.INITIAL_VIEW, amount: 100 as never }).amount).toBe('max')
  expect(state.fillView({ ...state.INITIAL_VIEW, amount: 10 }).amount).toBe(10)
})

test('the HUD keeps the newest numbers: an older tree handed in again never turns it back', () => {
  const hud = client<HudProps, unknown>(Hud)
  const drawn = hud.draw
  // The band drawn before the HUD's first poll was answered: no numbers yet.
  const early: HudProps = { ...EMPTY_HUD, surface: 'desktop' }
  expect(drawn(early)).toContain('✻ 0')
  // A poll's answer.
  const live: HudProps = { ...early, sparks: 119.3e9, depth: 889, idle: 0.5, at: 1_000_100, isAnswer: true }
  const shown = drawn(live)
  expect(shown).toContain('✻ 119.3B')
  // The desktop hands in that early tree again, each time the shop's counter changes: nothing moves.
  expect(drawn(early)).toBe(shown)
  expect(drawn({ ...live, isAnswer: undefined, sparks: 1, at: 1_000_050 })).toBe(shown)
  // A new answer always draws, even read by a clock set back; a tree drawn after it brings its mode.
  expect(drawn({ ...live, sparks: 120e9, at: 900_000 })).toContain('✻ 120.0B')
  expect(drawn({ ...live, isAnswer: undefined, sparks: 120e9, mode: 'work', at: 1_000_300 })).toContain('⛏ Mine')
  // A new answer draws once: kept without a setState, which would draw it again (and blink the desktop's pictures).
  const sets = hud.sets()
  expect(drawn({ ...live, sparks: 120.5e9, at: 1_000_400 })).toContain('✻ 120.5B')
  drawn({ ...live, sparks: 121e9, at: 1_000_500 })
  expect(hud.sets()).toBe(sets)
})

test('the vein keeps the newest answer: the band redrawn as it was never hides a vein that shows', () => {
  const vein = client<VeinProps, unknown>(Vein)
  const drawn = vein.draw
  const tree: VeinProps = { vein: null, frenzy: null, surface: 'desktop' }
  expect(drawn(tree)).not.toContain('Vein!')
  const showing: VeinProps = { ...tree, vein: { id: 3, kind: 'rich', left: 12, label: 'Vein!' }, isAnswer: true }
  const shown = drawn(showing)
  expect(shown).toContain('✦ Vein! 12s')
  expect(drawn(tree)).toBe(shown)
  // Its countdown draws without a setState.
  const sets = vein.sets()
  expect(drawn({ ...showing, vein: { id: 3, kind: 'rich', left: 11, label: 'Vein!' } })).toContain('✦ Vein! 11s')
  expect(vein.sets()).toBe(sets)
  // It goes when an answer says so.
  expect(drawn({ ...tree, isAnswer: true })).not.toContain('Vein!')
})

test('an answer that says what the last said keeps its time, so an idle Client draws nothing new', () => {
  const last: HudProps = { ...EMPTY_HUD, sparks: 40, at: 1_000_100 }
  expect(answerOf(last, { ...last, at: 1_000_200 }).at).toBe(1_000_100)
  expect(answerOf(last, { ...last, sparks: 41, at: 1_000_200 }).at).toBe(1_000_200)
  expect(answerOf(undefined, { ...last, at: 1_000_200 }).at).toBe(1_000_200)
})

test("a band drawn before its HUD's first poll starts from the mine, not from nothing", async ($, on) => {
  world(on, { save: seeded({ sparks: 5_000, lifetime: 9_000, allTime: 9_000 }) })
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  const handed = (await ui.find({ key: 'hud' }))?.props.props as HudProps | undefined
  expect(handed).toMatchObject({ variant: 'band', sparks: 5_000, depth: 100 })
  expect(handed?.at).toBeGreaterThan(0)
  expect(handed?.isAnswer).toBeUndefined()
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
  expect(pop?.props).toMatchObject({ color: 'success' })
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
  // A Button keeps to the top of its row there, so each sits in a slot the counter's height.
  expect(await wide.find({ key: 'mine-slot' })).toMatchObject({ props: { height: 2 }, children: [{ type: 'Button', props: { key: 'mine' } }] })
  expect(await wide.find({ key: 'shop-slot' })).toMatchObject({ props: { height: 2 }, children: [{ type: 'Button', props: { key: 'shop' } }] })
  expect(await wide.find({ key: 'vein-slot' })).toMatchObject({ props: { height: 2 }, children: [{ type: 'Client', props: { key: 'vein' } }] })
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
  await shop.press({ key: 'tab-shaft' })
  await shop.advance(50)
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

test('now and then a turn has a rarer spinner word', async ($, on) => {
  world(on, { save: seeded({ allTime: 2_000 }) })
  const seen: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    seen.push(e.props.word)
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.word] })
  })
  let turnId = 'turn-0'
  for (let i = 0; game.rareWord(turnId) === null; i += 1) turnId = `turn-${i}`
  const word = game.rareWord(turnId)
  await start($)
  const spinner = { plugin: 'sparkmine', component: 'Spinner' as const, surface: 'terminal' as const, props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
  await $.turn.start({ text: 'go', turnId })
  await $.ui.mount(spinner)
  expect(seen).toEqual([word])
  // The turn over, the spinner says the mine's own word again.
  await finishTurn($, turnId)
  await $.ui.mount(spinner)
  expect(seen.at(-1)).toBe('Mining')
  expect(['Spelunking', 'Panning for gold', 'Dowsing']).toContain(word)
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
  expect((await ui.find({ in: 'hud', type: 'Text', text: '★ Tests pass +10 ✻' }))?.props).toMatchObject({ color: 'warning' })
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
  expect(w.sounds).toEqual(['sounds/squash.wav'])
  await w.clock.advance(state.SPLAT_MS)
  expect(await scene()).not.toContain(SPLAT_GREEN)
})

test('tests that fail behind a pipe still put the bug on the rock, and pay no "Tests pass"', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  // The pipe's last step succeeds: only the output says the tests failed.
  w.bash = () => ({ result: { stdout: '  3 passing\n  1 failing\n', stderr: '', interrupted: false } })
  await $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail -20' })
  await ui.advance(POLL)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain(BUG_PINK)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /★ Tests pass/ })).toBeUndefined()
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

/** The band's scene as a still mine of no crew would draw it, the details given. */
const still = (patch: object) => sceneSvg({ mode: 'pause', carts: 0, goblins: 0, pick: 0, biome: 0, ...patch }, 3, true)

/** The secrets the store holds once the session syncs. */
async function secretsStored($: Engine, w: ReturnType<typeof world>): Promise<unknown> {
  await endSession($)
  return (w.store.get('save') as { secrets?: unknown }).secrets
}

test('thanks make the miner tip his helmet a moment, and the first time is a secret', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  // The desktop app hosts its sessions as an SDK does: what the person types there comes as one.
  await prompt($, 'thanks, that fixed it', { kind: 'sdk' })
  await $.turn.start({ text: 'thanks, that fixed it', turnId: 't1' })
  await ui.advance(POLL)
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(still({ pose: 'tip' }))
  await w.clock.advance(TIP_MS)
  await ui.advance(POLL)
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(sceneSvg({ mode: 'work', carts: 0, goblins: 0, pick: 0, biome: 0 }, 3, true))
  expect(w.toasts).toContain('Achievement: Good manners. Everything mines 2% more.')
  expect(await secretsStored($, w)).toEqual(['good-manners'])
})

test("a task's notification is not the person: its words find no secret", async ($, on) => {
  const w = world(on)
  await start($)
  await prompt($, 'The build finished. Thanks for waiting! ultrathink', { kind: 'task-notification' })
  await w.clock.advance(100)
  expect(w.sounds).toEqual([])
  expect(await secretsStored($, w)).toEqual([])
})

test('a secret chimes, and /mine sound turns the sounds off in every session, and on', async ($, on) => {
  const w = world(on)
  await start($)
  await prompt($, 'thank you!')
  await w.clock.advance(100)
  expect(w.sounds).toEqual(['sounds/secret.wav'])
  expect((await command($, 'sound')).text).toBe('Sounds are off in every session. /mine sound turns them back on.')
  expect(w.store.get('muted')).toBe(true)
  await prompt($, 'ultrathink this one')
  await w.clock.advance(100)
  expect(w.sounds).toEqual(['sounds/secret.wav'])
  expect((await command($, 'sound')).text).toBe('Sounds are on.')
  expect(w.store.get('muted')).toBe(false)
})

test('ultrathink flares the lanterns for the turn', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  await prompt($, 'ultrathink: why does the sync lose writes?')
  await $.turn.start({ text: 'ultrathink', turnId: 't1' })
  await ui.advance(POLL)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('#fff2c4')
  await finishTurn($, 't1')
  await $.turn.start({ text: 'go on', turnId: 't2' })
  await ui.advance(POLL)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('#fff2c4')
  expect(await secretsStored($, w)).toEqual(['deep-thinker'])
})

test("Claude's catchphrase and a turn worked through midnight are secrets", async ($, on) => {
  // The session starts half a minute after midnight, where the person is.
  const w = world(on, {}, new Date(2026, 9, 17, 0, 0, 30).getTime())
  await start($)
  await $.turn.start({ text: 'is this right?', turnId: 't1' })
  await finishTurn($, 't1', 60_000, 'answer', "You're absolutely right! The cache was stale.")
  expect(await secretsStored($, w)).toEqual(['absolutely-right', 'midnight-oil'])
})

test('a pull request merged on a Friday after four, and an initial commit, are secrets', async ($, on) => {
  const w = world(on, {}, new Date(2026, 9, 16, 17, 0).getTime())
  await start($)
  await $.turn.start({ text: 'ship it', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --squash' })
  w.bash = () => committed
  await $.tool.call({ tool: 'Bash', command: 'git init && git add -A && git commit -m "Initial commit"' })
  expect(await secretsStored($, w)).toEqual(['friday-deploy', 'groundbreaking'])
})

/** The band's scene as a crew of one cart draws it on a day of the person's calendar. */
async function sceneOn($: Engine, on: Parameters<typeof world>[0], date: Date): Promise<string> {
  const w = world(on, { save: seeded({ producers: { cart: 1 } }) }, date.getTime())
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(200)
  await ui.advance(POLL)
  return String((await ui.find({ type: 'Svg' }))?.props.source)
}

test('the last week of October puts a pumpkin on the cart', async ($, on) => {
  expect(await sceneOn($, on, new Date(2026, 9, 25, 12))).toContain('#4f8a2a')
})

test('December puts a Santa hat on the miner, and snow on the topsoil', async ($, on) => {
  const scene = await sceneOn($, on, new Date(2026, 11, 5, 12))
  expect(scene).toContain('#d03a2f')
  expect(scene).toContain('#f4f8fb')
})

test('a merged pull request rains confetti a moment', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'ship it', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --squash' })
  await ui.advance(POLL)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain(CONFETTI_BLUE)
  expect(w.sounds).toEqual(['sounds/party.wav'])
  await w.clock.advance(CONFETTI_MS)
  await ui.advance(POLL)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(CONFETTI_BLUE)
})

test('the counter shines a moment as it passes 1K, 1M, 1B', async ($, on) => {
  world(on, { save: seeded({ sparks: 999, lifetime: 999, allTime: 999 }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect((await ui.find({ in: 'hud', type: 'Text', text: '✻ 999' }))?.props.color).toBe('claude')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await ui.advance(POLL)
  expect(['warning', 'text']).toContain((await ui.find({ in: 'hud', type: 'Text', text: '✻ 1,001' }))?.props.color)
  await ui.advance(1_000)
  expect((await ui.find({ in: 'hud', type: 'Text', text: '✻ 1,001' }))?.props.color).toBe('claude')
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
  expect(w.sounds).toEqual(['sounds/vein.wav'])
})

/** A run in the stone whose first vein is its fossil. */
function runWithFossil(): string {
  for (let i = 0; ; i += 1) if (game.findAt(seeded({ runId: `fossil-run-${i}`, lifetime: 9_000 }), 1) === 'fossil') return `fossil-run-${i}`
}

test('in the stone a vein may be a fossil: it shows on the rock, and catching it is a secret', async ($, on) => {
  const runId = runWithFossil()
  const w = world(on, { save: seeded({ runId, lifetime: 9_000, allTime: 9_000 }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await wait(w, game.veinAfter(runId, 0).seconds + 1)
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'vein', type: 'Text', text: /^✦ Fossil! \d+s$/ })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain(FOSSIL_BONE)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'vein' })
  await ui.advance(VEIN_POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^★ A fossil \+/ })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(FOSSIL_BONE)
  // A find is a vein caught too: the next tick says both.
  await w.clock.advance(200)
  expect(w.toasts).toEqual(['Achievements: First vein and Paleontologist. Everything mines 4% more.'])
  expect(w.sounds).toEqual(['sounds/find.wav'])
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
  expect((await ui.find({ in: 'vein', type: 'Text', text: 'Frenzy ×5 · 60s' }))?.props).toMatchObject({ color: 'warning' })
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
  expect((await ui.find({ in: 'hud', type: 'Text', text: '330 m' }))?.props).toMatchObject({ color: '#9179ff' })
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
