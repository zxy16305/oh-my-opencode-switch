import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTimeSlotType } from '../../src/utils/time-slot-detector.js';

// Monday April 13 2026 — known workday, used for deterministic hour-based tests
const WORKDAY = new Date(2026, 3, 13);

function makeDate(hour) {
  return new Date(new Date(WORKDAY).setHours(hour, 0, 0, 0));
}

describe('Time-Slot Detector', () => {
  describe('hour mapping on workday', () => {
    describe('low load hours (night: 21-23, 0-7)', () => {
      it('should return "low" for hour 0', () => {
        assert.strictEqual(getTimeSlotType(makeDate(0)), 'low');
      });

      it('should return "low" for hour 1', () => {
        assert.strictEqual(getTimeSlotType(makeDate(1)), 'low');
      });

      it('should return "low" for hour 2', () => {
        assert.strictEqual(getTimeSlotType(makeDate(2)), 'low');
      });

      it('should return "low" for hour 3', () => {
        assert.strictEqual(getTimeSlotType(makeDate(3)), 'low');
      });

      it('should return "low" for hour 4', () => {
        assert.strictEqual(getTimeSlotType(makeDate(4)), 'low');
      });

      it('should return "low" for hour 5', () => {
        assert.strictEqual(getTimeSlotType(makeDate(5)), 'low');
      });

      it('should return "low" for hour 6', () => {
        assert.strictEqual(getTimeSlotType(makeDate(6)), 'low');
      });

      it('should return "low" for hour 7', () => {
        assert.strictEqual(getTimeSlotType(makeDate(7)), 'low');
      });

      it('should return "low" for hour 21', () => {
        assert.strictEqual(getTimeSlotType(makeDate(21)), 'low');
      });

      it('should return "low" for hour 22', () => {
        assert.strictEqual(getTimeSlotType(makeDate(22)), 'low');
      });

      it('should return "low" for hour 23', () => {
        assert.strictEqual(getTimeSlotType(makeDate(23)), 'low');
      });
    });

    describe('high load hours (10-11, 13-17)', () => {
      it('should return "high" for hour 10', () => {
        assert.strictEqual(getTimeSlotType(makeDate(10)), 'high');
      });

      it('should return "high" for hour 11', () => {
        assert.strictEqual(getTimeSlotType(makeDate(11)), 'high');
      });

      it('should return "high" for hour 13', () => {
        assert.strictEqual(getTimeSlotType(makeDate(13)), 'high');
      });

      it('should return "high" for hour 14', () => {
        assert.strictEqual(getTimeSlotType(makeDate(14)), 'high');
      });

      it('should return "high" for hour 15', () => {
        assert.strictEqual(getTimeSlotType(makeDate(15)), 'high');
      });

      it('should return "high" for hour 16', () => {
        assert.strictEqual(getTimeSlotType(makeDate(16)), 'high');
      });

      it('should return "high" for hour 17', () => {
        assert.strictEqual(getTimeSlotType(makeDate(17)), 'high');
      });
    });

    describe('medium load hours (8-9, 12, 18-20)', () => {
      it('should return "medium" for hour 8', () => {
        assert.strictEqual(getTimeSlotType(makeDate(8)), 'medium');
      });

      it('should return "medium" for hour 9', () => {
        assert.strictEqual(getTimeSlotType(makeDate(9)), 'medium');
      });

      it('should return "medium" for hour 12', () => {
        assert.strictEqual(getTimeSlotType(makeDate(12)), 'medium');
      });

      it('should return "medium" for hour 18', () => {
        assert.strictEqual(getTimeSlotType(makeDate(18)), 'medium');
      });

      it('should return "medium" for hour 19', () => {
        assert.strictEqual(getTimeSlotType(makeDate(19)), 'medium');
      });

      it('should return "medium" for hour 20', () => {
        assert.strictEqual(getTimeSlotType(makeDate(20)), 'medium');
      });
    });
  });

  describe('boundary transitions', () => {
    it('hour 7 → low, hour 8 → medium (morning transition)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(7)), 'low');
      assert.strictEqual(getTimeSlotType(makeDate(8)), 'medium');
    });

    it('hour 9 → medium, hour 10 → high (morning peak transition)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(9)), 'medium');
      assert.strictEqual(getTimeSlotType(makeDate(10)), 'high');
    });

    it('hour 11 → high, hour 12 → medium (noon break)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(11)), 'high');
      assert.strictEqual(getTimeSlotType(makeDate(12)), 'medium');
    });

    it('hour 12 → medium, hour 13 → high (afternoon peak starts)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(12)), 'medium');
      assert.strictEqual(getTimeSlotType(makeDate(13)), 'high');
    });

    it('hour 17 → high, hour 18 → medium (evening starts)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(17)), 'high');
      assert.strictEqual(getTimeSlotType(makeDate(18)), 'medium');
    });

    it('hour 20 → medium, hour 21 → low (night starts)', () => {
      assert.strictEqual(getTimeSlotType(makeDate(20)), 'medium');
      assert.strictEqual(getTimeSlotType(makeDate(21)), 'low');
    });
  });

  describe('Date input', () => {
    it('should accept a Date object and return correct slot', () => {
      assert.strictEqual(getTimeSlotType(new Date('2026-04-13T14:00:00')), 'high');
      assert.strictEqual(getTimeSlotType(new Date('2026-04-13T08:00:00')), 'medium');
      assert.strictEqual(getTimeSlotType(new Date('2026-04-13T02:00:00')), 'low');
    });
  });

  describe('non-workday detection', () => {
    it('should return "low" for Saturday regardless of hour', () => {
      assert.strictEqual(getTimeSlotType(new Date('2025-04-19T14:00:00')), 'low');
      assert.strictEqual(getTimeSlotType(new Date('2025-04-19T08:00:00')), 'low');
    });

    it('should return "low" for holiday (National Day) regardless of hour', () => {
      assert.strictEqual(getTimeSlotType(new Date('2025-10-01T14:00:00')), 'low');
    });

    it('should return correct slot for make-up workday (补班日)', () => {
      assert.strictEqual(getTimeSlotType(new Date('2025-09-28T14:00:00')), 'high');
      assert.strictEqual(getTimeSlotType(new Date('2025-09-28T08:00:00')), 'medium');
    });

    it('number input always works', () => {
      const result = getTimeSlotType(14);
      assert.ok(result === 'low' || result === 'high' || result === 'medium');
    });
  });
});
