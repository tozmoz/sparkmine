import { expect, test } from 'claude-code/testing'

import { band, command, finishTurn, pane, seeded, start, world } from './kit.ts'

/** Lets the HUD poll once, so it holds fresh numbers. */
const POLL = 150

test('the band keeps one line while Claude is idle', async ($, on) => {
  world(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    await ui.advance(POLL)
    expect(await ui.find({ in: 'hud', type: 'Text', text: '✻ 0' })).toBeDefined()
    expect(await ui.find({ in: 'hud', type: 'Text', text: '· mines while Claude works' })).toBeDefined()
    expect(await ui.find({ key: 'shop' })).toBeDefined()
    expect(await ui.find({ key: 'mine' })).toBeUndefined()
    await ui.unmount()
  }
})

test('while Claude works, the Mine button and tool calls mine', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect((await ui.find({ key: 'mine' }))?.props).toMatchObject({ label: '⛏ Mine' })
  await ui.press({ key: 'mine' })
  await ui.press({ key: 'mine' })
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
  expect(await ui.find({ key: 'mine' })).toBeUndefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '· last turn +3' })).toBeDefined()
})

test('a press pops what it earned beside the counter, then it fades', async ($, on) => {
  world(on, { save: seeded({ upgrades: ['pick-1', 'pick-2'], clicks: 100 }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  await ui.press({ key: 'mine' })
  await ui.advance(POLL)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^\+4$/ })).toBeDefined()
  await ui.advance(1_000)
  expect(await ui.find({ in: 'hud', type: 'Text', text: /^\+4$/ })).toBeUndefined()
})

test('the HUD keeps one size while the pop fades, and the scene is never redrawn', async ($, on) => {
  world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  const scene = await ui.find({ type: 'Svg' })
  await ui.press({ key: 'mine' })
  await ui.press({ key: 'mine' })
  await ui.advance(150)
  // What lays out in the flow (not the pop, which is placed absolutely) stays put frame after frame.
  const flow = async () => {
    const root = await ui.find({ in: 'hud', type: 'Box' })
    return JSON.stringify({ props: root?.props, rows: root?.children.filter(child => JSON.stringify(child).includes('"position":"absolute"') === false) })
  }
  const first = await flow()
  expect(first).toContain('"height":3')
  for (let frame = 0; frame < 12; frame += 1) {
    await ui.advance(60)
    expect(await flow()).toBe(first)
  }
  expect(await ui.find({ type: 'Svg' })).toEqual(scene)
})

test('the crew and the next goal fill the rest of the band', async ($, on) => {
  world(on, { save: seeded({ clicks: 30, producers: { apprentice: 17, cart: 6 } }) })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.advance(POLL)
  expect(await ui.find({ type: 'Text', text: '×17' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '×6' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: 'Next: Union contract' })).toBeDefined()
  expect(await ui.find({ in: 'hud', type: 'Text', text: '▰▰▰▰▰▰▱▱▱▱' })).toBeDefined()
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
  expect(await narrow.find({ key: 'mine' })).toBeDefined()
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
  expect(await ui.find({ key: 'mine' })).toBeUndefined()
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
  expect(await ui.find({ key: 'shop' })).toBeUndefined()
  await command($, 'show')
  await ui.redraw()
  expect(await ui.find({ key: 'shop' })).toBeDefined()
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
