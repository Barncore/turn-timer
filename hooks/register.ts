// turn-timer: a quiet "took 3m 12s" line under the last block of each reply.
// The desktop's own footer says when a turn finished, not how long it took.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Finished } from '../types'

const finished = atom({ plugin: 'turn-timer', key: 'finished' } as const, {})
/** Lines kept for scrolling back through older replies; the oldest go first. */
const KEEP = 200

type State = {
  /** The transcript id of the turn's last assistant row that holds text. */
  lastRowId: string | null
  /** That row's text, for the fallback match when a render names the block by another id. */
  lastText: string | null
}

export function fmtTook(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** A key from a block's text: its last 160 characters, control characters and spacing evened out. */
export function textKey(text: string): string {
  return 'text:' + text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(-160)
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

async function remember($: EngineInterface, s: State, line: string) {
  const keys = [s.lastRowId, s.lastText ? textKey(s.lastText) : null].filter((k): k is string => Boolean(k))
  s.lastRowId = null
  s.lastText = null
  if (keys.length === 0) return
  // One state write per turn, at its end: rare enough not to disturb other mods' buttons.
  await update($, finished, prev => {
    const next: Finished = { ...(prev ?? {}) }
    for (const key of keys) {
      delete next[key]
      next[key] = line
    }
    const all = Object.keys(next)
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) delete next[old]
    return next
  })
}

export const register: Register = on => {
  const s: State = { lastRowId: null, lastText: null }

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
        s.lastText = text
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await remember($, s, e.isAborted ? `stopped after ${fmtTook(e.durationMs)}` : `took ${fmtTook(e.durationMs)}`)
    return r
  })

  // A rewrite changes the drawing only; the stored reply, and what Claude reads, stay as they were.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const done = (await read($, finished)) ?? {}
    const line = done[e.requestId] ?? done[textKey(e.props.text)]
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
