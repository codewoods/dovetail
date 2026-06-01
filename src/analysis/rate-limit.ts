/**
 * In-process sliding-window rate limiter per spec §8.1.3. The analysis-component
 * is a single-process Bun.serve target by default, so a Map<source, timestamps>
 * is enough to bound ingress; horizontal deployments delegate to a front-line
 * reverse proxy and disable this layer via createRateLimiter caller policy.
 *
 * The state object is the caller's responsibility — passing it in keeps the
 * limiter itself a pure function of (state, source, nowMs) and lets vitest
 * exercise window edges without leaking globals across tests.
 */
export const RATE_LIMIT_PER_MIN = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export type RateLimiterState = Map<string, number[]>;

export const createRateLimiterState = (): RateLimiterState => new Map();

export type RateLimitOutcome =
	| { allowed: true; remaining: number }
	| { allowed: false; retryAfterMs: number };

export interface RateLimitInput {
	state: RateLimiterState;
	source: string;
	nowMs: number;
	limit?: number;
	windowMs?: number;
}

/**
 * Drop expired timestamps, then either record `nowMs` and return remaining or
 * reject with the wait time until the oldest in-window hit expires. Caller
 * mutates the shared state Map in place so the limiter stays O(window-hits).
 */
export const rateLimit = ({
	state,
	source,
	nowMs,
	limit = RATE_LIMIT_PER_MIN,
	windowMs = RATE_LIMIT_WINDOW_MS,
}: RateLimitInput): RateLimitOutcome => {
	// Drop hits outside the trailing window AND any future-dated hits that a
	// backwards wall-clock step (NTP correction, container clock skew) could
	// have left behind. Without the future-drop the limiter would stay stuck
	// rejecting until the window slid past the stale future timestamp.
	const cutoff = nowMs - windowMs;
	const hits = (state.get(source) ?? []).filter(
		(ts) => ts > cutoff && ts <= nowMs,
	);
	if (hits.length >= limit) {
		const oldest = hits[0] ?? nowMs;
		state.set(source, hits);
		return {
			allowed: false,
			retryAfterMs: Math.max(0, oldest + windowMs - nowMs),
		};
	}
	hits.push(nowMs);
	state.set(source, hits);
	return { allowed: true, remaining: limit - hits.length };
};

/**
 * Extract source identifier per spec §8.1.3. `x-source-id` / `x-forwarded-for`
 * are client-controllable absent a trusted reverse proxy, so the headers are
 * only honoured when the caller asserts the deployment sits behind a trusted
 * proxy. Default collapses all callers to a single "unknown" bucket so the
 * 60/min budget actually bounds an unauthenticated public endpoint.
 */
export interface SourceIdOptions {
	trustProxyHeaders: boolean;
}

export const sourceIdFromHeaders = (
	headers: Headers,
	{ trustProxyHeaders }: SourceIdOptions = { trustProxyHeaders: false },
): string => {
	if (!trustProxyHeaders) return "unknown";
	const explicit = headers.get("x-source-id");
	if (explicit) return explicit;
	const forwarded = headers.get("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
	return "unknown";
};
