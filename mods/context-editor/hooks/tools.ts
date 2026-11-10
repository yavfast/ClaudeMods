// [SP_CTX_02_01] [SP_CTX_02_02] [SP_CTX_02_11] [SP_CTX_02_19] [SP_CTX_02_32]
// The static metadata of the mod's tools and its command: names,
// descriptions and JSON schemas. The limits they name come from the
// constants that enforce them. Pure data; register.ts registers it (audit
// PL_AUD_CTX, CF-20).
import { LIST_COUNT, MAX_FULL_ROW, MAX_LIST_COUNT, MAX_QUEUE_EDITS, MAX_TEXT, ROW_WINDOW } from './edits'
import { MAX_NOTE, MAX_NOTES, MAX_REMIND } from './notes'
import { DEFAULT_RESUME, MAX_DOCUMENT } from './queue'
import { MARK } from './rows'
import { MAX_STAGE_NAME, SKILL } from './stages'
import { MAX_STATE_ITEM, MAX_STATE_ITEMS, STATE_KINDS } from './state'
import { MAX_TAGS } from './tags'
import { MAX_TITLE } from './title'

export const PLUGIN = 'context-editor'
export const LIST = 'context_list'
export const EDIT = 'context_edit'
export const TAG = 'context_tag'
export const HANDOFF = 'context_handoff'
export const NOTE = 'context_note'

// [SP_CTX_02_01] At most MAX_DESCRIPTION chars (the host cuts the rest).
export const LIST_DESCRIPTION = `List this conversation's rows OLDEST FIRST, a page at a time: indexes, sizes, tool_use ids (with their call alias, e.g. (c3)), media, flags (* already edited, ! large, @ has media; ~ after tool_use/tool_result: a reproducible Read, Grep or Glob pair), stage marks ([stage ▶ name] the first row of the open stage; [block ▶ name] .. [block end] the last closed block), tags ([pin], [state], [disposable: note], [disposable #a..#b: note] on a range's first row, [review: reason]; a bare [review] is from an older version) and your notes ([n3]; a range [n3 #a..#b]), whose full text comes in a "Notes:" block below the page ("Notes elsewhere" names those on other rows). Indexes are positions in this listing: call it right before ${EDIT}, ${TAG} or ${NOTE} by index.

The header gives one size, the conversation in tokens from the telemetry (else a calibrated estimate), then context telemetry: the size without the fixed part (system prompt, tools, skills, memory), the window, the open stage and the last closed block ("Last block #a..#b") with their sizes, the cleanup candidates by reason with their rows, and, when there is something to show, the effect of applications and your state slot. Row sizes stay in chars. "count":0 gives that header alone, without rows; it does not renew the indexes. {"index":12,"full":true} shows row #12 whole (e.g. to check a summary before reading the archive). Only the latest ${ROW_WINDOW} rows are visible. {"rules":true} gives the curation rules.`

const LIST_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'integer', description: 'Index of the first row to list (default 0, the oldest).' },
    count: { type: 'integer', description: `How many rows to list (default ${LIST_COUNT}, at most ${MAX_LIST_COUNT}); 0 gives the header with the context telemetry alone.` },
    index: { type: 'integer', description: 'With "full": true, the row to show whole.' },
    full: {
      type: 'boolean',
      description: `Show the row "index" whole (up to ${MAX_FULL_ROW} chars), e.g. to check a summary before reading an archive; from and count are ignored.`,
    },
    rules: {
      type: 'boolean',
      description: 'true: return the curation rules (lessons from failures, corrections, quoting, the state op, host rows) in place of the listing; takes no other parameter.',
    },
  },
}

