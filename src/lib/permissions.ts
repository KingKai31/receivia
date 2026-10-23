export type Role = 'owner' | 'accountant' | 'ca';

/** Mirrors the RLS rules: owner full; accountant writes data; CA reads only. */
export const can = {
  readData: (role: Role | null) => role !== null,
  writeData: (role: Role | null) => role === 'owner' || role === 'accountant',
  manageBusiness: (role: Role | null) => role === 'owner',
};

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'accountant' || value === 'ca';
}
