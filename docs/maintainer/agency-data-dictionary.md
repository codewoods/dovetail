# Agency Data Dictionary

This component exports field signals for different agencies. It does not decide evacuation, dispatch, eligibility, enforcement, or official case status.

## Export Profiles

| Profile | Intended reader | Includes | Excludes |
|---|---|---|---|
| `township` | Township office, village coordinator | event queue, alerts, summary | identity records, official case status |
| `county` | County EOC | event queue, review hints, alerts, summary | dispatch decisions |
| `central` | Central EOC / ministries | event queue, review hints, alerts, summary | local command decisions |
| `rescue` | Fire / rescue planning staff | rescue and terrain clusters, review hints | route recommendations |
| `social` | Social affairs / health / labor liaison | grouped needs flags, resource requests | names, IDs, immigration proof, direct migration/care labels |
| `partner` | T-CERT-style enterprises, malls, churches, civil-society groups, and local resource partners | resource requests and resource offers | person status details |
| `lifeline` | Telecom, power, transport, water, and other lifeline operators | infrastructure-related terrain clusters and communication/power/fuel/transport resources | civil identity and unrelated welfare needs |
| `healthcare` | Hospitals, clinics, long-term-care and medical partners | injury, grouped care-continuity signals, and medical-aid requests | immigration status, names, IDs, direct care labels, or hospital bed management |

Profiles are static export slices. They are not an authentication or authorization system.

`partner` absorbs non-specialized outside helpers. There is no separate outside
helper profile.

`T-CERT` is treated as a reference operating model for trained private-sector or
institutional emergency teams. The API uses functional profile names instead of
organization names so the same export slices work for Chiayi, Hualien, or other
local disaster networks.

## Fields

| Field | Means | Does Not Mean |
|---|---|---|
| `profile` | Which export slice was requested | Legal permission to access data |
| `section` | Group inside the export | Government workflow stage |
| `area` / `adminAreaKey` | Administrative bucket derived from point location | Official jurisdiction ruling |
| `cluster_id` | Stable event queue cluster key | Case number |
| `kind` | Queue grouping such as `terrain_event:flood` | Final incident classification |
| `status` | Queue display state: `queued` or `watch` | Dispatch or evacuation status |
| `count` | Number of packets or reported people, depending on row | Verified population count |
| `max_severity` | Highest display weight in that cluster | Sensor reading, danger score, or dispatch priority |
| `latest_ts` | Latest packet timestamp in that cluster | Official event start or end time |
| `lat` / `lng` | Rounded event queue centroid in JSON export | Raw packet coordinate or household location |
| `coord_resolution` | Decimal places applied to `lat` / `lng` | Permission to request raw coordinate precision |
| `receiver_tags` | Receiver hint for aggregated needs or resources | New packet field, formal humanitarian-data certification, or identity label |
| `osm_tags_proposed` | Proposed OSM-style `key=value` hints for terrain observations | Automatic OSM edit or official road closure |
| `duplicate_hint` | Nearby same-kind reports were clustered | Duplicate confirmed |
| `conflict_hint` | Nearby person statuses may need reconciliation | One report is false |

## Governance Semantics

This component provides data slices, not access control. Integrating agencies
must decide who can see each export profile.

Sensitive flags such as `migrant_worker`, `foreign_visitor`,
`requires_separated_space`, `long_term_care`, `injured`, and `consent_refused`
are support signals. They must not be used as enforcement, eligibility, or
identity evidence.

| Term | Meaning | Does not mean |
|---|---|---|
| `received` | Valid packet accepted into analysis | Official case opened |
| `queued` | Cluster should be reviewed first in the receiving queue | Dispatched or handled |
| `review_hint` | Human reconciliation may be needed | One report is false |
| `packet.ts` | Field report timestamp | Official event start or end time |
| `envelope.received_at` | Gateway receive time | Proof the event happened then |
| `analysed_at` / `generated_at` | Component analysis/export time | Replacement for packet time |
| `timeConfidence` | `reported_time` or `stale_report_time` | Sensor confidence |

The component does not interpolate across government sensors, paper records,
phone calls, or other data sources. If production integrations replace the demo
geocoder with village-boundary GeoJSON, the event queue contract should remain
stable.

## Export Use

JSON export:

```bash
curl -X POST 'http://localhost:9000/api/packets/export?profile=partner&format=json' \
  -H 'content-type: application/json' \
  --data-binary @examples/packets-batch.json
```

CSV export:

```bash
curl -X POST 'http://localhost:9000/api/packets/export?profile=township&format=csv' \
  -H 'content-type: application/json' \
  --data-binary @examples/packets-batch.json \
  -o township-export.csv
```