// [SP_CTX_02_02] At most MAX_DESCRIPTION chars, by the priorities of the spec.
export const EDIT_DESCRIPTION = `Edit your own earlier context to free space: replace tool outputs you have processed (screenshots and documents too), dead-end steps and wrong conclusions with summaries.

Edits apply when your turn ends: after this call, end your turn with a one-line status. The session then resumes by itself with "resume_prompt" unless "resume" is false; in a /compact turn only on "resume": true or "resume_prompt".

Ops (items of "edits"; every field shown is required):
- {"op":"summarize","tool_use_id" or "ref","summary"}: replace one tool result, with any image or document in it, by your summary of what mattered (describe the media too). Parallel calls sharing a result row: summarize those with media in one batch.
- {"op":"drop","tool_use_id", "ref" or "host"}: remove a useless call and its result, or a host row.
- {"op":"collapse","from_index","to_index","summary"}: replace rows from_index..to_index (from ${LIST}) with one summary; the range must hold every tool call together with its result.
- {"op":"rewrite","index","text"}: replace the text of one of your assistant text rows (no tool calls in it).
- {"op":"describe","index","description"}: replace the image, document or pasted text in a prompt row of the person (@ in ${LIST}) by your description; the text the person typed stays.
- {"op":"state","changes"}: change the items of your state slot; the apply rebuilds the slot's text from them.

A [pin] target cannot be edited; remove the pin with ${TAG} first. A row tagged [state] changes only by a rewrite, or by the state op once it has items.

Originals are archived (original: <path> in the replacement); Read it to get one back. Summaries keep every fact, number, URL and source you still need.

Compress a finished stage's block into a stage record. The person's messages (AskUserQuestion answers too) stay verbatim: edits that cover them are refused. Usually keep the rules and skills in force verbatim. Batch edits in one call (see "keep_cache"). Record template and guide: skill ${PLUGIN}:${SKILL}.`

// [SP_CTX_01_02] [SP_CTX_02_17] A call alias; exactly one of it and tool_use_id.
// [SP_CTX_02_69] the paragraph about refs lives here, not in EDIT_DESCRIPTION
const REF = {
  type: 'string',
  description: `Instead of tool_use_id: a call alias "cN" from the "${MARK} id cN" line after a call's result, or "last" for your latest call (context_* calls do not count); no ${LIST} needed.`,
}

// [SP_CTX_01_30] [SP_CTX_02_61] A host row by its id; the details live here,
// not in EDIT_DESCRIPTION ([SP_CTX_02_69]).
const HOST = {
  type: 'string',
  description: `Instead of tool_use_id or ref: the id of a host row (an expanded skill, a subagent's report) from the "Host rows" list of ${LIST}. The row before it comes back without its handle.`,
}

// [SP_CTX_01_30] [SP_CTX_02_67] The changes of a state edit; the details
// live here, not in EDIT_DESCRIPTION ([SP_CTX_02_69]).
const CHANGES = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_STATE_ITEMS,
  description: `Changes of your state slot's items, in order. An item's id (p3) is in the slot's text; an item added in this batch gets its id when the batch applies. Text: one line, at most ${MAX_STATE_ITEM} chars; at most ${MAX_STATE_ITEMS} items. Mark an item that proved harmful or outdated rather than removing it.`,
  items: {
    oneOf: [
      { type: 'object', properties: { do: { const: 'add' }, kind: { enum: [...STATE_KINDS] }, text: { type: 'string' } }, required: ['do', 'kind', 'text'] },
      { type: 'object', properties: { do: { const: 'set' }, id: { type: 'string' }, text: { type: 'string' } }, required: ['do', 'id', 'text'] },
      { type: 'object', properties: { do: { const: 'mark' }, id: { type: 'string' }, as: { enum: ['harmful', 'outdated'] } }, required: ['do', 'id', 'as'] },
      { type: 'object', properties: { do: { enum: ['unmark', 'remove'] }, id: { type: 'string' } }, required: ['do', 'id'] },
    ],
  },
}

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_QUEUE_EDITS,
      items: {
        oneOf: [
          { type: 'object', properties: { op: { const: 'summarize' }, tool_use_id: { type: 'string' }, summary: { type: 'string' } }, required: ['op', 'tool_use_id', 'summary'] },
          { type: 'object', properties: { op: { const: 'summarize' }, ref: REF, summary: { type: 'string' } }, required: ['op', 'ref', 'summary'] },
          { type: 'object', properties: { op: { const: 'drop' }, tool_use_id: { type: 'string' } }, required: ['op', 'tool_use_id'] },
          { type: 'object', properties: { op: { const: 'drop' }, ref: REF }, required: ['op', 'ref'] },
          { type: 'object', properties: { op: { const: 'drop' }, host: HOST }, required: ['op', 'host'] },
          { type: 'object', properties: { op: { const: 'collapse' }, from_index: { type: 'integer' }, to_index: { type: 'integer' }, summary: { type: 'string' } }, required: ['op', 'from_index', 'to_index', 'summary'] },
          { type: 'object', properties: { op: { const: 'rewrite' }, index: { type: 'integer' }, text: { type: 'string' } }, required: ['op', 'index', 'text'] },
          { type: 'object', properties: { op: { const: 'describe' }, index: { type: 'integer' }, description: { type: 'string' } }, required: ['op', 'index', 'description'] },
          { type: 'object', properties: { op: { const: 'state' }, changes: CHANGES }, required: ['op', 'changes'] },
        ],
      },
    },
    resume: { type: 'boolean', description: 'Resume the session after this batch applies (default true).' },
    resume_prompt: { type: 'string', description: `What the resumed turn is told (default: "${DEFAULT_RESUME}"); a non-empty one also resumes the batch, unless this call passes "resume": false.` },
    keep_cache: {
      type: 'boolean',
      description:
        'Keep the prompt cache up to the first edit (default false): cheaper when the earliest edit is within your last few calls and you end the turn soon.',
    },
  },
  required: ['edits'],
}

