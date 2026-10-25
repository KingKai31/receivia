import { MODEL } from '@/features/agent/draft';

export interface ModelEnv {
  anthropicKey?: string | null;
  fetchImpl?: typeof fetch;
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface Msg {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ModelError extends Error {}

/** One Messages API call. Throws ModelError on a missing key, HTTP error or network failure. */
export async function callModel(
  env: ModelEnv,
  req: {
    system: string;
    messages: Msg[];
    tools: ToolDef[];
    toolChoice?: { type: 'auto' } | { type: 'tool'; name: string };
    maxTokens?: number;
  },
): Promise<Block[]> {
  if (!env.anthropicKey) throw new ModelError('no model key');
  let res: Response;
  try {
    res = await (env.fetchImpl ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: req.maxTokens ?? 700,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
        tool_choice: req.toolChoice ?? { type: 'auto' },
      }),
    });
  } catch {
    throw new ModelError('model unreachable');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ModelError(`model error ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: Block[] };
  return data.content ?? [];
}
