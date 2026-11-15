See [docs/RELEASE_0.4.0.md](docs/RELEASE_0.4.0.md) for the current v0.4.0 build. The v0.3.1 notes below remain as historical audit context.

---

# BLACKBOX + GHOSTLINK v0.3.1 — reviewed software baseline

Review fixes incorporated before merge to `main`:
- Local MBTiles raster tiles now render under the browser Content Security Policy (`blob:` image sources).
- Radio crash recovery runs only at exclusive radio server startup, not during `backup`, `check` or `reindex`.
- A POSIX cross-process radio ownership lock prevents two active radio-owning servers from sharing the same outbox.
- Both local Ollama generation and the local Ollama hardware probe disable inherited HTTP proxies and outbound redirects.
- Added targeted regression tests for each review issue.

**Physical hardware and RF operation remain unverified.** This is software-ready only.

---

# BLACKBOX + GHOSTLINK v0.3.0 (prior release) — source-audited release

**Release date:** 2026-11-15 (Australia/Melbourne)  
**Release classification:** local-first software prototype with testable hardware adapters, **not field-certified**.

## What changed since v0.2.2

- **Crash-safe radio outbox:** persist uncertain send status before calling the Meshtastic serial API. Any interrupted, failed or pre-reboot queued delivery becomes manual-review only. No silent retransmission.
- **Fresh-message policy:** release requires an active serial bridge; a pending release expires after 120 seconds if not submitted. Operator must explicitly re-release if appropriate.
- **Persistent inbound deduplication:** uniqueness for sender plus packet ID in SQLite, including migration of old duplicate entries.
- **Home Assistant transport hardening:** numeric private IP or localhost only, redirects forbidden, proxies disabled, 1 MB response size cap and malformed attribute handling.
- **Private storage:** owner-only POSIX modes for SQLite databases and backups even when started outside systemd.
- **Knowledge index correctness:** deleted files disappear; unchanged documents retain original updated timestamps.
- **Safer client state:** clearing authentication actually removes browser session token; UI radio release button appears only when serial bridge reports connected; map object URLs are generation-checked.
- **Installer idempotence:** the knowledge folder no longer nests on repeat deployment.
- **ESP32 firmware:** finite HTTP connection and read timeouts; firmware remains uncompiled on target hardware.
- **Release verification:** exact per-file SHA-256 manifest and an offline integrity verification script. Release-builder excludes databases, local secrets, cache files and outdated screenshots.
- **Full source audit:** `docs/CODE_AUDIT_2026-11-15.md` and upstream references record every source asset and outstanding physical acceptance gate.

## Verification evidence

- **82 Python automated tests passed** on a clean local suite (HTTP, persistence, backup, security, migration, fake radio, map conversion and mesh integrity).
- Branch-aware test coverage: **85%** for `app.py` and `radio_bridge.py` combined. This does not measure JavaScript, firmware, CAD fit or the physical radio.
- `node --check app.js` and `python3 -m compileall` passed.
- `bash -n deploy/install_jetson.sh` passed.
- Three CAD STLs rebuilt using OpenSCAD, matched the shipped mesh volumes and dimensions, and passed trimesh watertight checks.
- Browser-based v0.3.0 test was attempted but blocked by managed Chromium `URLBlocklist: ["*"]`; previous v0.2.2 UI tests are historical evidence only, not current browser proof.
- Archive ZIP and per-file SHA-256 checks are verified after packing.

## Not verified

The Jetson remote agent was offline during this build. No Orin systemd deployment, physical LoRa send/receive, ACK, ESP32 firmware compilation/flash, live Home Assistant request, locally accelerated AI model, actual MBTiles map, measured battery power runtime or printed casing fit was performed. Never count code tests as these hardware gates.

## Security and safety boundary

Loopback-only is the default. LAN HTTP has **no TLS** and must never be exposed to an untrusted network or forwarded to the public internet. Radio serial submission never proves message delivery. Do not rely on this prototype as a substitute for emergency services, certified alarms, paper maps, verified charging/battery equipment or approved communications hardware. Australian RF operation must satisfy current ACMA rules for the actual device and antenna.
