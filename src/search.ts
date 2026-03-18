import { readFileSync, writeFileSync } from 'node:fs'
import { create, insertMultiple, remove, search } from '@orama/orama'
import type { AnyOrama, Results } from '@orama/orama'
import type { EntryRecord } from './db.ts'

type SearchDoc = {
  id: string
  question: string
  answer: string
  tags: string
}

type PersistedIndex = {
  version: 1
  docs: SearchDoc[]
}

async function makeIndex(): Promise<AnyOrama> {
  return create({
    schema: {
      id: 'string',
      question: 'string',
      answer: 'string',
      tags: 'string',
    },
  })
}

function toDoc(entry: EntryRecord): SearchDoc {
  return {
    id: String(entry.id),
    question: entry.question,
    answer: entry.answer,
    tags: entry.tags.join(' '),
  }
}

export class KBSearch {
  private readonly path: string
  private indexPromise: Promise<AnyOrama>
  private docMap = new Map<string, SearchDoc>()

  constructor(path: string) {
    this.path = path
    this.indexPromise = this.load()
  }

  async ensureSynced(entries: EntryRecord[]): Promise<void> {
    await this.indexPromise
    if (entries.length !== this.docMap.size) {
      await this.rebuild(entries)
      return
    }
    for (const entry of entries) {
      if (!this.docMap.has(String(entry.id))) {
        await this.rebuild(entries)
        return
      }
    }
  }

  async rebuild(entries: EntryRecord[]): Promise<void> {
    this.docMap = new Map(entries.map((entry) => {
      const doc = toDoc(entry)
      return [doc.id, doc]
    }))
    this.indexPromise = this.createFromDocs([...this.docMap.values()])
    await this.indexPromise
    this.persist()
  }

  async upsert(entry: EntryRecord): Promise<void> {
    const index = await this.indexPromise
    const id = String(entry.id)
    if (this.docMap.has(id)) {
      await remove(index, id)
    }
    const doc = toDoc(entry)
    this.docMap.set(id, doc)
    await insertMultiple(index, [doc])
    this.persist()
  }

  async remove(id: number): Promise<void> {
    const index = await this.indexPromise
    const key = String(id)
    if (!this.docMap.has(key)) return
    await remove(index, key)
    this.docMap.delete(key)
    this.persist()
  }

  async searchIds(term: string): Promise<number[]> {
    const index = await this.indexPromise
    const result = await search(index, {
      term,
      properties: ['question', 'answer', 'tags'],
      limit: 20,
      tolerance: 2,
      boost: {
        question: 2,
        tags: 1.5,
      },
    }) as Results<SearchDoc>

    return result.hits.map((hit) => Number(hit.document.id))
  }

  private async load(): Promise<AnyOrama> {
    try {
      const raw = readFileSync(this.path, 'utf8')
      const data = JSON.parse(raw) as PersistedIndex
      if (data.version !== 1 || !Array.isArray(data.docs)) throw new Error('bad index')
      this.docMap = new Map(data.docs.map((doc) => [doc.id, doc]))
      return this.createFromDocs(data.docs)
    } catch {
      this.docMap = new Map()
      return makeIndex()
    }
  }

  private async createFromDocs(docs: SearchDoc[]): Promise<AnyOrama> {
    const index = await makeIndex()
    if (docs.length > 0) {
      await insertMultiple(index, docs)
    }
    return index
  }

  private persist(): void {
    const payload: PersistedIndex = {
      version: 1,
      docs: [...this.docMap.values()],
    }
    writeFileSync(this.path, JSON.stringify(payload, null, 2))
  }
}