// [SP_CTX_02_11] At most MAX_DESCRIPTION chars, by the priorities of the spec.
export const TAG_DESCRIPTION = `Tag rows and tool calls of this conversation and mark the stages of your work, at no token cost: tags and stages live outside the conversation and show in ${LIST}. Call it with {"tags":[...]}; the requests apply in order.

Targets of add and remove: exactly one of "tool_use_id" (a tool call with its result), "ref" (a call alias "cN" or "last") or "index" (a row in ${LIST}); a disposable range: "index" and "to", its last row.

Stages: {"op":"open","stage":"<name>"} at the start of a logical stage; its block starts with the response that opens it, or at "index" if given. {"op":"close"} when the stage is done: the result names the block's rows #a..#b, its size, candidates, telemetry and advice; then compress what is processed there with ONE ${EDIT}. Opening a stage closes the open one first. To close a block you did not open, give open with the "index" of its first row and close in one call.

Title: {"op":"title","text":"<topic>"} when the task's topic changes; the session is renamed after the turn unless the person named it.

Kinds (op "add"):
- "pin": nothing may edit the target, not even a disposable tag's replacement. Pins are yours to set and remove.
- "disposable" + "note": once you close a stage or move on from a block you marked, your note replaces the target (a result summarized, your text row rewritten, a range collapsed); the original is archived. Write in the note every fact you still need. By index alone only your own assistant text rows.
- "review" (optional "ttl_turns"): a marker for yourself, shown after ttl_turns completed turns. Automatic ones carry a reason: big, search, stale (you changed the file since), superseded (a later read showed changed content), duplicate.
- "state": your one state slot, an assistant text row by "index"; change it by a rewrite of that row, or by the state op of ${EDIT} once it has items, never append a new one. A new state tag moves the slot.

A new tag on a target replaces the old one; "remove" drops it. Guide: skill ${PLUGIN}:${SKILL}.`

const TAG_TARGET = {
  tool_use_id: { type: 'string', description: 'Target: a tool call and its result.' },
  ref: { type: 'string', description: `Target: a tool call by its alias "cN" (from a "${MARK} id cN" line) or "last", your latest call (context_* calls do not count).` },
  index: { type: 'integer', description: `Target: a row index from ${LIST}.` },
}

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TAGS,
      items: {
        oneOf: [
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'pin' }, ...TAG_TARGET }, required: ['op', 'kind'] },
          {
            type: 'object',
            properties: {
              op: { const: 'add' },
              kind: { const: 'disposable' },
              ...TAG_TARGET,
              to: { type: 'integer', description: 'With "index": the last row of a range, included; the range holds every tool call with its result.' },
              note: { type: 'string', maxLength: MAX_TEXT },
            },
            required: ['op', 'kind', 'note'],
          },
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'review' }, ...TAG_TARGET, ttl_turns: { type: 'integer', minimum: 1 } }, required: ['op', 'kind'] },
          {
            type: 'object',
            properties: { op: { const: 'add' }, kind: { const: 'state' }, index: { type: 'integer', description: `Your assistant text row from ${LIST} that holds the state.` } },
            required: ['op', 'kind', 'index'],
          },
          { type: 'object', properties: { op: { const: 'remove' }, ...TAG_TARGET }, required: ['op'] },
          {
            type: 'object',
            properties: {
              op: { const: 'open' },
              stage: { type: 'string', maxLength: MAX_STAGE_NAME, description: 'The name of the stage.' },
              index: { type: 'integer', description: `The first row of its block, from ${LIST}; default: the response that opens it.` },
            },
            required: ['op', 'stage'],
          },
          { type: 'object', properties: { op: { const: 'close' } }, required: ['op'] },
          {
            type: 'object',
            properties: { op: { const: 'title' }, text: { type: 'string', maxLength: MAX_TITLE, description: 'The session title: the topic of the task, one line.' } },
            required: ['op', 'text'],
          },
        ],
      },
    },
  },
  required: ['tags'],
}

