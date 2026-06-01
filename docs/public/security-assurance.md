# Security and Privacy Assurance

This document explains what the MVP already protects, what remains a production responsibility, and how reviewers can test the boundary.

Privacy and personal-data boundaries are intentionally kept at the component
level: packet minimization, export generalization, coordinate precision
defaults, and synthetic demo/test data. Legal notice, retention, access control,
identity reconciliation, and jurisdiction-specific compliance assessment remain
production deployment responsibilities.

## Threat Model Summary

The full reviewer-facing threat model and risk matrix live in
`docs/developer/security-test-plan.md`. It covers five layers:

| Layer | Primary threats | Current posture |
|---|---|---|
| 通訊層 | 封包竊聽、中間人攻擊、重放攻擊 | AEAD packet codec, strict nonce/counter binding, gateway `chain_mac`, replay rejection, fail-closed verified ingest by default |
| 設備層 | 設備遺失、韌體竄改、金鑰外洩 | Minimal packet payload, firmware/profile separation, server-side key loading, no client-side key exposure; key provisioning/rotation remain production duties |
| 資料層 | 個資外洩、訊號偽造、稽核破壞 | No civil identity fields, strict schema validation, `verification_mode`, `semantic_verification`, response headers, optional CSV metadata |
| 流程層 | 基層誤操作、惡意通報、通報洪水攻擊、責任歸屬 | Fixed vocabulary, `unknown` as valid output, consent flags as operation records, event queue review hints rather than final decisions, request/rate/replay limits |
| 開發層 | AI 產生不安全程式碼、依賴套件漏洞、文件失真 | AI-assisted development boundary, deterministic tests, type/lint/secret gates, docs regression tests, human review for security-sensitive changes |

## Reviewer Validation Points

The detailed matrix in `docs/developer/security-test-plan.md` now includes a
validation point for every threat. For a quick review, use these checks:

| Layer | Validation point |
|---|---|
| 通訊層 | Run `bunx vitest --run test/codec.test.ts test/replay.test.ts`; confirm tampered ciphertext, wrong counters, duplicate replay keys, and timestamp-window failures are rejected. |
| 設備層 | Run `make -C firmware test` and review production SOP for per-device key provisioning, revocation after loss, signed firmware, and secure boot. |
| 資料層 | Run `bunx vitest --run test/security-boundary.test.ts test/gateway-verification.test.ts test/schema-consistency.test.ts`; confirm malformed packets, bad `chain_mac`, missing gateway key, and schema drift fail closed. |
| 流程層 | Run `bunx vitest --run test/operator-config.test.ts test/rate-limit.test.ts`; tabletop-test `unknown`, `consent_refused`, malicious duplicate reports, and post-incident correction workflow. |
| 開發層 | Run `make verify` and `make verify-docs`; manually review auth, crypto, secrets, `innerHTML`, `eval`, command execution, dependency diffs, and AI-edited security docs before release. |

## Current Protections

