# Hardware FAQ - Survival Companion

## What sensors does it need?

### Core Sensors (HIGH Priority)

**Environmental Monitoring:**
- **BME280** (I2C 0x76) - $5-10
  - Temperature (-40°C to +85°C)
  - Humidity (0-100%)
  - Barometric pressure (300-1100 hPa)
  - Altitude estimation
  - Used for: Weather monitoring, storm prediction, altitude tracking

**Navigation:**
- **GPS Module - u-blox NEO-6M** (UART /dev/ttyAMA0) - $15-25
  - Position tracking (latitude/longitude)
  - Altitude from satellites
  - Speed and heading
  - Time synchronization
  - Used for: Navigation, waypoints, breadcrumb trail, emergency location

**Vision:**
- **Camera - OV5647 or IMX219** (CSI ribbon cable) - $15-30
  - 5MP or 8MP sensor
  - 1920x1080 capture
  - Used for: Plant/animal identification, wound assessment, skin lesion screening

**User Interface:**
- **Display - ili9486 TFT 3.5-5"** (SPI) - $20-40
  - 320x480 or 480x320 resolution
  - 16-bit color
  - Used for: Primary dashboard UI

- **Touchscreen - ADS7846** (SPI) - Usually included with display
  - Resistive touch
  - Used for: Touch input

### Medical Sensors (MEDIUM Priority)

- **MAX30102** (I2C 0x57) - $8-15
  - SpO2 (blood oxygen saturation 0-100%)
  - Heart rate (30-220 BPM)
  - Used for: Vitals monitoring, hypoxia detection

- **MLX90614** (I2C 0x5A) - $15-25
  - Non-contact IR temperature sensor
  - Body temperature measurement
  - Used for: Fever detection, hypothermia monitoring

### Emergency Equipment (MEDIUM Priority)

- **Piezo Buzzer** (GPIO18) - $2-5
  - 2800Hz SOS beacon
  - PWM-driven for varying tones
  - Used for: Emergency signaling

### Optional (LOW Priority)

- **AD8232 ECG Module** (Analog via MCP3008) - $8-12
  - Single-lead ECG monitoring
  - Used for: Advanced cardiac monitoring

---

## Will the camera use Hailo automatically?

### Short Answer: **Not fully automatic** - requires setup

### What You Need to Do:

**1. Hailo is Already Working ✓**
- Hailo-8 accelerator detected: `0001:01:00.0`
- Driver loaded: `hailo_pci` kernel module
- Firmware: 4.23.0
- 26 TOPS of AI acceleration available

**2. Models Need to Be Compiled to HEF Format**

The camera will NOT use Hailo automatically. You need to:

**Step 1: Convert Models to Hailo Format (.hef)**
```bash
# Models need to be compiled with Hailo Dataflow Compiler
# Current models in /home/pi1/survival-companion/personas/survival/models/:
# - Phi-3-mini (general LLM) - NOT for Hailo (CPU/GPU-based)
# - BioMistral-7B (medical LLM) - NOT for Hailo (CPU/GPU-based)
# - Whisper.cpp (STT) - NOT for Hailo (CPU-based)
# - Piper (TTS) - NOT for Hailo (CPU-based)

# Vision models WILL use Hailo (need to compile):
# 1. Triage model - classifies images into categories
#    - plant, animal, skin_lesion, wound, other
# 2. Specialist models:
#    - plant_identifier.hef (plant species recognition)
#    - skin_lesion_classifier.hef (melanoma screening)
#    - wound_assessor.hef (wound severity)
#    - animal_identifier.hef (dangerous species)
```

**Step 2: Install Hailo Dataflow Compiler**
```bash
# Download from Hailo website (requires account)
# https://hailo.ai/developer-zone/

# Install on development machine (x86_64, not on Pi)
pip install hailo_dataflow_compiler

# Convert ONNX/TensorFlow models to HEF
hailo parser onnx model.onnx --hw-arch hailo8
hailo compiler model.har --hw-arch hailo8
# Output: model.hef
```

**Step 3: Deploy .hef Files to Pi**
```bash
# Copy compiled models to Pi
scp *.hef pi1@192.168.1.219:~/survival-companion/models/vision/

# Models will be automatically loaded via HailoRT API
```

**3. Camera Integration with Hailo**

The system is designed to use Hailo for vision inference:

```javascript
// From server.js - Vision endpoints reference Hailo
POST /api/vision/triage/load
  → Loads triage.hef on Hailo-8
  → Returns: "Triage model loaded on Hailo-8L"

POST /api/vision/triage/classify
  → Runs image through Hailo accelerator
  → 45-75ms inference time
  → Returns: plant/animal/skin_lesion/wound/other

POST /api/vision/specialist/load
  → Loads specialist model (plant/skin/wound/animal)
  → Swaps models on Hailo (only one specialist at a time)

POST /api/vision/specialist/analyze
  → Deep analysis using specialist model
  → Returns detailed results (species, danger level, treatment)
```

**4. How It Will Work When Complete:**

