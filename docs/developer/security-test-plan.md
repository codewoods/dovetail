# Security Review and Penetration Test Plan

This plan is for tutor review, internal testing, and future production hardening. It is not a claim of completed third-party penetration testing.

## Threat Model

This threat model is repository-scoped. It covers the reusable packet protocol,
the local Bun analysis-component, the demo UI, compatible hardware device profiles,
and the development workflow. Production agency identity reconciliation,
dispatch authority, and legal consent determination are outside this component.

### Assets and Trust Boundaries

| Asset | Why it matters | Primary boundary |
|---|---|---|
| Packet plaintext | Carries field location, count, status, and sensitive flags | Device / gateway / analysis-component |
| AEAD device key | Protects packet confidentiality and integrity on low-bandwidth links | Device provisioning, outside this repo |
| Gateway MAC key | Lets the server verify decoded JSON came from an authorized gateway | Server-side runtime config only |
| Replay and chain state | Prevents old accepted packets from inflating current analysis | Gateway / analysis-component process or shared store |
| Audit metadata | Supports cross-agency reconciliation and later review | JSON body, response header, optional CSV metadata row |
| Demo and docs | Used by evaluators and integrators to learn the contract | Public local demo, generated docs, AI-assisted edits |

Assumptions:

- LoRa, mesh relays, HTTP callers, and uploaded JSON are untrusted.
- Production ingest provides `DOVETAIL_GATEWAY_MAC_KEY_HEX`; unverified ingest is explicit demo mode only and is rejected when `DOVETAIL_DEPLOYMENT_MODE=production`.
- Packets intentionally do not contain names, phone numbers, ID numbers, passports, or household registry identity.
- Per-device key provisioning, rotation, secure storage, and incident response are production responsibilities.
- Production gateway key rotation requires a KMS-owned `kid`, one active signing key, a verify-only retire window, and a rotation drill that proves retired / revoked keys fail closed.
- Horizontal deployments need shared replay-window storage for both the AEAD nonce tuple and decoded JSON replay key. `DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH` covers single-host process restarts for decoded JSON replay / chain state, but the MVP process-local store is not enough across instances.

### Risk Matrix

