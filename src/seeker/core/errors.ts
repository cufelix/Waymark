import { newId } from "./ids.ts";

// API.md "Conventions": error codes and their HTTP status.
export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  consent_required: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
  upstream_failed: 502,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export type Envelope<T> =
  | { ok: true; data: T; error: null; meta: { requestId: string } }
  | { ok: false; data: null; error: { code: ErrorCode; message: string }; meta: { requestId: string } };

export function ok<T>(data: T, requestId: string = newId("req")): Envelope<T> {
  return { ok: true, data, error: null, meta: { requestId } };
}

export function fail(err: unknown, requestId: string = newId("req")): { status: number; body: Envelope<never> } {
  const e = err instanceof ApiError ? err : new ApiError("internal", "Internal error");
  return { status: e.status, body: { ok: false, data: null, error: { code: e.code, message: e.message }, meta: { requestId } } };
}
