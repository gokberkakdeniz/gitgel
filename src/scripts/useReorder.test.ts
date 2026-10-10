import { describe, expect, it } from 'vitest';
import { shiftForRow, slotForPointer } from './useReorder';

// Four rows, each 48px: midpoints at 24, 72, 120, 168.
const mids = [24, 72, 120, 168];

describe('slotForPointer', () => {
  it('lands before the first row', () => {
    expect(slotForPointer(mids, 0)).toBe(0);
    expect(slotForPointer(mids, 24)).toBe(0);
  });
  it('counts the midpoints above the pointer', () => {
    expect(slotForPointer(mids, 25)).toBe(1);
    expect(slotForPointer(mids, 100)).toBe(2);
    expect(slotForPointer(mids, 169)).toBe(4);
  });
  it('is empty-proof', () => {
    expect(slotForPointer([], 50)).toBe(0);
  });
});

describe('shiftForRow', () => {
  it('moves nothing when the slot is home', () => {
    for (let i = 0; i < 4; i++) expect(shiftForRow(1, 1, i, 48)).toBe(0);
  });
  it('moves the rows between down when dragging down', () => {
    // B (1) drops after C (2): C moves up one row.
    expect(shiftForRow(1, 2, 0, 48)).toBe(0);
    expect(shiftForRow(1, 2, 2, 48)).toBe(-48);
    expect(shiftForRow(1, 2, 3, 48)).toBe(0);
  });
  it('moves the rows between up when dragging up', () => {
    // C (2) drops before A (0): A and B move down one row.
    expect(shiftForRow(2, 0, 0, 48)).toBe(48);
    expect(shiftForRow(2, 0, 1, 48)).toBe(48);
    expect(shiftForRow(2, 0, 3, 48)).toBe(0);
  });
});