| Layer | Threat | Current mitigation | Validation point | Residual risk / production responsibility |
|---|---|---|---|---|
| 通訊層 | 封包竊聽 | AEAD packet codec: AES-128-GCM in Web/Bun MVP, AES-128-CCM in compatible hardware profiles. No free-text identity fields in packet payload. The current 32-bit tag is a constrained low-bandwidth profile, not a general-purpose high-assurance network profile. | `bunx vitest --run test/codec.test.ts`; reviewer checks `SPEC.md` and `src/packet/types.ts` contain no name, phone, ID, passport, or household registry fields. | Radio metadata, timing, rough location, traffic volume, and short-tag forgery budget can still be observed or pressured. Production transport planning should treat metadata as sensitive and evaluate larger AEAD tags where feasible. |
| 通訊層 | 中間人攻擊 mutates ciphertext or decoded envelope | AEAD tag failure rejects tampered encrypted frames. `chain_mac` is canonical length-framed HMAC over gateway inputs. `/api/packets` rejects malformed envelope shape before analysis. | `test/codec.test.ts` rejects tampered ciphertext; `test/security-boundary.test.ts` rejects malformed `chain_mac`; `test/gateway-verification.test.ts` rejects chain MAC mismatch before analysis. | The analysis-component only sees decoded JSON; real LoRa ciphertext verification must happen at the gateway before JSON ingest. |
| 通訊層 | 重放攻擊 | Codec nonce binds `device_mac || packet_counter || packet_type || reserved`. Gateway replay storage treats the AEAD nonce tuple separately from decoded JSON ingress dedupe (`replay_key = sha256(packet_type || mac || ts_le)`), enforces timestamp window, serializes one-process state mutation, and production gateway verification rejects cross-batch replay after `chain_mac` verification. | `test/codec.test.ts` rejects wrong counter, invalid counters, and same-counter cross-type nonce reuse; `test/replay.test.ts` rejects duplicate and out-of-window packets; `test/gateway-verification.test.ts` rejects cross-batch replay, concurrent same-key replay, and the `DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH` restart path. Manual review confirms docs keep AEAD nonce replay and JSON replay key governance separate. | File-backed JSON replay state does not store the AEAD nonce tuple and is not a multi-writer distributed lock. Production needs gateway or shared replay store with a TTL covering the replay window and delivery skew. |
| 設備層 | 設備遺失 | Packet schema avoids civil identity. Gateway verification can reject future packets if a device or gateway key is revoked outside this repo. | Automated: schema minimization checks in `test/security-boundary.test.ts` and `test/schema-consistency.test.ts`. Manual production drill: mark one device key revoked and confirm gateway rejects new traffic from that key. | Device key storage, revocation, and lost-device SOP are not implemented in the MVP. Agencies must provision per-device keys and rotate after loss. |
| 設備層 | 韌體竄改 | Device profile is separated from Bun MVP, with C encoder compatibility tests and a shared packet contract. `SPEC.md`, `src/packet/types.ts`, and `src/openapi.ts` are treated as a contract. | `make verify` covers TS codec/schema tests; `make -C firmware test` verifies host-side C layout. Production release must additionally verify signed firmware and secure boot outside this repo. | Production firmware still needs secure boot, signed firmware, physical tamper response, and release signing outside this repo. |
| 設備層 | 金鑰外洩 | Keys are loaded from server-side env/private runtime config. Agent sessions and client assets must not receive production keys. `.sops.yaml`, rage, and private runtime docs keep decrypted env outside default workflows. | `test/agent-workflow.test.ts` checks AI/secret boundary docs; `make verify` includes secret/static gates. Manual check: grep built demo assets for production key material before release. | If device or gateway keys leak, cryptographic checks cannot distinguish attacker traffic from legitimate traffic. Rotation and audit response remain production duties. |
| 資料層 | 個資外洩 | Packet schema excludes names, ID numbers, phone numbers, passports, and household registry identity. Sensitive flags are logistics signals, not identity evidence. | `test/security-boundary.test.ts` and `test/schema-consistency.test.ts` keep schema/contract limits visible. Reviewer checks exported JSON/CSV samples contain only packet fields and audit metadata. | Location plus flags may still be sensitive in small communities. Raw packet logs require access control and retention limits. |
| 資料層 | 訊號偽造 | Valibot schema validation, strict enums, body/batch limits, fail-closed gateway verification, and `chain_mac` mismatch rejection prevent malformed or unsigned JSON from entering analysis. | `test/security-boundary.test.ts` rejects malformed JSON, oversized bodies, and bad envelope shape; `test/gateway-verification.test.ts` fails closed without key and rejects mismatched signatures; `test/rate-limit.test.ts` covers abuse limits. | A legitimate but malicious trained operator can still submit false observations. The component marks semantic truth as unverified field observation. |
| 資料層 | 稽核破壞 | `verification_mode` appears in JSON and `X-Dovetail-Verification-Mode`; `include_metadata=1` can prepend CSV audit metadata. `chain_mac` preserves gateway-side audit continuity. | `test/gateway-verification.test.ts` verifies JSON mode, response header, default CSV header preservation, and opt-in CSV metadata row. | Long-term immutable audit log storage, access control, retention, and cross-agency reconciliation are deployment responsibilities. |
| 資料層 | 衍生資料追溯漂移 | Aggregation, overlay, event queue clustering, alerts, and agency export are pure transforms over the packet array. Packet index, cluster id, cluster `packetIndexes`, alert refs, and export rows derive deterministically from packet input order, so any performance refactor must keep observable traceability identical. | `test/data-lineage.test.ts` pins cluster `packetIndexes`, cluster id derivation, alert refs, and export row → cluster/alert/summary linkage; `test/event-queue.test.ts` and `test/agency-export.test.ts` cover queue/export contracts. | Future spatial indexing or batched grouping must keep cluster identity, sort order, and audit reference fields byte-equal under the same packet input. |
| 流程層 | 基層誤操作 | Fixed packet vocabulary, `unknown` as a valid value, no identity check requirement, and `consent_refused` / `consent_acknowledged` as operation records reduce judgment burden. | `test/operator-config.test.ts` confirms local queue/locale edits cannot break defaults; manual drill: operator sends `unknown`, `consent_refused`, and corrected follow-up packets in a tabletop exercise. | Training, local-language explanation, and post-incident correction workflow must be written into local SOP. |
| 流程層 | 惡意通報 | Gateway verification, rate limiting, schema validation, replay checks, and event queue review hints limit automated abuse and preserve packet indexes for human review. | `test/rate-limit.test.ts`, `test/replay.test.ts`, and `test/gateway-verification.test.ts` cover automated abuse/replay; manual review verifies event queue still exposes source packet indexes and review hints. | A valid authorized user can still lie. This is handled as operational review, not fully solved by cryptography. |
| 流程層 | 通報洪水攻擊癱瘓檢視佇列 | Body and batch limits bound each request, gateway verification rejects unsigned JSON, replay checks reject duplicates, rate limiting slows one-source abuse, and event queue rows preserve source packet indexes for review. | `test/rate-limit.test.ts`, `test/replay.test.ts`, `test/gateway-verification.test.ts`, and `test/data-lineage.test.ts`; tabletop-test many high-display-weight `rescue_needed` packets and confirm operators can inspect packet indexes. | Large-scale abuse from many valid devices or compromised operators still needs edge rate limiting, device revocation, anomaly monitoring, and human triage outside this component. |
| 流程層 | 責任歸屬 | The design separates reporting action from reported-person content. `chain_mac` and gateway IDs help trace reporting path while packet content avoids civil identity. | `test/gateway-verification.test.ts` verifies chain MAC verification and audit metadata; reviewer checks `SPEC.md` §9.1 and `docs/public/security-assurance.md` keep consent as operation record, not legal proof. | Legal responsibility, duty bypass, and agency role assignment remain government policy and SOP questions. |
| 開發層 | AI 產生不安全程式碼 | AI is outside the secret trust boundary. Runtime AI is not in the MVP critical path. Deterministic verification, security tests, AGENTS rules, and human review guard crypto, secrets, input validation, and PII boundaries. | `test/agent-workflow.test.ts` checks AI/secret boundary docs; required reviewer checklist covers auth, crypto, secrets, `innerHTML`, `eval`, and command execution changes before adoption. | AI-generated changes touching auth, crypto, secrets, `innerHTML`, `eval`, or command execution require manual review before adoption. |
| 開發層 | 依賴套件漏洞 | Bun lockfile, `make verify`, `knip`, linting, typecheck, Vitest, gitleaks, and local vendoring of Scalar asset reduce drift and catch obvious regressions. | `make verify`; manual release check reviews `bun.lock` diff and dependency advisories. Third-party scanner output is triage input, not sole approval. | Dependency advisories still require human triage. Third-party scanners are not treated as the only quality signal. |
| 開發層 | 文件失真 | `test/agent-workflow.test.ts` checks key docs, AI/secret boundaries, entrypoints, and quality gates. README/SPEC/PERSONA/LIMITATIONS/docs are source-of-truth docs. | `make verify-docs`; `test/agent-workflow.test.ts`; reviewer cross-checks threat model, public assurance, spec, and tests before submission. | Generated summaries and AI-written docs can drift. Security-sensitive docs should be reviewed against tests and concrete source files. |

