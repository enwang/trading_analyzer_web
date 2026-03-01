# Batch Video Transcription

This project includes a batch runner so you can transcribe an entire folder with one command.

Script:
- `scripts/batch-transcribe.mjs`
- npm alias: `npm run rag:transcribe -- ...`

Default input folder:
- `/Users/welsnake/Desktop/trading_source`

Default output folder:
- `<input>/transcripts`

## 1) SmartSub mode (recommended if you already use SmartSub)

The runner calls your SmartSub command template once per video.

Placeholders available in `--smartsub-cmd`:
- `{input}` absolute video path
- `{output}` absolute `.srt` output path
- `{outputDir}` output directory
- `{baseName}` output file basename (without extension)

Example:

```bash
npm run rag:transcribe -- \
  --backend smartsub \
  --smartsub-cmd 'smartsub transcribe --input "{input}" --output "{output}"'
```

If you prefer env var:

```bash
export SMARTSUB_CMD='smartsub transcribe --input "{input}" --output "{output}"'
npm run rag:transcribe -- --backend smartsub
```

## 2) Whisper CLI fallback

If SmartSub CLI is unavailable, use `whisper` command:

```bash
npm run rag:transcribe -- --backend whisper
```

Or custom binary:

```bash
npm run rag:transcribe -- --backend whisper --whisper-cmd "/opt/homebrew/bin/whisper"
```

## Useful options

- `--input-dir <path>` custom source folder
- `--output-dir <path>` custom transcript folder
- `--force` re-run even if `.srt` already exists
- `--dry-run` print commands without running
- `--report-file <path>` write JSON report to explicit path

Example dry run:

```bash
npm run rag:transcribe -- --backend smartsub --smartsub-cmd 'smartsub transcribe --input "{input}" --output "{output}"' --dry-run
```

## Notes

- Processing is sequential (safe for app-based tools).
- Existing transcripts are skipped unless `--force`.
- A JSON run report is generated automatically in output folder.
