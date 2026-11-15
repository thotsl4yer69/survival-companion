# BLACKBOX + GHOSTLINK v0.3.0

**Offline-first survival operations gateway and printable field hardware.** A genuinely runnable local software release with optional hardware adapters; not a claim of a tested off-grid network. Built to run without internet access once installed and provisioned. The Python core has **zero mandatory third-party dependencies**.

## Actual release status

| Component | Implemented | Tested | Physical verification |
|---|---|---|---|
| Local web dashboard / responsive screens | Yes | Previous v0.2.2 browser interactions; v0.3 automated API and JS syntax | Runs in a local test environment |
| Supplies / reserve thresholds / updates | Yes | Automated tests | No real inventory inserted |
| Readiness checklist with timestamps | Yes | Automated tests | Operator confirmation required |
| Power autonomy estimator | Yes | Numerical tests | No power meter installed |
| Field notes / events | Yes | Automated tests | No operational records assumed |
| Offline Markdown full-text search | Yes | Automated tests | Seven included original reference files |
| Local Ollama integration | Optional | API contract only | Model not installed or benchmarked |
| GHOSTLINK radio outbox | Yes | Crash/restart-safe fake-radio integration tests | **No radio hardware connected** |
| Meshtastic serial send/receive adapter | Optional | Fake transport tests | **No RF transmission or delivery test** |
| ESP32-S3 Wi-Fi telemetry firmware | Yes | Server ingestion tests | Firmware not compiled or flashed on physical board |
| Home Assistant read-only API adapter | Yes | Local fake-HA tests | User's actual HA not reached |
| Stored waypoints / GPX / GeoJSON | Yes | API tests | Not a standalone GPS receiver |
| Raster MBTiles map viewer | Yes, bring your own raster MBTiles | TMS API tests | No real map dataset shipped |
| Database backup / v0.1 schema migration | Yes | SQLite tests | Disaster recovery on hardware untested |
| Standalone printable field report | Yes | HTML escaping, content and authentication tests | Snapshot of operator-entered data only |
| Crash-safe radio release | Yes | Atomic uncertain handoff, no automatic replay, 120s expiry tests | Real receiver ACK not verified |
| Per-file release integrity | Yes | SHA-256 tamper/path tests and extracted-package verification | Does not prove origin or signature |
| Field node enclosure base and lid STL | Yes | Watertight mesh tests | Physical fit not yet printed/tested |
| Open Jetson mounting tray STL | Yes | Watertight mesh test | Physical fit/cooling not yet tested |
| systemd restart-on-failure service | Yes | Shell syntax checked | Jetson service not installed remotely |

**Important:** NONE of the radio, antenna, battery, thermal, enclosure-fit, on-device Orin AI or ESP32 hardware tests have occurred. Do not rely on the system for life-critical operation without appropriate physical and field validation.

## Run immediately

Requires **Python 3.9 or newer**, a writable local directory and a current browser. On a Jetson Orin Nano, Raspberry Pi, Windows, macOS or Linux:

```sh
cd blackbox_ghostlink
python3 app.py check
python3 tools/hardware_probe.py
python3 -m unittest discover -s tests -v
python3 app.py
```

Open `http://127.0.0.1:8765`. The server creates `blackbox.sqlite3` on first launch, with no fake supply, telemetry or radio records. At least seven original, concise safety references are indexed from `knowledge/`.

To reindex new local Markdown files you have added to `knowledge/`:

```sh
python3 app.py reindex
```

Back up the data while the server is running:

```sh
python3 app.py backup /your/backup/location/blackbox-backup.sqlite3
```

The System tab also offers a database snapshot download and a standalone **printable field report** containing current stockpile, waypoint coordinates, latest node readings, readiness checklist and recent notes. The self-contained HTML file is readable without the server or internet after export. Protect it: it can contain private information. Restore only after stopping the service, safeguarding the existing DB and placing the verified backup at the configured database path.

## Jetson install with startup persistence

Review `deploy/blackbox.service` and `deploy/install_jetson.sh` before running. From the extracted project directory on the Jetson:

```sh
sudo bash deploy/install_jetson.sh
sudo systemctl status blackbox --no-pager
curl --fail http://127.0.0.1:8765/api/health
```

