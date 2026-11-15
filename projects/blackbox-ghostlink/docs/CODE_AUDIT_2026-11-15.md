# BLACKBOX + GHOSTLINK — complete source and integration review

**Review date:** 2026-11-15 (Australia/Melbourne)  
**Revised release:** v0.3.0  
**Scope:** every source, configuration, test, CAD definition, asset and shipped reference file in the release. Review combines line-by-line source inspection, current upstream documentation checks, automated regression tests, and native CAD recompilation. The code has not been deployed to the user's physical Jetson, and this is not a certified security audit.

## Verdict

**Conditional software prototype, not verified emergency equipment.** Its main offline database, local HTTP API, browser UI, and radio transport contract have automated verification. The principal risks found in v0.2.2 are addressed in v0.3.0. Physical radio delivery, device-firmware compilation, field power resilience and real deployment remain unverified.

### Fixed findings

| Priority | v0.2.2 finding | v0.3.0 correction | Regression evidence |
|---|---|---|---|
| Critical | Radio worker could send a packet, crash before storing success, and replay it after reboot. | Persist `submitting-uncertain` **before** the serial call; mark ambiguous state for manual review on restart. | `RadioCrashSafety` crash/restart and failure tests |
| High | Previously released messages could wait indefinitely for a radio then transmit hours later. | Radio must be connected to release. Pending release expires after 120 seconds and must be explicitly released again. | Expiry and queue tests |
| High | Home Assistant API could redirect a bearer token to another URL; `.local`/`.lan` hostnames could hide public destinations. | Local numeric addresses or `localhost` only; redirects blocked; proxies bypassed; response limit enforced. | Redirect-leak and host validation tests |
| Medium | Received radio packet de-duplication was only in RAM and reset after crash. | Unique SQLite index on incoming `(sender, packet_id)`; one-time duplicate cleanup. | Persistence/restart and legacy migration tests |
| Medium | Directly launched app/backup files could inherit permissive POSIX umask. | Mode `0600` for database and backup files. | POSIX permission tests |
| Medium | Re-running installer could recursively nest `knowledge/knowledge`. | Copy contents (`knowledge/.`) into stable destination, preserve local additions. | Shell review; **not tested on target systemd** |
| Medium | Search index retained deleted reference files and reset `updated` on every boot. | Remove stale slugs and update timestamps only when content changes. | Search indexing tests |
| Low | ESP32 HTTP could stall for long periods; `use_model: "false"` was interpreted as true. | Explicit HTTP timeouts; strict boolean validation. | Python tests; firmware **not compiled on ESP32** |
| Low | Lock/switch-token button retained a session token and used misleading label. | Remove session token when locking and clarify label. | JS syntax/static inspection; browser smoke blocked by managed browser policy |
| Low | JS tile-generation race could retain an object URL after map refresh. | Verify request generation after receiving tile blob, before creating URL. | Static inspection; real raster-map field test pending |

### Residual risks (not fixed or not independently verified)

1. **No built-in HTTPS/TLS:** do not expose LAN HTTP to untrusted networks; device key and bearer token are visible to trusted-LAN packet capture. Default loopback avoids exposing HTTP directly. Use a secure, authenticated tunnel if remote clients are essential.
2. **No hardware radio test:** serial acceptance is not proof of LoRa range, channel compatibility or receiver delivery. Meshtastic acknowledgements are not currently persisted as verified end-to-end receipts.
3. **No real ESP32 Arduino build/flash:** firmware source is reviewed for correct Arduino APIs, but no board core, toolchain or ESP32-S3 hardware was connected here.
4. **No Jetson systemd test:** install script has shell syntax checking, but no confirmation of service startup, persistent boot or serial permissions on the actual target.
5. **No real MBTiles dataset:** TMS axis handling is tested. Map accuracy, coverage and tile-image compatibility need an actual dataset.
6. **No physical STL fit or thermal test:** CAD source recompiles to the shipped watertight models. Case and tray clearances have not been measured against the actual board, antenna, cable or fan intake.
7. **No radio RF compliance determination:** Meshtastic's ANZ profile does not alone prove a particular board/antenna/EIRP combination complies with Australian law; see ACMA sources.
8. **No formal application penetration test:** the stdlib HTTP service has no account lockout or enterprise-grade abuse protection. Use only on controlled local networks.
9. **No guaranteed offline AI:** deterministic search is offline; optional Ollama model inference depends on a separately installed model and successful runtime on the Nano.
10. **No guaranteed power resilience:** independent UPS/battery hardware, clean-shutdown behavior and power-budget assumptions have not been physically measured.

