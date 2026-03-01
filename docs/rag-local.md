# Local RAG (Trading Sources)

This project now has a local RAG pipeline that ingests non-video files and creates a searchable index.

## What it ingests

Included file types:
- `.srt`, `.txt`, `.md`, `.markdown`, `.csv`, `.tsv`, `.json`, `.html`, `.htm`, `.pdf`, `.docx`, `.rtf`

Ignored file types:
- video formats like `.mp4`, `.mov`, `.mkv`, etc.

## Build index

Default source is your Desktop folder:
- `/Users/welsnake/Desktop/trading_source`

Run:

```bash
npm run rag:build
```

Optional flags:

```bash
npm run rag:build -- \
  --source-dir /Users/welsnake/Desktop/trading_source \
  --index-file data/rag/index.json \
  --chunk-size 1200 \
  --overlap 180 \
  --verbose
```

## Query index

```bash
npm run rag:query -- --query "how to trail stop after partial profit"
```

JSON output:

```bash
npm run rag:query -- --query "A+ setup checklist" --json
```

## Notes

- PDF parsing uses `pdftotext` if available.
- DOCX parsing uses `unzip -p` to read `word/document.xml`.
- Results include file and chunk references so you can cite sources in AI analysis.
