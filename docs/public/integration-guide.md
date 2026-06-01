# Integration Guide

This guide explains how another system can reuse the protocol without adopting the whole demo.

## Component Summary

Dovetail (燕尾榫) Offline Disaster Field Reporting Protocol has two reusable pieces:

| Component | Competition type | Runtime |
|---|---|---|
| `call-component` | Library / Package | Browser, Bun, future hardware profile |
| `analysis-component` | API Service | Local Bun demo, portable fetch-compatible host |

It turns field observations that might otherwise be scattered across LINE,
calls, paper, spreadsheets, or meetings into compact, verifiable packet JSON.

Intended users:

- village or township staff
- tribal elders or local community coordinators
- patrol teams and civil defense volunteers
- shelter staff
- existing disaster information systems that need structured input

## Integration Model

```
Existing reporting channel
  -> normalize into packet JSON
  -> POST /api/packets
  -> consume aggregate + fact triggers
```

The reporting channel can be LoRa, HTTPS, CSV import, email parsing, or a custom local government form. The reusable part is the packet schema and analysis contract.

## Option A: Use the API Service

Run the API service and send decoded packet JSON:

```sh
curl -X POST https://your-worker.example/api/packets \
  -H 'content-type: application/json' \
  -d @examples/packets-batch.json
```

The response contains:

- `summary`: status totals, flag totals, resource requests and offers
- `overlays`: packet points with public hazard zone match; terrain observations may include `osm_tags_proposed`
- `alerts`: deterministic fact triggers; downstream government systems decide what response, if any, follows

Agency exports can also expose JSON-only receiver hints: `receiver_tags` on
aggregated needs/resources and `osm_tags_proposed` on terrain rows. The receiver
tags are informed by HXL's compact spreadsheet tag convention, but they are not
a direct HXL implementation. These hints do not change the packet vocabulary.
JSON event queue rows expose rounded centroids only; `coord_resolution` defaults
to 2 decimal places and rejects higher public export precision. Production
deployments should set `DOVETAIL_EXPORT_PROFILES` to the smallest profile list
they actually expose.

## Option B: Use the Packet Vocabulary Only

A local government or vendor can keep its own backend and only adopt the vocabulary:

- `person_report.status`
- `person_report.flags`
- `terrain_event.event`
- `terrain_event.flags`
- `resource_report.resource`
- `resource_report.flags`

Use `SPEC.md` as the vocabulary reference and keep `/api/openapi.json` for schema validation.

## Option C: Batch Import

If a field team can only export CSV or spreadsheet data, convert each row into packet JSON before sending to the API.

Minimum fields for `person_report`:

- `mac`
- `village`
- `ts`
- `lat`
- `lng`
- `addr`
- `count`
- `status`
- `flags`

## Government System Boundary

The component is designed to sit beside existing systems:

- It can feed a dashboard.
- It can produce a structured incident log.
- It can support cross-agency reconciliation.
- It must not be treated as an official command or dispatch system by itself.
- It must not be treated as a risk prediction or response recommendation engine.
- It must not be treated as live government database access.
- It does not provide production key management or legal consent determination.

## Adoption Boundary

The practical adoption rule is:

> 紀錄現場訊號，不增加現場判斷。

This means:

- field reporters do not decide legal consent, safety, identity, or eligibility
- `unknown` is an acceptable status, not a failure
- `consent_acknowledged` and `consent_refused` are operation records, not complete legal proof
- localized or interpreted explanations belong to local SOP; the protocol does not certify translation quality
- precise public dashboards, route recommendations, dispatch decisions, and automated rescue advice stay outside this component

Start with tabletop exercises and resource / terrain reports before any live
person-report integration. Formal deployment needs local SOPs for operator
roles, language support, log access, replay/key management, and identity
reconciliation responsibility.

## Data Protection Boundary

Packets must not include:

- names
- national ID numbers
- passport numbers
- phone numbers
- free-text medical details

If a government system needs identity reconciliation, that lookup stays inside the authorized government environment. The packet carries only location, count, status, and flags.

Privacy-related integration work should start from the component boundaries in
this guide: packet minimization, role-scoped export profiles, coordinate
precision defaults, and synthetic demo/test data. Legal notice, retention,
breach handling, subject-right processes, and identity reconciliation remain
responsibilities of the adopting organization under its governing law and SOP.

## Adding a New Integration

1. Map source fields to `SPEC.md`.
2. Add a fixture in `src/demo/scenarios.ts` or an example JSON file.
3. Add or update tests if the new field changes packet enums.
4. Run `bun run verify`.
5. Document the integration in this file.
