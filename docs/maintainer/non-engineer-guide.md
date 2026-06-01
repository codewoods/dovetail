# Non-Engineer Maintainer Guide

This component is designed so township staff, civil-servant operators, local partner coordinators, and humanities-background volunteers can maintain local wording and operating choices without editing code.

## The Rule

Do not edit `src/` for local operations.

Local maintainers should edit only:

- `config/queue-policy.json`
- `locales/zh-Hant-TW.json`
- `locales/en-US.json`
- `examples/*.json`
- classroom or local SOP notes

The protocol, packet validator, queue builder, OpenAPI schema, and tests stay under engineering review.

## What You Can Change

### Display Words

Use:

- `locales/zh-Hant-TW.json`
- `locales/en-US.json`

Examples:

- Change `需要救援` to a local training phrase.
- Change `保暖物資` to a phrase used by the local shelter team.

This changes only the screen text. It does not change the exported JSON. The
exported enum stays stable: screen label `需要救援` still exports as
`rescue_needed`.

Implemented demo locales are `zh-Hant-TW` and `en-US`. The demo accepts `zh-TW`
and `en` as compatibility codes, but maintained docs should prefer the fuller
BCP 47 tags. For new external consent surfaces, use independent language tags
such as `ami` / `ami-TW` and `hak` / `hak-TW`, `id`, `vi`, `th`, and `fil`; do not
model Indigenous languages, Hakka, or Filipino as `zh-*` variants.

Unsafe changes:

- renaming keys such as `rescue_needed`
- removing a whole section
- using display labels as exported data values

### Queue Display Rules

Use:

- `config/queue-policy.json`

Examples:

- Make same-severity floods appear before same-severity resource requests.
- Adjust `queuedSeverityThreshold`.
- Adjust how close same-kind points must be before they merge.

Queue severity is a display weight, not a danger score. It still wins before
local priority so one local setting cannot hide a higher-weight review item.
This changes what operators see first; it does not decide dispatch, evacuation,
or response order.

Safe changes:

- reorder items in `priorityOrder`
- change `queuedSeverityThreshold` between 0 and 255
- change `clusterRadiusDeg` within the accepted range
- change severity numbers in `personStatusSeverity` between 0 and 255

Unsafe changes:

- adding new packet kinds that are not already in the protocol
- changing English enum names such as `rescue_needed`
- deleting required fields

### Practice Packets

Use:

- `examples/*.json`

Examples:

- Add a school flood drill packet.
- Add a shelter resource-request packet.
- Add a village patrol terrain-event packet.

## What Happens If You Make a Mistake

The system is designed to fail softly:

- Bad queue values are ignored field-by-field.
- Incomplete language files fall back to tested built-in labels.
- Invalid packet examples fail tests before the demo.
- Core packet enums stay English so translation edits cannot break data exchange.

Common examples:

Bad queue kind:

```json
{
	"priorityOrder": ["terrain_event:big_flood"]
}
```

`big_flood` is not a protocol enum. Use an existing value such as
`terrain_event:flood`.

Bad threshold:

```json
{
	"queuedSeverityThreshold": 999
}
```

Severity must be 0-255.

Bad locale key:

```json
{
	"status": {
		"needs_help": "需要救援"
	}
}
```

The display text may change, but protocol keys such as `rescue_needed` must not.

Bad packet example:

```json
{
	"type": "terrain_event",
	"packet": {
		"event": "flood"
	}
}
```

A GIS point needs both `lat` and `lng`, plus the required envelope and packet
fields.

## Check Before Sharing

Run the local-maintainer check:

```bash
bun run test test/operator-config.test.ts
```

Run the full project check:

```bash
bun run verify
```

If a check fails, read the first failure message. It usually points to the file and field that needs attention.

## Suggested Local Workflow

1. Copy the file you want to edit.
2. Change one small thing.
3. Run `bun run test test/operator-config.test.ts`.
4. Open the demo.
5. Check the event queue.
6. Only then make the next change.

Small changes are easier to debug than one large edit.

## Do Not Edit Without Engineering Review

- `src/packet/*`: packet schema and codec.
- `src/analysis/event-queue.ts`: queue implementation.
- `src/analysis/api.ts`: HTTP analysis contract.
- `src/openapi.ts`: API schema.

## Fork Checklist

Before a student or local team forks:

- Keep the original README.
- Keep `docs/maintainer/non-engineer-guide.md`.
- Rename examples to match the local drill.
- Do not remove `bun run verify`.
- Document what local terms mean.

The goal is not to build a large platform. The goal is a small, understandable disaster-reporting component that local teams can keep alive.
