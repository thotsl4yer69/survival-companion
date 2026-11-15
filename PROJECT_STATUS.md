# Project Status — Survival Companion + BLACKBOX / GHOSTLINK

**Current source release:** BLACKBOX + GHOSTLINK **v0.4.0** on `main`. Includes a reproducible field-data pack pipeline for actual AI, encyclopedia, regional map data and ARM64 runtimes, source test suite, release integrity checks and Jetson deployment instructions.

**Actual deployment maturity:** Software-tested; field installation **not yet verified**. Presence of offline preparation code does not establish that upstream data has been downloaded or that a GitHub Release was successfully published. The GitHub field-pack workflow verifies and publishes binary data independently.

**Hardware gate:** No actual two-node LoRa RF test, Jetson install test, ESP32 hardware flash, power endurance test, GPS receiver test, certified life-safety sensor test, or offline AI inference benchmark on the target device is recorded. Until those gates pass, do not represent the system as fully operational, medically validated or emergency-service equipment.

**Legacy project:** The repository also retains the prior Raspberry Pi Survival Companion Node.js prototype. It is distinct from the Python BLACKBOX core. Historical hardware claims are not independently verified.

See [BLACKBOX](projects/blackbox-ghostlink/README.md), [complete offline build](projects/blackbox-ghostlink/docs/FULL_OFFLINE_BUILD.md), [2026-11-15 code review](projects/blackbox-ghostlink/docs/REVIEW_RESOLUTION_2026-11-15.md) and [hardware gates](projects/blackbox-ghostlink/docs/HARDWARE_TEST_GATES.md).
