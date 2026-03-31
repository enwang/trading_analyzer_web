import fs from 'node:fs/promises'
import path from 'node:path'

// Vercel and other serverless runtimes have a read-only filesystem except for /tmp.
const CACHE_FILE = process.env.VERCEL
  ? '/tmp/analysis-cache.json'
  : path.resolve(process.cwd(), 'data/rag/analysis-cache.json')

type CacheEntry = {
  key: string
  updatedAt: string
  value: Record<string, unknown>
}

type CacheStore = {
  entries: Record<string, CacheEntry>
}

async function loadStore(): Promise<CacheStore> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as CacheStore
    if (!parsed.entries || typeof parsed.entries !== 'object') return { entries: {} }
    return parsed
  } catch {
    return { entries: {} }
  }
}

async function saveStore(store: CacheStore) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
  await fs.writeFile(CACHE_FILE, JSON.stringify(store), 'utf8')
}

export function simpleHash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export async function getCachedAnalysis<T = Record<string, unknown>>(cacheKey: string) {
  const store = await loadStore()
  return (store.entries[cacheKey]?.value as T | undefined) ?? null
}

export async function setCachedAnalysis<T extends Record<string, unknown>>(
  cacheKey: string,
  value: T
) {
  const store = await loadStore()
  store.entries[cacheKey] = {
    key: cacheKey,
    updatedAt: new Date().toISOString(),
    value,
  }

  // Keep cache bounded to avoid unbounded file growth.
  const keys = Object.keys(store.entries)
  if (keys.length > 500) {
    const sorted = Object.values(store.entries).sort((a, b) => {
      return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0
    })
    const removeCount = keys.length - 500
    for (let i = 0; i < removeCount; i++) {
      delete store.entries[sorted[i].key]
    }
  }

  await saveStore(store)
}
