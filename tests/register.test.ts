import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionAppendInput, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { CLOCK_SVG, STOP_SVG, chipText, fmtTook, newestDrawn, tailOf, withLine } from '../hooks/register'

tier('user')

// The engine beneath the mod: turns start and end, and a message draws its own text.
function world(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: [String((e.props as { text?: string }).text ?? '')] }))
  return clock
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

// Draws a reply block on the desktop. The Code tab draws a reply under an id of its own,
// `msg_…-t0` (mod-probe on 2.1.295), never the row's uuid. Mount each id once and redraw it,
// as the Code tab re-asks a block it already shows.
const desktop = ($: Engine, requestId: string, text: string) =>
  $.ui.mount({ plugin: 'turn-timer', surface: 'desktop', component: 'AssistantMessage', props: message(text), requestId })

describe('turn-timer', () => {
  test('the last reply block of a turn gets a chip, matched by its row id', async ($, on) => {
    world(on)
    await $.session.append(reply('m1', 'Working on it.'))
    await $.session.append(reply('m2', 'Done. All 14 tests pass.'))
    await $.turn.complete(turn())
    const last = await desktop($, 'm2', 'Done. All 14 tests pass.')
    expect((await last.find({ type: 'Text', text: /^3m 12s$/ }))?.props.dimColor).toBe(true)
    expect((await last.find({ type: 'Svg' }))?.props.source).toBe(CLOCK_SVG)
    expect((await last.find({ type: 'Svg' }))?.props.alt).toBe('Turn time')
    expect((await last.find({ key: 'turn-timer' }))?.props.borderStyle).toBe('round')
    // The app's own drawing of the block is still there, above the chip.
    expect((await last.find({ type: 'Text', text: /^Done\. All 14 tests pass\.$/ }))).toBeTruthy()
    const earlier = await desktop($, 'm1', 'Working on it.')
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

  test('the desktop\'s own id is linked to the block it drew during the turn', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.append(reply('row-1', 'Working on it.'))
    const first = await desktop($, 'msg_A-t0', 'Working on it.')
    await $.session.append(reply('row-2', 'Here is the summary you asked for.'))
    const last = await desktop($, 'msg_B-t0', 'Here is the summary you asked for.')
    await $.turn.complete(turn({ durationMs: 42_000 }))
    await last.redraw()
    expect((await last.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
    await first.redraw()
    expect(await first.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('an older reply that ends with the same words does not borrow the newer time', async ($, on) => {
    world(on)
    const old = await desktop($, 'msg_OLD-t0', 'Done.')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.append(reply('row-new', 'Done.'))
    const fresh = await desktop($, 'msg_NEW-t0', 'Done.')
    await $.turn.complete(turn({ durationMs: 42_000 }))
    await old.redraw()
    expect(await old.find({ key: 'turn-timer' })).toBe(undefined)
    await fresh.redraw()
    expect((await fresh.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
  })

  test('a block the desktop first draws after the turn ended is linked then, and the link is saved', async ($, on) => {
    const clock = world(on)
    const old = await desktop($, 'msg_OLD-t0', 'Done.')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.append(reply('row-new', 'Done.'))
    await $.turn.complete(turn({ durationMs: 42_000 }))
    // The older reply is drawn again first. It was drawn before the turn started, so it stays bare.
    await old.redraw()
    expect(await old.find({ key: 'turn-timer' })).toBe(undefined)
    const fresh = await desktop($, 'msg_NEW-t0', 'Done.')
    expect((await fresh.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
    // The link is saved once the drawing is done, so the chip comes back after a remount.
    await clock.advance(1)
    await fresh.unmount()
    const again = await desktop($, 'msg_NEW-t0', 'Done.')
    expect((await again.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
    await old.redraw()
    expect(await old.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a turn the desktop never drew lends nothing to the next turn', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.append(reply('row-1', 'Done.'))
    await $.turn.complete(turn({ durationMs: 42_000 }))
    await $.turn.start({ text: 'again', turnId: 't2' })
    const next = await desktop($, 'msg_T2-t0', 'Done.')
    expect(await next.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a block drawn mid-stream during the turn is linked once it is drawn whole', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const streaming = await desktop($, 'msg_S-t0', 'Here is the')
    await $.session.append(reply('row-s', 'Here is the whole answer.'))
    await $.turn.complete(turn({ durationMs: 42_000 }))
    await streaming.redraw(message('Here is the whole answer.'))
    expect((await streaming.find({ type: 'Text', text: /^42s$/ }))).toBeTruthy()
  })

  test('an interrupted turn says "stopped after", and subagent rows and turns are ignored', async ($, on) => {
    world(on)
    await $.session.append(reply('m1', 'Halfway there.'))
    await $.session.append(reply('sub1', 'Subagent text.', 'agent-1'))
    await $.turn.complete(turn({ agentId: 'agent-1', durationMs: 5_000 }))
    await $.turn.complete(turn({ isAborted: true, reason: 'aborted', durationMs: 65_000 }))
    const main = await desktop($, 'm1', 'Halfway there.')
    expect((await main.find({ type: 'Text', text: /^stopped · 1m 05s$/ }))).toBeTruthy()
    expect((await main.find({ type: 'Svg' }))?.props.source).toBe(STOP_SVG)
    const sub = await desktop($, 'sub1', 'Subagent text.')
    expect(await sub.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a turn with no text reply adds nothing', async ($, on) => {
    world(on)
    await $.turn.complete(turn())
    const ui = await desktop($, 'old', 'Older reply.')
    expect(await ui.find({ key: 'turn-timer' })).toBe(undefined)
  })

  test('a row the hook cannot read is still stored, and the next turn still gets its chip', async ($, on) => {
    world(on)
    const bad = { ...reply('bad1', 'x'), message: { type: 'assistant', role: 'assistant', content: null } } as unknown as SessionAppendInput
    expect((await $.session.append(bad)).uuid).toBe('bad1')
    await $.session.append(reply('m2', 'Done.'))
    await $.turn.complete(turn())
    const ui = await desktop($, 'm2', 'Done.')
    expect((await ui.find({ type: 'Text', text: /^3m 12s$/ }))).toBeTruthy()
  })

  test('on the desktop it keeps the last 200 turns', async ($, on) => {
    world(on)
    for (let i = 1; i <= 201; i++) {
      await $.turn.start({ text: 'go', turnId: `t${i}` })
      await $.session.append(reply(`row-${i}`, `Reply ${i}.`))
      // Unmounted after its turn, so each state write doesn't redraw every earlier reply.
      const ui = await desktop($, `msg_${i}-t0`, `Reply ${i}.`)
      await $.turn.complete(turn())
      await ui.unmount()
    }
    const chipOn = async (i: number) => (await desktop($, `msg_${i}-t0`, `Reply ${i}.`)).find({ key: 'turn-timer' })
    expect(await chipOn(1)).toBe(undefined)
    expect(await chipOn(2)).toBeTruthy()
    expect(await chipOn(201)).toBeTruthy()
  })

  test('helpers', async () => {
    expect(fmtTook(0)).toBe('0s')
    expect(fmtTook(42_400)).toBe('42s')
    expect(fmtTook(192_000)).toBe('3m 12s')
    expect(fmtTook(65_000)).toBe('1m 05s')
    expect(fmtTook(3_840_000)).toBe('1h 04m')
    expect(tailOf('a\u0007  b\n')).toBe('a b')
    const seen = new Map([['old', { seq: 1, tail: 'Done.' }], ['a', { seq: 2, tail: 'Done.' }], ['b', { seq: 3, tail: 'Other.' }]])
    expect(newestDrawn(seen, 'Done.', 1)).toBe('a')
    expect(newestDrawn(seen, 'Done.', 2)).toBe(undefined)
    expect(withLine('Done.', 'took 3s')).toBe('Done.\n\n*took 3s*')
    expect(chipText('took 3m 12s')).toBe('3m 12s')
    expect(chipText('stopped after 1m 05s')).toBe('stopped · 1m 05s')
  })
})
