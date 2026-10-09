// Structured JSON logs on stdout/stderr. Never log secrets or seeker content.
type Fields = Record<string, unknown>;

const write = (level: "info" | "warn" | "error", msg: string, fields: Fields = {}): void => {
  const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...fields });
  (level === "info" ? process.stdout : process.stderr).write(line + "\n");
};

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
