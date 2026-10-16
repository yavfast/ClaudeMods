import { STATE_REBUILT } from './rows'

// [SP_CTX_01_29] [SP_CTX_02_67] [SP_CTX_DEC_41] The items of the state slot
// (phase 44): the agent changes them by deltas (the `state` op of
// context_edit), the apply assembles the slot's text from them. Pure; the
// registry holds the items (TagRegistry.items, .nextItem), edits.ts runs the
// op inside PrepareEdits and ApplyEdits.

export type StateKind = 'goal' | 'plan' | 'done' | 'next' | 'lesson'
export const STATE_KINDS: readonly StateKind[] = ['goal', 'plan', 'done', 'next', 'lesson']
const LETTER: Record<StateKind, string> = { goal: 'g', plan: 'p', done: 'd', next: 'n', lesson: 'l' }
const HEADING: Record<StateKind, string> = { goal: 'Goal', plan: 'Plan', done: 'Done', next: 'Next', lesson: 'Lessons' }

export type StateMark = 'harmful' | 'outdated'
const MARKS: readonly string[] = ['harmful', 'outdated']

// [SP_CTX_01_29] `turn`: TagRegistry.turn of the item's last change.
export type StateItem = { id: string; kind: StateKind; text: string; mark?: StateMark; turn: number }

// [SP_CTX_01_30] One change of a state edit, in the order given.
export type StateChange =
  | { do: 'add'; kind: StateKind; text: string }
  | { do: 'set'; id: string; text: string }
  | { do: 'mark'; id: string; as: StateMark }
  | { do: 'unmark'; id: string }
  | { do: 'remove'; id: string }

// [SP_CTX_01_32]
export const MAX_STATE_ITEMS = 40
export const MAX_STATE_ITEM = 500

// [SP_CTX_02_67] Errors (the guidance texts of the spec's table).
export const NO_STATE_SLOT = 'state: no state slot; tag one of your own text rows with context_tag (kind "state") first'
export const NO_ITEM = (id: string) => `state: no item ${id}; items added in this batch get their ids when it applies`
export const TOO_MANY_ITEMS = `state: too many items (max ${MAX_STATE_ITEMS}); remove or merge some`
export const SLOT_TOO_LONG = (max: number) => `state: the assembled slot would be too long (max ${max} chars); shorten or remove items`
export const STATE_ITEMS = 'your state slot is built from items; change it with the state op'
export const STATE_CONFLICT = (other: 'rewrite' | 'state') => `your state slot already has a ${other} edit in this batch; end the turn first`
export const STATE_GONE = 'state: the state slot is gone; items unchanged'
export const NO_ITEM_NOW = (id: string) => `state: no item ${id} now; items unchanged`
export const ITEMS_UNSAVED = (error: string) => `state: the items could not be saved (${error}); your slot shows them, the next state edit starts from the saved ones`

// [SP_CTX_01_29] One line: newlines become spaces.
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

function itemText(value: unknown, at: string): string | { error: string } {
  if (typeof value !== 'string' || !oneLine(value)) return { error: `${at}: text is required` }
  const text = oneLine(value)
  return text.length > MAX_STATE_ITEM ? { error: `${at}: text is too long (max ${MAX_STATE_ITEM} chars)` } : text
}

function itemId(value: unknown, at: string): string | { error: string } {
  return typeof value === 'string' && value ? value : { error: `${at}: id is required` }
}

// [SP_CTX_02_03] [SP_CTX_02_67] BAD_CHANGE: the shape of `changes`; the
// normalized changes (texts on one line) or the reason.
export function checkChanges(raw: unknown): StateChange[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STATE_ITEMS) return `changes must be a list of 1..${MAX_STATE_ITEMS} changes`
  const out: StateChange[] = []
  for (const [n, c] of raw.entries()) {
    const at = `change ${n + 1}`
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return `${at}: must be an object`
    const x = c as Record<string, unknown>
    switch (x.do) {
      case 'add': {
        if (typeof x.kind !== 'string' || !(STATE_KINDS as readonly string[]).includes(x.kind)) return `${at}: kind must be ${STATE_KINDS.map(k => `"${k}"`).join(', ')}`
        const text = itemText(x.text, at)
        if (typeof text !== 'string') return text.error
        out.push({ do: 'add', kind: x.kind as StateKind, text })
        break
      }
      case 'set': {
        const id = itemId(x.id, at)
        if (typeof id !== 'string') return id.error
        const text = itemText(x.text, at)
        if (typeof text !== 'string') return text.error
        out.push({ do: 'set', id, text })
        break
      }
      case 'mark': {
        const id = itemId(x.id, at)
        if (typeof id !== 'string') return id.error
        if (typeof x.as !== 'string' || !MARKS.includes(x.as)) return `${at}: as must be "harmful" or "outdated"`
        out.push({ do: 'mark', id, as: x.as as StateMark })
        break
      }
      case 'unmark':
      case 'remove': {
        const id = itemId(x.id, at)
        if (typeof id !== 'string') return id.error
        out.push({ do: x.do, id })
        break
      }
      default:
        return `${at}: do must be "add", "set", "mark", "unmark" or "remove"`
    }
  }
  return out
}

