import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RuntimeConfig {
	demoKeyHex: string;
	gatewayMacKeyHex?: string;
	tgos: {
		apiKey?: string;
	};
	tokens: Record<string, string>;
}

type RuntimeConfigFile = {
	demoKeyHex?: unknown;
	gatewayMacKeyHex?: unknown;
	tgos?: {
		apiKey?: unknown;
	};
	tokens?: unknown;
};

type RuntimeConfigEnv = Record<string, string | undefined>;

const runtimeEnvKeys = [
	"DOVETAIL_DEMO_KEY_HEX",
	"DOVETAIL_GATEWAY_MAC_KEY_HEX",
	"DOVETAIL_TGOS_API_KEY",
	"DOVETAIL_TOKENS_JSON",
] as const;

const runtimeConfigPath = join(runtimeWorkRoot(), "dovetail", "runtime.json");

// Default to a per-process key when no private config exists so local demo
// startup still works without forcing the secure bootstrap path.
function ephemeralRuntimeConfig(): RuntimeConfig {
	return {
		demoKeyHex: randomHex(16),
		tgos: {},
		tokens: {},
	};
}

// Environment values are the explicit mise+sops path; the file fallback keeps
// the existing tmpfs workflow working for local demos that already use rage.
export function loadRuntimeConfig(
	path: string,
	env: RuntimeConfigEnv = process.env,
): RuntimeConfig {
	return loadRuntimeConfigFromSources(readTextFile(path), env);
}

// Compose sources in authority order while preserving fallback fields that no
// explicit env value replaced; this keeps partial env from erasing file secrets.
export function loadRuntimeConfigFromSources(
	text: string | null,
	env: RuntimeConfigEnv,
): RuntimeConfig {
	const base =
		text === null ? ephemeralRuntimeConfig() : normalizeRuntimeConfig(text);
	return overlayRuntimeConfigEnv(base, env);
}

// Missing files are treated as "no private config", but other read failures
// are surfaced because they usually mean a broken secret boundary or bad path.
function readTextFile(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (isMissingPathError(error)) return null;
		throw error;
	}
}

function isMissingPathError(error: unknown): boolean {
	if (!isErrnoException(error)) return false;
	return error.code === "ENOENT";
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

// Env config is an overlay in source composition, so only fields represented by
// non-blank env values replace or extend values from the runtime file/fallback.
function overlayRuntimeConfigEnv(
	base: RuntimeConfig,
	env: RuntimeConfigEnv,
): RuntimeConfig {
	if (!runtimeEnvKeys.some((key) => hasEnvValue(env[key]))) return base;
	return {
		demoKeyHex: hasEnvValue(env.DOVETAIL_DEMO_KEY_HEX)
			? parseDemoKeyHex(env.DOVETAIL_DEMO_KEY_HEX)
			: base.demoKeyHex,
		...gatewayMacKeyOverlay(base, env),
		tgos: hasEnvValue(env.DOVETAIL_TGOS_API_KEY)
			? parseEnvTgos(env.DOVETAIL_TGOS_API_KEY)
			: base.tgos,
		tokens: hasEnvValue(env.DOVETAIL_TOKENS_JSON)
			? { ...base.tokens, ...parseEnvTokens(env.DOVETAIL_TOKENS_JSON) }
			: base.tokens,
	};
}

// Decode the private JSON shape once and fail fast on malformed files so we do
// not silently run with a half-configured secret boundary.
function normalizeRuntimeConfig(text: string): RuntimeConfig {
	const parsed = JSON.parse(text) as RuntimeConfigFile;
	const gatewayMacKeyHex = parseGatewayMacKeyHex(parsed.gatewayMacKeyHex);
	return {
		demoKeyHex: parseDemoKeyHex(parsed.demoKeyHex),
		...(gatewayMacKeyHex === undefined ? {} : { gatewayMacKeyHex }),
		tgos: parseTgos(parsed.tgos),
		tokens: parseTokens(parsed.tokens),
	};
}

// Keep mise-provided secrets flat because encrypted env files should not need
// runtime-specific nesting rules to stay readable and easy to audit.
export function parseRuntimeConfigEnv(
	env: RuntimeConfigEnv,
): RuntimeConfig | null {
	if (!runtimeEnvKeys.some((key) => hasEnvValue(env[key]))) return null;
	const gatewayMacKeyHex = parseGatewayMacKeyHex(
		blankToUndefined(env.DOVETAIL_GATEWAY_MAC_KEY_HEX),
	);
	return {
		demoKeyHex: parseDemoKeyHex(blankToUndefined(env.DOVETAIL_DEMO_KEY_HEX)),
		...(gatewayMacKeyHex === undefined ? {} : { gatewayMacKeyHex }),
		tgos: parseEnvTgos(env.DOVETAIL_TGOS_API_KEY),
		tokens: parseEnvTokens(env.DOVETAIL_TOKENS_JSON),
	};
}

function hasEnvValue(value: string | undefined): value is string {
	return value !== undefined && value !== "";
}

function blankToUndefined(value: string | undefined): string | undefined {
	return value === "" ? undefined : value;
}

function parseEnvTgos(value: string | undefined): RuntimeConfig["tgos"] {
	return hasEnvValue(value) ? { apiKey: value } : {};
}

function parseEnvTokens(value: string | undefined): Record<string, string> {
	if (!hasEnvValue(value)) return {};
	return parseTokens(JSON.parse(value));
}

function parseDemoKeyHex(value: unknown): string {
	if (value === undefined) return randomHex(16);
	if (typeof value !== "string" || !/^[0-9a-fA-F]{32}$/.test(value))
		throw new RangeError("demoKeyHex must be a 32-character hex string");
	return value.toLowerCase();
}

function parseGatewayMacKeyHex(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !/^[0-9a-fA-F]{32}$/.test(value))
		throw new RangeError("gatewayMacKeyHex must be a 32-character hex string");
	return value.toLowerCase();
}

// Preserve a configured gateway key unless the private env explicitly replaces
// it; absent env should not downgrade a file-backed production verification key.
function gatewayMacKeyOverlay(
	base: RuntimeConfig,
	env: RuntimeConfigEnv,
): Partial<RuntimeConfig> {
	const value = hasEnvValue(env.DOVETAIL_GATEWAY_MAC_KEY_HEX)
		? parseGatewayMacKeyHex(env.DOVETAIL_GATEWAY_MAC_KEY_HEX)
		: base.gatewayMacKeyHex;
	return value === undefined ? {} : { gatewayMacKeyHex: value };
}

function parseTgos(value: RuntimeConfigFile["tgos"]): RuntimeConfig["tgos"] {
	if (value?.apiKey === undefined) return {};
	if (typeof value.apiKey !== "string")
		throw new TypeError("tgos.apiKey must be a string");
	return { apiKey: value.apiKey };
}

// Tokens stay optional and server-only, but any provided map must be explicit
// so a typo or wrong JSON shape does not erase a private credential by accident.
function parseTokens(value: unknown): Record<string, string> {
	if (value === undefined) return {};
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("tokens must be a JSON object");
	const tokens: Record<string, string> = {};
	for (const [name, token] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (typeof token !== "string")
			throw new TypeError(`tokens.${name} must be a string`);
		tokens[name] = token;
	}
	return tokens;
}

function randomHex(byteLength: number): string {
	return Array.from(
		crypto.getRandomValues(new Uint8Array(byteLength)),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}

function runtimeWorkRoot(): string {
	return existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
}

export const runtimeConfig = loadRuntimeConfig(runtimeConfigPath);
export const parseRuntimeConfigText = normalizeRuntimeConfig;