### Items Not Listed as Primary Matrix Risks

These are not ignored. They are excluded from the primary risk matrix or treated
as lower severity because the project has explicit scope boundaries or controls:

| Item | Why it is not a primary matrix item | Risk-reducing measure |
|---|---|---|
| Government identity lookup breach | The component does not implement identity reconciliation or query civil registries. | Packet minimization; identity work stays inside authorized government systems. |
| Evacuation or dispatch harm from automated decisions | The component does not issue evacuation orders, dispatch recommendations, route advice, or predictions. | Analysis output is deterministic facts, overlays, alerts, and review hints only. |
| LLM hallucination in runtime decision path | MVP runtime does not use LLMs for codec, analysis, hazard overlay, fact triggers, or decision-making. | `docs/public/security-assurance.md` limits future LLM use to read-only summaries or human-confirmed transcription. |
| Public dashboard doxxing | The repo does not provide a public citizen dashboard or public precise-location publishing workflow. | Demo is local evaluator/operator UI; public sharing must aggregate/redact outside this component. |
| Browser credential theft from the demo | Production keys are never placed in demo assets; the demo uses server-side keys or explicit unverified mode. | CSP, `nosniff`, no-store headers, permissions policy, and `textContent` rendering. |
| Cloud provider account takeover | Runtime default is offline Bun demo; this repo does not deploy cloud infrastructure. | Production hosting and IAM are integrator responsibilities. |
| Raw disaster sensor spoofing | The component consumes field observations and public hazard layers; it does not ingest official sensor networks as truth sources. | `semantic_verification` marks observations as unverified field reports. |
| Translation certification failure | The protocol can carry operation outcomes, but does not certify legal adequacy of translations. | Localized external-interface strings and translator review belong to local SOP. |
| Physical harm from wrong rescue prioritization | Event queue is a review aid, not dispatch authority. | Queue output preserves source packet indexes and uses review hints rather than final decisions. |
| Many high-weight reports hiding other reports | Queue display flooding is handled as abuse review, not automated dispatch. | Request limits, gateway verification, replay rejection, source packet indexes, and production anomaly monitoring keep the queue auditable. |
| Supply-chain compromise of generated `.understand-anything/` output | That directory is an analysis artifact, not runtime code or source of truth. | Useful summaries are manually curated into docs; generated files should be deleted or excluded from verification. |

