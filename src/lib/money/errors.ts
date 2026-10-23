export type MoneyErrorCode = 'NOT_SAFE_INTEGER' | 'INVALID_RUPEES' | 'NEGATIVE_NOT_ALLOWED';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
