# Survival Companion

A portable, offline AI survival expert system designed for Raspberry Pi 5 that provides medical guidance, plant/wildlife identification, navigation, weather awareness, and emergency assistance.

## Overview

Survival Companion is an autonomous tactical AI companion that operates completely offline in wilderness environments where professional medical help is unavailable. It integrates as a persona module within the sentient-core-v4 framework, providing life-critical assistance through voice interaction, computer vision, and real-time sensor monitoring.

## Key Features

- **Voice Interface**: Hands-free operation with wake word detection, speech-to-text (Whisper), and text-to-speech (Piper)
- **Medical First Aid**: SQLite-backed protocol database with 45+ medical scenarios, safety-validated outputs
- **Plant/Wildlife ID**: Camera-based identification with edibility/toxicity warnings
- **Navigation**: GPS tracking, offline maps (MBTiles), waypoints, breadcrumb trails
- **Weather Monitoring**: BME280 environmental sensors with storm prediction
- **Emergency SOS**: Audio beacon, position display, medical info for rescuers
- **Vitals Monitoring**: SpO2, heart rate, temperature, ECG screening

## Hardware Requirements

| Component | Specification | Purpose |
|-----------|--------------|---------|
| Raspberry Pi 5 | 8GB RAM | Main compute |
| Hailo-8L | 26 TOPS, PCIe M.2 | Vision AI acceleration |
| Display | 3.5-5" SPI TFT (ili9486) | Touch interface |
| Camera | OV5647 or IMX219 (CSI) | Vision identification |
| MAX30102 | I2C 0x57 | SpO2 and heart rate |
| MLX90614 | I2C 0x5A | IR skin temperature |
| BME280 | I2C 0x76 | Environmental sensors |
| GPS | u-blox NEO-6M (UART) | Position tracking |
| Piezo | GPIO18 PWM | SOS audio beacon |
| MCP3008 | SPI1 | ECG ADC |

## Software Stack

- **Python 3.9+** with llama.cpp bindings
- **LLM Fast**: Phi-3-mini-4k-instruct Q4_K_M (2.5GB)
- **LLM Medical**: BioMistral-7B-DARE Q4_K_M (4GB)
- **STT**: whisper.cpp (ggml-base.en.bin)
- **TTS**: Piper (en_US-lessac-medium)
- **Wake Word**: OpenWakeWord
- **Vision**: Hailo-compiled HEF models (MobileNetV2/EfficientNet)
- **Database**: SQLite for protocols, species, user data
- **Maps**: OpenMapTiles MBTiles format

## Quick Start

```bash
# Clone and enter the project
cd survival-companion

# Run the setup script
./init.sh

# Activate virtual environment
source .venv/bin/activate

# Run tests
pytest tests/ -v

# Start the application (requires models)
python personas/survival/survival_persona.py
```

## Memory Management

The Raspberry Pi 5 has 8GB RAM - **only one LLM can be loaded at a time**.

| State | RAM Usage | Description |
|-------|-----------|-------------|
| Idle Listening | ~2GB | Wake word + VAD only |
| Fast LLM Active | ~5.5GB | Phi-3-mini + voice pipeline |
| Medical LLM Active | ~7.5GB | BioMistral + voice pipeline |
| Vision Inference | ~3GB | Hailo models (LLM unloaded) |

The ModelManager class handles automatic model swapping based on query classification.

## Implementation Phases

### Phase 1: Core MVP (80 features)
- Voice interface (wake word, STT, TTS)
- Phi-3 general LLM
- GPS navigation and offline maps
- Weather monitoring
- Emergency SOS beacon
- Basic medical protocol lookup

### Phase 2: Medical Intelligence (60 features)
- BioMistral medical LLM
- Vitals monitoring (SpO2, HR, temp, ECG)
- Advanced medical protocol database
- Safety layer validation

### Phase 3: Advanced Vision (40 features)
- Skin lesion/melanoma screening
- Plant and wildlife identification
- Wound assessment
- Vision pipeline routing

