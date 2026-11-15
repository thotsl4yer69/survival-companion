# Primary upstream references — verified 15 November 2026

These are documentation links used during the v0.3.0 code review. They are research provenance, **not** dependencies for running BLACKBOX offline; store/print a separate offline copy where permitted.

1. **Meshtastic Python API** — https://python.meshtastic.org/ and https://python.meshtastic.org/serial_interface.html — `SerialInterface(devPath=...)`, `sendText`, event subscription; serial submission is not proof of remote delivery.
2. **Meshtastic supported hardware** — https://meshtastic.org/docs/hardware/devices/ — ESP32-S3 alone is not a LoRa transceiver. Supported boards integrate a suitable Semtech radio, commonly SX1262. External LoRa radio/firmware is still needed for this system.
3. **Meshtastic regional config** — https://meshtastic.org/docs/configuration/region-by-country/ — Australia `ANZ`; Meshtastic's own region table places ANZ in 915–928 MHz. The official device setting is not a declaration of legal compliance for a modified build.
4. **ACMA LIPD licence** — https://www.acma.gov.au/licences/low-interference-potential-devices-lipd-class-licence — actual transmitted device, RF output, frequency and standards must comply with Australian requirements.
5. **Home Assistant REST API** — https://contributors.home-assistant.io/core/internals/rest-api/ — bearer token, `GET /api/states`, read-only invocation contract.
6. **Mapbox MBTiles 1.3 specification** — https://github.com/mapbox/mbtiles-spec/blob/master/1.3/spec.md — `tile_row` is TMS Y; XYZ tile request Y must be converted to `2^z - 1 - y`. Raster display depends on valid tiles.
7. **NVIDIA Orin Nano setup** — https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/setup_jetpack.html — verify the actual OS, firmware generation, JetPack and service paths before enabling optional model acceleration.
8. **ESP32 Arduino core HTTPClient** — https://github.com/espressif/arduino-esp32/blob/master/libraries/HTTPClient/src/HTTPClient.h — APIs used by `WiFiClient`/`HTTPClient` telemetry code; physical compile still pending.
9. **Python `urllib.request` redirection rules** — https://docs.python.org/3/library/urllib.request.html — a redirect handler can be disabled; the Home Assistant adapter explicitly blocks redirecting the sensitive token.
10. **Python SQLite backup** — https://docs.python.org/3/library/sqlite3.html — `Connection.backup()` creates consistent backups from a live SQLite connection.
11. **VICSES emergency planning** — https://www.ses.vic.gov.au/en/plan-and-stay-safe/create-an-emergency-plan — maintain separate power, battery radio, safe water, printed plan and essential supplies, beyond experimental electronic equipment.
12. **Emergency Victoria power outages** — https://www.emergency.vic.gov.au/prepare-and-get-ready/outages-and-disruptions/power-outages — backup phone charge, torches, battery radio and preplanned outage procedures.

Verification scope: API and reference compatibility checked against accessible primary documentation. Source excerpts have not been reproduced here. Upstream APIs and regulations can change; do not assume perpetual validity.