## File-by-file inspection record

| File or group | What was checked | Outcome |
|---|---|---|
| `app.py` | All API handlers, auth, JSON parsing, validation, SQLite schema/migration, FTS, GPX/GeoJSON, MBTiles TMS, backup, printable report, HA SSRF boundary, local Ollama. | Revised; API regression tests pass |
| `radio_bridge.py` | PubSub receive event, serial API, durable inbound de-dup, outbound claim-before-send, reconnect and failure policy. | Revised; fake-radio regression tests pass; physical send not tested |
| `app.js` | HTML escaping for DB/user text, authenticated fetch, user actions, radio release button, map tile object URLs, lock and session token. | Revised; JavaScript parser passes; live browser retest blocked |
| `index.html` | All tabs, form IDs, labels, accessibility indicators, CSP-compatible linked assets, auth gate, no externally hosted scripts. | Reviewed; corrected token label |
| `style.css` | No remote CSS imports or fonts, responsive classes, content containment, authentication overlay and map styling. | Inspected; visual acceptance not rerun |
| `icon.svg` | XML/SVG purely visual; no script, foreign remote content or links. | Reviewed |
| `manifest.webmanifest` | Valid JSON, local origin routes and icon reference. | JSON parse passes; offline PWA caching not claimed |
| `.gitignore` | Prevents `.sqlite3`, private `secrets.h`, `.env`, pycache and backup artifacts from source control. | Reviewed |
| `deploy/install_jetson.sh` | Root check, user/group ownership, file modes, repeat installation, systemd changes. | Fixed nested-copy bug, shell syntax passes; not executed on Nano |
| `deploy/blackbox.service` | Service isolation, no privileged login shell, restart behavior, protected filesystem, private runtime. | Reviewed; permissions and device groups need target validation |
| `deploy/blackbox.env.example` | Loopback safe default, separate sensor key, optional integrations commented out. | Reviewed; contains no real keys |
| `deploy/generate_node_config.py` | Private IPv4 host input, random independent node key, safe C-string serialization, `0600` secrets file. | Reviewed; command-line Wi-Fi password can appear in shell history; treat cautiously |
| `firmware/esp32s3-node/esp32s3-node.ino` | Wi-Fi reconnect, actual uptime/RSSI/heap reporting, JSON structure, HTTP/timeout handling, separate key; not LoRa. | Revised; source inspected, Arduino compile/flash pending |
| `firmware/esp32s3-node/secrets.example.h` | Placeholder-only credentials, correct macro names, no real secrets. | Reviewed |
| `tools/hardware_probe.py` | Read-only OS, Jetson, memory, storage, serial candidates and loopback Ollama; no invented hardware. | Automated host-container probe passes; Nano probe pending |
| `tools/package_release.py` | Explicit extension allowlist; no private DB, keys or `.env`; ZIP integrity and SHA-256 generation. | Reviewed; release archive validation performed |
| `tools/verify_integrity.py` | Per-file SHA-256 checks and archive-path traversal protection. | Reviewed; verified extracted archive |
| `hardware/field_node_case.scad` | Units, base cavity, cutouts, lid dimensions, print fit disclaimers. | OpenSCAD export rebuild matches shipped STLs |
| `hardware/field_node_base.stl` | Watertight volume, dimensions, reproduction from source. | PASS mesh geometry; physical fit untested |
| `hardware/field_node_lid.stl` | Watertight volume, dimensions, reproduction from source. | PASS mesh geometry; physical fit untested |
| `hardware/jetson_open_tray.scad` | Published outer dimensions used as approximation, ventilation, mounting/port uncertainty. | OpenSCAD export rebuild matches shipped STL |
| `hardware/jetson_open_tray.stl` | Watertight volume, dimensions, reproduction from source. | PASS mesh geometry; physical fit/thermal untested |
| `tests/test_system.py` | HTTP API, auth, SQL input handling, backup integrity, search, GPX, telemetry, fake radio, optional adapter and CAD tests. | Executed |
| `tests/test_hardening.py` | Crash-safe delivery, dedup across restarts, redirect token protection, strict numeric input, private backups. | New and executed |
| `tests/test_edge_cases.py` | HTTP size limits, local-only bind enforcement, fresh radio release, direct-node ACK request semantics, optional local-model request contract. | New and executed |
| `tests/test_radio_states.py` | Radio transport malformed packets, disconnect, PubSub registration/unsubscription and failed connection event. | New and executed |
| `tests/test_reference_integrity.py` | Knowledge-index removal/timestamp logic and manifest-tamper/path-traversal checks. | New and executed |
| `tests/browser_smoke.py` | Optional browser automation for auth, UI forms, search, lock and mobile viewport. | Script reviewed; unable to execute due managed Chromium `URLBlocklist: ["*"]` |
| `docs/HARDWARE_TEST_GATES.md` | Explicitly distinguishes real-world acceptance evidence from tested code. | Reviewed and updated |
| `docs/UPSTREAM_REFERENCES.md` | Direct upstream API and safety/regulatory sources with review date. | New research record |
| `docs/CODE_AUDIT_2026-11-15.md` | Findings, file-by-file scope, residual risks and verified claims. | This report |
| `knowledge/00-emergency-first-actions.md` | First-actions sequence, official warnings and equipment-failure cautions. | Reviewed; general orientation, not emergency certification |
| `knowledge/01-water.md` | Water visual quality vs potability, boiling limitations, certified treatment warnings. | Reviewed; authority guidance remains primary |
| `knowledge/02-backup-power.md` | Watts/Wh, lithium batteries, CO, transfer-switch restrictions. | Reviewed; no mains DIY procedure |
| `knowledge/03-communications.md` | ANZ region, short messages, no guaranteed delivery or emergency calls. | Reviewed against Meshtastic/ACMA |
| `knowledge/04-health-and-shelter.md` | Certified detectors, first aid/evacuation boundary. | Reviewed; not medical guidance |
| `knowledge/05-navigation.md` | Offline maps, coordinate provenance, GNSS constraints. | Reviewed; physical cross-check required |
| `knowledge/06-stockpile.md` | Actual inventory, expiry, min reserve, no invented supplies. | Reviewed |
| `README.md` | Installation, security boundaries, optional dependencies, verified/unverified capabilities. | Updated for v0.3.0 |
| `RELEASE_NOTES.md` | Shipping scope, test count and limitations. | Updated for v0.3.0 |
| `SHA256SUMS` | Per-file release integrity, generated during packaging (excludes itself). | Verified from extracted ZIP |

**Screenshots:** v0.2.2 reference PNGs are intentionally excluded from this v0.3.0 release because the environment's managed Chromium policy prevents generating accurate new screenshots. The application itself is shipped unchanged as a runnable UI; no generated images are used as evidence of testing.

## Test-method limitations

At this review, **82 tests pass** and branch-aware coverage of the Python backend and radio bridge is **85%**. The tests are primarily software unit/integration checks against a local ephemeral database and a deliberately fake radio. The fake-radio contract verifies API calls and failure handling, **not** firmware, LoRa transmission, range, antenna performance, repeatability in electromagnetic interference or emergency availability. A live browser retest was attempted, but the installed Chromium policy blocks all URLs (`net::ERR_BLOCKED_BY_ADMINISTRATOR`); JavaScript parsing and API coverage are separate evidence, not a substitute. Source inspection cannot prove physical deployment or independent network security.

## Decision

**Release v0.3.0 as a software prototype with a hardware acceptance gate.** Do not advertise as emergency-certified, reliable radio delivery, field-tested solar/UPS, GPS guidance or tested EMP protection. If a gate has no actual physical measurement, status remains NOT TESTED.