This copies the service into `/opt/blackbox`, stores its private data under `/var/lib/blackbox`, creates a restricted service account, enables startup and restarts it on failure. It does **not** flash firmware or alter radio regional settings. If the service must be accessible over a trusted LAN, generate a random access token and configure `BLACKBOX_HOST=0.0.0.0` plus `BLACKBOX_TOKEN=<random token>` inside `/etc/blackbox/blackbox.env`, then restart. Non-loopback bind is intentionally refused without an access token of at least 24 characters.

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
sudo chmod 600 /etc/blackbox/blackbox.env
sudo systemctl restart blackbox
```

**Security:** LAN HTTP is not encrypted, even with a bearer token. Do not expose the port to the internet. Use loopback or a secure authenticated tunnel where possible. Browser tokens are stored in session storage, not in the SQLite database. Generate a separate node key for field devices.

## GHOSTLINK physical setup gate

The core has an explicit two-stage outbound policy:

1. Compose a message: it stays `local-only` and **cannot** be transmitted.
2. With a **connected** optional radio bridge enabled, manually select **Release to radio**. Its freshness window is 120 seconds, after which it requires a new deliberate release. The worker uses Meshtastic's serial API.

Radio submission becomes `submitted-to-radio-unconfirmed`. This label is **not** delivery confirmation. A radio/serial exception becomes `failed-transmission-uncertain`; no automatic retry or repeated broadcasts. The handoff is persisted as uncertain *before* calling the radio library so a crash cannot silently replay it. On restart uncertain or previously queued messages need manual review. Releases are accepted only when the serial bridge is connected, and expire after 120 seconds if not submitted. Any deliberate re-release may result in a duplicate; decide accordingly.

The bridge needs an actual Meshtastic-compatible node, known-good antenna, compatible firmware, a verified serial device, approved frequency settings and the third-party Meshtastic Python library, installed **before** an outage:

```sh
python3 -m pip install meshtastic
```

Example settings for `/etc/blackbox/blackbox.env` (change serial device according to a real connected device):

```text
BLACKBOX_MESH_ENABLED=1
BLACKBOX_MESH_PORT=/dev/ttyUSB0
```

The service account must have explicit permission to the selected serial port; on many Linux systems this requires membership of the appropriate device group. Keep the bridge disabled until two physical nodes have demonstrated two-way exchange in the real environment. For Australia the Meshtastic ANZ region uses 915–928 MHz, but actual equipment compliance must be checked before transmission. Use correct antenna hardware. The adapter does not change firmware settings automatically.

Documentation: [Meshtastic Python API](https://python.meshtastic.org/) · [Supported radio regions](https://meshtastic.org/docs/configuration/region-by-country/)

## ESP32-S3 node

`firmware/esp32s3-node/esp32s3-node.ino` is a real Arduino sketch that posts its own measured uptime, Wi-Fi RSSI and free heap. It does not require a sensor library or claim to be a hazard detector. Its transmission path is **Wi-Fi on a private LAN**, not LoRa; these are separate systems.

Create the private `secrets.h` using `deploy/generate_node_config.py` with your actual local credentials, reachable host IP and node ID. The script generates a separate random device token and prints the required `BLACKBOX_NODE_KEY` service-environment entry. Do not publish the generated secrets file. Build with the appropriate ESP32-S3 board selected in Arduino IDE and an installed ESP32 board core, then inspect the serial output. Initial compile/flash/hardware testing must happen on the real board.

```sh
python3 deploy/generate_node_config.py --ssid 'LOCAL_WIFI' --wifi-password 'YOUR_WIFI_PASSWORD' --server 192.168.1.20 --node-id esp32s3-field-01
```

Only replace the above command values with your actual network values; no synthetic readings are required. Because telemetry uses unencrypted HTTP on a trusted LAN, do not allow this device to send over a public network.

## Home Assistant (read-only)

Set the following on the host running BLACKBOX, using the actual local host URL and a Home Assistant long-lived access token:

```text
BLACKBOX_HA_URL=http://192.168.1.143
BLACKBOX_HA_TOKEN=<private token from Home Assistant user profile>
```

The adapter only invokes `GET /api/states`, filters a bounded number of common device domains and does **not** send service/action commands. It accepts **private numeric IP addresses** or `localhost`, and refuses redirects and proxy forwarding so an HA bearer token cannot be forwarded to a public host. Set the explicit port needed by your particular installation (often 8123, sometimes a reverse proxy on 80/443). DNS names such as `homeassistant.local` are intentionally rejected to prevent hostname rebinding. The precise port is deployment-dependent.

Documentation: [Home Assistant REST API](https://contributors.home-assistant.io/core/internals/rest-api/).

## Offline AI and offline maps

Deterministic local document search works without a model. For optional generative answers, an Ollama instance must already be installed and running on `127.0.0.1:11434` with a model that fits the device memory. Set `BLACKBOX_OLLAMA_MODEL` to a **locally installed** model name. The gateway never downloads a model automatically or makes cloud requests. It passes retrieved reference passages to the local model; model answers can be wrong.

For raster maps, supply a `.mbtiles` file compatible with the MBTiles SQLite schema, set `BLACKBOX_MBTILES=/absolute/path/to/map.mbtiles`, and restart. `metadata.format` must be `png`, `jpg`, `jpeg`, or `webp`. The waypoint screen provides a simple offline tile viewer centered on your first saved waypoint; no map data is bundled, and the viewer does not compute routes. Vector MBTiles and live navigation are not supported. Export saved waypoints as GPX or GeoJSON.

## 3D-print files

`hardware/field_node_case.scad` is parametric with two exported watertight STLs: `field_node_base.stl` and `field_node_lid.stl`. The default internal footprint is 98 × 62 mm. Features include cable access, antenna hole, floor tie-down slots and a lid with 0.3 mm per-side fit clearance. It is **not waterproof, RF/EMI/EMP-proof or verified to fit any particular ESP32/LoRa assembly**.

`hardware/jetson_open_tray.scad` and `jetson_open_tray.stl` are a ventilated mounting tray based on NVIDIA's published 103 × 90.5 mm external dev-kit envelope. No mounting-hole pattern has been assumed. Inspect available connector access, installed feet, airflow and actual dimensions. Do not enclose the Jetson heatsink or obstruct its fan. The CAD files are editable in OpenSCAD to accommodate measured hardware.

NVIDIA hardware specification: [Jetson Orin Nano Super Developer Kit](https://www.nvidia.com/en-au/autonomous-machines/embedded-systems/jetson-orin/nano-super-developer-kit/).

## Important known limitations

The project is not fully tested on Jetson, ARM-specific model runtimes, physical radio, actual ESP32 sensor board or live Home Assistant. It cannot detect hazards, give verified medical advice, guarantee a radio message was delivered, survive loss of all power or prove EMP protection. No independent battery supply, tested thermal management or certified sensing hardware is bundled.

### Files

- `app.py`: local HTTP API, SQLite, indexed knowledge, power planner and optional integrations
- `app.js`, `index.html`, `style.css`: responsive UI, zero remote assets
- `radio_bridge.py`: optional Meshtastic serial worker
- `knowledge/`: offline safety reference files
- `firmware/esp32s3-node/`: Wi-Fi telemetry firmware and local config generator
- `hardware/`: parametric 3D CAD and printable STL exports
- `deploy/`: systemd service, safe defaults and setup helpers
- `tools/hardware_probe.py`: read-only local CPU/Jetson/memory/serial/AI-runtime probe
- `docs/HARDWARE_TEST_GATES.md`: exact physical acceptance tests and outstanding hardware gates
- `tests/`: HTTP, validation, persistence, security, mock adapter, map and geometry tests
- `docs/CODE_AUDIT_2026-11-15.md`: line-by-line review findings, file ledger, residual risks and evidence
- `docs/UPSTREAM_REFERENCES.md`: primary API, law and field safety documentation
- `tools/package_release.py` / `tools/verify_integrity.py`: ZIP integrity and per-file hash verification
- `SHA256SUMS`: hashes for every shipped file (automatically generated in the archive)

No cloud SDK, account sign-in, paid API or externally hosted JavaScript dependency is required by the core.

## v0.3.0 review and offline integrity

The release passes 82 software tests with 85% branch-aware Python backend/bridge coverage. It has been inspected against current Meshtastic, Home Assistant, NVIDIA, MBTiles, ACMA and VICSES documentation. See `docs/CODE_AUDIT_2026-11-15.md` for the file-by-file audit and precise untested boundaries.

After extracting the ZIP, verify all original source/CAD files:

```sh
python3 tools/verify_integrity.py
```

This checks SHA-256 hashes **for every shipped file**; it does not establish who created the archive. The separate `.zip.sha256` file confirms that the downloaded ZIP bytes are unchanged relative to the published checksum.

The database and downloaded reports may contain private information. Directly generated SQLite databases and backups use owner-only POSIX file permissions (`0600`), and those files are **not** included in release ZIPs. Browser screenshots from v0.2.2 were intentionally excluded from this build because the current managed Chromium environment blocks all local URLs, so fresh UI screenshots could not be verified.

