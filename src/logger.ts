/**
 * Minimal structured JSON logger.
 *
 * Output format: one JSON object per line (ndjson), e.g.
 *   {"time":"2026-04-19T14:30:00.000Z","level":"info","msg":"room created","roomId":"a1b2c3"}
 *
 * Filter with: grep '"level":"error"' | jq .
 *
 * Level controlled by LOG_LEVEL env var (default: info).
 * info/debug → stdout, warn/error → stderr (PM2 captures both).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[(process.env['LOG_LEVEL'] as LogLevel) ?? 'info'] ?? LEVELS.info;

function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...data }) + '\n';
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info:  (msg: string, data?: Record<string, unknown>) => write('info',  msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => write('warn',  msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};

/** Pull a loggable string out of any thrown value. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
