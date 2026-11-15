# BLACKBOX + GHOSTLINK — GitHub automated code-review resolution

Revision: **0.3.1**. This records the three severity-P2 issues raised by the GitHub Codex reviewer on commit `a02ca581995efa80a6d15f9fdf1d823177cf1b12` and the corresponding fixes before promotion to `main`.

| Finding | Mitigation in v0.3.1 | Regression |
|---|---|---|
| Raster MBTiles map blank because CSP blocks `blob:` images | Permit `blob:` only under `img-src`, retaining restrictive script policy | `test_content_security_policy_allows_offline_blob_tiles` |
| Maintenance commands reset radio outbox status while worker running | Removed status recovery from database initialization; recover only during exclusive radio-enabled server startup and hold advisory POSIX flock for the radio service lifetime | `test_observers_and_maintenance_do_not_reset_live_outbox`, `test_exclusive_radio_lock_blocks_second_server`, `test_radio_server_startup_is_only_recovery_path` |
| Inherited HTTP proxy could forward local Ollama prompts and references externally | Explicit proxy-free URL opener + redirect rejection for the local Ollama request and hardware probe | `test_model_request_is_loopback_and_response_is_marked_uncertain`, `test_probe_uses_no_proxy_opener` |

The `main` branch contains an implementation that can be tested without a radio, not a production-certified emergency communications device. The software CI checks exercise fake hardware adapters; actual RF delivery, printed fit, field power, systemd deployment and ESP32 flashing require physical evidence as documented in `HARDWARE_TEST_GATES.md`.

The previous v0.3.0 report is a historical baseline. Release 0.3.1 incorporates these review corrections.
