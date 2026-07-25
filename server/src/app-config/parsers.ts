/**
 * Pure env-string coercion helpers shared by the whole config layer (derive.ts,
 * env.schema.ts) and — until their call sites migrate — by legacy readers like
 * src/mcp/config.ts. Kept free of imports so units can test them in isolation.
 *
 * Each helper reproduces a coercion family that already exists in the codebase.
 * Parity is law: do NOT "fix" a family's quirks here (e.g. `numberOr` treating
 * "0" as unset) — call sites were written against the current semantics.
 */

const TRUE_VALUES = new Set(['true', '1', 'on', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'off', 'no']);

/**
 * Unified boolean coercion for env switches — the ONE deliberate departure from
 * legacy parity: historically each site accepted a different literal ('true'
 * vs '1' vs 'on'), so operators guessed. Now every boolean-like variable
 * accepts true/1/on/yes and false/0/off/no (any casing, padded ok) and derives
 * to a real boolean. Anything else — including unset and blank — returns
 * undefined so the field's default applies; out-of-family values are rejected
 * at boot by env.schema.ts anyway (undefined here is the safe fallback for
 * paths that skip validation, e.g. tests).
 */
export function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return undefined;
}

/** `Number(raw) || fallback` — NaN, 0 and '' all fall back (PORT, plugin limits). */
export function numberOr(raw: string | undefined, fallback: number): number {
  return Number(raw) || fallback;
}

/** Finite and > 0, else fallback (IDEMPOTENCY_TTL_SECONDS, OVERPASS_TIMEOUT_MS, BACKUP_*). */
export function positiveNumberOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `Number.parseInt` finite and > 0, else fallback (MCP_MAX_SESSION_PER_USER, MCP_RATE_LIMIT). */
export function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Comma-split + trim, null when unset — the websocket ALLOWED_ORIGINS variant (no empty-entry filter). */
export function csvList(raw: string | undefined): string[] | null {
  return raw ? raw.split(',').map((o) => o.trim()) : null;
}

/** Comma-split + trim + drop empties — the CORS ALLOWED_ORIGINS variant (globalMiddleware). */
export function csvListFiltered(raw: string | undefined): string[] | null {
  return raw
    ? raw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : null;
}

/** Strip ALL trailing slashes (`/\/+$/`) — notifications.getAppUrl / TRANSIT_API_URL variant. */
export function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_557_600_000,
};

/**
 * ms-style duration strings ('1h', '7d', '30d', …) → milliseconds, null when
 * invalid. Same grammar as the SESSION_DURATION parsing in src/config.ts.
 */
export function parseDurationMs(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * DURATION_UNITS_MS[(m[2] || 'ms').toLowerCase()];
}

/**
 * Session idle TTL in SECONDS via MCP_SESSION_TTL, default 1 hour, clamped to
 * 24h so a milliseconds-value typo can't produce a 1000-hour session.
 * (Same contract as src/mcp/config.ts, which commit 7 retires in favor of this.)
 */
export function resolveSessionTtlMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24 * 60 * 60) * 1000 : 60 * 60 * 1000;
}

/**
 * SSE keep-alive interval in SECONDS via MCP_SSE_KEEPALIVE, default 25s
 * (below common proxy idle timeouts like nginx-ingress's 60s). 0 disables.
 */
export function resolveKeepaliveMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : 25_000;
}