// [SP_CTX_02_67] A draft item of PrepareEdits: an item added in the batch has
// no id until the apply.
export type DraftItem = { id?: string; kind: StateKind; text: string; mark?: StateMark }

// [SP_CTX_02_67] PrepareEdits: the items once `changes` apply to `items`;
// a change naming an id absent from them gives NO_ITEM, too many items
// TOO_MANY_ITEMS. `lenient`: the batch already queued, whose failures were
// reported when it was queued; a change that no longer fits is skipped.
export function draftChanges(items: readonly DraftItem[], changes: readonly StateChange[], lenient = false): { items: DraftItem[] } | { error: string } {
  const out = items.map(i => ({ ...i }))
  for (const c of changes) {
    if (c.do === 'add') {
      out.push({ kind: c.kind, text: c.text })
      continue
    }
    const k = out.findIndex(i => i.id === c.id)
    if (k < 0) {
      if (lenient) continue
      return { error: NO_ITEM(c.id) }
    }
    if (c.do === 'set') out[k]!.text = c.text
    else if (c.do === 'mark') out[k]!.mark = c.as
    else if (c.do === 'unmark') delete out[k]!.mark
    else out.splice(k, 1)
  }
  return !lenient && out.length > MAX_STATE_ITEMS ? { error: TOO_MANY_ITEMS } : { items: out }
}

// [SP_CTX_02_67] run state: the items once the changes of the batch apply in
// order; each add gets its id from `nextItem`, every item an add, set, mark
// or unmark touches gets `turn`. A change naming an id that is not there:
// `missing`, nothing changes.
export function applyChanges(
  items: readonly StateItem[],
  nextItem: number,
  turn: number,
  changes: readonly StateChange[],
): { items: StateItem[]; nextItem: number } | { missing: string } {
  const out = items.map(i => ({ ...i }))
  let next = nextItem
  for (const c of changes) {
    if (c.do === 'add') {
      out.push({ id: `${LETTER[c.kind]}${next}`, kind: c.kind, text: c.text, turn })
      next += 1
      continue
    }
    const k = out.findIndex(i => i.id === c.id)
    if (k < 0) return { missing: c.id }
    const item = out[k]!
    if (c.do === 'remove') {
      out.splice(k, 1)
      continue
    }
    if (c.do === 'set') item.text = c.text
    else if (c.do === 'mark') item.mark = c.as
    else delete item.mark
    item.turn = turn
  }
  return { items: out, nextItem: next }
}

// [SP_CTX_02_67] Assemble: one block per kind with items, in the order goal,
// plan, done, next, lesson; an item line names its id and its mark.
export function assemble(items: readonly DraftItem[]): string {
  const blocks = STATE_KINDS.flatMap(kind => {
    const of = items.filter(i => i.kind === kind)
    if (!of.length) return []
    return [`${HEADING[kind]}:\n${of.map(i => `- ${i.id ?? `${LETTER[kind]}?`}${i.mark ? ` (${i.mark})` : ''}: ${i.text}`).join('\n')}`]
  })
  return blocks.length ? blocks.join('\n') : '(no items)'
}

// [SP_CTX_02_67] [SP_CTX_03_04] The slot's text after a state edit:
// STATE_REBUILT, the archive line (`note`) and the assembled items.
export function stateText(note: string, items: readonly DraftItem[]): string {
  return `${STATE_REBUILT}${note}:\n${assemble(items)}`
}

// [SP_CTX_01_29] One stored item, by type and constraint.
export function isStateItem(v: unknown): v is StateItem {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const i = v as Record<string, unknown>
  if (typeof i.kind !== 'string' || !(STATE_KINDS as readonly string[]).includes(i.kind)) return false
  return (
    typeof i.id === 'string' &&
    new RegExp(`^${LETTER[i.kind as StateKind]}[1-9][0-9]*$`).test(i.id) &&
    typeof i.text === 'string' &&
    i.text.length > 0 &&
    (i.mark === undefined || (typeof i.mark === 'string' && MARKS.includes(i.mark))) &&
    typeof i.turn === 'number' &&
    Number.isInteger(i.turn) &&
    i.turn >= 0
  )
}

// [SP_CTX_01_29] The number of an item's id (`p3` → 3).
function idNumber(id: string): number {
  return Number(id.slice(1))
}

// [SP_CTX_01_10] [SP_CTX_01_29] The registry's item fields that are wrong,
// for parseRegistry: unique ids below `nextItem`, at most MAX_STATE_ITEMS.
export function badItemFields(items: unknown, nextItem: unknown): string | false {
  if (items === undefined && nextItem === undefined) return false
  const list = items ?? []
  if (!Array.isArray(list) || list.length > MAX_STATE_ITEMS || !list.every(isStateItem)) return 'items'
  const next = nextItem ?? 1
  if (typeof next !== 'number' || !Number.isInteger(next) || next < 1) return 'nextItem'
  const ids = list.map(i => i.id)
  if (new Set(ids).size !== ids.length) return 'items'
  return ids.some(id => idNumber(id) >= next) ? 'nextItem' : false
}
