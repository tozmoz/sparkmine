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

test('Max buys as many as the purse allows, and says what one costs when it allows none', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 2_000 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ key: 'amount-100' })).toBeUndefined()
  await ui.press({ key: 'amount-max' })
  // Twenty apprentices cost 1,962: the twenty-first would cost 347 more.
  expect((await ui.find({ key: 'buy-apprentice' }))?.props).toMatchObject({ label: '×20 1,962 ✻', variant: 'primary' })
  await ui.press({ key: 'buy-apprentice' })
  await ui.advance(250)
  expect(await ui.find({ type: 'Text', text: 'Apprentice ×20' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 38' })).toBeDefined()
  const button = await ui.find({ key: 'buy-apprentice' })
  expect(button?.props).toMatchObject({ label: '×1 347 ✻', dimColor: true })
  await ui.press({ key: 'buy-apprentice' })
  expect(w.toasts).toEqual(['Need 309 more ✻'])
  // ×10 buys ten or none.
  await ui.press({ key: 'amount-10' })
  expect((await ui.find({ key: 'buy-apprentice' }))?.props.variant).toBeUndefined()
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

test('a new shaft trades the run for ancient stones, from 500 m down', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 5e6, lifetime: 125e6, allTime: 2e8, producers: { cart: 3 } }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'shaft' }))?.props.label).toBe('Open for 5 ◈')
  expect(await ui.find({ type: 'Text', text: /^Start over in fresh rock for 5 ◈ ancient stones\. They add 31% to everything, for good/ })).toBeDefined()
  w.answers.push('Keep digging')
  await ui.press({ key: 'shaft' })
  expect(w.asked[0]).toMatch(/your stones will add 31% to everything\.$/)
  expect(await ui.find({ type: 'Text', text: 'Mine cart ×3' })).toBeDefined()
  w.answers.push('Open it')
  await ui.press({ key: 'shaft' })
  await ui.advance(250)
  // Five stones add 31%; Hard rock, Crystal caves, Into the magma and Fresh rock 2% each.
  expect(await ui.find({ type: 'Text', text: '◈ 5 stones +31% · ★ 4 achievements +8%' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 0' })).toBeDefined()
  expect(w.store.get('save')).toMatchObject({ stones: 5, shafts: 1, deepest: 510, sparks: 0, allTime: 2e8, producers: {} })
  expect(w.toasts).toContain('A new shaft is open. You hold 5 ◈. Achievement: Fresh rock. Everything mines 2% more.')
})

test('a shaft above 500 m says how deep it must go, and the layers say what each adds', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 100, lifetime: 2e6, allTime: 2e6, veins: 1 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'shaft' }))?.props).toMatchObject({ label: 'Open a new shaft', dimColor: true })
  await ui.press({ key: 'shaft' })
  expect(w.toasts).toEqual(['A new shaft opens once this one reaches 500 m'])
  // 2M is 330 m: the crystal caves, with the stone above them reached and the magma ahead.
  expect(await ui.find({ type: 'Text', text: '◀ here' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'Crystal caves' }))?.props).toMatchObject({ bold: true })
  expect(await ui.find({ type: 'Text', text: '500 m · Veins show twice as often.' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'Magma' }))?.props).toMatchObject({ dimColor: true })
  // The layers past the next one stay a surprise, and how many there are too.
  expect(await ui.find({ type: 'Text', text: 'Groundwater' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'More layers below' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3/42 · +6% to everything' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '★ First vein' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '☆ Vein hunter' })).toBeDefined()
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

test('the idle pace is paid once: a session adds only what no other session gave the save yet', async ($, on) => {
  // 100 carts mine 50/s, and a tenth of it while Claude is idle. Another
  // session already gave the save the next three seconds of it.
  const w = world(on, {
    save: seeded({ producers: { cart: 100 }, upgrades: ['idle-1'], sparks: 15, lifetime: 15, allTime: 15, bySource: { crew: 15 }, idleAt: 1_003_000 }),
  })
  await start($)
  await wait(w, 4)
  await endSession($)
  const save = w.store.get('save') as { sparks: number; idleAt: number }
  expect(Math.round(save.sparks * 1_000) / 1_000).toBe(20)
  expect(save.idleAt).toBe(1_004_000)
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

test('one stone and one achievement read as one', async ($, on) => {
  world(on, { save: seeded({ stones: 1, veins: 1 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: '◈ 1 stone +10% · ★ 1 achievement +2%' })).toBeDefined()
  // An earned badge reads in the theme's gold, so a light theme darkens it.
  expect((await ui.find({ type: 'Text', text: '★ First vein' }))?.props).toMatchObject({ color: 'warning' })
})

test('/mine share puts a card of the mine in the conversation, and on the clipboard', async ($, on) => {
  const w = world(on, {
    save: seeded({ lifetime: 34_132_372, allTime: 224_510_497, deepest: 528, stones: 5, shafts: 1, bestTurn: 75_467_611, gems: 543, veins: 8, clicks: 17_739, events: { longShift: 10 } }),
  })
  await start($)
  const card = [
    '⛏️ Sparkmine · 453 m in the Crystal caves',
    '🟫⬜🟪🟧⬛⬛⬛ deepest 528 m',
    '✻ 224.5M mined · ◈ 5 stones · ★ 9/42',
    'Best turn +75.47M · 543 gems · 8 veins',
    'github.com/tozmoz/sparkmine',
  ].join('\n')
  expect((await command($, 'share')).text).toBe(`Your mine, ready to paste:\n\`\`\`\n${card}\n\`\`\``)
  expect(w.copied).toEqual([card])
  expect(w.toasts).toContain('Copied to the clipboard')
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
  world(on, { save: seeded({ bySource: { crew: 600, click: 300, tool: 60, event: 40 }, bestTurn: 450, bestStreak: 4, gems: 3, veins: 2, events: { tests: 4, fix: 1, build: 2, commit: 1, pr: 1 }, deepest: 520, shafts: 1 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.advance(1_000)
  expect(await ui.find({ in: 'stats', type: 'Text', text: '60% · ✻ 600' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: '4% · ✻ 40' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Best turn +450 · Best streak 4 · Deepest 520 m · Shafts 1' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Gems 3 · Veins 2' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Tests passed 4 · Bugs squashed 1 · Builds 2 · Clean lints 0' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Commits 1 · PRs opened 1 · PRs merged 0 · Long shifts 0' })).toBeDefined()
})

test('a stopped mine says so atop the shop', async ($, on) => {
  world(on)
  await start($)
  await command($, 'stop')
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Sparkmine is stopped. /mine start sets it going again.' })).toBeDefined()
})
