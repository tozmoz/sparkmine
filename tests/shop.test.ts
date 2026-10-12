import { expect, test } from 'claude-code/testing'

import * as game from '../hooks/game.ts'
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
  await ui.press({ key: 'tab-stats' })
  await ui.advance(1_000)
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Clicks 25 · Tool calls 0 · Turns 0' })).toBeDefined()
  await ui.press({ key: 'tab-shop' })
  await ui.advance(50)
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
  await ui.press({ key: 'tab-shaft' })
  await ui.advance(50)
  expect((await ui.find({ key: 'shaft' }))?.props).toMatchObject({ label: 'Open', variant: 'primary' })
  // The shaft pays stones and costs none, and says what there is to spend then.
  expect(await ui.find({ type: 'Text', text: 'Open it now to find ◈ 5 stones' })).toBeDefined()
  expect(
    await ui.find({ type: 'Text', text: 'Start over in fresh rock with ◈ 5 to spend on relics. All 5 stones then add 31% to everything, for good. Badges, stats and relics stay.' }),
  ).toBeDefined()
  w.answers.push('Keep digging')
  await ui.press({ key: 'shaft' })
  expect(w.asked[0]).toMatch(/^Open a new shaft and find 5 ◈\? .*: you will have 5 ◈ to spend on relics, and your stones will add 31% to everything\.$/)
  await ui.press({ key: 'tab-shop' })
  await ui.advance(50)
  expect(await ui.find({ type: 'Text', text: 'Mine cart ×3' })).toBeDefined()
  await ui.press({ key: 'tab-shaft' })
  await ui.advance(50)
  w.answers.push('Open it')
  await ui.press({ key: 'shaft' })
  await ui.advance(250)
  // Five stones add 31%; Hard rock, Lost ruins, Crystal caves, Into the magma and Fresh rock 2% each.
  expect(await ui.find({ type: 'Text', text: '◈ 5 stones +31% · ★ 5 achievements +10%' })).toBeDefined()
  expect(await ui.find({ in: 'shophud', type: 'Text', text: '✻ 0' })).toBeDefined()
  expect(w.store.get('save')).toMatchObject({ stones: 5, shafts: 1, deepest: 510, sparks: 0, allTime: 2e8, producers: {} })
  expect(w.toasts).toContain('A new shaft is open: 5 ◈ found, 5 to spend on relics. Achievement: Fresh rock. Everything mines 2% more.')
  // The relics: what there is to spend, and that spending never lowers what the stones add.
  expect(await ui.find({ type: 'Text', text: '◈ 5 to spend' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You found 5 stones. They add 31% to everything, and spending them never lowers that.' })).toBeDefined()
  // Five stones buy the ledger: it shows with what it does, and the shop says what is left.
  await ui.press({ key: 'relic-ledger' })
  await ui.advance(250)
  expect(await ui.find({ key: 'relic-ledger' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Foreman's ledger$/ }))?.props).toMatchObject({ bold: true })
  expect(await ui.find({ type: 'Text', text: "A new shaft starts with the last one's first 5 upgrades, free." })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '◈ 0 to spend' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'You found 5 stones and spent 5 on relics. All 5 still add 31% to everything: spending never lowers it.' })).toBeDefined()
  expect((await ui.find({ key: 'relic-starter' }))?.props).toMatchObject({ label: '◈ 10', dimColor: true })
  await ui.press({ key: 'relic-starter' })
  expect(w.toasts).toContain('Need 10 more ◈')
  await endSession($)
  expect(w.store.get('save')).toMatchObject({ stones: 5, relics: ['ledger'] })
})

test('the shaft tab says how deep the run is, what its layers add, and how deep a new shaft needs it', async ($, on) => {
  const w = world(on, { save: seeded({ sparks: 100, lifetime: 2e6, allTime: 2e6, veins: 1 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  // The shop opens on its own tab.
  expect((await ui.find({ key: 'tab-shop' }))?.props).toMatchObject({ label: '⛏ Shop', variant: 'primary' })
  expect((await ui.find({ key: 'tab-badges' }))?.props).toMatchObject({ label: '★ Badges 4/42', dimColor: true })
  expect(await ui.find({ key: 'shaft' })).toBeUndefined()
  await ui.press({ key: 'tab-shaft' })
  await ui.advance(50)
  expect((await ui.find({ key: 'shaft' }))?.props).toMatchObject({ label: 'Open', dimColor: true })
  expect(await ui.find({ type: 'Text', text: 'Opens at 500 m' })).toBeDefined()
  await ui.press({ key: 'shaft' })
  expect(w.toasts).toEqual(['A new shaft opens once this one reaches 500 m'])
  // 2M is 330 m: the crystal caves, the magma next, and what the stone and the caves add.
  expect(await ui.find({ type: 'Text', text: '330 m' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Crystal caves$/ }))?.props).toMatchObject({ bold: true, color: '#9179ff' })
  expect(await ui.find({ type: 'Text', text: /now · .*at 500 m: veins show twice as often\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Your layers add: clicks +50% · work events ×2 · a 2% gem chance.' })).toBeDefined()
  const strata = String((await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('The layers in sight'))?.props.source)
  expect(strata).toContain('stroke-dasharray')
  expect(strata.match(/<rect /g)).toHaveLength(8)
  // The relics, before a stone is found.
  expect(await ui.find({ type: 'Text', text: '◈ 0 to spend' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^New shafts find ◈ ancient stones to spend here\./ })).toBeDefined()
  expect((await ui.find({ key: 'relic-ledger' }))?.props).toMatchObject({ label: '◈ 5', dimColor: true })
})

test('the shaft tab says what there is to spend, what a new shaft finds, and what each relic owned does', async ($, on) => {
  world(on, { save: seeded({ sparks: 100, lifetime: 3.2e10, allTime: 9e10, stones: 66, shafts: 3, relics: ['ledger', 'starter', 'lamp', 'map'] }) })
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'tab-shaft' })
    await ui.advance(50)
    // 66 found and 65 of them in four relics: one to spend, so the gem cutter at 50 waits.
    expect(await ui.find({ type: 'Text', text: '◈ 1 to spend' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'You found 66 stones and spent 65 on relics. All 66 still add 188% to everything: spending never lowers it.' })).toBeDefined()
    expect((await ui.find({ key: 'relic-cutter' }))?.props).toMatchObject({ label: '◈ 50', dimColor: true })
    // The new shaft costs no stones: it finds them, and says what there is to spend then.
    expect(await ui.find({ type: 'Text', text: 'Open it now to find ◈ 31 stones' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Start over in fresh rock with ◈ 32 to spend on relics\. All 97 stones then add 246% to everything, up from 188%\./ })).toBeDefined()
    for (const text of [
      "A new shaft starts with the last one's first 5 upgrades, free.",
      'Each new shaft starts with 10 apprentices and 5 mine carts.',
      'Veins show 25% more often.',
      'A new shaft starts at 100 m, in the stone.',
    ]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the badges tab draws every badge, and a pointer over one names it', async ($, on) => {
  world(on, { save: seeded({ sparks: 100, lifetime: 2e6, allTime: 2e6, veins: 1, clicks: 4 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-badges' })
  await ui.advance(50)
  expect(await ui.find({ type: 'Text', text: '4 of 42' })).toBeDefined()
  // The closest badge to go: the magma, 330 m of 500.
  expect(await ui.find({ type: 'Text', text: 'Next: Into the magma' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▰▰▰▰▰▰▱▱▱▱ 330\/500$/ })).toBeDefined()
  const wall = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === '4 of 42 badges')
  // Its frame is given the wall's own size: nine badges to a row, a row for each group of up to nine.
  expect(wall?.props).toMatchObject({ isInteractive: true, width: 416, height: 442 })
  const source = String(wall?.props.source)
  // Each badge's note opens at once on hover: no title, which waits a second first.
  expect(source).not.toContain('<title>')
  expect(source).toMatch(/>First vein<\/tspan><tspan class="tt"[^>]*>Catch a vein\.<\/tspan><tspan class="te"[^>]*>Earned</)
  expect(source).toMatch(/>Vein hunter<\/tspan><tspan class="tt"[^>]*>Catch 25 veins\.<\/tspan><\/text>/)
  expect(source).toContain('#b0:hover~#t0')
  // A secret, and a layer past the core, say nothing of themselves.
  expect(source.match(/Still a secret\./g)).toHaveLength(12)
  expect(source).not.toContain('Good manners')
  expect(source).not.toContain('Under pressure')
  // The terminal lists them by group, earned ones in gold.
  await ui.unmount()
  const term = await $.ui.mount(pane('terminal'))
  expect((await term.find({ key: 'tab-badges' }))?.props).toMatchObject({ label: 'Badges 4/42', variant: 'primary' })
  expect(await term.find({ type: 'Text', text: 'Depth 3/9' })).toBeDefined()
  expect((await term.find({ type: 'Text', text: '★ First vein' }))?.props).toMatchObject({ color: 'warning' })
  expect((await term.find({ type: 'Text', text: '★ Lost ruins' }))?.props).toMatchObject({ color: 'warning' })
  expect(await term.find({ type: 'Text', text: '☆ Underground river' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: '☆ ???' })).toBeDefined()
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

test("a purchase stays when another session writes over the save's first write", async ($, on) => {
  // A new save, a new shaft and a reset have no chain of writes yet.
  const read = seeded({ sparks: 100, lifetime: 100, allTime: 100 })
  const w = world(on, { save: read })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'buy-apprentice' })
  // Another session read the same save and mined, and its write lands last.
  const stored = game.normalize(read)
  if (stored === null) throw new Error('not a save')
  const other = game.syncMine(stored, game.earn({ ...game.newMine(stored.runId), save: stored, isLoaded: true }, 10, { kind: 'crew' }), 'other')
  w.overwrite = other.save
  await wait(w, 6)
  expect(w.store.get('save')).toMatchObject({ sparks: 110, producers: {} })
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
})

test('/mine share puts a card of the mine in the conversation, and on the clipboard', async ($, on) => {
  const w = world(on, {
    save: seeded({ lifetime: 34_132_372, allTime: 224_510_497, deepest: 528, stones: 5, shafts: 1, bestTurn: 75_467_611, gems: 543, veins: 8, clicks: 17_739, events: { longShift: 10 } }),
  })
  await start($)
  const card = [
    '⛏️ Sparkmine · 453 m in the Crystal caves',
    '🟫⬜🟨🟪🟧⬛⬛ deepest 528 m',
    '✻ 224.5M mined · ◈ 5 stones · ★ 10/42',
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

test('the stats tab says where the sparks came from: a bar and tiles on the desktop, lines on the terminal', async ($, on) => {
  world(on, { save: seeded({ bySource: { crew: 600, click: 300, tool: 60, event: 40 }, bestTurn: 450, bestStreak: 4, gems: 3, veins: 2, events: { tests: 4, fix: 1, build: 2, commit: 1, pr: 1 }, deepest: 520, shafts: 1 }) })
  await start($)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-stats' })
  await ui.advance(1_000)
  expect(await ui.find({ in: 'stats', type: 'Text', text: '1,000 in all' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: '60% · ✻ 600' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: '4% · ✻ 40' })).toBeDefined()
  // Each source's share of the bar, in its color.
  const bar = (await ui.findAll({ in: 'stats', type: 'Box' })).filter(b => b.props.backgroundColor !== undefined && b.props.height === 1)
  expect(bar.map(b => [b.props.backgroundColor, b.props.flexGrow])).toEqual([['claude', 600], ['suggestion', 60], ['warning', 40], ['success', 300]])
  expect(await ui.find({ in: 'stats', type: 'Text', text: '+450' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: '520 m' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Bugs squashed' })).toBeDefined()
  expect(await ui.find({ in: 'stats', type: 'Text', text: 'Clicks 0 · Tool calls 0 · Turns 0' })).toBeDefined()
  await ui.unmount()
  const term = await $.ui.mount(pane('terminal'))
  await term.advance(1_000)
  expect(await term.find({ in: 'stats', type: 'Text', text: 'Best turn +450 · Best streak 4 · Deepest 520 m · Shafts 1 · Gems 3 · Veins 2' })).toBeDefined()
  expect(await term.find({ in: 'stats', type: 'Text', text: 'Tests passed 4 · Bugs squashed 1 · Builds 2 · Clean lints 0 · Commits 1 · PRs opened 1 · PRs merged 0 · Long shifts 0' })).toBeDefined()
})

test('a stopped mine says so atop the shop', async ($, on) => {
  world(on)
  await start($)
  await command($, 'stop')
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Sparkmine is stopped. /mine start sets it going again.' })).toBeDefined()
})
