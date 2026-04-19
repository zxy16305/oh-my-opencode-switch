import { Transform } from 'node:stream';

export class ResponseTransformer extends Transform {
  constructor(options = {}) {
    super(options);
    this._buffer = '';
    this._completionId = `chatcmpl-resp-${Date.now()}`;
  }

  _transform(chunk, _encoding, callback) {
    this._buffer += chunk.toString();

    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      this._processLine(line);
    }

    callback();
  }

  _flush(callback) {
    if (this._buffer.trim()) {
      this._processLine(this._buffer);
    }
    callback();
  }

  _processLine(line) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data:')) {
      return;
    }

    const dataContent = trimmed.slice(5).trim();

    if (dataContent === '[DONE]') {
      this.push(`data: [DONE]\n\n`);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(dataContent);
    } catch {
      return;
    }

    const transformed = this._transformEvent(parsed);
    if (transformed) {
      this.push(`data: ${JSON.stringify(transformed)}\n\n`);
    }
  }

  _transformEvent(event) {
    const { type } = event;

    if (type === 'response.created' || type === 'response.in_progress') {
      return null;
    }

    if (type === 'response.output_text.delta') {
      return this._transformTextDelta(event);
    }

    if (type === 'response.function_call_arguments.delta') {
      return this._transformToolCallDelta(event);
    }

    if (type === 'response.completed') {
      this._handleResponseCompleted(event);
      return null;
    }

    return event;
  }

  _transformTextDelta(event) {
    const { delta } = event;
    return {
      id: this._completionId,
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            content: delta,
            role: 'assistant',
          },
          finish_reason: null,
        },
      ],
    };
  }

  _transformToolCallDelta(event) {
    const { name, arguments: args, call_id } = event;
    const toolCallId = call_id || `call_${Date.now()}`;

    return {
      id: this._completionId,
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                type: 'function',
                function: {
                  name: name,
                  arguments: args || '',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
  }

  _handleResponseCompleted(event) {
    const { response } = event;
    if (!response?.usage) {
      this.push(`data: [DONE]\n\n`);
      return;
    }

    const {
      input_tokens = 0,
      output_tokens = 0,
      total_tokens: explicitTotalTokens,
      cache_read_input_tokens,
      cache_creation_input_tokens,
      cached_tokens,
      prompt_cache_hit_tokens,
      prompt_cache_miss_tokens,
      input_tokens_details,
      prompt_tokens_details,
      completion_tokens_details,
    } = response.usage;
    const total_tokens = explicitTotalTokens ?? (input_tokens + output_tokens);

    const normalizedPromptTokensDetails = {
      ...(prompt_tokens_details || {}),
    };

    const cacheRead =
      normalizedPromptTokensDetails.cached_tokens ??
      input_tokens_details?.cached_tokens ??
      cached_tokens ??
      prompt_cache_hit_tokens ??
      cache_read_input_tokens;

    const cacheWrite =
      normalizedPromptTokensDetails.cache_creation_input_tokens ?? cache_creation_input_tokens;

    if (cacheRead !== undefined) {
      normalizedPromptTokensDetails.cached_tokens = cacheRead;
    }

    if (cacheWrite !== undefined) {
      normalizedPromptTokensDetails.cache_creation_input_tokens = cacheWrite;
    }

    const usageChunk = {
      id: this._completionId,
      object: 'chat.completion.chunk',
      choices: [],
      usage: {
        prompt_tokens: input_tokens,
        completion_tokens: output_tokens,
        total_tokens: total_tokens,
        ...(cache_read_input_tokens !== undefined
          ? { cache_read_input_tokens }
          : {}),
        ...(cache_creation_input_tokens !== undefined
          ? { cache_creation_input_tokens }
          : {}),
        ...(cached_tokens !== undefined ? { cached_tokens } : {}),
        ...(prompt_cache_hit_tokens !== undefined ? { prompt_cache_hit_tokens } : {}),
        ...(prompt_cache_miss_tokens !== undefined ? { prompt_cache_miss_tokens } : {}),
        ...(input_tokens_details !== undefined ? { input_tokens_details } : {}),
        ...(completion_tokens_details !== undefined ? { completion_tokens_details } : {}),
        ...(Object.keys(normalizedPromptTokensDetails).length > 0
          ? { prompt_tokens_details: normalizedPromptTokensDetails }
          : {}),
      },
    };

    this.push(`data: ${JSON.stringify(usageChunk)}\n\n`);
    this.push(`data: [DONE]\n\n`);
  }
}
