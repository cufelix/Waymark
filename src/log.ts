// Structured JSON logs on stdout/stderr. Never log secrets or seeker content.
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|token|secret|api[-_]?key|prompt|content|text|body|reason)$/iu;
const URL = /https?:\/\/[^\s"'<>]+/giu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const BEARER = /\bBearer\s+\S+/giu;

function safeValue(value: unknown, key?: string, depth = 0): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    return value.replace(BEARER, "Bearer [redacted]").replace(URL, "[url]").replace(EMAIL, "[email]");
  }
  if (Array.isArray(value)) return value.map((item) => safeValue(item, undefined, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, safeValue(child, childKey, depth + 1)]));
  }
  return value;
}

export function safeLogFields(fields: Fields): Fields {
  return safeValue(fields) as Fields;
}

const write = (level: "info" | "warn" | "error", msg: string, fields: Fields = {}): void => {
  const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...safeLogFields(fields) });
  (level === "info" ? process.stdout : process.stderr).write(line + "\n");
};

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

/** A diagnostic category safe for logs, stored failures and user-visible fallback reasons. */
export const errorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    const code = "code" in err && typeof err.code === "string" && /^[A-Z0-9_-]{1,40}$/iu.test(err.code) ? err.code : undefined;
    return code === undefined ? err.name || "Error" : `${err.name || "Error"} (${code})`;
  }
  return typeof err;
};
