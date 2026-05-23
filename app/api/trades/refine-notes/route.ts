import { NextResponse } from 'next/server'

// Ordered by preference — Claude Haiku used when OpenRouter account has credits,
// falls back to the best-available free model.
const MODELS = [
  'anthropic/claude-haiku-4-5',
  'liquid/lfm-2.5-1.2b-instruct:free',
]

const PROMPT = (text: string) =>
  `Rewrite the following trading journal note to be more concise and clear. Keep all key insights but remove redundancy and tighten the language. Return only the rewritten text with no explanation or preamble:\n\n${text}`

export async function POST(request: Request) {
  try {
    const { text } = (await request.json()) as { text: string }

    if (!text?.trim()) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 })
    }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
    }

    let lastError = 'All models unavailable'
    for (const model of MODELS) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: PROMPT(text) }],
        }),
      })

      const json = await res.json() as {
        choices?: { message: { content: string } }[]
        error?: { message: string }
      }

      if (!res.ok || json.error) {
        lastError = json.error?.message ?? `HTTP ${res.status}`
        continue
      }

      const refined = json.choices?.[0]?.message?.content?.trim()
      if (refined) return NextResponse.json({ refined })
    }

    return NextResponse.json({ error: lastError }, { status: 500 })
  } catch (err) {
    console.error('[refine-notes]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