The CSV includes a UTF-8 BOM for spreadsheet compatibility and escapes cells
that could be interpreted as formulas. Receiver hint tags and proposed OSM
fields are JSON-only receiver hints; the default CSV header stays fixed for
spreadsheet workflows.

Receiver hint tags are informed by HXL's compact hashtag convention, but they
are not a direct HXL implementation. The export keeps a smaller local vocabulary
so packet fields stay fixed, low-bandwidth, and privacy-minimizing.

JSON event queue rows include rounded `lat` / `lng` centroids with
`coord_resolution`. The default is 2 decimal places, and the public export API
rejects values above 4 so agency exports cannot request raw packet precision.
CSV exports continue to omit coordinate columns.

Production export deployments should set `DOVETAIL_EXPORT_PROFILES` to the
smallest profile list needed by that deployment. When
`DOVETAIL_DEPLOYMENT_MODE=production` is set and the allowlist is missing, the
export endpoint fails closed with `export_profile_allowlist_not_configured`.

For offline cross-agency file transfer, add `include_metadata=1`:

```bash
curl -X POST 'http://localhost:9000/api/packets/export?profile=township&format=csv&include_metadata=1' \
  -H 'content-type: application/json' \
  --data-binary @examples/packets-batch.json \
  -o township-export.csv
```

The first line becomes an audit comment row:

```csv
# verification_mode=verified,semantic_verification=field_observation_unverified_truth,exported_at=2026-05-23T08:12:09Z
profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts
```

The same verification enum is also returned in
`X-Dovetail-Verification-Mode`, so HTTP-only audit pipelines do not need to
parse the body.

Review hints include `same_kind_nearby_duplicate`,
`mutually_exclusive_person_status`, `administrative_boundary_uncertain`, and
`gateway_burst_resend`. They are prompts for human reconciliation, not truth
decisions.

## Agency Difficulties This Helps With

### Township Office

Difficulty:

- Mixed paper, LINE, phone, and packet reports.
- Fear that `unknown` or `refused` will be treated as failure.

Component support:

- Structured queue clusters.
- `unknown` and `refused` remain valid states.
- CSV export can be opened in spreadsheet tools.

### County EOC

Difficulty:

- Multiple townships report in different formats.
- Decision-makers ask for certainty before field data is certain.

Component support:

- Same packet schema across townships.
- Review hints mark reconciliation needs without deciding truth.
- Queue shows signals, not official counts.

### Central Agencies

Difficulty:

- Cross-agency data formats differ.
- Informal field reports cannot become official statistics directly.

Component support:

- OpenAPI and JSON Schema.
- Fact-trigger alerts explicitly marked as non-recommendations.
- Chain MAC remains available for audit trails.

### Fire / Rescue

Difficulty:

- Too many raw points can distract from urgent clusters.
- Roads, people, and resources get mixed together.

Component support:

- `rescue` profile filters to rescue-relevant person and terrain clusters.
- No route recommendation is provided.

### Social / Health / Labor

Difficulty:

- Sensitive populations need support without creating enforcement risk.
- Different bureaus need different slices.

Component support:

- Resource requests are visible without names or IDs.
- Sensitive needs are grouped: migration or nonlocal support is exported as
  `language_or_nonlocal_support`, while evacuation support, care, and privacy
  needs are exported as restricted support buckets. `special_needs` covers
  young children, maternity, caregiver absence, disability, illness, and other
  local SOP support cases without exposing those subcategories.
- `migrant_worker`, `foreign_visitor`, and similar packet flags are logistics
  signals, not enforcement evidence, and are not exported as direct labels.

### T-CERT / Enterprise / Mall Partners

Difficulty:

- Trained private teams may both request support and offer equipment, manpower, shelter, power, or supplies.
- Churches, civil-society groups, and other local helpers may need resource
  signals but should not receive person-status details.

Component support:

- `partner` profile exports resource requests and resource offers.
- The slice is suitable for T-CERT-style enterprise, mall, church, civil-society, and local mutual-aid nodes.

### Lifeline Operators

Difficulty:

- Telecom, power, water, and transport operators need signals related to service continuity, not all disaster case details.

Component support:

- `lifeline` profile filters event queue rows to signal loss, power outage, road block, and bridge collapse.
- It also filters resources to communication, power generator, fuel, and vehicle transport.

### Healthcare Partners

Difficulty:

- Hospitals and care institutions need medical-aid and vulnerable-needs signals without receiving civil identity or immigration-sensitive details.

Component support:

- `healthcare` profile includes injury counts and grouped care-continuity
  support buckets instead of direct special-needs or long-term-care labels.
- It filters resource requests to `medical_aid`.

## Safe Use Statement

Use these exports to ask better follow-up questions. Do not use them as the only basis for official evacuation, rescue, eligibility, immigration, welfare, hospital admission, or lifeline restoration decisions.
