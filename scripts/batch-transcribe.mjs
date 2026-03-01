#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.m4v',
  '.webm',
  '.mpg',
  '.mpeg',
  '.wmv',
])

function parseArgs(argv) {
  const args = {
    inputDir: '/Users/welsnake/Desktop/trading_source',
    outputDir: '',
    backend: 'smartsub',
    smartsubCmd: process.env.SMARTSUB_CMD ?? '',
    whisperCmd: process.env.WHISPER_CMD ?? 'whisper',
    force: false,
    dryRun: false,
    reportFile: '',
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--input-dir' && next) { args.inputDir = next; i++; continue }
    if (token === '--output-dir' && next) { args.outputDir = next; i++; continue }
    if (token === '--backend' && next) { args.backend = next; i++; continue }
    if (token === '--smartsub-cmd' && next) { args.smartsubCmd = next; i++; continue }
    if (token === '--whisper-cmd' && next) { args.whisperCmd = next; i++; continue }
    if (token === '--report-file' && next) { args.reportFile = next; i++; continue }
    if (token === '--force') { args.force = true; continue }
    if (token === '--dry-run') { args.dryRun = true; continue }
    if (token === '--help' || token === '-h') { args.help = true; continue }
  }

  return args
}

function printHelp() {
  console.log(`
Batch transcription runner

Usage:
  npm run rag:transcribe -- [options]

Options:
  --input-dir <path>     Source folder (recursive). Default: /Users/welsnake/Desktop/trading_source
  --output-dir <path>    Output folder for .srt. Default: <input-dir>/transcripts
  --backend <name>       smartsub | whisper. Default: smartsub
  --smartsub-cmd <tmpl>  Command template for SmartSub mode.
                         Placeholders: {input} {output} {outputDir} {baseName}
  --whisper-cmd <cmd>    Whisper CLI command. Default: whisper
  --report-file <path>   Optional JSON report path
  --force                Re-transcribe even if .srt already exists
  --dry-run              Print planned actions only

Examples:
  npm run rag:transcribe -- --backend smartsub --smartsub-cmd "smartsub transcribe --input \\"{input}\\" --output \\"{output}\\""
  npm run rag:transcribe -- --backend whisper --input-dir /Users/welsnake/Desktop/trading_source
`)
}

async function walk(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function runShell(command, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with exit code ${code}`))
    })
  })
}

function quote(s) {
  return `"${String(s).replaceAll('"', '\\"')}"`
}

function buildSmartsubCommand(template, input, output) {
  const outputDir = path.dirname(output)
  const baseName = path.basename(output, path.extname(output))
  return template
    .replaceAll('{input}', input)
    .replaceAll('{output}', output)
    .replaceAll('{outputDir}', outputDir)
    .replaceAll('{baseName}', baseName)
}

function buildWhisperCommand(binary, input, output) {
  const outputDir = path.dirname(output)
  return `${binary} ${quote(input)} --task transcribe --output_format srt --output_dir ${quote(outputDir)}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const inputDir = path.resolve(args.inputDir)
  const outputDir = path.resolve(args.outputDir || path.join(inputDir, 'transcripts'))
  const reportFile = args.reportFile
    ? path.resolve(args.reportFile)
    : path.join(outputDir, `transcribe-report-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`)

  if (!(await exists(inputDir))) {
    throw new Error(`Input folder not found: ${inputDir}`)
  }

  await fs.mkdir(outputDir, { recursive: true })
  const allFiles = await walk(inputDir)
  const videos = allFiles.filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))

  if (videos.length === 0) {
    console.log(`No video files found under ${inputDir}`)
    return
  }

  if (args.backend === 'smartsub' && !args.smartsubCmd) {
    throw new Error('SmartSub backend needs --smartsub-cmd (or SMARTSUB_CMD env var).')
  }

  const report = {
    startedAt: new Date().toISOString(),
    inputDir,
    outputDir,
    backend: args.backend,
    totalVideos: videos.length,
    processed: [],
  }

  console.log(`Found ${videos.length} videos. Backend: ${args.backend}`)

  for (let i = 0; i < videos.length; i++) {
    const input = videos[i]
    const rel = path.relative(inputDir, input)
    const outPath = path.join(outputDir, rel).replace(path.extname(rel), '.srt')
    await fs.mkdir(path.dirname(outPath), { recursive: true })

    const already = await exists(outPath)
    if (already && !args.force) {
      console.log(`[${i + 1}/${videos.length}] skip (exists): ${rel}`)
      report.processed.push({ input, output: outPath, status: 'skipped_exists' })
      continue
    }

    let cmd
    if (args.backend === 'smartsub') {
      cmd = buildSmartsubCommand(args.smartsubCmd, input, outPath)
    } else if (args.backend === 'whisper') {
      cmd = buildWhisperCommand(args.whisperCmd, input, outPath)
    } else {
      throw new Error(`Unsupported backend: ${args.backend}`)
    }

    console.log(`[${i + 1}/${videos.length}] transcribing: ${rel}`)
    console.log(`  cmd: ${cmd}`)

    if (args.dryRun) {
      report.processed.push({ input, output: outPath, status: 'dry_run', command: cmd })
      continue
    }

    try {
      await runShell(cmd, inputDir)
      const ok = await exists(outPath)
      if (!ok) {
        throw new Error(`Finished command but .srt not found at ${outPath}`)
      }
      report.processed.push({ input, output: outPath, status: 'ok' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`  failed: ${message}`)
      report.processed.push({ input, output: outPath, status: 'error', error: message })
    }
  }

  report.finishedAt = new Date().toISOString()
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8')
  console.log(`Done. Report: ${reportFile}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})

