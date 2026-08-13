# Survival Companion

**Offline-first Raspberry Pi field-companion prototype with explicit hardware/evidence boundaries.**

[![Status](https://img.shields.io/badge/status-software%20prototype-blue)](PROJECT_STATUS.md)
![Platform](https://img.shields.io/badge/platform-Raspberry%20Pi%205-red)
![Edge AI](https://img.shields.io/badge/accelerator-Hailo--8-orange)

> **Maturity: Software prototype with hardware integration pending.** The most important engineering rule in this repository is simple: if a sensor is not connected, the system reports **not available** instead of fabricating data. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

## What it is

Survival Companion is an offline/edge-compute research project for a Raspberry Pi 5 and optional Hailo accelerator. It explores how reference information, local AI, navigation, sensors, voice and a field-oriented UI could be brought together when cloud connectivity is limited.

It is **not** represented as a validated medical device, emergency-response system, navigation instrument or safety-certified survival product.

## Engineering scope

The repository explores:

- local/offline reference protocols and field information;
- Raspberry Pi web/API services;
- GPS integration architecture;
- environmental-sensor integration;
- camera/vision integration concepts;
- optional vitals-sensor interfaces;
- local voice interaction;
- local language-model integration;
- Hailo-8 acceleration work;
- emergency/SOS UI concepts;
- explicit unavailable/error states for missing physical hardware.

## The evidence rule

Earlier development used simulated values to exercise software flows. Those values were removed from the real-data path.

A hardware-backed endpoint should now distinguish between:

```text
real measurement available
        │
        ├── yes → return measured data
        │
        └── no  → return NOT_AVAILABLE / hardware-pending state
```

That boundary is more valuable than a large feature count. It means software completion is not presented as proof that an attached sensor, model or physical subsystem works.

## Hardware target

The project was designed around a stack such as:

- Raspberry Pi 5;
- optional Hailo-8 accelerator;
- environmental sensor(s);
- GPS receiver;
- camera;
- optional pulse/temperature sensors;
- local display/audio hardware.

The presence of support code or a wiring guide does **not** imply every listed component has been physically integrated and verified. Check the current deployment/status documents before assuming a hardware feature is available.

## Running the software

Follow the repository's deployment documentation for the current revision. Once running, use the local address assigned to your own Pi rather than relying on historical private-LAN addresses from old documentation.

Hardware-dependent APIs should return explicit unavailable/error states until the required device is detected and working.

## Documentation

- [PROJECT_STATUS.md](PROJECT_STATUS.md) — current portfolio maturity and evidence boundary
- [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md) — historical/current deployment checklist
- [HARDWARE_SETUP_GUIDE.md](HARDWARE_SETUP_GUIDE.md) — hardware setup reference
- [HARDWARE_FAQ.md](HARDWARE_FAQ.md) — hardware notes
- [API_REFERENCE.md](API_REFERENCE.md) — API reference

Some historical documents may contain old feature counts or roadmap language. Treat the current project-status/evidence rules as authoritative when those documents disagree.

## Safety boundary

Reference material related to first aid, health, plants, animals, weather or navigation requires independent verification before real-world use.

In particular:

- do not use model output as diagnosis or treatment;
- do not rely on camera classification to decide whether a plant/fungus/animal is safe;
- do not rely on prototype sensor readings for medical decisions;
- do not treat prototype GPS/weather/SOS functions as certified emergency equipment;
- maintain appropriate real emergency, navigation and first-aid equipment independently of this project.

## Development provenance

This is an authored MAZLABZ project developed with AI coding agents as part of the engineering workflow. AI has supported implementation, research, refactoring and testing; architecture, hardware selection, integration, evidence boundaries and verification remain the project owner's responsibility.

## Portfolio significance

The strongest lesson from this repository is not the number of planned features. It is the move from **demo behaviour to evidence-aware engineering**—separating software paths from physical capabilities and refusing to invent sensor data when hardware is absent.

**Raspberry Pi · edge AI · sensors · APIs · local-first software · hardware-state modelling · evidence discipline**

## License

See [LICENSE](LICENSE).
