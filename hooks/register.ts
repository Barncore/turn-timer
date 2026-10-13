// turn-timer: a quiet "took 3m 12s" line under the last block of each reply.
// The desktop's own footer says when a turn finished, not how long it took.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Finished } from '../types'

const finished = atom({ plugin: 'turn-timer', key: 'finished' } as const, {})
/** Ids kept for scrolling back through older replies; the oldest go first. A turn stores at most two, so this holds at least 200 turns. */
const KEEP = 400
/** Render ids remembered in the order they were first drawn; the oldest go first. */
const SEEN = 1000

type Drawn = {
  /** When this module first saw the id drawn, counted in render ids. */
  seq: number
  /** The end of the block's text as it was last drawn. */
  tail: string
}

type State = {
  /** The transcript id of the turn's last assistant row that holds text. */
  lastRowId: string | null
  /** The end of that row's text, to recognise its block on a surface that draws it under another id. */
  lastTail: string | null
  /** How many render ids this module has seen drawn. */
  seq: number
  /** Every render id seen drawn, in the order first seen. */
  seen: Map<string, Drawn>
  /** `seq` when the current turn started: ids first drawn after it belong to this turn. */
  turnStart: number
  /** A finished turn whose block the desktop hadn't drawn yet when the turn ended. */
  pending: { line: string; tail: string; since: number } | null
}

export function fmtTook(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** The end of a block's text, control characters and spacing evened out: its last 160 characters. */
export function tailOf(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(-160)
}

/** The newest render id first drawn after `since` whose text ends as `tail` does. */
export function newestDrawn(seen: ReadonlyMap<string, Drawn>, tail: string, since: number): string | undefined {
  let found: string | undefined
  for (const [id, drawn] of seen) if (drawn.seq > since && drawn.tail === tail) found = id
  return found
}

/** Notes a render id as drawn with this text, and says when it was first drawn. */
function noteDrawn(s: State, id: string, tail: string): Drawn {
  let drawn = s.seen.get(id)
  if (drawn === undefined) {
    drawn = { seq: ++s.seq, tail }
    s.seen.set(id, drawn)
    if (s.seen.size > SEEN) s.seen.delete(s.seen.keys().next().value as string)
  }
  drawn.tail = tail
  return drawn
}

/** The block's markdown with the line appended: the fallback for surfaces that draw no Svg. */
export function withLine(text: string, line: string): string {
  return `${text}\n\n*${line}*`
}

/** The chip's words: `3m 12s` for a finished turn, `stopped · 1m 05s` for an interrupted one. */
export function chipText(line: string): string {
  return line.startsWith('stopped after ') ? `stopped · ${line.slice('stopped after '.length)}` : line.replace(/^took /, '')
}

// One mid-grey reads on both the light and the dark theme, so the icon needs no theme of its own.
// The stop square keeps cache-watch's orange: an interrupted turn is the one worth noticing.
const ICON_GREY = '#8a8883'
const STOP_ORANGE = '#d97757'

export const CLOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${ICON_GREY}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  '<circle cx="8" cy="9" r="5.75"/><path d="M8 6.25V9l1.75 1.25M6.5 1.75h3M8 1.75v1.5M12.6 4.4l.9-.9"/></svg>'

export const STOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16">` +
  `<rect x="3.5" y="3.5" width="9" height="9" rx="1.75" fill="${STOP_ORANGE}"/></svg>`

async function store($: EngineInterface, ids: string[], line: string) {
  await update($, finished, prev => {
    const next: Finished = { ...(prev ?? {}) }
    for (const id of ids) {
      delete next[id]
      next[id] = line
    }
    const all = Object.keys(next)
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) delete next[old]
    return next
  })
}

async function remember($: EngineInterface, s: State, line: string) {
  const rowId = s.lastRowId
  const tail = s.lastTail
  const since = s.turnStart
  s.lastRowId = null
  s.lastTail = null
  s.turnStart = s.seq
  s.pending = null
  if (rowId === null || tail === null) return
  // The terminal draws a block under its row id. The desktop draws it under an id of its own
  // (`msg_…-t0`) that no event hands a mod, so link the two: the block drawn this turn whose
  // text ends as the row's does. A reply drawn before the turn started can't match, whatever its words.
  const drawn = newestDrawn(s.seen, tail, since)
  if (drawn === undefined) s.pending = { line, tail, since }
  // One state write per turn, at its end: rare enough not to disturb other mods' buttons.
  await store($, drawn === undefined || drawn === rowId ? [rowId] : [rowId, drawn], line)
}

export const register: Register = on => {
  const s: State = { lastRowId: null, lastTail: null, seq: 0, seen: new Map(), turnStart: 0, pending: null }

  on('turn.start', async ($, e, next) => {
    s.turnStart = s.seq
    // A block still unlinked stays bare, rather than lending its time to this turn's blocks.
    s.pending = null
    return next(e)
  })
    .catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.door === 'response' && e.message.role === 'assistant') {
      const text = e.message.content
        .map(block => {
          const body = (block as { text?: unknown }).text
          return block.type === 'text' && typeof body === 'string' ? body : ''
        })
        .join('\n')
      if (text.trim() !== '') {
        s.lastRowId = e.uuid
        s.lastTail = tailOf(text)
      }
    }
    return r
  })
    // The timer must never hold up a reply: on a failure, pass the row through as stored.
    .catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await remember($, s, e.isAborted ? `stopped after ${fmtTook(e.durationMs)}` : `took ${fmtTook(e.durationMs)}`)
    return r
  })
    .catch(($, e, next) => next(e))

  // A rewrite changes the drawing only; the stored reply, and what Claude reads, stay as they were.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const tail = tailOf(e.props.text)
    const drawn = noteDrawn(s, e.requestId, tail)
    let line = ((await read($, finished)) ?? {})[e.requestId]
    const late = s.pending
    if (line === undefined && late !== null && drawn.seq > late.since && tail === late.tail) {
      // The desktop drew this turn's block only after the turn ended: link it now, and save the
      // link once this drawing is done, since a state write redraws every site.
      s.pending = null
      line = late.line
      const id = e.requestId
      $.clock.after(0, () => { void store($, [id], late.line).catch(() => undefined) })
    }
    if (line === undefined) return next(e)
    if (e.surface === 'desktop') {
      // A chip under the app's own drawing of the block, which keeps its markdown, selection and copy.
      const rest = await next(e)
      const { Box, Text, Svg } = $.ui.resolve(e)
      const stopped = line.startsWith('stopped')
      const chip = Box({ key: 'turn-timer', flexDirection: 'row', alignItems: 'center', gap: 1, alignSelf: 'flex-start', borderStyle: 'round', borderColor: 'subtle', paddingX: 1, children: [
        Box({ flexShrink: 0, children: [Svg({ source: stopped ? STOP_SVG : CLOCK_SVG, width: 14, height: 14, alt: stopped ? 'Turn stopped' : 'Turn time' })] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [chipText(line)] }),
      ] })
      return Box({ flexDirection: 'column', gap: 1, children: [rest, chip] })
    }
    return next({ ...e, props: { ...e.props, text: withLine(e.props.text, line) } })
  })
}
