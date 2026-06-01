import { describe, expect, it } from "vitest";
import {
	loadRuntimeConfig,
	loadRuntimeConfigFromSources,
	parseRuntimeConfigEnv,
	parseRuntimeConfigText,
	runtimeConfig,
} from "../src/config/runtime.ts";

describe("runtime config", () => {
	it("provides a valid in-memory demo key by default", () => {
		expect(runtimeConfig.demoKeyHex).toMatch(/^[0-9a-f]{32}$/);
	});

	it("parses a private runtime config payload", () => {
		const demoKeyParts = ["00112233", "44556677", "8899aabb", "ccddeeff"];
		const config = parseRuntimeConfigText(
			JSON.stringify({
				demoKeyHex: demoKeyParts.join(""),
				gatewayMacKeyHex: "42424242424242424242424242424242",
				tgos: { apiKey: "tgos-demo-key" },
				tokens: { maps: "token-1" },
			}),
		);
		expect(config.demoKeyHex).toBe(demoKeyParts.join(""));
		expect(config.gatewayMacKeyHex).toBe("42424242424242424242424242424242");
		expect(config.tgos.apiKey).toBe("tgos-demo-key");
		expect(config.tokens.maps).toBe("token-1");
	});

	it("rejects malformed private token payloads", () => {
		expect(() =>
			parseRuntimeConfigText(JSON.stringify({ tokens: ["not-an-object"] })),
		).toThrow("tokens must be a JSON object");
	});

	it("rejects non-string private token values", () => {
		expect(() =>
			parseRuntimeConfigText(JSON.stringify({ tokens: { maps: 123 } })),
		).toThrow("tokens.maps must be a string");
	});

	it("rejects non-string private TGOS API keys", () => {
		expect(() =>
			parseRuntimeConfigText(JSON.stringify({ tgos: { apiKey: 123 } })),
		).toThrow("tgos.apiKey must be a string");
	});

	it("rejects malformed gateway MAC keys", () => {
		expect(() =>
			parseRuntimeConfigText(JSON.stringify({ gatewayMacKeyHex: "short" })),
		).toThrow("gatewayMacKeyHex must be a 32-character hex string");
	});

	it("overlays partial private env vars on file runtime config", () => {
		const config = loadRuntimeConfigFromSources(
			JSON.stringify({
				demoKeyHex: "00112233445566778899aabbccddeeff",
				tokens: { maps: "file-token" },
			}),
			{ DOVETAIL_TGOS_API_KEY: "env-tgos-key" },
		);
		expect(config).toEqual({
			demoKeyHex: "00112233445566778899aabbccddeeff",
			tgos: { apiKey: "env-tgos-key" },
			tokens: { maps: "file-token" },
		});
	});

	it("throws non-missing runtime config read failures", () => {
		expect(() => loadRuntimeConfig(".", {})).toThrow(/EISDIR/);
	});

	it("throws runtime config paths below files", () => {
		expect(() => loadRuntimeConfig("/dev/null/runtime.json", {})).toThrow(
			/ENOTDIR/,
		);
	});

	it("parses private mise env vars without reading a runtime file", () => {
		const config = parseRuntimeConfigEnv({
			DOVETAIL_DEMO_KEY_HEX: "AABB2233445566778899AABBCCDDEEFF",
			DOVETAIL_GATEWAY_MAC_KEY_HEX: "42424242424242424242424242424242",
			DOVETAIL_TGOS_API_KEY: "tgos-demo-key",
			DOVETAIL_TOKENS_JSON: JSON.stringify({ maps: "token-1" }),
		});
		expect(config).toEqual({
			demoKeyHex: "aabb2233445566778899aabbccddeeff",
			gatewayMacKeyHex: "42424242424242424242424242424242",
			tgos: { apiKey: "tgos-demo-key" },
			tokens: { maps: "token-1" },
		});
	});

	it("ignores absent private mise env vars", () => {
		expect(parseRuntimeConfigEnv({})).toBeNull();
		expect(
			parseRuntimeConfigEnv({
				DOVETAIL_DEMO_KEY_HEX: "",
				DOVETAIL_TGOS_API_KEY: "",
				DOVETAIL_TOKENS_JSON: "",
			}),
		).toBeNull();
	});

	it("rejects malformed private mise env vars", () => {
		expect(() =>
			parseRuntimeConfigEnv({ DOVETAIL_DEMO_KEY_HEX: "not-hex" }),
		).toThrow("demoKeyHex must be a 32-character hex string");
		expect(() =>
			parseRuntimeConfigEnv({ DOVETAIL_GATEWAY_MAC_KEY_HEX: "not-hex" }),
		).toThrow("gatewayMacKeyHex must be a 32-character hex string");
		expect(() =>
			parseRuntimeConfigEnv({ DOVETAIL_TOKENS_JSON: '["not-an-object"]' }),
		).toThrow("tokens must be a JSON object");
	});
});