### Phase 4: Polish (25 features)
- Vitals dashboards and trends
- Regional species packs
- Multi-language support
- Hardware expansion (LoRa, e-ink)

## Project Structure

```
survival-companion/
├── init.sh                 # Environment setup script
├── README.md               # This file
├── app_spec.txt            # Full project specification
├── config/
│   └── survival_config.yaml    # Main configuration
├── personas/survival/
│   ├── __init__.py
│   ├── survival_persona.py     # Main persona class
│   ├── model_manager.py        # LLM swapping logic
│   ├── medical/
│   │   ├── protocols.db        # Medical protocol database
│   │   ├── advisor.py          # Protocol lookup
│   │   ├── safety_layer.py     # Output validation
│   │   └── vitals_analyzer.py  # Vitals processing
│   ├── vision/
│   │   ├── pipeline.py         # Triage routing
│   │   ├── skin_analyzer.py
│   │   ├── plant_identifier.py
│   │   └── wildlife_identifier.py
│   ├── navigation/
│   │   ├── navigator.py
│   │   ├── gps_handler.py
│   │   └── maps/               # MBTiles storage
│   ├── emergency/
│   │   ├── beacon.py           # SOS activation
│   │   └── protocols.py
│   ├── voice/
│   │   ├── wake_word.py
│   │   ├── stt.py
│   │   └── tts.py
│   ├── sensors/
│   │   ├── vitals.py
│   │   ├── environment.py
│   │   └── gps.py
│   ├── ui/
│   │   ├── display.py
│   │   └── touch.py
│   ├── data/
│   │   ├── species.db
│   │   ├── user_data.db
│   │   └── regional/
│   └── models/
│       ├── phi-3-mini.gguf
│       ├── biomistral.gguf
│       └── *.hef
└── tests/
    ├── unit/
    ├── integration/
    └── safety/
```

## Safety Architecture

All medical outputs pass through a safety layer that:

1. **Blocks forbidden patterns**: No definitive diagnoses, specific dosing, or death predictions
2. **Requires disclaimers**: All medical advice includes appropriate caveats
3. **Uses verified data**: LLM formats responses; databases provide facts
4. **Assumes dangerous**: Uncertain wildlife/plant IDs default to dangerous

### Forbidden Output Patterns
- "you have [disease] cancer"
- "definitely [condition] disease"
- "take [number] mg of"
- "you will die"

### Required Disclaimers
- **Skin analysis**: "This is a screening tool only. See a dermatologist for diagnosis."
- **Medication**: "Consult a medical professional before taking any medication."
- **Emergency**: "If symptoms worsen, activate emergency beacon immediately."

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run safety tests (critical)
pytest tests/safety/ -v

# Run with coverage
pytest tests/ --cov=personas/survival --cov-report=html
```

## Power Budget

| State | Power Draw | Runtime (20Ah) |
|-------|------------|----------------|
| Idle Listening | 2W | 40h |
| Active Voice | 7W | 11h |
| Vision Analysis | 8W | 10h |
| Emergency Beacon | 3W | 26h |

## Model Downloads

Before deployment, download and place models in `personas/survival/models/`:

1. **Phi-3-mini**: [HuggingFace](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)
2. **BioMistral**: [HuggingFace](https://huggingface.co/BioMistral/BioMistral-7B-DARE)
3. **Whisper.cpp**: [GitHub](https://github.com/ggerganov/whisper.cpp/tree/master/models)
4. **Piper voices**: [GitHub](https://github.com/rhasspy/piper/releases)

## Contributing

This is a life-critical system. All contributions must:

1. Include comprehensive tests
2. Pass safety layer validation
3. Work completely offline
4. Be field-tested in actual wilderness conditions

## License

[License to be determined]

## Disclaimer

This system is designed to assist in emergency situations but is not a replacement for professional medical care. Always seek professional help when available. The developers are not liable for outcomes resulting from use of this system.
