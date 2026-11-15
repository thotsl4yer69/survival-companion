# Release 0.4.0 — owned source and complete data-pack pipeline

**Release class:** tested source with reproducible off-grid data pack assembly. Not a certified, deployed physical system.

## New capabilities

1. Python-only `offline/prepare.py` prepares model, Kiwix and map sources through HTTPS, validates file type and minimum size, records source SHA-256, detects tampering and bundles sources + derived map into one TAR with its own checksum.
2. `offline/render_map.py` processes actual Geofabrik Victoria OSM PBF with Osmium and renders roads, places, park/water and building features into raster PNG MBTiles for BLACKBOX's existing map API. Geographic scope and zoom guardrails bound RAM usage.
3. `offline/activate.py` verifies imported assets, reports actual local runtime availability and supports importing the GGUF into a locally running Ollama instance without downloading again.
4. `offline/catalog.json` records exact public sources and minimum sizes for all large data inputs. Two profiles, `base` and `bendigo`, permit choosing the footprint.
5. Comprehensive new automated tests cover downloading, file signatures, SHA-256 tamper detection, safe archive paths, raster tile creation, local map API compatibility, and missing-source failure paths.
6. Automated GitHub main-branch source tests and dedicated complete field-pack publishing workflow with GitHub release assets (split below the GitHub per-asset size limit) (data published only if full build succeeds).

## Important limits

No gigabyte source files are checked into Git history. A GitHub release asset is created only after real fetching, rendering and hash verification on the GitHub runner. Physical performance is not inferred from CI. The field-data pack does not package a native executable Ollama/Kiwix runtime; those must be preinstalled on the target, and validated offline.

## Evidence

`python3 -m unittest discover -s tests -q`; `python3 tools/verify_integrity.py`; `python3 offline/prepare.py plan`; GIS GeoJSONseq fixture → real raster MBTiles tested; release archive extracted and integrity checked in CI.

The completion threshold is not number of tests: it is a verified AI inference, map display, offline Kiwix browse, two-node LoRa exchange and independent power test on physical equipment. These remain unverified.
