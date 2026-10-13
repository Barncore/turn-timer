import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionAppendInput, TurnCompleteInput } from 'claude-code'

import { CLOCK_SVG, STOP_SVG, chipText, fmtTook, textKey, withLine } from '../hooks/register'

tier('user')

// The engine beneath the mod: turns end with their answer, and a message draws its own text.
function world(on: On) {
  mock.clock(on, { now: 1_000_000 })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: [String((e.props as { text?: string }).text ?? '')] }))
}

const reply = (uuid: string, text: string, agentId?: string): SessionAppendInput => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response',
  origin: { kind: 'model', model: 'claude-opus-5-5' },
  uuid,
  ...(agentId ? { agentId } : {}),
} as SessionAppendInput)

type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({
  answer: 'ok', durationMs: 192_000, isAborted: false, turnId: 't1', reason: 'answer', ...over,
})

const message = (text: string): RenderPropsOf['AssistantMessage'] => ({ text, isFirstOfReply: true })

describe('turn-timer', () => {
  test('the last reply block of a turn gets a chip on the desktop, matched by its row id', async ($, on) => {
    world(on)
    await $.session.append(reply('m1', 'Working on it.'))
    await $.session.append(reply('m2', 'Done. All 14 tests pass.'))
    await $.turn.complete(turn())
    const last = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Done. All 14 tests pass.'), requestId: 'm2' })
    expect((await last.find({ type: 'Text', text: /^3m 12s$/ }))?.props.dimColor).toBe(true)
    expect((await last.find({ type: 'Svg' }))?.props.source).toBe(CLOCK_SVG)
    expect((await last.find({ type: 'Svg' }))?.props.alt).toBe('Turn time')
    expect((await last.find({ key: 'turn-timer' }))?.props.borderStyle).toBe('round')
    // The app's own drawing of the block is still there, above the chip.
    expect((await last.find({ type: 'Text', text: /^Done\. All 14 tests pass\.$/ }))).toBeTruthy()
    const earlier = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Working on it.'), requestId: 'm1' })
    expect(await earlier.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('surfaces without Svg keep the italic line in the markdown', async ($, on) => {
    world(on)
    await $.session.append(reply('m2', 'Done.'))
    await $.turn.complete(turn())
    const ui = await $.ui.mount({ plugin: 'turn-timer', surface: 'terminal', component: 'AssistantMessage', props: message('Done.'), requestId: 'm2' })
    expect((await ui.find({ text: /took 3m 12s/ }))?.text).toBe('Done.\n\n*took 3m 12s*')
    expect(await ui.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a render that names the block by another id still matches on its text', async ($, on) => {
    world(on)
    await $.session.append(reply('row-7', 'Here is the summary you asked for.'))
    await $.turn.complete(turn({ durationMs: 42_000 }))
    const ui = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Here is the summary you asked for.'), requestId: 'msg_api_123' })
    expect((await ui.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
  })

  test('an interrupted turn says "stopped after", and subagent rows and turns are ignored', async ($, on) => {
    world(on)
    await $.session.append(reply('m1', 'Halfway there.'))
    await $.session.append(reply('sub1', 'Subagent text.', 'agent-1'))
    await $.turn.complete(turn({ agentId: 'agent-1', durationMs: 5_000 }))
    await $.turn.complete(turn({ isAborted: true, reason: 'aborted', durationMs: 65_000 }))
    const main = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Halfway there.'), requestId: 'm1' })
    expect((await main.find({ type: 'Text', text: /^stopped · 1m 05s$/ }))).toBeTruthy()
    expect((await main.find({ type: 'Svg' }))?.props.source).toBe(STOP_SVG)
    const sub = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Subagent text.'), requestId: 'sub1' })
    expect(await sub.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a turn with no text reply adds nothing', async ($, on) => {
    world(on)
    await $.turn.complete(turn())
    const ui = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Older reply.'), requestId: 'old' })
    expect(await ui.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a row the hook cannot read is still stored, and the next turn still gets its chip', async ($, on) => {
    world(on)
    const bad = { ...reply('bad1', 'x'), message: { type: 'assistant', role: 'assistant', content: null } } as unknown as SessionAppendInput
    expect((await $.session.append(bad)).uuid).toBe('bad1')
    await $.session.append(reply('m2', 'Done.'))
    await $.turn.complete(turn())
    const ui = await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message('Done.'), requestId: 'm2' })
    expect((await ui.find({ type: 'Text', text: /^3m 12s$/ }))).toBeTruthy()
  })

  test('it keeps the last 100 turns', async ($, on) => {
    world(on)
    for (let i = 1; i <= 101; i++) {
      await $.session.append(reply(`m${i}`, `Reply ${i}.`))
      await $.turn.complete(turn())
    }
    const chipOn = async (i: number) => (await $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message(`Reply ${i}.`), requestId: `m${i}` })).find({ key: 'turn-timer' })
    expect(await chipOn(1)).toBe(undefined)
    expect(await chipOn(2)).toBeTruthy()
    expect(await chipOn(101)).toBeTruthy()
  })

  test('helpers', async () => {
    expect(fmtTook(0)).toBe('0s')
    expect(fmtTook(42_400)).toBe('42s')
    expect(fmtTook(192_000)).toBe('3m 12s')
    expect(fmtTook(65_000)).toBe('1m 05s')
    expect(fmtTook(3_840_000)).toBe('1h 04m')
    expect(textKey('a\u0007  b\n')).toBe('text:a b')
    expect(withLine('Done.', 'took 3s')).toBe('Done.\n\n*took 3s*')
    expect(chipText('took 3m 12s')).toBe('3m 12s')
    expect(chipText('stopped after 1m 05s')).toBe('stopped · 1m 05s')
  })
})