## Test Cases

| Area | Test |
|---|---|
| Input validation | Send unknown `type`, missing `envelope`, invalid `status`, invalid flags, impossible lat/lng, huge batch. Expect 400 and no stack trace. |
| Body limits | Send payload larger than `MAX_PACKET_BODY_BYTES`. Expect 400 `body_too_large`. |
| Media type | POST `text/plain` to JSON endpoints. Expect 415. |
| AEAD tamper | Flip one byte in encrypted frame. Decode must fail. |
| Replay | Decode with wrong counter. Decode must fail; production gateway should also store the accepted AEAD nonce tuple and decoded JSON replay key in the shared replay store. |
| Gateway verification | Enable `DOVETAIL_GATEWAY_MAC_KEY_HEX`; valid signed decoded JSON must pass, `chain_mac` mismatch must return 400, and replaying an already accepted `replay_key` in a later batch must return 409. |
| XSS | Inject `<img onerror=...>` in scenario-like strings. Demo must render as text only. |
| Clickjacking | Confirm `Content-Security-Policy` includes `frame-ancestors 'none'`. |
| Data minimization | Confirm packet schema has no name, phone, ID, passport, or household registry fields. |
| Logging | Confirm production logs redact raw packet payloads unless incident role requires access. |
| AI development boundary | Confirm docs say agents have no production keys, no real government records, and no authority to override deterministic tests. |
| Documentation integrity | Confirm README, SPEC, security assurance, and AI policy still describe the same runtime and trust boundary. |

## Current Automated Coverage

- `test/security-boundary.test.ts`
- `test/codec.test.ts`
- `test/schema-consistency.test.ts`

Run:

```sh
bun run verify
```

<!--
## Recommended Tutor Discussion

1. What replay window is acceptable for disaster conditions with intermittent gateways, and should the shared replay store live in the gateway, reverse proxy, or agency backend?
2. Which raw packet fields should be redacted from routine logs?
3. Which agency role can perform identity reconciliation, and where is that audit logged?
4. Should public demo endpoints be deployed separately from production API endpoints?
-->
