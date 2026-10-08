// What the engine would answer beneath the mod, for the tests.

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Save } from '../types'

export type World = {
  clock: MockClock
  /** The plugin's store, as the engine would keep it. */
  store: Map<string, unknown>
  toasts: string[]
  opened: string[]
  /** What the person picks, in order, when the mod asks a question. */
  answers: string[]
  /** What a permission check decides. */
  decision: 'allow' | 'ask' | 'deny'
}

export function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: 1_000_000 }),
    store: new Map(Object.entries(store)),
    toasts: [],
    opened: [],
    answers: [],
    decision: 'allow',
  }
  // A store the tests can read back, kept as JSON the way the engine keeps it.
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // Beneath the band nothing else draws: the engine's own, which is empty there.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // $.ui.ask is a call of the AskUserQuestion tool: answer it as the person would.
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const question = e.questions[0]?.question ?? ''
    return { result: { questions: e.questions, answers: { [question]: w.answers.shift() ?? 'No' } } }
  })
  on('tool.check', () => ({ decision: w.decision }))
  return w
}

export const start = ($: Engine) => $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

/** A slash command as the person types it at the prompt. */
export const command = ($: Engine, args: string) =>
  $.command.run({
    command: 'mine',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

export const endSession = ($: Engine) =>
  $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })

export const finishTurn = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'Done.', durationMs: 1_000, isAborted: false, turnId, reason: 'answer' })

export function seeded(patch: Partial<Save>): Save {
  return {
    v: 1,
    runId: 'seed',
    sparks: 0,
    lifetime: 0,
    allTime: 0,
    crystals: 0,
    clicks: 0,
    tools: 0,
    turns: 0,
    mined: {},
    producers: {},
    upgrades: [],
    ...patch,
  }
}

export function band<S extends 'terminal' | 'desktop'>(surface: S, patch: { hasSurvey?: boolean; bodyColumns?: number } = {}) {
  const bodyColumns = patch.bodyColumns ?? 120
  return {
    plugin: 'sparkmine',
    surface,
    component: 'AbovePrompt' as const,
    props: {
      hasSurvey: patch.hasSurvey ?? false,
      isWorking: false,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
    viewport: { columns: bodyColumns, rows: 40 },
  }
}

export function pane<S extends 'terminal' | 'desktop'>(surface: S) {
  return {
    plugin: 'sparkmine',
    surface,
    component: 'Pane' as const,
    requestId: 'sparkmine',
    props: {
      title: 'Sparkmine',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock' as const,
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
    viewport: { columns: 140, rows: 40 },
  }
}
