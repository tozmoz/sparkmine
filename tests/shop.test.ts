import { expect, test } from 'claude-code/testing'

import { band, command, endSession, finishTurn, pane, seeded, start, world } from './kit.ts'

test('/mine opens the shop pane', async ($, on) => {
  const w = world(on)
  await start($)
  const answer = await command($, '')
  expect(answer.text).toBeUndefined()
  expect(w.opened).toEqual(['sparkmine'])
})

test('producers cost sparks, one or ten at a time', async ($, on) => {
  world(on, { save: seeded({ sparks: 1_000 }) })
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
  world(on, { save: seeded({ sparks: 500, clicks: 25 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Next: Steel pick, after 100 clicks' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▰▰▱▱▱▱▱▱▱▱ 25/100' })).toBeDefined()
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
  await ui.press({ key: 'mine' })
  await ui.advance(250)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await finishTurn($, 't1')
  await endSession($)
  expect(w.store.get('save')).toMatchObject({ sparks: 3, clicks: 1, tools: 1, turns: 1, mined: { bash: 1 } })
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
