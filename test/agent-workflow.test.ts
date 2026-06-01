import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

type PackageJson = {
	scripts?: Record<string, string>;
};

const rootEntrypoints = ["SPEC.md", "PERSONA.md", "LIMITATIONS.md"] as const;
const sourceFirstTerms = [
	"bun install",
	"make verify",
	"make dev",
	"`examples/packets-batch.json`",
	"`/api/packets`",
	"`/api/hazard-zone`",
	"`/api/openapi.json`",
	"Input",
	"Function",
	"Output",
] as const;
const qualityGateTerms = [
	"Spec before behavior change",
	"data/source can be checked",
	"Do not rely on Semgrep",
	"third-party scanner",
	"secrets boundary",
	"crypto boundary",
	"input validation",
	"PII minimization",
	"replay/MAC",
	"client exposure",
	"`make verify` is the done gate",
] as const;
const evaluatorDocs = [
	"docs/public/integration-guide.md",
	"docs/public/security-assurance.md",
] as const;
const requestUrlTestFiles = [
	"test/agency-export-api.test.ts",
	"test/gateway-verification.test.ts",
	"test/openapi-docs.test.ts",
	"test/rate-limit.test.ts",
	"test/security-boundary.test.ts",
] as const;

/** Read fixture docs through one handled path so stale-file failures keep context. */
const read = (path: string): string => {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(`Unable to read ${path}`, { cause: error });
	}
};

/** Parse JSON fixtures through the same file-aware boundary as plain text docs. */
const readJson = <T>(path: string): T => {
	try {
		return JSON.parse(read(path)) as T;
	} catch (error) {
		throw new Error(`Unable to parse ${path}`, { cause: error });
	}
};

const assertFilesExist = (paths: readonly string[]) => {
	for (const path of paths) expect(existsSync(path)).toBe(true);
};

const assertContainsAll = (text: string, terms: readonly string[]) => {
	for (const term of terms) expect(text).toContain(term);
};

const assertOmitsAll = (text: string, terms: readonly string[]) => {
	for (const term of terms) expect(text).not.toContain(term);
};

const assertFileContainsAll = (path: string, terms: readonly string[]) => {
	const text = read(path);
	assertContainsAll(text, terms);
};

const assertFileOmitsAll = (path: string, terms: readonly string[]) => {
	const text = read(path);
	assertOmitsAll(text, terms);
};

/** Root docs are the evaluator contract, so README links must mirror them. */
const assertRootEntrypoints = () => {
	const readme = read("README.md");
	const spec = read("SPEC.md");
	const limitations = read("LIMITATIONS.md");
	assertFilesExist(rootEntrypoints);
	assertContainsAll(readme, rootEntrypoints);
	expect(spec).toContain("不做處置建議");
	expect(limitations).toContain("主動列出限制");
};

/**
 * Secret setup must stay opt-in and separate from the default agent path.
 *
 * Sensitive literals are assembled at runtime so this test source can be shipped
 * without broadcasting the AGE secret-key prefix verbatim, and the age recipient
 * is asserted via shape (regex) rather than a pinned value so key rotation does
 * not require editing this test.
 */
const assertPrivateSecretsStayOutOfDefaultWorkflow = () => {
	const ageSecretPrefix = ["AGE", "SECRET", "KEY"].join("-") + "-";
	const ageRecipientPattern = /age1[02-9ac-hj-np-z]{50,}/;
	const mise = read("mise.toml");
	const privateMise = read("mise.secrets.toml");
	const exampleEnv = read(".env.runtime.example.json");
	const sopsYaml = read(".sops.yaml");
	const gitAttributes = read(".gitattributes");
	const gitIgnore = read(".gitignore");
	const reproduce = read("docs/developer/reproduce.md");
	assertFilesExist([
		"mise.secrets.toml",
		".env.runtime.example.json",
		".env.runtime.sops.json",
		".sops.yaml",
	]);
	expect(mise).not.toContain(".env.runtime.sops.json");
	assertContainsAll(mise, ['sops = "3.13.1"']);
	assertContainsAll(privateMise, [".env.runtime.sops.json", "redact = true"]);
	assertContainsAll(exampleEnv, ["DOVETAIL_DEMO_KEY_HEX"]);
	expect(exampleEnv).not.toContain(ageSecretPrefix);
	expect(read(".env.runtime.sops.json")).not.toContain(ageSecretPrefix);
	expect(sopsYaml).toContain(".env\\.runtime\\.sops\\.json");
	expect(sopsYaml).toMatch(ageRecipientPattern);
	expect(sopsYaml).not.toContain(ageSecretPrefix);
	assertContainsAll(gitAttributes, [
		"*.enc.yaml",
		".env.runtime.sops.json",
		"diff=sopsdiffer",
	]);
	assertContainsAll(gitIgnore, [".env", ".env.*.local", ".env.runtime.json"]);
	expect(gitIgnore).not.toContain("enc.yaml");
	assertContainsAll(reproduce, [
		"Agents must not run private secret decrypt commands",
	]);
	expect(reproduce).toMatch(/sops\/age/);
};