// [SP_CTX_02_32] At most MAX_DESCRIPTION chars.
export const NOTE_DESCRIPTION = `Add and remove your own service notes on rows, row ranges and tool calls of this conversation, at no token cost: notes live outside the conversation and change or protect nothing; a target may have several. Call it with {"notes":[...]}; the requests apply in order.

Add: {"op":"add","text":"..."} with a target as in ${TAG} (exactly one of "tool_use_id", "ref" or "index"; a range: "index" and "to"), and optionally "remind_in_turns": N for one reminder after N completed turns, delivered with the result of your next tool call (any tool but ${EDIT} and ${HANDOFF}). Remove: {"op":"remove","id":"n3"}.

Notes show in ${LIST} ([n3] on their rows, the full text below the page) and in the result of a stage close. A note moves to the row that replaced its row and goes with a removed row. Use them to mark what to drop or compress later and how, to remind yourself to come back to an output, or to link rows.`

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_NOTES,
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              op: { const: 'add' },
              text: { type: 'string', maxLength: MAX_NOTE, description: 'The note.' },
              ...TAG_TARGET,
              to: { type: 'integer', description: 'With "index": the last row of a range, included.' },
              remind_in_turns: { type: 'integer', minimum: 1, maximum: MAX_REMIND, description: 'One reminder after this many completed turns.' },
            },
            required: ['op', 'text'],
          },
          { type: 'object', properties: { op: { const: 'remove' }, id: { type: 'string', description: 'The id of the note, e.g. "n3".' } }, required: ['op', 'id'] },
        ],
      },
    },
  },
  required: ['notes'],
}

// [SP_CTX_02_19]
export const HANDOFF_DESCRIPTION = `Move this conversation into a new session and continue there, so a cleaned context survives --resume.

mode "transcript" (default): this session is cleared and the new one is seeded with the conversation as you see it now, with the edits you queued with ${EDIT} applied, tool calls and results kept; images and documents come along as files named in their results (open them with Read). On any failure the "document" way is used.
mode "document": the new session starts from "document", your handoff text (the person's task and constraints verbatim, decisions in force, facts, numbers, paths, open questions, the next step), sent as its first prompt; without it the mod asks the model for one. Give "document" with "transcript" too, as the fallback.

It runs when your turn ends: after this call, end your turn at once with a one-line status. Unless "resume" is false, the new session goes on with "resume_prompt" (default: "${DEFAULT_RESUME}").`

const HANDOFF_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['transcript', 'document'], description: 'How to build the new session (default "transcript").' },
    document: { type: 'string', maxLength: MAX_DOCUMENT, description: 'Your handoff document: the start of a "document" session, the fallback of a "transcript" one.' },
    resume: { type: 'boolean', description: 'Continue in the new session at once (default true).' },
    resume_prompt: { type: 'string', maxLength: MAX_TEXT, description: 'What the new session is told to continue with.' },
  },
}

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown>; isDeferred: false }

// The tools in the order the session start registers them.
export const TOOLS: readonly ToolSpec[] = [
  { name: LIST, description: LIST_DESCRIPTION, inputSchema: LIST_SCHEMA, isDeferred: false },
  { name: EDIT, description: EDIT_DESCRIPTION, inputSchema: EDIT_SCHEMA, isDeferred: false },
  { name: TAG, description: TAG_DESCRIPTION, inputSchema: TAG_SCHEMA, isDeferred: false },
  { name: HANDOFF, description: HANDOFF_DESCRIPTION, inputSchema: HANDOFF_SCHEMA, isDeferred: false },
  { name: NOTE, description: NOTE_DESCRIPTION, inputSchema: NOTE_SCHEMA, isDeferred: false },
]

// [SP_CTX_02_20] The person's command.
export const HANDOFF_COMMAND = {
  name: 'handoff',
  description: 'Move this conversation into a new session: cleaned transcript, or a handoff document',
  argumentHint: '[document|cancel]',
}
