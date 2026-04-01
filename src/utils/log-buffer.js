/**
 * Circular buffer for storing recent log entries.
 * Maintains a fixed capacity of 50 entries, automatically removing oldest.
 */

const CAPACITY = 50;

class LogBuffer {
  constructor() {
    this._buffer = new Array(CAPACITY);
    this._head = 0;
    this._count = 0;
  }

  /**
   * Add a log entry to the buffer.
   * If capacity is exceeded, the oldest entry is overwritten.
   * @param {object} logEntry - Log entry object
   */
  add(logEntry) {
    this._buffer[this._head] = logEntry;
    this._head = (this._head + 1) % CAPACITY;
    if (this._count < CAPACITY) {
      this._count++;
    }
  }

  /**
   * Get all log entries in reverse chronological order (newest first).
   * @returns {object[]} Array of log entries
   */
  getAll() {
    if (this._count === 0) {
      return [];
    }

    const result = new Array(this._count);

    // Calculate the position of the newest entry
    // newest is at (head - 1 + CAPACITY) % CAPACITY
    // oldest is at head (if buffer is full) or 0 (if not full)

    for (let i = 0; i < this._count; i++) {
      // Read from newest to oldest
      const readPos = (this._head - 1 - i + CAPACITY) % CAPACITY;
      result[i] = this._buffer[readPos];
    }

    return result;
  }

  /**
   * Get the current number of log entries.
   * @returns {number}
   */
  get size() {
    return this._count;
  }

  /**
   * Clear all entries from the buffer.
   */
  clear() {
    this._buffer = new Array(CAPACITY);
    this._head = 0;
    this._count = 0;
  }
}

export const logBuffer = new LogBuffer();

export { LogBuffer };
