# Reproduce and Maintain

This guide is the first stop for a new contributor who wants to reproduce the project from a clean checkout.

## 1. Tooling

Required:

| Tool | Purpose | Check |
|---|---|---|
| Bun 1.3+ | test, typecheck, local Bun dev | `bun --version` |
| GDAL 3.8+ with PMTiles driver | hazard layer and PMTiles build | `ogr2ogr --formats | grep PMTiles` |
| jq | remove protected address fields from public GeoJSON | `jq --version` |
| rage + rage-keygen | optional encrypted private runtime config | `rage --version` / `rage-keygen --version` |

Optional:

| Tool | Purpose |
|---|---|
| mise | install the versions in `mise.toml` |
| curl | API smoke tests |
| openssl | optional local runtime config bootstrap |

## 2. Fresh Checkout

```sh
git clone <repo-url>
cd dovetail
bun install
make verify
```

Expected result:

```text
make verify exits 0 after lint, typecheck, knip, and Vitest checks.
```

Readable demo color pairs are part of the quality gate. `make verify` runs the
APCA audit through `make lint-contrast`; use `bun run contrast` when iterating on
demo palette changes.

## 2.1 Verification and Hooks

Static checks are split into two layers:

- `make lint` runs fast checks: Biome, Oxlint, and the APCA contrast audit.
- `make pre-push` runs whole-tree gates: TypeScript, Knip, and Vitest.
- `make verify` runs both layers and is the local done command.

`bun install` runs `prepare`, which delegates to `hooks:install`.
`hooks:install` first checks for a Git worktree, then runs `lefthook install` so
a fresh Git checkout activates `pre-commit`, `commit-msg`, and `pre-push`. Zip
or source-only demo folders skip hook installation without failing `bun install`.

Hook behavior:

- `pre-commit` runs fast staged checks in parallel and restages Biome auto-fixes.
- `pre-commit` also runs `gitleaks git --staged --no-banner --redact`.
- `commit-msg` runs Commitlint with the conventional config.
- `pre-push` runs `make pre-push` against the whole tree.

Do not run `git commit --no-verify`. A failing hook is a required fix signal.

## 3. Project Tour for New Programmers

The project is easiest to read as one request path:

```text
packet JSON -> validation -> gateway/replay checks -> analysis -> API/demo output
```

Start with these files before reading the whole tree:

| Step | File | Why it matters |
|---|---|---|
| 1 | `src/server.ts` | Starts the local Bun server and hands every request to the shared fetch handler. |
| 2 | `src/index.ts` | Routes HTTP endpoints, applies rate/gateway checks, and returns JSON/CSV/demo assets. |
| 3 | `src/packet/validate.ts` | Defines the accepted packet JSON shapes, batch limit, and body-size budget. |
| 4 | `src/analysis/api.ts` | Turns accepted packets into aggregate facts, overlays, alerts, and event queues. |
| 5 | `src/openapi.ts` | Publishes the same API contract that `/api/openapi.json` and `/api/docs` expose. |
| 6 | `test/security-boundary.test.ts` | Shows the most important failure cases: invalid input, replay, MAC, and rate limits. |

The source tree is split into layers:

| Layer | Owns | Main files |
|---|---|---|
| Packet protocol | Packet vocabulary, binary layout, Web Crypto codec, Valibot JSON validation | `src/packet/`, `src/bytes.ts` |
| Analysis pipeline | Aggregation, hazard overlay, factual alerts, event queue, replay/MAC/rate-limit helpers, agency export | `src/analysis/` |
| API entry | Runtime-agnostic fetch handler, Bun server, OpenAPI and Scalar docs | `src/index.ts`, `src/server.ts`, `src/openapi.ts`, `src/openapi-docs.ts` |
| Demo UI | Local evaluator page, scenario picker, codec helper endpoints, SVG hazard map | `src/demo/`, `locales/` |
| Shared geography | Point-in-polygon, Haversine distance, offline reverse geocode, static hazard zones | `src/geo-math.ts`, `src/geocode.ts`, `src/danger-zones.ts` |
| Runtime config | Environment parsing, queue policy, locale validation, tool/lint/secret config | `src/config/`, `config/`, `mise*.toml`, `.sops.yaml` |
| Tests | Vitest unit/integration coverage | `test/` |
| Device profile | C packet encoder compatibility work for future low-bandwidth hardware profiles | `firmware/` |
| Data/build pipeline | Quality gates, APCA audit, GDAL hazard GeoJSON and PMTiles generation | `Makefile`, `scripts/`, `docs/developer/gdal-pipeline.md` |

Some tests and older notes use the name `worker.fetch`; read that as "call the
same Web Request/Response handler in memory." The current demo runtime is Bun,
not a Cloudflare deployment target.

Small glossary:

| Term | Meaning in this repo |
|---|---|
| packet | One structured field report: `person_report`, `terrain_event`, or `resource_report`. |
| envelope | Metadata around a packet, such as gateway ID, receive time, and chain MAC. |
| `chain_mac` | Gateway HMAC audit chain. It helps detect tampering/replay but does not replace AEAD. |
| overlay | Deterministic lookup that asks whether a packet coordinate falls in a known hazard zone. |
| semantic verification | A response label saying packet content is field observation, not proof of real-world truth. |

## 4. Run the Demo

```sh
make dev
```

Open `http://localhost:9000/`.
If that port is already taken, Bun will move up to the next free port and print the actual URL in the console.

