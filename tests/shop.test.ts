import { expect, test } from 'claude-code/testing'

import { band, command, endSession, finishTurn, pane, seeded, start, wait, world } from './kit.ts'

test('/mine opens the shop pane', async ($, on) => {
  const w = world(on)
  await start($)
  const answer = await command($, '')
  expect(answer.text).toBeUndefined()
  expect(w.opened).toEqual(['sparkmine'])
})

test('producers cost sparks, one or ten at a time', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 1_000 }) })
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ key: 'buy-apprentice' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '??? · 110 ✻' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.press({ key: 'buy-apprentice' })
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×1' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 985' })).toBeDefined()
  await ui.press({ key: 'amount-10' })
  expect((await ui.find({ key: 'buy-apprentice' }))?.props.label).toBe('×10 399 ✻')
  await ui.press({ key: 'buy-apprentice' })
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×11' })).toBeDefined()
  expect(w.toasts).toEqual([])
})

test('a purchase shows at once, and a run of quick presses all land', async ($, on) => {
  world(on, { save: seeded({ sparks: 1_000 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'buy-apprentice' })
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×1' })).toBeDefined()
  expect((await ui.find({ key: 'buy-apprentice' }))?.props.label).toBe('18 ✻')
  await ui.press({ key: 'buy-apprentice' })
  await ui.press({ key: 'buy-apprentice' })
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×3' })).toBeDefined()
})

/** Each Button's handle in a drawn tree, by key: what a surface names when it presses one. */
function handles(node: unknown, out: Record<string, number> = {}): Record<string, number> {
  if (Array.isArray(node)) for (const child of node) handles(child, out)
  else if (node !== null && typeof node === 'object') {
    const el = node as { type?: unknown; props?: { key?: unknown }; press?: { handle?: unknown }; children?: unknown }
    if (el.type === 'Button' && typeof el.props?.key === 'string' && typeof el.press?.handle === 'number') out[el.props.key] = el.press.handle
    handles(el.children, out)
  }
  return out
}

test('a redraw keeps every shop button under its handle, so a press already sent still lands', async ($, on) => {
  world(on, { save: seeded({ sparks: 1_000 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  const before = handles(await ui.drawn())
  expect(Object.keys(before)).toEqual(expect.arrayContaining(['amount-1', 'amount-10', 'buy-apprentice']))
  // A purchase and a new amount redraw the shop and relabel its buttons.
  await ui.press({ key: 'buy-apprentice' })
  await ui.press({ key: 'amount-10' })
  await ui.advance(700)
  expect((await ui.find({ key: 'buy-apprentice' }))?.props.label).toBe('×10 399 ✻')
  const after = handles(await ui.drawn())
  for (const key of Object.keys(before)) expect([key, after[key]]).toEqual([key, before[key]])
  // The button pressed under its first handle still buys.
  await ui.press({ key: 'buy-apprentice' })
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×11' })).toBeDefined()
})

test('×100 buys a hundred or none, and its button lights only when all of it is affordable', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 2_000 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'amount-100' })
  const button = await ui.find({ key: 'buy-apprentice' })
  expect(button?.props).toMatchObject({ dimColor: true })
  expect(button?.props.variant).toBeUndefined()
  await ui.press({ key: 'buy-apprentice' })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toMatch(/^Need [\d.,]+[KMB]? more ✻$/)
  expect(await ui.find({ type: 'Text', text: 'Apprentice' })).toBeDefined()
  // ×10 fits the purse, so it lights and buys all ten.
  await ui.press({ key: 'amount-10' })
  expect((await ui.find({ key: 'buy-apprentice' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'buy-apprentice' })
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×10' })).toBeDefined()
})

test('a short purse says how much is missing', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'buy-apprentice' })
  expect(w.toasts).toEqual(['Need 15 more ✻'])
  expect(await ui.find({ type: 'Text', text: 'Apprentice' })).toBeDefined()
})

test('an upgrade goes on sale at its unlock', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 500, clicks: 25 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: 'Next: Steel pick, after 100 clicks' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '▰▰▱▱▱▱▱▱▱▱ 25/100' })).toBeDefined()
  await ui.advance(1_000)
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Clicks 25 · Tool calls 0 · Turns 0' })).toBeDefined()
  await ui.press({ key: 'up-pick-1' })
  await ui.advance(250)
  expect(await ui.find({ key: 'up-pick-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Click +2 · Read +1 · Edit +4' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 400' })).toBeDefined()
})

test('collapsing the mine trades the run for crystals', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 5e6, lifetime: 8e6, allTime: 8e6, producers: { cart: 3 } }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'collapse' }))?.props.label).toBe('Collapse for 2 ◆')
  w.answers.push('Keep mining')
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: 'Mine cart ×3' })).toBeDefined()
  w.answers.push('Collapse')
  await ui.press({ key: 'collapse' })
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: '◆ 2 · +4% to everything' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 0' })).toBeDefined()
  expect(w.store.get('save')).toMatchObject({ crystals: 2, sparks: 0, allTime: 8e6, producers: {} })
})

