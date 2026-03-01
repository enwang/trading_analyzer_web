#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_INDEX = 'data/rag/index.json'
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','for','to','from','of','in','on','at','by','with','without','as','is','are','was','were','be','been','being','this','that','these','those','it','its','into','about','over','after','before','during','up','down','out','off','you','your','we','our','they','their','he','she','his','her','them','i','me','my','mine','so','than','too','very','can','could','should','would','will','just','not','no','yes'
])

function parseArgs(argv) {
  const args = {
    indexFile: DEFAULT_INDEX,
    topK: 8,
    query: '',
    json: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = argv[i + 1]
    if ((token === '--index-file' || token === '-i') && next) { args.indexFile = next; i++; continue }
    if ((token === '--top-k' || token === '-k') && next) { args.topK = Number(next); i++; continue }
    if ((token === '--query' || token === '-q') && next) { args.query = next; i++; continue }
    if (token === '--json') { args.json = true; continue }
    if (token === '--help' || token === '-h') { args.help = true; continue }
  }

  if (!args.query) {
    const positional = argv.filter((x) => !x.startsWith('-'))
    if (positional.length) args.query = positional.join(' ')
  }

  return args
}

function printHelp() {
  console.log(`\nQuery local RAG index\n\nUsage:\n  npm run rag:query -- --query "your question"\n\nOptions:\n  --index-file, -i <path>  Index JSON file. Default: ${DEFAULT_INDEX}\n  --top-k, -k <n>          Number of results. Default: 8\n  --query, -q <text>       Query text\n  --json                   Print raw JSON output\n`)
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

function scoreChunk(chunk, queryTerms, docFreq, totalDocs) {
  let score = 0
  const tfMap = chunk.tf || {}
  for (const term of queryTerms) {
    const tf = Number(tfMap[term] ?? 0)
    if (!tf) continue
    const df = Number(docFreq[term] ?? 0)
    const idf = Math.log(1 + (totalDocs + 1) / (df + 1))
    score += (1 + Math.log(tf)) * idf
  }
  return score
}

function highlightSnippet(text, terms) {
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (pos === -1 || i < pos)) pos = i
  }
  if (pos < 0) return text.slice(0, 240)
  const start = Math.max(0, pos - 80)
  const end = Math.min(text.length, pos + 180)
  return text.slice(start, end)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.query) {
    printHelp()
    return
  }

  const indexFile = path.resolve(args.indexFile)
  const raw = await fs.readFile(indexFile, 'utf8')
  const index = JSON.parse(raw)

  const queryTerms = tokenize(args.query)
  if (!queryTerms.length) {
    throw new Error('Query has no searchable terms after normalization.')
  }

  const totalDocs = Number(index?.params?.chunks ?? index?.chunks?.length ?? 0)
  const docFreq = index.docFreq ?? {}
  const chunks = Array.isArray(index.chunks) ? index.chunks : []

  const scored = []
  for (const chunk of chunks) {
    const score = scoreChunk(chunk, queryTerms, docFreq, totalDocs)
    if (score > 0) {
      scored.push({
        score,
        file: chunk.file,
        chunkIndex: chunk.chunkIndex,
        snippet: highlightSnippet(chunk.text || '', queryTerms),
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, Math.max(1, args.topK))

  if (args.json) {
    console.log(JSON.stringify({ query: args.query, terms: queryTerms, results: top }, null, 2))
    return
  }

  console.log(`Query: ${args.query}`)
  console.log(`Terms: ${queryTerms.join(', ')}`)
  console.log(`Results: ${top.length}`)
  console.log('')

  if (!top.length) {
    console.log('No matches found.')
    return
  }

  for (let i = 0; i < top.length; i++) {
    const r = top[i]
    console.log(`${i + 1}. [${r.file}#${r.chunkIndex}] score=${r.score.toFixed(3)}`)
    console.log(`   ${r.snippet.replace(/\s+/g, ' ').trim()}`)
    console.log('')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
