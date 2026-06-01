import worker, { securityPostureBanner } from "./index.ts";

/**
 * Bun runtime entry — wraps the runtime-agnostic fetch handler from index.ts.
 * Keeping handler logic in one place lets the offline laptop demo, vitest suites,
 * and any future host (Node http, Deno, Docker, edge) share the same protocol path.
 * Port defaults to 9000 so the prior dev URL keeps working.
 */
const port = startServer();
console.log(`dovetail server listening on http://localhost:${port}`);
console.log(securityPostureBanner());

// Try the requested port first, then walk upward a few slots so a stray local
// listener does not block the demo. We keep the server reference alive at module
// scope because Bun.serve returns the active listener handle.
function startServer(): number {
	const preferredPort = Number(Bun.env.PORT ?? 9000);
	for (let offset = 0; offset < 10; offset += 1) {
		const port = preferredPort + offset;
		try {
			bindServer(port);
			return port;
		} catch (error) {
			if (!isPortInUseError(error)) throw error;
		}
	}
	throw new Error(`Unable to start Bun server from port ${preferredPort}`);
}

// Bind the Bun server once the port scanner has picked a free slot. Keeping the
// handle on globalThis prevents it from being garbage-collected.
function bindServer(port: number): void {
	(
		globalThis as { __dovetailServer?: ReturnType<typeof Bun.serve> }
	).__dovetailServer = Bun.serve({
		port,
		fetch: (request) => worker.fetch(request),
	});
}

// Bun throws an address-in-use error when the port is already bound; only that
// case should trigger the fallback scan so we do not hide real server startup bugs.
function isPortInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code?: string }).code === "EADDRINUSE"
	);
}