```
Camera (libcamera) → Capture 1920x1080 image
                   ↓
              Resize to 224x224
                   ↓
           Preprocessing (normalize)
                   ↓
    HailoRT API → Hailo-8 accelerator
                   ↓
           Inference (45-75ms)
                   ↓
        Postprocessing (decode results)
                   ↓
           Return classification
```

**Current Status:**
- ✅ Hailo-8 hardware working
- ✅ HailoRT drivers installed
- ✅ API endpoints ready
- ⚠️ Vision models NOT compiled to .hef yet
- 🔴 Camera NOT connected yet

**Currently Using:** Simulation mode (fake classifications until camera + models ready)

---

## Where will the feed be displayed?

### Display Options:

**1. Physical Display on Pi (Primary Interface)**

**Hardware:**
- **ili9486 TFT Display** (3.5-5" touchscreen)
- Connected via SPI bus
- 320x480 or 480x320 resolution
- Resistive touchscreen (ADS7846)

**Setup Required:**
```bash
# Install display driver
git clone https://github.com/juj/fbcp-ili9341
cd fbcp-ili9341
mkdir build && cd build
cmake -DILI9486=ON -DSPI_BUS_CLOCK_DIVISOR=6 ..
make -j4
sudo ./fbcp-ili9341

# Configure autostart
sudo nano /etc/rc.local
# Add: /home/pi1/fbcp-ili9341/build/fbcp-ili9341 &

# Set framebuffer resolution
sudo nano /boot/config.txt
# Add:
hdmi_force_hotplug=1
hdmi_cvt=480 320 60 1 0 0 0
hdmi_group=2
hdmi_mode=87
```

**What Will Be Shown:**
- Full dashboard UI
- Camera preview stream (real-time)
- Vitals monitoring graphs
- GPS map with waypoints
- Medical protocols
- Weather information
- Emergency SOS controls

**Access:**
- Touch interface for navigation
- Wake word voice control: "Guardian" or "Companion"
- Physical buttons (if wired to GPIO)

---

**2. Web Dashboard (Secondary Interface)**

**Access from any device on network:**
```
http://192.168.1.219:5000
```

**Available Pages:**
- `/` - Main dashboard (system status, vitals, GPS, weather)
- `/medical` - Medical protocols and first aid guides
- `/navigation` - GPS, waypoints, breadcrumb trail, mapping
- `/weather` - Environmental monitoring, storm alerts
- `/emergency` - SOS activation, emergency info
- `/survival` - Wilderness survival guides
- `/settings` - System configuration

**Camera Feed on Web Dashboard:**
```bash
# Start camera preview
POST /api/camera/preview/start

# Get frames (MJPEG stream)
GET /api/camera/preview/frame

# Or view captured images
GET /api/camera/images/:imageId
```

**Live Updates:**
- All sensor data refreshes every 5 seconds
- Real-time vitals graphs
- GPS position updates
- Camera preview stream (if enabled)

**Web Dashboard Features:**
- Works on any device (phone, tablet, laptop)
- No installation required
- Responsive design
- Can control system remotely on local network

---

## Quick Setup Summary

### Minimum Viable System:
1. **BME280** - Weather sensor ($5)
2. **GPS Module** - Navigation ($15)
3. **Camera** - Vision AI ($15)
4. **Display** - UI output ($20-40)

**Total:** ~$55-75 for core functionality

### Recommended System:
Add medical sensors:
5. **MAX30102** - Vitals ($8)
6. **MLX90614** - Temperature ($15)
7. **Piezo Buzzer** - Emergency ($2)

**Total:** ~$80-100 for full system

### For Hailo Vision:
- Camera connects → `libcamera-hello --list-cameras` to verify
- Models compile to .hef → Deploy to `/models/vision/`
- API automatically uses Hailo for inference
- **No code changes needed** - system detects .hef files and routes to Hailo

### Display Priority:
1. **Physical display** - Primary interface (always-on, no network needed)
2. **Web dashboard** - Secondary (development, testing, remote monitoring)

Both display the same information, just different form factors.

---

## Next Steps

1. **Order sensors** (listed above with prices)
2. **Connect camera first** (easiest to test)
   - Verify with: `libcamera-hello --list-cameras`
   - Test capture: `libcamera-jpeg -o test.jpg`
3. **Wire I2C sensors** (BME280, MAX30102, MLX90614)
   - All share same GPIO2/GPIO3 pins
   - Test with: `i2cdetect -y 1`
4. **Connect GPS** (UART pins)
   - Test with: `cat /dev/ttyAMA0`
5. **Set up display** (SPI + touchscreen)
   - Use fbcp-ili9341 driver
6. **Compile vision models to .hef** (for Hailo)
   - Requires Hailo Dataflow Compiler
   - Run on x86_64 dev machine, deploy .hef to Pi

**Current State:**
- ✅ Software fully deployed
- ✅ API ready and tested
- ✅ All fake data removed
- ✅ Hailo accelerator working
- 🔴 Physical sensors not connected
- 🔴 Display not configured
- 🔴 Vision models not compiled

**System is ready for hardware assembly!**
