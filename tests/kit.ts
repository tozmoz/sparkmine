// What the engine would answer beneath the mod, for the tests.

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'

import type { Save } from '../types'

export type World = {
  clock: MockClock
  /** The plugin's store, as the engine would keep it. */
  store: Map<string, unknown>
  toasts: string[]
  /** What the mod put on the clipboard. */
  copied: string[]
  /** The sounds the mod played, by file. */
  sounds: string[]
  opened: string[]
  /** What the person picks, in order, when the mod asks a question. */
  answers: string[]
  /** Each question put to the person, as it is put. */
  asked: string[]
  /** While set, the person takes their time: a question waits on it before it is answered. */
  answering?: Promise<void>
  /** What a permission check decides. */
  decision: 'allow' | 'ask' | 'deny'
  /** Another session's save, written right after this session next writes one: it read before that write. */
  overwrite?: Save
  /** How a Bash call ends, by its command: a failed run, a commit. Unset, it succeeds plainly. */
  bash?: (command: string) => { result: unknown; isError?: true } | undefined
}

/**
 * A surface module run as a surface runs it, with plain objects for elements
 * and its clock and port at rest: what it draws, as JSON, for the props given.
 */
export function client<P, S>(module: (props: P, surface: never) => unknown): (props: P) => string {
  let held: S | undefined
  const surface = {
    elements: { Box: (p: object) => ({ type: 'Box', ...p }), Text: (p: object) => ({ type: 'Text', ...p }) },
    get state() {
      return held
    },
    setState: (next: S) => {
      held = next
    },
    columns: 80,
    rows: 1,
    every: () => () => undefined,
    onPointer: () => () => undefined,
    onKey: () => () => undefined,
    post: () => undefined,
  }
  return props => JSON.stringify(module(props, surface as never))
}

/** @param now when the session starts: some secrets go by the person's own clock. */
export function world(on: On, store: Record<string, unknown> = {}, now = 1_000_000): World {
  const w: World = {
    clock: mock.clock(on, { now }),
    store: new Map(Object.entries(store)),
    toasts: [],
    copied: [],
    sounds: [],
    opened: [],
    answers: [],
    asked: [],
    decision: 'allow',
  }
  // A store the tests can read back, kept as JSON the way the engine keeps it.
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    if (e.key === 'save' && w.overwrite !== undefined) {
      w.store.set(e.key, w.overwrite)
      w.overwrite = undefined
    }
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
  on('audio.play', ($, e) => {
    w.sounds.push(e.clip.asset ?? '')
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.copy', ($, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // Beneath the band nothing else draws: the engine's own, which is empty there.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // $.ui.ask is a call of the AskUserQuestion tool: answer it as the person would, when they are ready.
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') return w.bash?.(String(e.command)) ?? { result: { stdout: '', stderr: '', interrupted: false } }
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const question = e.questions[0]?.question ?? ''
    w.asked.push(question)
    if (w.answering !== undefined) await w.answering
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

export const finishTurn = ($: Engine, turnId: string, durationMs = 1_000, reason: 'answer' | 'aborted' | 'error' = 'answer', answer = 'Done.') =>
  $.turn.complete({ answer, durationMs, isAborted: reason === 'aborted', turnId, reason })

/** A prompt: the person's, typed at the terminal, unless `origin` says it came another way. */
export const prompt = ($: Engine, text: string, origin: PromptOrigin = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin })

/**
 * Lets time pass a second at a time, as it does for a running session: one
 * long jump would fire every tick at once, each reading the same moment.
 */
export async function wait(w: World, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) await w.clock.advance(1_000)
}

/** A Bash call's answer when it fails, and when it commits. */
export const failed = { result: { stdout: '', stderr: '1 failing', interrupted: false }, isError: true } as const
export const committed = { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } } }

export function seeded(patch: Partial<Save>): Save {
  return {
    v: 1,
    runId: 'seed',
    sparks: 0,
    lifetime: 0,
    allTime: 0,
    stones: 0,
    deepest: 0,
    shafts: 0,
    clicks: 0,
    tools: 0,
    turns: 0,
    mined: {},
    producers: {},
    upgrades: [],
    bySource: {},
    bestTurn: 0,
    bestStreak: 0,
    gems: 0,
    veins: 0,
    events: {},
    secrets: [],
    relics: [],
    idleAt: 0,
    writes: {},
    chain: '',
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