/** Firmware docs and package scripts share the same Makefile verification entry. */
const assertFirmwareBoundaryAndVerifyScript = () => {
	const packageJson = readJson<PackageJson>("package.json");
	const makefile = read("Makefile");
	assertFilesExist(["firmware/README.md"]);
	assertFileContainsAll("firmware/README.md", [
		"hardware-neutral low-bandwidth device profile",
		"SPEC.md",
	]);
	expect(packageJson.scripts?.verify).toBe("make verify");
	expect(packageJson.scripts?.["pre-push"]).toBe("make pre-push");
	expect(packageJson.scripts?.["data:hazard"]).toBe("make data-hazard");
	expect(packageJson.scripts?.["data:pmtiles"]).toBe("make data-pmtiles");
	expect(packageJson.scripts?.dev).toBe("make dev");
	expect(packageJson.scripts?.deploy).toBeUndefined();
	assertContainsAll(makefile, [
		"dev:\n\tbun run --hot src/server.ts",
		"verify: lint pre-push",
		"pre-push: typecheck knip test",
		"verify-docs:",
		"verify-contract: typecheck",
		"test-file:",
	]);
	assertOmitsAll(makefile, [
		"dev: runtime-prepare",
		"verify: runtime-prepare",
		"verify-contract: runtime-prepare",
	]);
};

/** Contract verification must fail on data-lineage or gateway drift, not just types. */
const assertContractGateCoversDataGovernance = () => {
	const makefile = read("Makefile");
	const spec = read("SPEC.md");
	assertContainsAll(makefile, [
		"test/schema-consistency.test.ts",
		"test/replay.test.ts",
		"test/data-lineage.test.ts",
		"test/gateway-verification.test.ts",
		"test/agency-export.test.ts",
		"test/scenarios.test.ts",
	]);
	assertContainsAll(spec, [
		"canonical lineage fixture",
		"drift gate",
		"packet enum",
		"demo scenarios",
		"verification_mode",
		"chain MAC",
	]);
};

/** Hook activation is part of reproducibility, so fresh checkouts must self-install hooks. */
const assertGitHooksInstallFromPackageLifecycle = () => {
	const packageJson = readJson<PackageJson>("package.json");
	const reproduce = read("docs/developer/reproduce.md");
	const hookInstall = packageJson.scripts?.["hooks:install"] ?? "";
	expect(packageJson.scripts?.prepare).toBe("bun run hooks:install");
	expect(hookInstall).toContain("git rev-parse --is-inside-work-tree");
	expect(hookInstall).toContain("lefthook install");
	assertContainsAll(reproduce, [
		"`bun install` runs `prepare`",
		"`hooks:install` first checks for a Git worktree",
		"skip hook installation without failing `bun install`",
		"`commit-msg` runs Commitlint",
	]);
};

/** Quick-start docs must keep the no-key local path obvious to evaluators. */
const assertBeginnerReproductionDocs = () => {
	const readme = read("README.md");
	const reproduce = read("docs/developer/reproduce.md");
	expect(existsSync("docs/readme.md")).toBe(false);
	assertFilesExist(["docs/developer/reproduce.md"]);
	assertContainsAll(readme, sourceFirstTerms);
	assertOmitsAll(readme, [
		"-d '[{...},{...}]'",
		"Built With",
		"React",
		"Flux",
		"Django",
		"Acknowledgments",
	]);
	assertContainsAll(reproduce, [
		"make data-all",
		"public-safe derived geometry",
	]);
	assertOmitsAll(reproduce, ["local Worker", "Start local Worker"]);
};

/** The quality gate text is a security contract, not a generic checklist. */
const assertSecurityOrientedQualityGate = () => {
	assertFileContainsAll("AGENTS.md", qualityGateTerms);
};

/** Docs filenames remain predictable for non-engineer maintainers. */
const assertDocsFileNames = () => {
	assertFilesExist([
		"SPEC.md",
		"docs/developer/client-sample.md",
		"docs/maintainer/non-engineer-guide.md",
	]);
	expect(existsSync("docs/readme.md")).toBe(false);
};

/** Maintainer docs expose the non-code paths needed by local government users. */
const assertMaintainerEntryPoints = () => {
	const readme = read("README.md");
	assertFilesExist([
		"docs/maintainer/non-engineer-guide.md",
		"docs/maintainer/journey-test-matrix.md",
		"docs/maintainer/agency-data-dictionary.md",
	]);
	assertContainsAll(readme, [
		"docs/maintainer/non-engineer-guide.md",
		"docs/maintainer/journey-test-matrix.md",
		"docs/maintainer/agency-data-dictionary.md",
	]);
	assertFileContainsAll("docs/maintainer/non-engineer-guide.md", [
		"Do not edit `src/`",
		"BCP 47",
		"terrain_event:big_flood",
		"Do Not Edit Without Engineering Review",
	]);
	assertFileContainsAll("docs/maintainer/agency-data-dictionary.md", [
		"not an authentication or authorization system",
		"verification_mode=verified",
		"timeConfidence",
		"same_kind_nearby_duplicate",
	]);
};