If you want a stable local demo key or future private tokens, create a private config once:

```sh
make runtime-init
```

This writes `~/.config/dovetail/age.key` using `rage-keygen` and `~/.config/dovetail/runtime.json.age` using `rage`. Run `make runtime-prepare` before `make dev` only when you want that private config loaded into tmpfs.

The repo works without it. When no private config exists, local runs fall back to a per-process in-memory key; fresh checkout verification does not need `rage`, `rage-keygen`, or `openssl`.

### Optional mise + sops private env

Agents must not run private secret decrypt commands or receive decrypted secret
environment variables. Use this only in a human-owned shell when the age
identity and encrypted env file are safe for that session.

Install the project tool declaration and create an age identity outside the
repo. The identity file is private and must not be committed or pasted into
agent sessions:

```sh
mise install sops
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt
```

The repository `.sops.yaml` authorizes encrypted runtime env files named
`.env.runtime.sops.json` and dotenv-derived YAML files matching
`.env.*.enc.yaml`. To rotate or add machines, add the new public age recipient
to `.sops.yaml`; do not store the private identity in the repo.

Create a local plaintext copy from the non-secret example, edit it in your
own shell, then encrypt it. SOPS reads the recipient from `.sops.yaml`:

```sh
cp .env.runtime.example.json /tmp/dovetail-runtime-env.json
sops --filename-override .env.runtime.sops.json \
  --encrypt /tmp/dovetail-runtime-env.json > .env.runtime.sops.json
rm -f /tmp/dovetail-runtime-env.json
```

Run the demo with the private env only when needed:

```sh
MISE_ENV=secrets mise exec -- make dev
```

`MISE_ENV=secrets` loads `mise.secrets.toml`, which references the encrypted
`.env.runtime.sops.json` only when explicitly invoked. The file is intentionally
not named `mise.local.toml` so mise will not auto-load it in fresh shells. The
root `mise.toml` intentionally stays tool-only so `make verify` and normal agent
sessions do not decrypt runtime secrets.

Gateway verification is **required by default** (spec §8.0.1). Add
`DOVETAIL_GATEWAY_MAC_KEY_HEX` to the private env when testing the production
path; the analysis-component will verify `chain_mac` and track cross-batch
replay. Never put the key in client-side demo assets.

For a keyless demo session (local browsing, evaluator reproduction without the
private env), set `DOVETAIL_ALLOW_UNVERIFIED_INGEST=1` to explicitly opt into
`verification_mode="demo_unverified"`. Without either signal `/api/packets`
returns `503 gateway_verification_not_configured`, which is the intended
fail-closed default. Do not combine the demo flag with
`DOVETAIL_DEPLOYMENT_MODE=production`; production mode rejects it with
`demo_unverified_not_allowed_in_production`. `DOVETAIL_REQUIRE_GATEWAY_VERIFICATION`
is deprecated and no longer read by `src/`.

Optional Git diff setup for a human-owned repository clone:

```sh
git config diff.sopsdiffer.textconv "sops decrypt"
```

Useful endpoints:

The coordinates below are public reference coordinates used by synthetic
reports for deterministic overlay tests. Do not round them for publication:
rounding can move a demo point toward unrelated private locations. They are not
real household, sheltering, rescue, or resource-status claims.

```sh
curl http://localhost:9000/api/scenarios
curl -X POST http://localhost:9000/api/packets \
  -H 'content-type: application/json' \
  --data-binary @examples/packets-batch.json
curl http://localhost:9000/api/openapi.json
curl 'http://localhost:9000/api/hazard-zone?lat=23.661234&lng=121.421789'
```

## 5. Rebuild Static Hazard Data

The committed public-safe derived geometry is already enough for tests and demo
development. Rebuild only inside a private data workspace when source data or
reviewed processing policy changes.

```sh
make data-hazard
make data-pmtiles
```

Or run both:

```sh
make data-all
```

Outputs:

| Path | Commit? | Reason |
|---|---|---|
| Redacted / simplified derived geometry | Only after review | small deterministic demo layer |
| Generated map tiles | No | generated build output |
| Raw source downloads | No | may contain protected fields |

## 6. Maintenance Rules

- Treat `SPEC.md`, `src/packet/types.ts`, and `src/openapi.ts` as a contract. If one changes, update all three and run `make verify-contract`, then `make verify`.
- Do not commit secrets, raw protected data, or generated build outputs.
- Keep geospatial processing out of the Bun runtime. Public docs should describe
  only the redacted / simplified output boundary unless a future release
  explicitly publishes a reviewed reproducible pipeline.
- Keep old pre-pivot discussion out of the repo. Current source of truth starts at `README.md`, `SPEC.md`, `PERSONA.md`, `LIMITATIONS.md`, and maintained `docs/` guides.
- If a private runtime config exists, keep the encrypted source at `~/.config/dovetail/runtime.json.age` and the identity at `~/.config/dovetail/age.key`. Never move the decrypted file out of tmpfs.

## 7. Common Tasks

| Task | Command |
|---|---|
| Run all checks | `make verify` |
| Run APCA color audit | `bun run contrast` |
| Run contract checks | `make verify-contract` |
| Start local Bun server | `make dev` |
| Rebuild hazard GeoJSON | `make data-hazard` |
| Rebuild PMTiles | `make data-pmtiles` |
| Deploy cloud runtime | N/A |
