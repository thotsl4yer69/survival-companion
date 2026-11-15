# BLACKBOX + GHOSTLINK — external code review request

**Review target:** v0.3.0 source, firmware, deployment scripts, printable CAD and generated STL assets, in `projects/blackbox-ghostlink/`.

## Verification boundary

- `python3 tools/verify_integrity.py` matches SHA-256 of the 40 underlying original package files. It is a transfer-integrity check, **not a signature, independent provenance or security certification**.
- `python3 -m unittest discover -s tests -q` ran **82 tests successfully in the build environment on 2026-11-15**; GitHub Actions should provide separate evidence once executed.
- Connected Jetson, ESP32-S3, Home Assistant, radio hardware, regional RF operation, power/electrical safety and enclosure fit are **not verified**.
- Do not assert that the package is emergency-safe or that outgoing radio messages are delivered merely because software tests pass.

## Review priorities

1. **Security:** Validate URL parsing, DNS pinning/redirect handling and bearer-token protection in Home Assistant and Ollama access; browser token handling; field node authentication and network exposure. Review for XSS, CSRF, SSRF, path traversal, SQL injection and secret leakage.
2. **Message integrity:** Inspect `radio_bridge.py` and SQLite transitions for exactly-once vs at-most-once ambiguity; manual transmission gate, expiry, restart/crash recovery, inbound deduplication, replay/idempotency and delivery acknowledgement semantics.
3. **Operational reliability:** SQLite transaction/thread safety, migrations, backups and restores, permission modes, failures under disk-full conditions, clock jumps, repeated boot, network outages and loss of power.
4. **Offline mode:** No unplanned external requests; ensure local-only mode works without DNS, cloud APIs or internet. Validate imported MBTiles database constraints and availability states.
5. **Deployment:** systemd hardening, file ownership, Python/runtime version assumptions and installer idempotency; no privileged web server; no silent overwrites of data.
6. **ESP32 firmware:** Compile on real board toolchain; verify Wi-Fi fallback, sensor-missing signals, timeouts, retry/queue semantics and secrets handling. Local fake-device ingestion tests are not actual firmware verification.
7. **CAD:** Rebuild from OpenSCAD, inspect print orientation, wall thickness and clearances, cooling/vents and final fit against actual hardware dimensions. Watertight mesh checks do not establish mechanical or electrical suitability.
8. **Knowledge and safety:** Fact-check critical instructions against authoritative sources; confirm no critical reliance on AI or uncalibrated sensor readings.

## Reviewer commands

```bash
cd projects/blackbox-ghostlink
python3 app.py check
python3 tools/verify_integrity.py
python3 -m unittest discover -s tests -q
python3 -m compileall -q app.py radio_bridge.py deploy tools tests
node --check app.js
bash -n deploy/install_jetson.sh
```

## Findings

Please leave **inline PR comments with file/line and reproducer**, severity, exploitability or failure consequences, and suggested fix. Do not merge into `main` until blocking findings are resolved and relevant field tests are evidenced. Keep deliberate assumptions separate from verified behaviour.

The baseline audit at `docs/CODE_AUDIT_2026-11-15.md` is the producer's audit, **not independent assurance**.