/** Public docs are the external integration map and must stay README-linked. */
const assertEvaluatorFacingDocs = () => {
	const readme = read("README.md");
	assertFilesExist(evaluatorDocs);
	assertContainsAll(readme, evaluatorDocs);
	assertFileOmitsAll("docs/public/integration-guide.md", ["Google Chat"]);
	assertFilesExist(["docs/developer/security-test-plan.md"]);
	assertFileContainsAll("docs/developer/security-test-plan.md", [
		"Penetration Test Plan",
	]);
	assertFileContainsAll("docs/public/integration-guide.md", [
		"紀錄現場訊號，不增加現場判斷",
	]);
};

/** Public assurance docs should expose the AI and secret trust boundary. */
const assertAiAndSecretBoundaries = () => {
	const security = read("docs/public/security-assurance.md");
	assertContainsAll(security, [
		"AI-assisted development",
		"agent trust boundary",
		"ciphertext only",
		"Nonce / counter binding",
		"same-ciphertext replay rejection requires production replay-window storage",
	]);
	assertOmitsAll(security, ["| Replay resistance |"]);
};

/** Security assurance must not overstate the 32-bit AEAD tag profile. */
const assertAeadProfileDisclosure = () => {
	const spec = read("SPEC.md");
	const security = read("docs/public/security-assurance.md");
	assertContainsAll(spec, [
		"32-bit constrained",
		"not a general-purpose high-assurance profile",
		"ChaCha20-Poly1305",
	]);
	assertContainsAll(security, [
		"32-bit constrained AEAD profile",
		"not a general-purpose high-assurance network profile",
		"96-bit or 128-bit tags",
	]);
};

/** Gateway key rotation belongs to production governance, not hidden MVP magic. */
const assertGatewayKeyRotationBoundary = () => {
	const spec = read("SPEC.md");
	const security = read("docs/public/security-assurance.md");
	const threatModel = read("docs/developer/security-test-plan.md");
	assertContainsAll(spec, [
		"single active gateway MAC key",
		"`kid`",
		"active signing",
		"verify-only retire window",
	]);
	assertContainsAll(security, [
		"Gateway key rotation",
		"active signing key",
		"verify-only retired keys",
		"revocation drill",
	]);
	assertContainsAll(threatModel, [
		"rotation drill",
		"verify-only retire window",
		"`kid`",
	]);
};

/** Replay storage docs must separate AEAD nonce replay from JSON dedupe. */
const assertReplayStoreBoundary = () => {
	const spec = read("SPEC.md");
	const security = read("docs/public/security-assurance.md");
	assertContainsAll(spec, [
		"AEAD nonce replay store",
		"`device_mac || packet_type || packet_counter`",
		"JSON replay key",
		"DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH",
		"shared store TTL",
	]);
	assertContainsAll(security, [
		"Shared replay store",
		"AEAD nonce tuple",
		"JSON replay key",
		"DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH",
		"process restart",
	]);
};

/** Request URL fixtures should use the reserved documentation domain, without preserving the old test TLD. */
const assertTestRequestUrlsUseExampleOrg = () => {
	const oldTld = ["example", "test"].join(".");
	for (const path of requestUrlTestFiles) {
		const text = read(path);
		expect(text).not.toContain(oldTld);
		expect(text).toContain("example.org");
	}
};

it(
	"keeps root evaluator entry points concise and discoverable",
	assertRootEntrypoints,
);
it(
	"keeps private runtime secrets out of the default agent workflow",
	assertPrivateSecretsStayOutOfDefaultWorkflow,
);
it(
	"documents firmware boundary and exposes a verify script",
	assertFirmwareBoundaryAndVerifyScript,
);
it(
	"keeps the contract gate tied to data-governance drift checks",
	assertContractGateCoversDataGovernance,
);
it(
	"installs Git hooks from the package lifecycle",
	assertGitHooksInstallFromPackageLifecycle,
);
it(
	"keeps beginner reproduction instructions discoverable",
	assertBeginnerReproductionDocs,
);
it(
	"keeps the AGENTS quality gate compact and security-oriented",
	assertSecurityOrientedQualityGate,
);
it("keeps docs filenames lowercase kebab-case", assertDocsFileNames);
it(
	"keeps non-engineer GIS teaching and maintenance entry points discoverable",
	assertMaintainerEntryPoints,
);
it(
	"keeps evaluator-facing entry points discoverable",
	assertEvaluatorFacingDocs,
);
it(
	"keeps government-facing AI and secret boundaries explicit",
	assertAiAndSecretBoundaries,
);
it("discloses the constrained AEAD tag profile", assertAeadProfileDisclosure);
it("documents gateway key rotation boundary", assertGatewayKeyRotationBoundary);
it("documents replay store boundary", assertReplayStoreBoundary);
it(
	"keeps test request URLs on example.org",
	assertTestRequestUrlsUseExampleOrg,
);
