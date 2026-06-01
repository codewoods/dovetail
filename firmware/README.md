# Firmware Boundary

Target hardware: hardware-neutral low-bandwidth device profile.

The initial competition MVP is Web/Bun-hosted. Firmware work should be treated as an adapter to the existing protocol, not a separate source of truth.

## Required Contract

Firmware must conform to:

- `SPEC.md`
- `src/packet/types.ts`
- codec fixtures in `test/codec.test.ts`

## Crypto Profile

- Firmware target: AES-128-CCM through mbedTLS.
- Web/Worker simulator: AES-128-GCM through Web Crypto.
- Plaintext packet layout and enum values must remain shared.

## Development Before Hardware Arrival

Use host-side C++ skeleton tests for:

- byte layout offsets
- enum bitmap encoding
- nonce construction
- AES-CCM fixture compatibility when available

Do not add production secrets, device keys, or API keys to the repo.
