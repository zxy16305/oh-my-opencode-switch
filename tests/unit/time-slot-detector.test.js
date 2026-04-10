import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTimeSlotType } from '../../src/utils/time-slot-detector.js';

describe('Time-Slot Detector', () => {
  describe('all hours mapping', () => {
    describe('low load hours (night: 21-23, 0-7)', () => {
      it('should return "low" for hour 0', () => {
        assert.strictEqual(getTimeSlotType(0), 'low');
      });

      it('should return "low" for hour 1', () => {
        assert.strictEqual(getTimeSlotType(1), 'low');
      });

      it('should return "low" for hour 2', () => {
        assert.strictEqual(getTimeSlotType(2), 'low');
      });

      it('should return "low" for hour 3', () => {
        assert.strictEqual(getTimeSlotType(3), 'low');
      });

      it('should return "low" for hour 4', () => {
        assert.strictEqual(getTimeSlotType(4), 'low');
      });

      it('should return "low" for hour 5', () => {
        assert.strictEqual(getTimeSlotType(5), 'low');
      });

      it('should return "low" for hour 6', () => {
        assert.strictEqual(getTimeSlotType(6), 'low');
      });

      it('should return "low" for hour 7', () => {
        assert.strictEqual(getTimeSlotType(7), 'low');
      });

      it('should return "low" for hour 21', () => {
        assert.strictEqual(getTimeSlotType(21), 'low');
      });

      it('should return "low" for hour 22', () => {
        assert.strictEqual(getTimeSlotType(22), 'low');
      });

      it('should return "low" for hour 23', () => {
        assert.strictEqual(getTimeSlotType(23), 'low');
      });
    });

    describe('high load hours (10-11, 13-17)', () => {
      it('should return "high" for hour 10', () => {
        assert.strictEqual(getTimeSlotType(10), 'high');
      });

      it('should return "high" for hour 11', () => {
        assert.strictEqual(getTimeSlotType(11), 'high');
      });

      it('should return "high" for hour 13', () => {
        assert.strictEqual(getTimeSlotType(13), 'high');
      });

      it('should return "high" for hour 14', () => {
        assert.strictEqual(getTimeSlotType(14), 'high');
      });

      it('should return "high" for hour 15', () => {
        assert.strictEqual(getTimeSlotType(15), 'high');
      });

      it('should return "high" for hour 16', () => {
        assert.strictEqual(getTimeSlotType(16), 'high');
      });

      it('should return "high" for hour 17', () => {
        assert.strictEqual(getTimeSlotType(17), 'high');
      });
    });

    describe('medium load hours (8-9, 12, 18-20)', () => {
      it('should return "medium" for hour 8', () => {
        assert.strictEqual(getTimeSlotType(8), 'medium');
      });

      it('should return "medium" for hour 9', () => {
        assert.strictEqual(getTimeSlotType(9), 'medium');
      });

      it('should return "medium" for hour 12', () => {
        assert.strictEqual(getTimeSlotType(12), 'medium');
      });

      it('should return "medium" for hour 18', () => {
        assert.strictEqual(getTimeSlotType(18), 'medium');
      });

      it('should return "medium" for hour 19', () => {
        assert.strictEqual(getTimeSlotType(19), 'medium');
      });

      it('should return "medium" for hour 20', () => {
        assert.strictEqual(getTimeSlotType(20), 'medium');
      });
    });
  });

  describe('boundary transitions', () => {
    describe('low to medium transition (morning starts)', () => {
      it('hour 7 should be low (last low hour before medium)', () => {
        assert.strictEqual(getTimeSlotType(7), 'low');
      });

      it('hour 8 should be medium (first medium hour)', () => {
        assert.strictEqual(getTimeSlotType(8), 'medium');
      });
    });

    describe('medium to high transition (morning peak starts)', () => {
      it('hour 9 should be medium (last medium hour before high)', () => {
        assert.strictEqual(getTimeSlotType(9), 'medium');
      });

      it('hour 10 should be high (first high hour)', () => {
        assert.strictEqual(getTimeSlotType(10), 'high');
      });
    });

    describe('high to medium transition (noon break)', () => {
      it('hour 11 should be high (last high hour before noon)', () => {
        assert.strictEqual(getTimeSlotType(11), 'high');
      });

      it('hour 12 should be medium (noon)', () => {
        assert.strictEqual(getTimeSlotType(12), 'medium');
      });
    });

    describe('medium to high transition (afternoon peak starts)', () => {
      it('hour 12 should be medium (noon)', () => {
        assert.strictEqual(getTimeSlotType(12), 'medium');
      });

      it('hour 13 should be high (afternoon high starts)', () => {
        assert.strictEqual(getTimeSlotType(13), 'high');
      });
    });

    describe('high to medium transition (evening starts)', () => {
      it('hour 17 should be high (last high hour)', () => {
        assert.strictEqual(getTimeSlotType(17), 'high');
      });

      it('hour 18 should be medium (evening medium starts)', () => {
        assert.strictEqual(getTimeSlotType(18), 'medium');
      });
    });

    describe('medium to low transition (night starts)', () => {
      it('hour 20 should be medium (last medium hour)', () => {
        assert.strictEqual(getTimeSlotType(20), 'medium');
      });

      it('hour 21 should be low (night low starts)', () => {
        assert.strictEqual(getTimeSlotType(21), 'low');
      });
    });

    describe('day boundary (midnight)', () => {
      it('hour 23 should be low (last hour of day)', () => {
        assert.strictEqual(getTimeSlotType(23), 'low');
      });

      it('hour 0 should be low (first hour of day)', () => {
        assert.strictEqual(getTimeSlotType(0), 'low');
      });
    });
  });
});