test('what a session mines reaches the store', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount(band('desktop'))
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'hud' })
  await ui.advance(250)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await finishTurn($, 't1')
  await endSession($)
  expect(w.store.get('save')).toMatchObject({ sparks: 3, clicks: 1, tools: 1, turns: 1, mined: { bash: 1 }, bySource: { click: 1, tool: 2 }, bestTurn: 3 })
})

test('a purchase stays when another session writes over it', async ($, on) => {
  const read = seeded({ sparks: 100, lifetime: 100, allTime: 100, chain: 'c' })
  const w = world(on, { save: read })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'buy-apprentice' })
  // Another session read the save before this one wrote the purchase, and its write lands last.
  w.overwrite = { ...read, sparks: 110, lifetime: 110, allTime: 110, writes: { other: 1 } }
  await wait(w, 6)
  expect(w.store.get('save')).toMatchObject({ sparks: 110, producers: {} })
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×1' })).toBeDefined()
  // The next sync finds its write missing and lays the purchase over the other session's.
  await wait(w, 6)
  expect(w.store.get('save')).toMatchObject({ sparks: 95, producers: { apprentice: 1 } })
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×1' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 95' })).toBeDefined()
})

test('/mine reset asks first', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 77 }) })
  await start($)
  w.answers.push('Keep it')
  expect((await command($, 'reset')).text).toBe('Nothing was reset.')
  w.answers.push('Reset')
  expect((await command($, 'reset')).text).toBe('Sparkmine was reset.')
  expect(w.store.get('save')).toMatchObject({ sparks: 0 })
})

test('on the desktop the cards stand a row apart, in the terminal they stay packed', async ($, on) => {
  world(on, { save: seeded({ sparks: 1_000, producers: { apprentice: 3 } }) })
  await start($)
  const gapped = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount(pane(surface))
    const boxes = await ui.findAll({ type: 'Box' })
    await ui.unmount()
    // The box that holds the producer cards themselves, not the pane around them.
    return boxes.some(box => box.props.rowGap === 1 && !JSON.stringify(box).includes('Producers') && JSON.stringify(box).includes('buy-apprentice'))
  }
  expect(await gapped('desktop')).toBe(true)
  expect(await gapped('terminal')).toBe(false)
})

test('the stats say where the sparks came from', async ($, on) => {
  world(on, { save: seeded({ bySource: { crew: 600, click: 300, tool: 60, event: 40 }, bestTurn: 450, gems: 3, veins: 2, events: { tests: 4, commit: 1 } }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.advance(1_000)
  expect(await ui.find({ in: 'stats', type: 'Text', text: '60% · ✻ 600' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: '4% · ✻ 40' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Best turn +450 · Gems 3 · Veins 2' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Tests passed 4 · Commits 1 · Long shifts 0' })).toBeDefined()
})

test('a stopped mine says so atop the shop', async ($, on) => {
  world(on)
  await start($)
  await command($, 'stop')
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Sparkmine is stopped. /mine start sets it going again.' })).toBeDefined()
})