| Area | Current control |
|---|---|
| Packet confidentiality and integrity | Packet codec uses a 32-bit constrained AEAD profile (`AES-128-GCM` in Worker/Web MVP, `AES-128-CCM` for compatible hardware device profiles). This is a low-bandwidth packet tradeoff, not a general-purpose high-assurance network profile; production profiles should evaluate 64-bit or larger tags, with GCM deployments preferring 96-bit or 128-bit tags when the byte budget allows. |
| Nonce / counter binding | Nonce is `device_mac || packet_counter || packet_type || reserved`; `packet_counter` must be a real u32 and `packet_type` must be the frame type byte before nonce construction; neither value is coerced from strings or other types. Decode with the wrong counter or packet type fails AEAD verification. Gateway implementations must track the AEAD nonce tuple separately from the decoded JSON replay key so ciphertext replay cannot be hidden by later JSON normalization. |
| Shared replay store | `/api/packets` rejects per-batch JSON replay key duplicates, and production gateway verification mode adds process-local cross-batch replay rejection only after replay/timestamp classification; same-ciphertext replay rejection requires production replay-window storage when crossing processes or instances. Verified state load / verify / save is serialized inside one process. `DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH` can persist decoded JSON replay key and chain-head state across a process restart in the Bun runtime, but production deployments running more than one instance still need a shared store for both the AEAD nonce tuple and JSON replay key, with a TTL covering the timestamp window, delivery delay, clock skew, and restart overlap. |
| Chain MAC framing | `chain_mac` input is canonical length-framed before HMAC computation, not raw adjacent string concatenation. |
| Gateway key rotation | MVP verification uses one server-side gateway MAC key and does not implement `kid` key selection. Production gateway / KMS rotation must keep one active signing key, verify-only retired keys during the retire window, and a revocation drill proving retired / revoked keys fail closed. |
| Personal data minimization | Packets do not contain name, ID number, phone, passport number, or household registry identity. |
| Consent boundary | `consent_acknowledged` and `consent_refused` flags record the device operation and separate reporting action from reported person status. |
| API input boundary | `/api/packets`, `/api/packets/export`, `/api/codec/encode`, and `/api/codec/decode` accept JSON only, enforce max body size, max batch size, and packet schema validation before analysis. The codec helper endpoints share the same rate limit and body-size budget as `/api/packets` so demo helpers cannot be turned into a DoS amplifier. Timestamp and replay rejection happen before any stateful gateway mutation. |
| Event queue abuse boundary | Queue `severity` / `maxSeverity` are display weights, not danger scores or dispatch advice. Body limits, batch limits, rate limits, gateway verification, replay rejection, and packet index lineage keep high-weight report floods auditable for human review. |
| Operator visibility | The Bun entry logs a one-line `dovetail security posture: verification_mode=<verified\|demo_unverified\|demo_forbidden\|missing>, proxy_trust=<on\|off>` banner at startup. When `DOVETAIL_DEPLOYMENT_MODE=production`, unverified demo ingest is rejected instead of only logged. |
| Verification error surfacing | Gateway verification distinguishes a missing/invalid configuration (`503 gateway_verification_not_configured`) from a genuine verification exception (`500 gateway_verification_error`), so a crypto regression is not masked as a configuration drift. |
| Browser demo safety | Demo renders dynamic values with `textContent`, not HTML injection sinks. |
| Demo key handling | Demo key and optional gateway MAC key stay server-side. The server uses a per-process in-memory demo key by default and can decrypt optional private runtime config using rage or mise+sops in a human-owned shell. |
| AI-assisted development | AI agents are treated as outside the secret trust boundary and agent trust boundary. Default repo workflows expose ciphertext only, examples, tests, and docs; production API keys, age private identities, protected resident data, and decrypted private env values stay outside agent sessions. |
| Worker response hardening | API responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and restrictive browser permissions headers. |

## Why Some Risks Are Not Primary Matrix Items

The threat model does not list every imaginable disaster-system failure as a
primary component risk. Some issues are deliberately out of scope or reduced by
design:

| Not primary in this component | Risk-reducing measure |
|---|---|
| Government identity lookup breach | The packet contract does not contain names, phone numbers, ID numbers, passports, or household registry identity; identity reconciliation stays inside authorized government systems. |
| Automated evacuation or dispatch harm | The component does not issue evacuation orders, dispatch recommendations, route advice, or predictions; output remains facts, overlays, alerts, and review hints. |
| Runtime LLM hallucination | The MVP critical path uses deterministic validation, codec, aggregation, overlay, and fact triggers; future LLM use is limited to read-only summaries or human-confirmed transcription. |
| Public dashboard doxxing | The repo does not provide a public precise-location dashboard; public sharing must aggregate or redact outside this component. |
| Cloud IAM compromise | The default demo runtime is local Bun, not a cloud deployment; production hosting/IAM is chosen by the integrating agency. |
| Translation certification failure | The protocol records operation outcomes but does not certify translation quality; local language review belongs to local SOP. |

## What Citizens Should Be Told

- The packet is designed to report location, count, status, and disaster flags, not civil identity.
- Identity reconciliation, if needed, must stay inside authorized government systems and should not be pushed into the public packet.
- Refusing consent must remain representable as data, not hidden as missing data.
- A consent flag is an operational record, not a legal proof that a specific person personally pressed the button.
