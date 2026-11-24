# STATUS — 2026-11-24

Ladder: 1 Written · 2 Runs here · 3 CI green · 4 Bench-verified · 5 Field-verified · 6 Soak-verified

## S1 FORGE — level 2 (Runs here), independently reviewed, with real-upstream integration

| Test | Result | Level | Evidence |
|---|---|---|---|
| F1 init | PASS | 2 | `VaultTests`; real exFAT detected as `exfat` behind FUSE; FAT32 refused |
| F2 path rules | PASS | 2 | reserved names incl. COM0/COM¹/CONIN$, Windows characters, trailing dot/space, length, file- and folder-level case collisions vs plan and existing records |
| F3 plan | PASS | 2 | `LiveUpstreamTests` + live `plan --profile scout` (23 of 24 resolved; Geofabrik is unreachable from the sandbox); exit codes 0/1/3 tested |
| F4 integrity | PASS | 2 | upstream SHA-256 / MD5 (Geofabrik only) / pinned (kiwix-tools), labelled in `vault.json` + `PROVENANCE.tsv`; the review's integrity sweep found no wrong file ever promoted |
| F5 resume under faults | PASS | 2 | drops, **TCP resets, read timeouts, trickle watchdog**, bad mirrors rotate, Range ignored, corrupt piece, wrong Content-Range, 503/429 storms |
| F6 resume across restarts | PASS | 2 | give-up-then-rerun; kill -9 with and without pieces; resumes from a verified/durable offset |
| F7 clean failure | PASS | 2 | 404 everywhere, size change, real ENOSPC (exit 4), ENOSPC on the index write, OS errors reported without traceback |
| F8 Ollama store | PASS | 2 | automated live test: real Ollama 0.40.17 lists, embeds and generates from Forge-written models on exFAT; also from a read-only mount |
| F9 Kiwix | PASS | 2 | automated live test: real kiwix-serve 3.8.2 from the Vault, article and full-text search |
| F10 manifest | PASS | 2 | coreutils `sha256sum -c` (unit and live) |
| F11 verify | PASS | 2 | flip / truncate / missing / untracked / runtime cache / quick; **read-only Vault**; flagged damage repaired by the next `fetch`; `--deep` |
| F12 lock | PASS | 2 | in-process and cross-process (exit 5); a read-only Vault is reported, not crashed |
| F13 exFAT | PASS | 2 | 65 exFAT test variants + live tests on a real `mkfs.exfat` volume; survived an unclean unmount |
| F14 portability | PASS on Linux | 2 | whole suite on real Python 3.9.25 and 3.13; stdlib only; pyflakes clean. **Windows paths not yet executed**: see below |
| F15 no regressions | PASS | 2 | repo suite 260 tests OK; v0.4.0 release parity (53 files) unchanged; only new files added |

Independent review (Phase 5): 1 high, 6 medium and 9 low defects found, **all fixed** with regression tests `r1`–`r16`. The reviewer's own attack scripts were re-run against the fixed code and no longer reproduce.

### Not yet verified, and how to verify

1. **Windows (levels 3 and 4).** This covers `GetVolumeInformationW` detection, `msvcrt` locking, the `winreg` long-path check, the replace retry and `forge.cmd`. The Windows code was read by the reviewer but has not run.
   - CI: `.github/workflows/blackbox-forge-ci.yml` runs on `windows-latest` × Python 3.9/3.12. Run it manually with `live_fetch=true` for a real Windows download.
   - Desktop: `forge\forge.cmd init E:\BLACKBOX`, then `forge\forge.cmd fetch E:\BLACKBOX --profile test`, then `forge\forge.cmd verify E:\BLACKBOX --strict`. It must print `PASS`.
2. **Orin (level 4).** Run `sha256sum -c --quiet MANIFEST.sha256 && echo VAULT OK`, then README section 2. `ollama run qwen3:4b` must answer.
   - Unverified: whether `zstd` is preinstalled on JetPack 6 (if not, `sudo apt install zstd` while online), and the udisks exFAT mount permissions for the Ollama service user.
3. **Geofabrik maps:** unreachable from the sandbox; the MD5 path is covered only by unit tests.
4. **Large-file timing:** resume re-reads the partial download before continuing (a few minutes per resume on a 119 GB ZIM); not yet timed on the real SSD.

## Pre-existing v0.4.0 defect (not changed; that release is frozen)

- The offline pack ships only the Ollama JetPack overlay, which has no `ollama` binary. Forge's `rt-ollama-arm64` fixes this for the Vault; `offline/catalog.json` should get the same fix in a v0.5 release.

## Decisions

- 2026-11-24: owner approved `TARGET.md` (S1 to S6) and pushing to branch `forge-v0.5` (public for now; the owner may make the repo private later).
- Still open: merging to `main` and cutting a v0.5 release ZIP (needs the `offline/catalog.json` Ollama fix).
- Next slice: S2 FIELD-KNOWLEDGE. Planned route: Kiwix search for HTML ZIMs plus a Forge-built PDF text index for zimgit-style collections (REGISTER S2-K2).
