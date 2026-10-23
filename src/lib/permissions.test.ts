import { describe, expect, it } from 'vitest';
import { can, isRole } from './permissions';

describe('permissions', () => {
  it('owner can do everything', () => {
    expect(can.writeData('owner')).toBe(true);
    expect(can.manageBusiness('owner')).toBe(true);
  });
  it('accountant writes data but does not manage the business', () => {
    expect(can.writeData('accountant')).toBe(true);
    expect(can.manageBusiness('accountant')).toBe(false);
  });
  it('CA is read-only', () => {
    expect(can.readData('ca')).toBe(true);
    expect(can.writeData('ca')).toBe(false);
    expect(can.manageBusiness('ca')).toBe(false);
  });
  it('no role means no access', () => {
    expect(can.readData(null)).toBe(false);
    expect(can.writeData(null)).toBe(false);
  });
  it('isRole guards unknown values', () => {
    expect(isRole('owner')).toBe(true);
    expect(isRole('admin')).toBe(false);
  });
});
