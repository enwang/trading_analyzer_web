#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_SOURCE = '/Users/welsnake/Desktop/trading_source'
const DEFAULT_INDEX = 'data/rag/index.json'

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm', '.mpg', '.mpeg', '.wmv', '.flv'
])

const TEXT_EXTS = new Set([
  '.srt', '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.html', '.htm', '.pdf', '.docx', '.rtf'
])

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','for','to','from','of','in','on','at','by','with','without','as','is','are','was','were','be','been','being','this','that','these','those','it','its','into','about','over','after','before','during','up','down','out','off','you','your','we','our','they','their','he','she','his','her','them','i','me','my','mine','so','than','too','very','can','could','should','would','will','just','not','no','yes'
])

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE,
    indexFile: DEFAULT_INDEX,
    chunkSize: 1200,
    overlap: 180,
    maxFiles: 0,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = argv[i + 1]
    if ((token === '--source-dir' || token === '-s') && next) { args.sourceDir = next; i++; continue }
    if ((token === '--index-file' || token === '-o') && next) { args.indexFile = next; i++; continue }
    if (token === '--chunk-size' && next) { args.chunkSize = Number(next); i++; continue }
    if (token === '--overlap' && next) { args.overlap = Number(next); i++; continue }
    if (token === '--max-files' && next) { args.maxFiles = Number(next); i++; continue }
    if (token === '--verbose') { args.verbose = true; continue }
    if (token === '--help' || token === '-h') { args.help = true; continue }
  }
  return args
}

function printHelp() {
  console.log(`\nBuild local RAG index from files (videos ignored).\n\nUsage:\n  npm run rag:build -- [options]\n\nOptions:\n  --source-dir, -s <path>   Source folder (recursive). Default: ${DEFAULT_SOURCE}\n  --index-file, -o <path>   Output index file. Default: ${DEFAULT_INDEX}\n  --chunk-size <n>          Chunk size in chars. Default: 1200\n  --overlap <n>             Chunk overlap in chars. Default: 180\n  --max-files <n>           Optional cap for testing. 0 = no cap\n  --verbose                 Print per-file ingest logs\n`)
}

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

async function walk(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

function normalizeText(text) {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function cleanSrt(srt) {
  const lines = srt.split(/\r?\n/)
  const kept = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\d+$/.test(trimmed)) continue
    if (/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,\.]\d{3}$/.test(trimmed)) continue
    kept.push(trimmed)
  }
  return kept.join(' ')
}

function readPdfText(file) {
  const run = spawnSync('pdftotext', ['-q', '-layout', file, '-'], { encoding: 'utf8' })
  if (run.status === 0 && run.stdout) return run.stdout
  // Fallback when pdftotext is unavailable: best-effort plain string extraction.
  const fallback = spawnSync('strings', ['-n', '6', file], { encoding: 'utf8' })
  if (fallback.status === 0 && fallback.stdout) return fallback.stdout
  return ''
}

function readDocxText(file) {
  const run = spawnSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' })
  if (run.status !== 0 || !run.stdout) return ''
  return run.stdout
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase()
  let raw = ''

  if (ext === '.pdf') {
    raw = readPdfText(file)
  } else if (ext === '.docx') {
    raw = readDocxText(file)
  } else {
    const buf = await fs.readFile(file)
    raw = buf.toString('utf8')
  }

  if (!raw) return ''
  if (ext === '.srt') return normalizeText(cleanSrt(raw))
  if (ext === '.html' || ext === '.htm') return normalizeText(stripHtml(raw))
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(raw)
      return normalizeText(JSON.stringify(parsed))
    } catch {
      return normalizeText(raw)
    }
  }
  if (ext === '.rtf') {
    const stripped = raw
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-z]+\d* ?/g, ' ')
      .replace(/[{}]/g, ' ')
    return normalizeText(stripped)
  }
  return normalizeText(raw)
}

function chunkText(text, chunkSize, overlap) {
  const out = []
  if (!text) return out
  const step = Math.max(1, chunkSize - overlap)
  let start = 0
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize)
    const chunk = text.slice(start, end).trim()
    if (chunk) out.push(chunk)
    if (end >= text.length) break
    start += step
  }
  return out
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

function termFreq(tokens) {
  const map = new Map()
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1)
  return map
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const sourceDir = path.resolve(args.sourceDir)
  const indexFile = path.resolve(args.indexFile)

  if (!(await exists(sourceDir))) {
    throw new Error(`Source folder not found: ${sourceDir}`)
  }

  const allFiles = await walk(sourceDir)
  const ingestable = allFiles.filter((file) => {
    const ext = path.extname(file).toLowerCase()
    if (VIDEO_EXTS.has(ext)) return false
    return TEXT_EXTS.has(ext)
  })

  const selected = args.maxFiles > 0 ? ingestable.slice(0, args.maxFiles) : ingestable

  const chunks = []
  const docFreq = new Map()
  const fileStats = []
  const skipped = []

  for (const file of selected) {
    const relPath = path.relative(sourceDir, file)
    try {
      const text = await extractText(file)
      if (!text || text.length < 24) {
        skipped.push({ file: relPath, reason: 'empty_text' })
        continue
      }

      const split = chunkText(text, args.chunkSize, args.overlap)
      if (!split.length) {
        skipped.push({ file: relPath, reason: 'no_chunks' })
        continue
      }
      const metaTokens = tokenize(relPath.replace(/[\/_.-]+/g, ' '))

      for (let i = 0; i < split.length; i++) {
        const chunkTextValue = split[i]
        const id = `${relPath}#${i}`
        const tokens = tokenize(chunkTextValue).concat(metaTokens)
        const tf = termFreq(tokens)

        const unique = new Set(tf.keys())
        for (const term of unique) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
        }

        chunks.push({
          id,
          file: relPath,
          chunkIndex: i,
          text: chunkTextValue,
          tf: Object.fromEntries(tf.entries()),
          length: tokens.length,
        })
      }

      fileStats.push({ file: relPath, chars: text.length, chunks: split.length })
      if (args.verbose) console.log(`ingested: ${relPath} (${split.length} chunks)`)
    } catch (e) {
      skipped.push({ file: relPath, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  const index = {
    builtAt: new Date().toISOString(),
    sourceDir,
    params: {
      chunkSize: args.chunkSize,
      overlap: args.overlap,
      totalFilesScanned: allFiles.length,
      ingestableFiles: ingestable.length,
      indexedFiles: fileStats.length,
      skippedFiles: skipped.length,
      chunks: chunks.length,
      terms: docFreq.size,
    },
    docFreq: Object.fromEntries(docFreq.entries()),
    chunks,
    fileStats,
    skipped,
  }

  await fs.mkdir(path.dirname(indexFile), { recursive: true })
  await fs.writeFile(indexFile, JSON.stringify(index), 'utf8')

  console.log(`RAG index built: ${indexFile}`)
  console.log(`Indexed files: ${fileStats.length}/${ingestable.length}`)
  console.log(`Chunks: ${chunks.length}, Terms: ${docFreq.size}`)
  if (skipped.length) {
    console.log(`Skipped files: ${skipped.length} (see index.skipped)`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
