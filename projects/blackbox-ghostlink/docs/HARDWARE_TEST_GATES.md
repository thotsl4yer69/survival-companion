# Hardware acceptance gates — BLACKBOX/GHOSTLINK

Do not classify a gate as passed without an actual result from the intended physical equipment. The source code supports it; that does not imply a real-world result.

| Gate | Exact observable evidence | Result |
|---|---|---|
| Orin detects hardware | `python3 tools/hardware_probe.py` output with actual board, serial ports and system data | **Not run on Orin** |
| Jetson boot persistence | Cold-boot; `systemctl is-active blackbox` returns `active`, HTTP health responds | **Not run** |
| No internet mode | Disconnect WAN only; use dashboard, write/read note, restore internet; no unexpected external requests | **Not run on target** |
| Local power reserve | Log actual watts measured under idle/load, record charge and measured battery shutdown threshold | **Not run** |
| Radio physical connection | Plug correct Meshtastic-compatible board and matched antenna; record serial enumeration and firmware/radio region | **Not run** |
| Radio delivery | Send and receive bidirectionally between two actual nodes, record distance, retries and loss | **Not run** |
| Radio recovery | Disconnect/reconnect serial device; observe state and reconnect without duplicate sends | **Not run on physical radio**; no auto-replay tested in fake adapter |
| ESP32 heartbeat | Compile firmware for exact board, flash, collect actual serial logs and POST, correlate UI timestamp | **Not run** |
| Home Assistant | Read live `/api/states` with an account-scoped token; verify no services were sent | **Not run** |
| Offline reference search | Search indexed local knowledge without internet using application UI | **Passed in local browser/API QA** |
| Local AI | Run and benchmark an installed local model offline on Orin; compare RAM/latency | **Not run** |
| Offline maps | Load real raster MBTiles; cross-check waypoints against trusted map coordinates | **Not run** |
| Database restore | Stop service; restore verified backup to a clean instance; compare records, then restart | **Not run on target** |
| Printed case clearance | Print base/lid/tray; inspect PCB, ports, cooling, screws and fit | **Not printed/tested** |
| Thermal stress | Run Orin at sustained expected load, measure temperatures and ensure fan/airflow adequate | **Not run** |

## Hard stop criteria

A sensor value cannot be used for a safety decision until calibrated and validated against a certified reference. A radio message is not delivered until receipt by the intended remote party is verified. A Li-ion battery system must use appropriately rated and protected hardware; no improvised mains connections. Do not advertise a prototype as an emergency-service replacement.

## No-question installation sequence

1. Copy the extracted package to the Jetson. Run `python3 tools/hardware_probe.py` and store the output.
2. Verify archive integrity using `python3 tools/verify_integrity.py`, then run tests with `python3 -m unittest discover -s tests -q` and install `sudo bash deploy/install_jetson.sh`.
3. Use the loopback dashboard first and test persistence; then configure LAN authentication and the separate ESP32 device key.
4. Load local references and a raster MBTiles file *before* a WAN failure.
5. Install the optional Meshtastic adapter only when an actual radio is attached. Run physical two-node acceptance tests.
6. Configure read-only Home Assistant access and the local model only after each service is actually reachable.
7. Bench-test independent power and enclosure temperature, then perform a controlled WAN-offline and mains-off test.
