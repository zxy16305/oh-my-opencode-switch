import { Transform } from 'node:stream';
import { parseTokenUsage } from './token-parser.js';

/**
 * Transform stream that captures token usage from API responses.
 * Forwards all data unchanged while parsing SSE or JSON responses.
 */
export class TokenCaptivee extends Transform {
  constructor(options = {}) {
    super(options);
    this._buffer = '';
    this._usage = null;
    this._lastUsageLine = null;
    this._isSSE = null;
    this._jsonBuffer = '';
    this._responseChunks = [];
  }

  _transform(chunk, _encoding, callback) {
    const data = chunk.toString();
    this.push(chunk);
    this._responseChunks.push(chunk);

    if (this._isSSE === null) {
      this._isSSE = this._detectSSE(data);
    }

    if (this._isSSE) {
      this._processSSE(data);
    } else {
      this._jsonBuffer += data;
    }

    callback();
  }

  _flush(callback) {
    if (!this._isSSE && this._jsonBuffer) {
      this._parseNonStreamingJson();
    }
    callback();
  }

  _detectSSE(data) {
    return data.includes('data:');
  }

  _processSSE(data) {
    this._buffer += data;

    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      this._processSSELine(line);
    }
  }

  _processSSELine(line) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data:')) {
      return;
    }

    const dataContent = trimmed.slice(5).trim();

    if (dataContent === '[DONE]') {
      if (this._lastUsageLine) {
        this._extractUsageFromLine(this._lastUsageLine);
      }
      return;
    }

    if (dataContent.includes('"usage"')) {
      this._lastUsageLine = dataContent;
    }
  }

  _extractUsageFromLine(dataContent) {
    try {
      const parsed = JSON.parse(dataContent);
      if (parsed.usage) {
        this._usage = parseTokenUsage(parsed);
      }
    } catch {
      // Silently ignore parse errors
    }
  }

  _parseNonStreamingJson() {
    try {
      const parsed = JSON.parse(this._jsonBuffer);
      if (parsed.usage) {
        this._usage = parseTokenUsage(parsed);
      }
    } catch {
      // Silently ignore parse errors
    }
  }

  getUsage() {
    return this._usage;
  }

  getFullResponse() {
    return Buffer.concat(this._responseChunks).toString();
  }
}
