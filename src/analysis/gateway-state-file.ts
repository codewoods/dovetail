import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	createGatewayVerificationState,
	type GatewayVerificationState,
} from "./gateway-verification.ts";

type JsonRecord = Record<string, unknown>;

interface GatewayStateFile {
	readonly version: 1;
	readonly seen_replay_keys: readonly string[];
	readonly last_chain_mac_by_gateway: Readonly<Record<string, string>>;
}

const replayKeyPattern = /^[0-9a-f]{64}$/i;
const chainMacPattern = /^[0-9a-f]{64}$/i;

const isJsonRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const isMissingFileError = (error: unknown): boolean =>
	error instanceof Error &&
	"code" in error &&
	(error as { code?: string }).code === "ENOENT";

const invalidStateError = (path: string, reason: string): Error =>
	new Error(`invalid gateway verification state at ${path}: ${reason}`);

/**
 * Validate the on-disk JSON before reconstructing Sets/Maps. The state file is
 * operator-controlled runtime input, so version, replay-key shape, and chain
 * MAC values are all checked before they can influence gateway verification.
 */
const parseStateFile = (
	value: unknown,
	path: string,
): GatewayVerificationState => {
	if (!isJsonRecord(value)) throw invalidStateError(path, "root is not object");
	if (value.version !== 1) throw invalidStateError(path, "unsupported version");
	const replayKeys = parseReplayKeys(value.seen_replay_keys, path);
	const chainHeads = parseChainHeads(value.last_chain_mac_by_gateway, path);
	return {
		seenReplayKeys: new Set(replayKeys),
		lastChainMacByGateway: chainHeads,
	};
};

/**
 * Replay keys are lower-cased and de-duplicated while loading so the persisted
 * file cannot create case-sensitive duplicates that differ from runtime checks.
 */
const parseReplayKeys = (value: unknown, path: string): readonly string[] => {
	if (!Array.isArray(value))
		throw invalidStateError(path, "seen_replay_keys is not array");
	return [
		...new Set(
			value.map((entry) => {
				if (typeof entry !== "string" || !replayKeyPattern.test(entry))
					throw invalidStateError(path, "invalid replay key");
				return entry.toLowerCase();
			}),
		),
	];
};

/**
 * Chain heads stay keyed by gateway_id so independent gateways can advance
 * their audit chains without sharing one global previous_chain_mac value.
 */
const parseChainHeads = (
	value: unknown,
	path: string,
): ReadonlyMap<string, string> => {
	if (!isJsonRecord(value))
		throw invalidStateError(path, "last_chain_mac_by_gateway is not object");
	return new Map(
		Object.entries(value).map(([gatewayId, chainMac]) => {
			if (typeof chainMac !== "string" || !chainMacPattern.test(chainMac))
				throw invalidStateError(path, "invalid chain head");
			return [gatewayId, chainMac.toLowerCase()];
		}),
	);
};

/**
 * Serialize Maps/Sets into stable JSON so diffs and incident reviews see a
 * deterministic file. Sorting is not a security boundary; it keeps local
 * operator artifacts understandable when state must be inspected.
 */
const stateFileFrom = (state: GatewayVerificationState): GatewayStateFile => {
	const seenReplayKeys = [...state.seenReplayKeys].map((key) =>
		key.toLowerCase(),
	);
	const chainHeadEntries: Array<[string, string]> = [
		...state.lastChainMacByGateway.entries(),
	].map(([gatewayId, chainMac]) => [gatewayId, chainMac.toLowerCase()]);
	const lastChainMacByGateway = Object.fromEntries(
		chainHeadEntries.sort(([left], [right]) => left.localeCompare(right)),
	);
	return {
		version: 1,
		seen_replay_keys: seenReplayKeys.sort(),
		last_chain_mac_by_gateway: lastChainMacByGateway,
	};
};

/**
 * Load configured gateway verification state. Missing files intentionally start
 * empty, while unreadable or malformed files fail with path context so ingress
 * can reject instead of silently downgrading replay protection.
 */
export const loadGatewayVerificationStateFromFile = async (
	path: string,
): Promise<GatewayVerificationState> => {
	try {
		const raw = await readFile(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		return parseStateFile(parsed, path);
	} catch (error) {
		if (isMissingFileError(error)) return createGatewayVerificationState();
		throw new Error(
			`failed to load gateway verification state from ${path}: ${errorMessage(error)}`,
		);
	}
};

/**
 * Persist state with temp-file + rename so a crash cannot leave a partially
 * written JSON document at the configured path. Save errors carry path context
 * and are propagated to the HTTP fail-closed gateway verification path.
 */
export const saveGatewayVerificationStateToFile = async (
	path: string,
	state: GatewayVerificationState,
): Promise<void> => {
	const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await writeFile(
			tempPath,
			`${JSON.stringify(stateFileFrom(state), null, 2)}\n`,
			{
				mode: 0o600,
			},
		);
		await rename(tempPath, path);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw new Error(
			`failed to save gateway verification state to ${path}: ${errorMessage(error)}`,
		);
	}
};
