import { expect, test } from 'claude-code/testing'

import * as game from '../hooks/game.ts'
import { band, command, finishTurn, pane, seeded, start, world } from './kit.ts'

/** Lets the HUD poll once, so it holds fresh numbers. */
const POLL = 150

/** A press of the desktop's gold Mine sign: the pointer going down on the HUD. */
const DOWN = { type: 'down', x: 1, y: 0, button: 'left', in: 'hud' } as const

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

test('on the terminal the pointer mines at once, and the button press after it is not counted twice', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('terminal', { bodyColumns: 140 }))
  await ui.advance(POLL)
  await ui.pointer({ type: 'down', x: 2, y: 1, button: 'left', in: 'hud' })
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 1' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 2, y: 1, button: 'left', in: 'hud' })
  await ui.press({ key: 'mine' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 1' })).toBeDefined()
  // A press with no pointer before it, from its hotkey, counts.
  await ui.press({ key: 'mine' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 2' })).toBeDefined()
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
  const holdsSign = (child: unknown) => (child as { type?: string }).type === 'Client' && JSON.stringify(child).includes('"shopbtn"')
  const column = (await ui.findAll({ type: 'Box' })).find(box => box.children.some(holdsSign))
  expect(column?.props).toMatchObject({ flexDirection: 'column', alignItems: 'flex-start' })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'shopbtn' })
  await ui.advance(POLL)
  expect(w.opened).toEqual(['sparkmine'])
})

test('buying the Diamond pick puts it in the miner\'s hands', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 20_000, clicks: 600, upgrades: ['pick-1', 'pick-2'] }) })
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
  expect((await narrow.find({ in: 'hud', key: 'mine' }))?.props).toMatchObject({ label: 'Mine', hotkey: 'm' })
})

test('a permission prompt pauses the miner until the turn moves on', async ($, on) => {
  const w = world(on)
  w.decision = 'ask'
  await start($)
  await $.turn.start({ text: 'clean up', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'call-1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeDefined()
  // The sign stays, dulled, so nothing moves; a press does nothing until Claude works again.
  expect((await ui.find({ in: 'hud', key: 'mine' }))?.props).toMatchObject({ backgroundColor: '#5c4d2e' })
  await ui.pointer(DOWN)
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 0' })).toBeDefined()
  await finishTurn($, 't1')
  await ui.redraw()
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Claude is waiting for you' })).toBeUndefined()
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
