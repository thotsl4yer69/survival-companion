# TARGET — BLACKBOX + GHOSTLINK v0.5 "FORGE / FIELD"

Mode: **Build**. Owner: Jack Mazzini (MAZLABZ). Base: `survival-companion/projects/blackbox-ghostlink` v0.4.0 (111 passing tests).

## What done means (campaign)

A custom offline survival command centre that is *prepared* on the Windows desktop (FORGE), *runs* on the Jetson Orin Nano Super (FIELD), and also runs on the Windows desktop. One shared drive (the VAULT) carries all bulk content between them. It does more than Project NOMAD in the ways that matter to this owner: ARM64/Orin-native, verified provenance for every byte, cited AI answers, Meshtastic AI gateway, and the ARMORY survival 3D-print library pre-sliced for the owner's printers.

## Slices (each ships with tests and must pass before the next starts)

| Slice | Delivers | Real target |
|---|---|---|
| **S1 FORGE** | Vault provisioner: catalogue, resolvers, resumable verified downloads, Ollama native store, SHA-256 manifest, verify, plan, env | Windows 10/11 + Python 3.9+, exFAT USB SSD; re-verify on Orin |
| S2 FIELD-KNOWLEDGE | BLACKBOX reads the Vault: Kiwix full-text retrieval → local model answers with citations; auto-config of Ollama/kiwix-serve | Orin Nano Super 8 GB, JetPack 6.x; Windows desktop |
| S3 ARMORY | Parametric survival part library (OpenSCAD → STL), licence ledger, OrcaSlicer CLI pre-slice for Flashforge Adventurer 5M + Anycubic Kobra S1, import of owner-downloaded models, UI tab | Windows desktop + both printers |
| S4 MAPS | Region-wide offline maps from the Vault (raster pipeline extended beyond Bendigo; vector option evaluated) | Orin + Windows |
| S5 GHOSTLINK-AI | Meshtastic → local AI gateway, 233-byte paging, rate limits, explicit opt-in | 2 × physical nodes, ANZ 915–928 MHz |
| S6 POWER & HW gates | Measured power, endurance, thermal, enclosure fit | Physical |

## S1 FORGE — acceptance tests (pass/fail, no judgement)

| # | Test | Pass criterion |
|---|---|---|
| F1 | `forge init <dir>` | Creates `vault.json`, `.forge/`, standard folders; refuses a non-empty non-vault folder; refuses FAT32 (4 GiB limit); reports exFAT/NTFS/other with the detected type |
| F2 | Path rules | Every planned path passes Windows + exFAT rules: no `<>:"\|?*` or control chars, no reserved device names, no trailing dot/space, ≤ 200 chars relative, no case-insensitive collisions. Violations block `plan` |
| F3 | `forge plan --profile P` | Resolves every item against live upstream to a concrete file list with byte sizes and an integrity class; reports total vs free space; exit code 3 if it will not fit |
| F4 | Integrity | Nothing is promoted into the Vault unless it matches an upstream SHA-256 (Kiwix meta4 / sidecar, Hugging Face `x-linked-etag`, Ollama layer digest, Ollama `sha256sum.txt`) or a catalogue-pinned SHA-256. MD5-only and pinned items are labelled as such in `vault.json` and `PROVENANCE.tsv` (`MANIFEST.sha256` stays pure coreutils format for F10) |
| F5 | Resume under faults | Against a fault-injecting server: ≥5 dropped connections mid-file, TCP resets, read timeouts, 1-byte trickles, mirror/ETag changes between requests, bad mirrors (http redirect, wrong size), Range ignored (HTTP 200), one corrupted piece, 503 storms → final file SHA-256 equals expected; never a corrupt file in the Vault |
| F6 | Resume across restarts | Process killed mid-download, rerun resumes from the last verified piece (not from zero) and finishes with the correct digest |
| F7 | Failure is clean | 404 on all mirrors, upstream size change, disk full: item fails with a clear message, exit ≠ 0, no partial file in a managed path, partial kept for resume where valid |
| F8 | Ollama store | Models written by Forge (no Ollama install needed on the Forge) load in a real Ollama server with `OLLAMA_MODELS=<vault>/ai/ollama`: `/api/tags` lists them and inference/embedding returns output |
| F9 | Kiwix | A ZIM fetched by Forge is served by a real `kiwix-serve`; an article and a full-text search return HTTP 200 with content |
| F10 | Manifest | `MANIFEST.sha256` is GNU coreutils format; `sha256sum -c MANIFEST.sha256` passes on Linux/Orin from the Vault root |
| F11 | Verify | `forge verify` detects a flipped byte, a truncated file and a missing file (exit 1); reports untracked files; `--quick` checks sizes only; works on a read-only Vault; the next `fetch` repairs what verify flagged |
| F12 | Lock | A second concurrent Forge process on the same Vault refuses to start |
| F13 | exFAT | F1, F5, F10, F11, F12 pass on a real exFAT volume |
| F14 | Portability | Stdlib only; source passes a Python 3.9 minimum-version check; Windows launcher `forge.cmd` provided |
| F15 | No regressions | Existing v0.4.0 suite still passes |

## Constraints

- Zero mandatory third-party Python dependencies (project principle since v0.1).
- HTTPS only for downloads; no telemetry, accounts, tokens or cloud services.
- Vault must be readable by Windows (exFAT/NTFS) and the Orin (JetPack 6 kernel reads exFAT natively).
- Orin Nano 8 GB shared RAM: default resident model ≤ ~3 GB (qwen3:4b, 2.50 GB); 8B and Gemma 4 E4B (6.58 GB) are optional profile extras, not defaults.
- Content licences preserved; non-commercial content must never be bundled into anything sold.

## Budget and stop rules

- S1 lands in one session at ladder level **2 (Runs here)** with real-upstream integration tests. Levels 4+ need the owner's Windows PC and Orin.
- Stop and ask before: pushing to the public repo, publishing releases, formatting any drive, buying hardware, or flashing radios.
- If a real-upstream check cannot be reached from the build sandbox, the item is marked unverified with the exact command to verify it.
