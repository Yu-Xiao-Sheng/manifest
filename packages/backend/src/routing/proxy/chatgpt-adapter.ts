/**
 * Converts between OpenAI Chat Completions format and the
 * ChatGPT Codex Responses API format used by subscription tokens.
 *
 * Endpoint: POST https://chatgpt.com/backend-api/codex/responses
 */

import { randomUUID } from 'crypto';

const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

interface OpenAiMessage {
  role: string;
  content: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  [key: string]: unknown;
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ResponsesTool {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
    strict?: boolean;
  };
  name?: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
  [key: string]: unknown;
}

/* ── Request conversion ── */

export function toResponsesRequest(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const messages = (body.messages ?? []) as OpenAiMessage[];
  const input = messagesToResponsesInput(messages);

  // Responses API requires stream: true and store: false
  const request: Record<string, unknown> = {
    model,
    input,
    stream: true, // Responses API only supports streaming
    store: false,
    instructions: extractInstructions(messages),
  };

  const tools = convertTools(body.tools);
  if (tools) request.tools = tools;

  const toolChoice = convertToolChoice(body.tool_choice);
  if (toolChoice !== undefined) request.tool_choice = toolChoice;

  if (typeof body.parallel_tool_calls === 'boolean') {
    request.parallel_tool_calls = body.parallel_tool_calls;
  }

  return request;
}

/* ── Non-streaming response conversion ── */

export function fromResponsesResponse(
  data: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const output = (data.output ?? []) as Record<string, unknown>[];
  let text = '';
  const toolCalls: Record<string, unknown>[] = [];

  for (const item of output) {
    if (item.type === 'message') {
      text += extractMessageText(item);
      continue;
    }

    const toolCall = toOpenAiToolCall(item);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  const usage = (data.usage as Record<string, unknown>) ?? {};
  const inputDetails = usage.input_tokens_details as Record<string, number> | undefined;
  const message: Record<string, unknown> = { role: 'assistant', content: text };
  const hasToolCalls = toolCalls.length > 0;

  if (hasToolCalls) {
    message.tool_calls = toolCalls;
  }

  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 29)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: (usage.input_tokens as number) ?? 0,
      completion_tokens: (usage.output_tokens as number) ?? 0,
      total_tokens: (usage.total_tokens as number) ?? 0,
      cache_read_tokens: inputDetails?.cached_tokens ?? 0,
      cache_creation_tokens: 0,
    },
  };
}

/* ── Streaming SSE conversion ── */

/**
 * Transform a single Responses API SSE chunk into an OpenAI
 * Chat Completions SSE chunk. Returns null for irrelevant events.
 */
export function transformResponsesStreamChunk(chunk: string, model: string): string | null {
  return createResponsesStreamTransformer(model)(chunk);
}

