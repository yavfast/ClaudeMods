import type { CompactionIO } from '../hooks/compaction'
import type { Boundary } from '../hooks/edits'
import { EMPTY_ALIASES, type AliasRegistry } from '../hooks/aliases'
import type { Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'

// [SP_CTX_02_07] A HandleCompaction port over fakes, shared by the
// compaction and alias tests: every write is recorded, in order.
const PNG = 'iVBORw0KGgo='

export function harness(
  queue: Read<Queue>,
  over: Partial<CompactionIO> = {},
  tags: Read<TagRegistry> = { state: 'missing', value: { ...EMPTY_REGISTRY } },
  aliases: Read<AliasRegistry> = { state: 'missing', value: { ...EMPTY_ALIASES, map: {} } },
) {
  const written: {
    queue?: Queue
    media: string[]
    archive?: string
    archiveText?: string
    toasts: string[]
    tags?: TagRegistry
    aliases?: AliasRegistry
    boundary?: Boundary
    pruned?: ReadonlySet<string>
    journal: unknown[]
    reported?: number
    order: string[]
  } = { media: [], toasts: [], journal: [], order: [] }
  const io: CompactionIO = {
    dir: '/s',
    now: () => 1000,
    readQueue: async () => queue,
    writeQueue: async q => {
      written.queue = q
      written.order.push('queue')
    },
    readApi: async () => [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z', content: 'listing' }] },
    ],
    writeMedia: async path => {
      written.media.push(path)
      return true
    },
    writeArchive: async (path, text) => {
      written.archive = path
      written.archiveText = text
      return true
    },
    isAborted: () => false,
    toast: t => void written.toasts.push(t),
    readTags: async () => tags,
    writeTags: async reg => {
      written.tags = reg
      written.order.push('tags')
    },
    readAliases: async () => aliases,
    writeAliases: async reg => {
      written.aliases = reg
      written.order.push('aliases')
    },
    reported: id => void (written.reported = id),
    writeBoundary: async b => {
      written.boundary = b
      written.order.push('boundary')
    },
    pruneDeliveries: done => {
      written.pruned = done
      written.order.push('deliveries')
    },
    journal: entry => {
      written.journal.push(entry)
      written.order.push('journal')
    },
    hostId: () => undefined,
    ...over,
  }
  return { io, written }
}

