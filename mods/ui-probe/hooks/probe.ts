import type { EngineInterface, Register } from 'claude-code'

// Every channel a plugin has to show a person a line without the model seeing it.
const CHANNELS = ['log', 'toast', 'status', 'notify', 'notice'] as const
type Channel = (typeof CHANNELS)[number]

const TOOL = {
  name: 'ui_probe',
  description:
    'Test the plugin notification channels: shows one numbered line through each chosen channel ($.ui.log, toast, status, notify, notice) and reports which calls the host accepted. The person tells which ones they saw.',
  inputSchema: {
    type: 'object',
    properties: {
      channels: { type: 'array', items: { type: 'string', enum: [...CHANNELS] }, description: 'Channels to try (default: all).' },
      delay_ms: { type: 'integer', description: 'Show the lines this many ms later, from a timer, e.g. after the turn ended (default 0: right away).' },
      text: { type: 'string', description: 'Text to show (default: "ui-probe test").' },
    },
  },
  isDeferred: false,
}

const COMMAND = {
  name: 'ui-probe',
  description: 'Show a test line through every plugin notification channel',
  argumentHint: '[text]',
}

let runs = 0

function pickChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return [...CHANNELS]
  const picked = CHANNELS.filter(c => raw.includes(c))
  return picked.length ? picked : [...CHANNELS]
}

// Shows `label` through each channel; returns what each call did. `notice`
// needs an open tool call, so it runs only when `callId` is given.
async function probe($: EngineInterface, channels: Channel[], label: string, callId?: string): Promise<string[]> {
  const out: string[] = []
  for (const c of channels) {
    try {
      if (c === 'log') $.ui.log(`${label} [log]`)
      else if (c === 'toast') $.ui.toast(`${label} [toast]`, { timeoutMs: 15000 })
      else if (c === 'status') $.ui.status(`${label} [status]`)
      else if (c === 'notice') {
        if (!callId) {
          out.push('notice: skipped (no open tool call)')
          continue
        }
        $.ui.notice(callId, `${label} [notice]`)
      } else {
        const r = await $.ui.notify(`${label} [notify]`, { title: 'ui-probe' })
        out.push(`notify: ${r.isSent ? `sent via ${r.channel}` : `not sent (${r.reason})`}`)
        continue
      }
      out.push(`${c}: called`)
    } catch (err) {
      out.push(`${c}: threw ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register(TOOL)
    await $.command.register(COMMAND)
    return next(e)
  })

  on('tool.call', { tool: /^mcp__ui-probe__ui_probe$/ }, async ($, e) => {
    const args = e as unknown as { channels?: unknown; delay_ms?: unknown; text?: unknown }
    const n = ++runs
    const label = `ui-probe #${n}: ${typeof args.text === 'string' && args.text ? args.text : 'ui-probe test'}`
    const channels = pickChannels(args.channels)
    const delay = typeof args.delay_ms === 'number' && args.delay_ms > 0 ? Math.min(args.delay_ms, 120000) : 0
    if (delay) {
      $.clock.after(delay, () => {
        void probe($, channels, label).then(lines => $.ui.log(`ui-probe #${n} (delayed): ${lines.join('; ')}`, { to: 'debug' }))
      })
      return { result: `${label}: planned in ${delay} ms through ${channels.join(', ')}. Ask the person which lines they saw.` }
    }
    const lines = await probe($, channels, label, e.tool_use_id)
    return { result: `${label}\n${lines.join('\n')}\nAsk the person which of these lines they saw, and where.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `ui_probe failed: ${next.error.kind}` }))

  on('command.run', { command: 'ui-probe' }, async ($, e) => {
    const n = ++runs
    const label = `ui-probe #${n}: ${e.args?.trim() || 'ui-probe test'}`
    const lines = await probe($, [...CHANNELS], label)
    return { text: `${label}\n${lines.join('\n')}` }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `ui-probe failed: ${next.error.kind}` }))
}
