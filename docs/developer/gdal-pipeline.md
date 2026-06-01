# GDAL 開放資料 Pipeline

> Public-safe summary for the build-time geospatial process.

GDAL is used only as a build-time tool. It does not run in the server runtime and is not part of the packet/API contract.

## Public Boundary

This repository may include simplified / redacted derived demo geometry from Taiwan open government data. It does not publish raw geospatial files, address fields, coordinate review notes, exact clipping ranges, or source-processing working files.

Minimum public attribution for the agriculture datasets lives in `README.md` under Data Attribution. That attribution intentionally lists only:

- dataset name
- publisher
- data.gov.tw dataset URL
- license
- public-data boundary statement

## Processing Boundary

The private build process converts official open-data geometry into a small static overlay for deterministic demo analysis. The public output is only a redacted / simplified demonstration layer. It is not an official hazard map, a real-case reconstruction, a routing layer, or evidence of any household, sheltering decision, rescue case, or welfare case.

The public repo does not require reviewers or downstream adopters to reproduce the private geospatial processing steps. Integrators that need official geometry should obtain the source datasets from the publishing agencies and run their own governance, licensing, privacy, and quality review.

## Runtime Boundary

The application consumes static derived geometry. Missing geometry must fail visibly or render blank; the runtime must not fetch raw geospatial data, infer hidden address fields, or silently replace the overlay with undocumented sources.

## Implementation Note

Keep geospatial processing outside the runtime path. If a future branch publishes a reproducible public data pipeline, it must first remove raw address fields, avoid exposing coordinate review notes, and update `README.md` attribution before release.
