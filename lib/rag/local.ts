import fs from 'node:fs/promises'
import path from 'node:path'

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','for','to','from','of','in','on','at','by','with','without','as','is','are','was','were','be','been','being','this','that','these','those','it','its','into','about','over','after','before','during','up','down','out','off','you','your','we','our','they','their','he','she','his','her','them','i','me','my','mine','so','than','too','very','can','could','should','would','will','just','not','no','yes'
])

export interface RagChunk {
  id: string
  file: string
  chunkIndex: number
  text: string
  tf: Record<string, number>
}

interface RagIndex {
  builtAt?: string
  sourceDir?: string
  params?: {
    chunks?: number
  }
  docFreq: Record<string, number>
  chunks: RagChunk[]
}

export interface RagQueryResult {
  file: string
  chunkIndex: number
  score: number
  snippet: string
  text: string
}

type SourcePreference = 'jlaw' | 'oliverkell' | 'none'

interface QueryOptions {
  sourcePreference?: SourcePreference
}

let cache: { file: string; mtimeMs: number; index: RagIndex } | null = null

export function tokenizeForRag(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

function scoreChunk(
  chunk: RagChunk,
  queryTerms: string[],
  docFreq: Record<string, number>,
  totalDocs: number
) {
  let score = 0
  for (const term of queryTerms) {
    const tf = Number(chunk.tf?.[term] ?? 0)
    if (!tf) continue
    const df = Number(docFreq?.[term] ?? 0)
    const idf = Math.log(1 + (totalDocs + 1) / (df + 1))
    score += (1 + Math.log(tf)) * idf
  }
  return score
}

function snippet(text: string, terms: string[]) {
  const lower = text.toLowerCase()
  let pos = -1
  for (const term of terms) {
    const idx = lower.indexOf(term)
    if (idx >= 0 && (pos === -1 || idx < pos)) pos = idx
  }
  if (pos < 0) return text.slice(0, 320)
  const start = Math.max(0, pos - 100)
  const end = Math.min(text.length, pos + 240)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

export async function loadLocalRagIndex(indexFile = path.resolve(process.cwd(), 'data/rag/index.json')) {
  const stat = await fs.stat(indexFile)
  if (cache && cache.file === indexFile && cache.mtimeMs === stat.mtimeMs) {
    return cache.index
  }

  const raw = await fs.readFile(indexFile, 'utf8')
  const parsed = JSON.parse(raw) as RagIndex
  cache = { file: indexFile, mtimeMs: stat.mtimeMs, index: parsed }
  return parsed
}

function sourceWeight(file: string, preference: SourcePreference) {
  if (preference === 'none') return 1

  const f = file.toLowerCase()
  const isJlaw = f.includes('jlaw')
  const isOliver = f.includes('oliverkell') || f.includes('oliver')

  if (preference === 'jlaw') {
    if (isJlaw) return 1.45
    if (isOliver) return 0.78
    return 1
  }

  if (preference === 'oliverkell') {
    if (isOliver) return 1.45
    if (isJlaw) return 0.78
    return 1
  }

  return 1
}

export function queryLocalRag(index: RagIndex, query: string, topK = 6, options: QueryOptions = {}): RagQueryResult[] {
  const terms = tokenizeForRag(query)
  if (!terms.length) return []

  const chunks = Array.isArray(index.chunks) ? index.chunks : []
  const docFreq = index.docFreq ?? {}
  const totalDocs = Number(index.params?.chunks ?? chunks.length)
  const preference = options.sourcePreference ?? 'none'

  const out: RagQueryResult[] = []
  for (const chunk of chunks) {
    const rawScore = scoreChunk(chunk, terms, docFreq, totalDocs)
    const score = rawScore * sourceWeight(chunk.file, preference)
    if (score <= 0) continue
    out.push({
      file: chunk.file,
      chunkIndex: chunk.chunkIndex,
      score,
      snippet: snippet(chunk.text ?? '', terms),
      text: chunk.text ?? '',
    })
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, Math.max(1, topK))
}
