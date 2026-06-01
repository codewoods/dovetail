# Journey Test Matrix

This document tests the component against demo scenarios to verify boundary compliance. Scope: the component records structured field signals, queues them clearly, and exports interoperable data. It does not make evacuation decisions, route recommendations, volunteer schedules, AI chat, or official government case management.

The four scenarios below mirror `src/demo/scenarios-data.json` one-to-one. All scenarios use **synthetic packets at public reference coordinates** (`location_policy: public_reference_coordinates`, `source: Synthetic scenario`). No real case locations, no real identities.

## Roles

| Role | Protocol need |
|---|---|
| 民眾 / 被通報者 | counted without exposing identity or legal status |
| 政府決策者 | auditable facts, distinct from recommendations |
| 居間公務員 / 志工 | record facts without taking on decision liability |

## Design Boundary

Allowed improvements:

- clearer queue ordering
- safer editable labels and local examples
- better scenario coverage
- more explicit output JSON / overlay / OpenAPI
- less ambiguous wording for status and resources
- validation that catches mistakes before demo or drill

Not allowed:

- deciding evacuation or rescue actions
- predicting risk
- recommending routes
- replacing official case systems
- collecting names, phone numbers, ID numbers, passport numbers, or immigration status proof
- splitting `special_needs` into child / maternity / caregiver-absence sub-categories on the packet

## Scenario Tests

Each scenario lists the synthetic packet shape, the demo intent, and the boundary signal the receiver must preserve. Scenario `id` and packet field values match `src/demo/scenarios-data.json` byte-for-byte; update both files together when the demo changes.

---

### 1. Synthetic 情境一 收容容量與後勤需求

`id: shelter-capacity-synthetic` · `occurred_at_utc: 2025-09-23T06:50:00Z`

Journey:

1. A synthetic `person_report` records `count: 6` at `addr: MOCK01`, `status: evacuated_shelter`, `flags: [on_site]`.
2. Two `resource_report` packets at the same `MOCK01` carry `food_water`/`manpower` (`is_request`, `urgent`) and `shelter_space` supply.
3. Receiver sees occupancy + logistics request together without conflating them.

Within component boundary:

- Keep `evacuated_shelter` and `on_site` as structured fields; never derive "evacuation complete" from them.
- Resource request (`is_request`) is distinct from resource availability — do not merge.
- `urgent` raises queue priority; it does not assign a dispatch action.

Test signal:

- `person_report` and both `resource_report`s remain valid against the packet schema.
- Event queue shows the cluster with separate person vs. resource rows.

---

### 2. Synthetic 情境二 河道與道路疊合

`id: river-road-overlay-synthetic` · `occurred_at_utc: 2025-09-23T07:08:00Z`

Journey:

1. Two `terrain_event` packets arrive: `drainage_backflow` (`severity 200`, `flags: [rapid_rainfall, backflow_observed]`) at one point and `road_blocked` (`severity 170`, `flags: [only_exit_control]`) at another.
2. A later `person_report` (`count: 14`, `evacuated_shelter`) lands at `MOCK01`.
3. The hazard overlay highlights both terrain points; the queue keeps person and terrain rows distinguishable.

Within component boundary:

- `flood` (observed result) and `drainage_backflow` (mechanism) are distinct packets; do not silently fold one into the other.
- `only_exit_control` is a road-control fact, not a routing recommendation.
- Overlay hit count is informational; it never elevates a packet to an action item.

Test signal:

- Terrain points sort by severity ahead of evacuation-state person rows.
- Raw JSON preserves each packet without inferring causation between terrain and person packets.

---

### 3. Synthetic 情境三 公共設施資源回報

`id: public-facility-resource-synthetic` · `occurred_at_utc: 2025-09-23T08:00:00Z`

Journey:

1. A `resource_report` at `MOCK18` offers `shelter_space` + `food_water` (no `is_request` flag — supply, not demand).
2. A `person_report` at `MOCK19` records `count: 9`, `evacuated_shelter`, `on_site`.
3. A second `resource_report` at the same `MOCK19` requests `medical_aid` + `manpower` (`is_request`).

Within component boundary:

- Supply vs. request distinction comes from `is_request`; no implicit pairing of nearby supply and demand.
- `addr` tokens (`MOCK18`, `MOCK19`) are opaque facility labels — they carry no household identity.
- `medical_aid` is a logistics resource line; it does not collect medical detail or diagnosis.

Test signal:

- Supply and request rows are exported as separate `resource_report`s in JSON / CSV.
- Person cluster at `MOCK19` is not overwritten by the colocated resource request.

---

### 4. Synthetic 情境四 事件群聚與接收端排序

`id: event-queue-cluster-synthetic` · `occurred_at_utc: 2025-09-23T08:30:00Z`

Journey:

1. Two `terrain_event` (`flood`) packets at identical coordinates with `severity 180` and `190`, both with `backflow_observed`.
2. A `person_report` at a different point with `count: 3`, `status: rescue_needed`, `addr: MOCKNA`.
3. A `resource_report` at the same coordinates as the person-report but under a separate addr token (`MOCK21`) requests `vehicle_transport` + `manpower` (`is_request`, `urgent`).

Within component boundary:

- Same-kind nearby `flood` events cluster, but distinct severities remain visible in the underlying packet list.
- `rescue_needed` and `urgent` raise queue position; neither implies the component issued a rescue order.
- `MOCKNA` represents an unknown / not-applicable address token, not a real-world identifier.

Test signal:

- Cluster merges colocated `flood` packets without dropping the higher-severity entry.
- `rescue_needed` and `urgent` request appear at the top of the event queue.
- Cross-kind packets (terrain vs. person vs. resource) remain in separate cluster rows.

---

## Cross-Journey Improvements That Stay Small

1. **Incident queue receipts** — stable cluster ID + packet indexes; reporter can confirm signal received without expecting action.
2. **Local editable wording** — labels in `locales/*.json`; reduces blame wording, supports township forks.
3. **Scenario examples** — the four synthetic scenarios above act as drill fixtures; non-engineers can edit labels without touching code.
4. **Queue policy guardrails** — severity-first; local teams tune tie-break order only.
5. **After-action export** — JSON / OpenAPI / CSV output; no dashboard or official case system.

## Acceptance Checklist

- A non-engineer can explain what changed after editing `locales/*.json` against any of the four scenarios.
- A township operator sees queue groups before raw packet details.
- A government decision-maker can distinguish facts from recommendations across all four scenarios.
- Every scenario can be replayed through `POST /api/packets` using the packets in `src/demo/scenarios-data.json`.
- No scenario introduces names, IDs, phones, passports, or `special_needs` sub-categories on the packet.
- `id`, `addr`, `status`, `flags`, `event`, and `resource` values in this document match `src/demo/scenarios-data.json` exactly; CI / review should flag drift.