export function createResponsesStreamTransformer(model: string): (chunk: string) => string | null {
  let toolCallIndex = 0;
  let sawToolCalls = false;
  const itemToToolCallIndex = new Map<string, number>();
  const itemToArgumentsLength = new Map<string, number>();

  return (chunk: string): string | null => {
    // parseSseEvents strips "data: " prefixes before calling transforms,
    // so lines arrive as "event: <type>\n<json>" (no "data: " prefix on JSON).
    const lines = chunk.split('\n');
    let eventType = '';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataStr = line.slice(6);
      } else if (line.trim()) {
        // Pre-processed: data prefix already stripped by parseSseEvents
        dataStr = line.trim();
      }
    }

    if (!eventType && !dataStr) return null;

    if (eventType === 'response.output_text.delta') {
      const data = safeParse(dataStr);
      if (!data) return null;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      return formatSSE({ delta: { content: delta }, finish_reason: null }, model);
    }

    if (eventType === 'response.output_item.added') {
      const data = safeParse(dataStr);
      if (!data) return null;
      const item = data.item as Record<string, unknown> | undefined;
      if (!item) return null;

      const toolCallChunk = buildToolCallAddedChunk(item, toolCallIndex);
      if (!toolCallChunk) return null;

      sawToolCalls = true;
      if (toolCallChunk.itemId) {
        itemToToolCallIndex.set(toolCallChunk.itemId, toolCallChunk.index);
        itemToArgumentsLength.set(toolCallChunk.itemId, toolCallChunk.arguments.length);
      }
      toolCallIndex += 1;

      return formatSSE(
        {
          delta: {
            tool_calls: [
              {
                index: toolCallChunk.index,
                id: toolCallChunk.callId,
                type: 'function',
                function: {
                  name: toolCallChunk.name,
                  arguments: toolCallChunk.arguments,
                },
              },
            ],
          },
          finish_reason: null,
        },
        model,
      );
    }

    if (eventType === 'response.function_call_arguments.delta') {
      const data = safeParse(dataStr);
      if (!data) return null;
      const itemId = typeof data.item_id === 'string' ? data.item_id : '';
      const delta = typeof data.delta === 'string' ? data.delta : '';
      const index = itemToToolCallIndex.get(itemId);
      if (!itemId || index === undefined) return null;

      itemToArgumentsLength.set(itemId, (itemToArgumentsLength.get(itemId) ?? 0) + delta.length);
      return formatSSE(
        {
          delta: {
            tool_calls: [
              {
                index,
                function: { arguments: delta },
              },
            ],
          },
          finish_reason: null,
        },
        model,
      );
    }

    if (eventType === 'response.function_call_arguments.done') {
      const data = safeParse(dataStr);
      if (!data) return null;
      const itemId = typeof data.item_id === 'string' ? data.item_id : '';
      const finalArguments = typeof data.arguments === 'string' ? data.arguments : '';
      const index = itemToToolCallIndex.get(itemId);
      if (!itemId || index === undefined) return null;

      const sentLength = itemToArgumentsLength.get(itemId) ?? 0;
      const remainingArguments =
        sentLength >= finalArguments.length ? '' : finalArguments.slice(sentLength);
      itemToArgumentsLength.set(itemId, finalArguments.length);

      if (!remainingArguments) return null;
      return formatSSE(
        {
          delta: {
            tool_calls: [
              {
                index,
                function: { arguments: remainingArguments },
              },
            ],
          },
          finish_reason: null,
        },
        model,
      );
    }

    if (eventType === 'response.completed') {
      const data = safeParse(dataStr);
      const response = (data?.response as Record<string, unknown>) ?? {};
      const respUsage = response.usage as Record<string, number> | undefined;
      const respDetails = response.usage as Record<string, unknown> | undefined;
      const cachedTokens =
        (respDetails?.input_tokens_details as Record<string, number> | undefined)?.cached_tokens ??
        0;
      const hasToolCalls = sawToolCalls || responseHasToolCalls(response);
      const usage = respUsage
        ? {
            prompt_tokens: respUsage.input_tokens ?? 0,
            completion_tokens: respUsage.output_tokens ?? 0,
            total_tokens: respUsage.total_tokens ?? 0,
            cache_read_tokens: cachedTokens,
            cache_creation_tokens: 0,
          }
        : undefined;
      const finish = formatSSE(
        { delta: {}, finish_reason: hasToolCalls ? 'tool_calls' : 'stop' },
        model,
        usage,
      );
      return `${finish}\ndata: [DONE]\n\n`;
    }

    return null;
  };
}

/* ── Helpers ── */

/**
 * Convert Chat Completions content to Responses API content format.
 * The Responses API uses role-specific content types:
 * - user messages: `input_text`
 * - assistant messages: `output_text`
 */
function convertContent(content: unknown, role: string): unknown {
  const partType = role === 'assistant' ? 'output_text' : 'input_text';
  if (typeof content === 'string') {
    return [{ type: partType, text: content }];
  }
  if (!Array.isArray(content)) return content;
  return (content as { type?: string; text?: string }[]).map((part) => {
    if (part.type === 'text') return { ...part, type: partType };
    return part;
  });
}

