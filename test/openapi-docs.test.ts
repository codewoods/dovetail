import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../src/demo/scenarios.ts";
import worker from "../src/index.ts";
import { openApiSpec } from "../src/openapi.ts";

/**
 * Build JSON requests separately so tests exercise the same Worker boundary while
 * keeping request serialization explicit and reusable across codec calls.
 */
const jsonRequest = (url: string, body: unknown): Request => {
	const payload = JSON.stringify(body);
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: payload,
	});
};

const postJson = (url: string, body: unknown): Promise<Response> => {
	const request = jsonRequest(url, body);
	return worker.fetch(request);
};

describe("openapi docs", () => {
	it("does not serve a YAML OpenAPI endpoint", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/api/openapi.yaml", { method: "GET" }),
		);
		expect(response.status).toBe(404);
	});

	it("serves a Scalar HTML reference backed by the JSON contract", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/api/docs", { method: "GET" }),
		);
		const body = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("text/html");
		expect(body).toContain("Scalar.createApiReference");
		expect(body).toContain('src="/vendor/scalar-api-reference.js"');
		expect(body).toContain("url: '/api/openapi.json'");
		expect(body).toContain("telemetry: false");
		expect(body).not.toContain("https://");
	});

	it("documents the revised security contract in OpenAPI descriptions", () => {
		expect(
			openApiSpec.components.schemas.Envelope.properties.chain_mac.description,
		).toContain("length-framed");
		expect(
			openApiSpec.components.schemas.VerificationMode.description,
		).toContain("audit mode");
		expect(
			openApiSpec.components.schemas.EncodeResponse.properties.counter
				.description,
		).toContain("server-assigned");
		expect(
			openApiSpec.components.schemas.Envelope.properties.aead_profile
				.description,
		).toContain("32-bit constrained");
	});

	it("serves Scalar from a same-origin vendor asset for offline demos", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/vendor/scalar-api-reference.js", {
				method: "GET",
			}),
		);
		const body = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("text/javascript");
		expect(body).toContain("createApiReference");
	});

	it("keeps real decode responses inside the documented PacketJson envelope", async () => {
		const scenario = DEMO_SCENARIOS.at(0);
		if (!scenario) throw new Error("missing demo scenario fixture");
		const packet = scenario.packets.at(0);
		if (!packet) throw new Error("missing demo packet fixture");
		const encoded = await postJson("https://example.org/api/codec/encode", {
			packet,
		});
		const frame = (await encoded.json()) as { hex: string; counter: number };
		const decoded = await postJson("https://example.org/api/codec/decode", {
			hex: frame.hex,
			counter: frame.counter,
			mac: packet.packet.mac,
		});
		const body = (await decoded.json()) as {
			packet: { envelope: { chain_mac: string } };
		};
		const pattern =
			openApiSpec.components.schemas.Envelope.properties.chain_mac.pattern;
		expect(body.packet.envelope.chain_mac).toMatch(new RegExp(pattern));
	});
});
