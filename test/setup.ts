import { beforeEach } from "vitest";
import { __resetForTests } from "../src/index.ts";

// Reset the shared in-process rate limiter between tests so suites that fire
// many requests don't trip §8.1.3's 60/min budget on shared "unknown" sources.
// Also opt every test suite into the demo ingest path by default; gateway
// verification specs that need the fail-closed default re-delete the flag
// inside the test body. This keeps unrelated suites focused on their own
// behaviour without each one having to know about §8.0.1 env wiring.
beforeEach(() => {
	__resetForTests();
	process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST = "1";
});
