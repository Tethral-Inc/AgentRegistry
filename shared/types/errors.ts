export type ErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_FIELD'
  | 'INVALID_FORMAT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'AGENT_NOT_FOUND'
  | 'SKILL_NOT_FOUND';

export interface APIError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export function makeError(code: ErrorCode, message: string): APIError {
  return { error: { code, message } };
}