function extractInstructions(messages: OpenAiMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role !== 'system' && message.role !== 'developer') continue;
    parts.push(...extractTextParts(message.content));
  }

  const instructions = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');

  return instructions || DEFAULT_INSTRUCTIONS;
}

function messagesToResponsesInput(messages: OpenAiMessage[]): unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: (message.tool_call_id as string) || 'unknown',
        output: stringifyToolOutput(message.content),
      });
      continue;
    }

    const messageItem = messageToResponsesMessage(message);
    if (messageItem) input.push(messageItem);

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const responseToolCall = toolCallToResponsesItem(toolCall);
        if (responseToolCall) input.push(responseToolCall);
      }
    }
  }

  return input;
}

function messageToResponsesMessage(message: OpenAiMessage): Record<string, unknown> | null {
  const content = convertContent(message.content, message.role);
  if (!Array.isArray(content) || content.length === 0) return null;
  return { role: message.role, content };
}

function toolCallToResponsesItem(toolCall: OpenAiToolCall): Record<string, unknown> | null {
  const fn = toolCall.function;
  if (!fn?.name) return null;
  return {
    type: 'function_call',
    call_id: toolCall.id || `call_${randomUUID()}`,
    name: fn.name,
    arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
  };
}

function stringifyToolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '');
}

function convertTools(tools: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  const converted = (tools as ResponsesTool[])
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return null;

      if (tool.type !== 'function') {
        return { ...tool };
      }

      if (tool.function) {
        return {
          type: 'function',
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict,
        };
      }

      return {
        ...tool,
        type: 'function',
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  return converted.length > 0 ? converted : undefined;
}

function convertToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === undefined) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (!toolChoice || typeof toolChoice !== 'object' || Array.isArray(toolChoice)) {
    return toolChoice;
  }

  const choice = toolChoice as Record<string, unknown>;
  if (choice.type !== 'function') return choice;

  const nestedFunction = choice.function as Record<string, unknown> | undefined;
  if (nestedFunction && typeof nestedFunction.name === 'string') {
    return {
      type: 'function',
      name: nestedFunction.name,
    };
  }

  return choice;
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];

  return (content as Array<Record<string, unknown>>)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);
}

function safeParse(str: string): Record<string, unknown> | null {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractMessageText(item: Record<string, unknown>): string {
  let text = '';
  const content = item.content as { type?: string; text?: string }[] | undefined;
  if (!content) return text;

  for (const part of content) {
    if (part.type === 'output_text' && part.text) {
      text += part.text;
    }
  }

  return text;
}

function toOpenAiToolCall(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'function_call') return null;
  if (typeof item.name !== 'string') return null;

  return {
    id:
      (typeof item.call_id === 'string' && item.call_id) ||
      (typeof item.id === 'string' && item.id) ||
      `call_${randomUUID()}`,
    type: 'function',
    function: {
      name: item.name,
      arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
    },
  };
}

function buildToolCallAddedChunk(
  item: Record<string, unknown>,
  index: number,
): {
  itemId: string;
  index: number;
  callId: string;
  name: string;
  arguments: string;
} | null {
  const toolCall = toOpenAiToolCall(item);
  if (!toolCall) return null;

  return {
    itemId: typeof item.id === 'string' ? item.id : '',
    index,
    callId: toolCall.id as string,
    name: (toolCall.function as Record<string, string>).name,
    arguments: (toolCall.function as Record<string, string>).arguments,
  };
}

function responseHasToolCalls(response: Record<string, unknown>): boolean {
  const output = (response.output ?? []) as Array<Record<string, unknown>>;
  return output.some((item) => item.type === 'function_call');
}

function formatSSE(
  choice: Record<string, unknown>,
  model: string,
  usage?: Record<string, number>,
): string {
  const payload: Record<string, unknown> = {
    id: `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 29)}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, ...choice }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}
