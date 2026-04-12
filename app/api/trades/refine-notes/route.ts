import { NextResponse } from 'next/server'

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

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'liquid/lfm-2.5-1.2b-instruct:free',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Rewrite the following trading journal note to be more concise and clear. Keep all key insights but remove redundancy and tighten the language. Return only the rewritten text with no explanation or preamble:\n\n${text}`,
          },
        ],
      }),
    })

    const json = await res.json() as { choices?: { message: { content: string } }[]; error?: { message: string } }

    if (!res.ok || json.error) {
      return NextResponse.json({ error: json.error?.message ?? 'LLM error' }, { status: 500 })
    }

    const refined = json.choices?.[0]?.message?.content?.trim() ?? text
    return NextResponse.json({ refined })
  } catch (err) {
    console.error('[refine-notes]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
