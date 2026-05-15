import { Transform } from 'node:stream';
import { fixToolsListResponse } from './schema-fixer.js';

export class McpSseTransformer extends Transform {
  constructor(options = {}) {
    super(options);
    this._buffer = '';
    this._pathPrefix = options.pathPrefix || '';
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
    if (trimmed.startsWith('data:')) {
      const dataContent = trimmed.slice(5).trim();
      if (!dataContent) {
        this.push(`${line}\n`);
        return;
      }
      try {
        const parsed = JSON.parse(dataContent);
        const fixed = fixToolsListResponse(parsed);
        this.push(`data: ${JSON.stringify(fixed)}\n`);
      } catch {
        if (this._pathPrefix && dataContent.startsWith('/')) {
          this.push(`data: ${this._pathPrefix}${dataContent}\n`);
        } else {
          this.push(`${line}\n`);
        }
      }
      return;
    }
    this.push(`${line}\n`);
  }
}
