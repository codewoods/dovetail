import { describe, expect, it } from "vitest";
import {
	createRateLimiterState,
	RATE_LIMIT_PER_MIN,
	RATE_LIMIT_WINDOW_MS,
	rateLimit,
	sourceIdFromHeaders,
} from "../src/analysis/rate-limit.ts";
import worker, { __resetForTests } from "../src/index.ts";

const TRUST = { trustProxyHeaders: true } as const;

const takeRateLimit = (
	state: ReturnType<typeof createRateLimiterState>,
	source: string,
	nowMs: number,
) => rateLimit({ state, source, nowMs });

const examplePacket = () => ({
	type: "person_report" as const,
	envelope: {
		received_at: "2025-09-28T11:20:10Z",
		gateway_id: "G1",
		aead_profile: "aead-gcm-128" as const,
		chain_mac: "a".repeat(64),
	},
	packet: {
		mac: "5C8AF3000001",
		village: 1003012,
		ts: 1759058400,
		lat: 0.125,
		lng: 0.25,
		alt: 130,
		addr: "MOCK01",
		count: 6,
		status: "evacuated_shelter" as const,
		flags: [] as const,
	},
});

describe("rateLimit helper", () => {
	it("allows up to RATE_LIMIT_PER_MIN hits inside the window", () => {
		const state = createRateLimiterState();
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++)
			expect(takeRateLimit(state, "client", 1000 + i).allowed).toBe(true);
		const next = takeRateLimit(state, "client", 1000 + RATE_LIMIT_PER_MIN);
		expect(next.allowed).toBe(false);
	});

	it("re-admits the source after the window slides past oldest hit", () => {
		const state = createRateLimiterState();
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++)
			takeRateLimit(state, "client", 1000 + i);
		const later = takeRateLimit(
			state,
			"client",
			1000 + RATE_LIMIT_WINDOW_MS + 1,
		);
		expect(later.allowed).toBe(true);
	});

	it("isolates sources by identifier", () => {
		const state = createRateLimiterState();
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++)
			takeRateLimit(state, "alpha", 1000 + i);
		expect(takeRateLimit(state, "beta", 2000).allowed).toBe(true);
	});

	it("recovers when wall clock steps backwards (drops future-dated hits)", () => {
		const state = createRateLimiterState();
		// Fill the budget at t=10_000ms.
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++)
			takeRateLimit(state, "client", 10_000 + i);
		// Wall clock then jumps back to t=5000ms (e.g. NTP correction). Without
		// future-drop the limiter would reject for the next 60s; with it, the
		// stale future hits are discarded so the source is admitted immediately.
		expect(takeRateLimit(state, "client", 5000).allowed).toBe(true);
	});
});

describe("sourceIdFromHeaders", () => {
	it("collapses to 'unknown' by default to bound the public endpoint", () => {
		expect(
			sourceIdFromHeaders(new Headers({ "x-source-id": "router-7" })),
		).toBe("unknown");
		expect(
			sourceIdFromHeaders(
				new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" }),
			),
		).toBe("unknown");
	});

	it("honours x-source-id then x-forwarded-for only when proxy headers are trusted", () => {
		expect(
			sourceIdFromHeaders(new Headers({ "x-source-id": "router-7" }), TRUST),
		).toBe("router-7");
		expect(
			sourceIdFromHeaders(
				new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" }),
				TRUST,
			),
		).toBe("10.0.0.1");
		expect(sourceIdFromHeaders(new Headers(), TRUST)).toBe("unknown");
	});
});

describe("/api/packets rate limit boundary", () => {
	it("returns 429 with Retry-After once the source exceeds the budget", async () => {
		__resetForTests();
		const body = JSON.stringify([examplePacket()]);
		const send = (): Promise<Response> => {
			const request = new Request("https://example.org/api/packets", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-source-id": "burst-tester",
				},
				body,
			});
			return worker.fetch(request);
		};
		// Fire exactly RATE_LIMIT_PER_MIN requests, all must be admitted.
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
			const response = await send();
			expect(response.status).toBe(200);
		}
		const overflow = await send();
		const retryAfter = overflow.headers.get("Retry-After");
		expect(overflow.status).toBe(429);
		expect(retryAfter).toBeTruthy();
		expect(await overflow.json()).toEqual({ error: "rate_limited" });
	});

	it("rate-limits non-JSON 415 floods so attackers cannot bypass the budget", async () => {
		__resetForTests();
		const send = (): Promise<Response> => {
			const request = new Request("https://example.org/api/packets", {
				method: "POST",
				headers: {
					"content-type": "text/plain",
					"x-source-id": "flood-tester",
				},
				body: "garbage",
			});
			return worker.fetch(request);
		};
		for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
			const response = await send();
			expect(response.status).toBe(415);
		}
		const overflow = await send();
		expect(overflow.status).toBe(429);
	});
});
