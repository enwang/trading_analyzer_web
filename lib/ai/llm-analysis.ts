type LlmProvider = 'claude' | 'openai'

export async function runOpenAiText(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 800,
      temperature: 0.3,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`OpenAI request failed (${resp.status}): ${text}`)
  }

  const data = (await resp.json()) as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }

  if (data.output_text?.trim()) return data.output_text.trim()

  const parts = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' || typeof content.text === 'string')
    .map((content) => content.text ?? '')
    .join('\n')
    .trim()

  return parts || null
}

export async function runClaudeText(prompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const preferredModel = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'

  const makeRequest = async (model: string) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

  let resp = await makeRequest(preferredModel)

  if (resp.status === 404) {
    const modelsResp = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (modelsResp.ok) {
      const modelsJson = (await modelsResp.json()) as {
        data?: Array<{ id?: string }>
      }
      const fallbackModel =
        (modelsJson.data ?? [])
          .map((model) => model.id ?? '')
          .find(
            (id) =>
              id.startsWith('claude-sonnet') ||
              id.startsWith('claude-opus') ||
              id.startsWith('claude-haiku'),
          ) ?? null

      if (fallbackModel) {
        resp = await makeRequest(fallbackModel)
      }
    }
  }

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Claude request failed (${resp.status}): ${text}`)
  }

  const data = (await resp.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }

  const text = (data.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim()

  return text || null
}

export async function runLlmText(prompt: string): Promise<{ provider: LlmProvider; text: string } | null> {
  const forced = (process.env.RAG_LLM_PROVIDER ?? '').toLowerCase().trim()

  if (forced === 'claude') {
    const text = await runClaudeText(prompt)
    return text ? { provider: 'claude', text } : null
  }

  if (forced === 'openai') {
    const text = await runOpenAiText(prompt)
    return text ? { provider: 'openai', text } : null
  }

  const claude = await runClaudeText(prompt)
  if (claude) return { provider: 'claude', text: claude }

  const openai = await runOpenAiText(prompt)
  if (openai) return { provider: 'openai', text: openai }

  return null
}
