# Survival Companion - API Reference

**Base URL:** `http://192.168.1.219:5000`
**Status:** ✅ All endpoints tested and functional (simulation mode until physical sensors connected)

---

## 🎯 Quick Start

### Get System Status
```bash
curl http://192.168.1.219:5000/api/status | json_pp
```

### Get All Medical Protocols
```bash
curl http://192.168.1.219:5000/api/protocols | json_pp
```

### Get Specific Protocol (CPR)
```bash
curl http://192.168.1.219:5000/api/protocols/12 | json_pp
```

### Check Current Vitals
```bash
curl http://192.168.1.219:5000/api/vitals/current | json_pp
```

### Get GPS Position
```bash
curl http://192.168.1.219:5000/api/gps/position | json_pp
```

---

## 📋 Medical & First Aid

### Get All Protocols
```http
GET /api/protocols
```

**Response:**
```json
{
  "success": true,
  "count": 12,
  "protocols": [
    {
      "id": 1,
      "name": "Bee Sting Treatment",
      "category": "poison",
      "severity": "moderate",
      "summary": "First aid for bee, wasp, and insect stings...",
      "keywords": ["bee", "sting", "wasp", ...]
    },
    ...
  ]
}
```

**Available Protocols (12 total):**
1. Bee Sting Treatment (poison, moderate)
2. Snake Bite Protocol (poison, critical)
3. Hypothermia Treatment (environmental, critical)
4. Heat Stroke Emergency (environmental, critical)
5. Burns Treatment (wound, moderate)
6. Fracture Immobilization (wound, moderate)
7. Dehydration Treatment (environmental, moderate)
8. Minor Cut Treatment (wound, minor)
9. Allergic Reaction Response (poison, critical)
10. Sprain and Strain Treatment (wound, minor)
11. Choking Response (cardiac, critical)
12. CPR - Adult (cardiac, critical)

### Get Specific Protocol
```http
GET /api/protocols/:id
```

**Example:** CPR Protocol
```bash
curl http://localhost:5000/api/protocols/12
```

**Response includes:**
- Detailed step-by-step instructions
- Warnings and contraindications
- When to seek help
- Keywords for search
- Emergency escalation procedures (for some protocols)

---

## 🩺 Vitals Monitoring

### Current Vitals
```http
GET /api/vitals/current
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-01-16T01:45:25.172Z",
  "heart_rate": {
    "value": 68,
    "unit": "BPM",
    "trend": "stable",
    "status": "normal"
  },
  "spo2": {
    "value": 97,
    "unit": "%",
    "trend": "stable",
    "status": "normal"
  },
  "body_temp": {
    "value": 36.5,
    "unit": "°C",
    "trend": "stable",
    "status": "normal"
  }
}
```

### Vitals History
```http
GET /api/vitals/history
```

Returns time-series data for trends.

### SpO2 with Altitude Compensation
```http
GET /api/vitals/spo2/altitude-compensated
```

Adjusts SpO2 readings based on current altitude from GPS.

### Vitals Alerts
```http
GET /api/vitals/alerts
```

Active alerts for abnormal vitals.

### Baseline Vitals
```http
GET /api/profile/baseline-vitals
```

User's baseline vitals for comparison.

### Compare to Baseline
```http
GET /api/vitals/compare
```

Compares current vitals to user's baseline.

---

## 🌍 GPS & Navigation

### GPS Position
```http
GET /api/gps/position
```

**Response:**
```json
{
  "latitude": -33.868796,
  "longitude": 151.208992,
  "altitude": 58,
  "accuracy": 3.9,
  "accuracy_indicator": "high",
  "speed": 0,
  "heading": 0,
  "fix": true,
  "satellites": 10,
  "hdop": 1.2,
  "last_update": 1768527924986,
  "age_ms": 231,
  "tracking_active": true,
  "coordinates_formatted": "-33.868796, 151.208992"
}
```

### GPS Status
```http
GET /api/gps/status
```

Detailed GPS fix status, satellite count, acquisition info.

### GPS Time Sync
```http
GET /api/gps/time-sync
```

Uses GPS for accurate time synchronization.

---

## 🗺️ Waypoints & Breadcrumbs

### Get All Waypoints
```http
GET /api/waypoints
```

### Create Waypoint
```http
POST /api/waypoints
Content-Type: application/json

{
  "name": "Camp Site",
  "notes": "Good water source nearby"
}
```

Uses current GPS position automatically.

### Edit Waypoint
```http
PUT /api/waypoints/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "notes": "Updated notes"
}
```

### Delete Waypoint
```http
DELETE /api/waypoints/:id
```

### Get Distances to Waypoints
```http
GET /api/waypoints/distances
```

Calculates distance and bearing from current position to all waypoints.

### Breadcrumbs (Trail History)
```http
GET /api/breadcrumbs
```

Returns recorded trail positions.

```http
POST /api/breadcrumbs/record
```

Manually record current position to trail.

---

## 🌤️ Weather Monitoring

### Current Weather
```http
GET /api/weather
```

**Response:**
```json
{
  "temperature": {
    "value": 23.68,
    "unit": "C",
    "source": "BME280"
  },
  "humidity": {
    "value": 66,
    "unit": "%",
    "source": "BME280"
  },
  "pressure": {
    "value": 1013.40,
    "unit": "hPa",
    "source": "BME280",
    "trend": "stable",
    "trend_change": "-0.2",
    "history": [...]
  },
  "altitude_estimated": {
    "value": 58,
    "unit": "m",
    "source": "barometric"
  }
}
```

### Pressure History
```http
GET /api/weather/pressure-history
```

Returns barometric pressure trend for storm prediction.

### Storm Alert
```http
GET /api/weather/storm-alert
```

Checks if pressure is dropping rapidly (storm warning).

---

## 👤 User Profile

### Get Profile
```http
GET /api/profile
```

**Response:**
```json
{
  "success": true,
  "profile": {
    "name": "User Name",
    "blood_type": "O+",
    "allergies": ["Peanuts", "Shellfish"],
    "medical_conditions": ["Type 2 Diabetes"],
    "medications": ["Metformin"],
    "emergency_contacts": [{
      "name": "Emergency Contact",
      "phone": "+1-555-123-4567",
      "relationship": "Mother"
    }],
    "baseline_vitals": {
      "heart_rate": 72,
      "spo2": 98,
      "temperature": 36.7
    }
  }
}
```

### Create/Update Profile
```http
POST /api/profile
Content-Type: application/json

{
  "name": "John Doe",
  "blood_type": "O+",
  "allergies": ["Peanuts"],
  "medical_conditions": [],
  "medications": [],
  "emergency_contacts": [{
    "name": "Jane Doe",
    "phone": "+1-555-123-4567",
    "relationship": "Spouse"
  }],
  "baseline_vitals": {
    "heart_rate": 70,
    "spo2": 98,
    "temperature": 36.8
  }
}
```

### Delete Profile
```http
DELETE /api/profile
```

### Backup Profile
```http
POST /api/profile/backup
```

Creates encrypted backup.

### Restore Profile
```http
POST /api/profile/restore
Content-Type: application/json

{
  "backup_data": "encrypted_backup_string"
}
```

---

## ⚙️ System & Configuration

### System Status
```http
GET /api/status
```

**Response:**
```json
{
  "state": "ready",
  "memory_state": "idle",
  "boot_status": {
    "display": true,
    "sensors": true,
    "gps": true,
    "i2c_devices": ["MAX30102 (SpO2/HR) at 0x57", ...],
    "llm_ready": true,
    "wake_word": true,
    "dashboard": true,
    "battery": 100,
    "gps_fix": true,
    "errors": []
  },
  "sensors": {
    "max30102": true,
    "mlx90614": true,
    "bme280": true,
    "gps": true,
    "camera": false
  },
  "is_ready": true
}
```

### Configuration
```http
GET /api/config
```

Returns full system configuration (voice, LLM, safety settings, hardware config).

### Update Settings
```http
PUT /api/config/settings
Content-Type: application/json

{
  "voice": {
    "volume": 0.9
  }
}
```

### Reset Settings
```http
POST /api/config/settings/reset
```

### Sensor Status
```http
GET /api/sensors
```

Returns status of all hardware sensors.

### Sensor Health Check
```http
GET /api/sensors/health
```

Tests all sensors and returns health status.

---

## 🤖 AI Models & LLM

### Model Status
```http
GET /api/models/status
```

Shows which models are loaded and their status.

### Model Info
```http
GET /api/llm/model-info
```

Information about currently loaded LLM.

### Memory Status
```http
GET /api/memory/status
```

RAM usage and model loading status.

### Load Model
```http
POST /api/memory/load-model
Content-Type: application/json

{
  "model": "phi3"
}
```

Options: `phi3` (general) or `biomistral` (medical)

### Unload Model
```http
POST /api/memory/unload-model
```

Frees RAM by unloading current model.

---

## 🎤 Voice Interface

### Voice Query
```http
POST /api/voice/query
Content-Type: application/json

{
  "text": "how do I treat a burn"
}
```

**Note:** Requires wake word activation in production. In testing/simulation mode, may work without wake word.

### Smart LLM Query
```http
POST /api/llm/smart-query
Content-Type: application/json

{
  "query": "What are the symptoms of hypothermia?"
}
```

Automatically selects appropriate model (medical vs general) based on query content.

---

## 📸 Vision & Image Analysis

### Capture Image
```http
POST /api/vision/capture
```

Captures image from camera.

### Analyze Image
```http
POST /api/vision/analyze
Content-Type: application/json

{
  "image_id": "12345"
}
```

Runs AI analysis on captured image.

### Triage Classification
```http
GET /api/vision/triage/:imageId
```

Classifies image type (skin lesion, wound, plant, animal, etc.).

---

## 🚨 Emergency & SOS

### Activate SOS
```http
POST /api/sos/activate
```

Activates emergency beacon (audio, LED, position broadcast).

### Deactivate SOS
```http
POST /api/sos/deactivate
```

### SOS Status
```http
GET /api/sos/status
```

Returns current emergency status.

### Emergency Info
```http
GET /api/emergency-info
```

Information package for rescuers (medical profile, location, vitals).

### Emergency Log
```http
GET /api/emergency-log
```

Log of emergency events.

---

## 🧪 Testing & Validation Endpoints

These endpoints are for testing/verification during development:

### Safety Layer Test
```http
POST /api/safety/validate
Content-Type: application/json

{
  "text": "You have cancer"
}
```

Tests if safety layer blocks forbidden medical outputs.

### Test Patterns
```http
POST /api/safety/test-patterns
```

Runs all safety pattern tests.

### Boot Sequence Test
```http
POST /api/boot
```

Initiates boot sequence.

### Boot Status
```http
GET /api/boot/status
```

Current boot sequence progress.

### Offline Functionality Test
```http
GET /api/offline/test-all
```

Tests all offline capabilities.

### Recovery Status
```http
GET /api/recovery/status
```

System recovery and error handling status.

---

## 📊 Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 404 | Endpoint not found |
| 500 | Server error |

**Standard Response Format:**
```json
{
  "success": true/false,
  "data": { ... },
  "error": "error message if failed",
  "message": "human-readable message"
}
```

---

## 🔍 Common Use Cases

### 1. Get First Aid for Burns
```bash
# List all protocols, find burns (ID 5)
curl http://192.168.1.219:5000/api/protocols

# Get detailed burn protocol
curl http://192.168.1.219:5000/api/protocols/5 | json_pp
```

### 2. Check if Someone Has Hypothermia
```bash
# Get hypothermia protocol (ID 3)
curl http://192.168.1.219:5000/api/protocols/3 | json_pp

# Get current vitals
curl http://192.168.1.219:5000/api/vitals/current | json_pp

# Get body temperature specifically
curl http://192.168.1.219:5000/api/vitals/current | jq '.body_temp'
```

### 3. Mark Current Location as Waypoint
```bash
curl -X POST http://192.168.1.219:5000/api/waypoints \
  -H 'Content-Type: application/json' \
  -d '{"name": "Water Source", "notes": "Clean stream"}'
```

### 4. Get Directions Back to Camp
```bash
# Get all waypoints with distances
curl http://192.168.1.219:5000/api/waypoints/distances | json_pp

# Find waypoint named "Camp" and use bearing/distance
```

### 5. Check for Approaching Storm
```bash
curl http://192.168.1.219:5000/api/weather/storm-alert | json_pp
```

### 6. Perform CPR with Guidance
```bash
# Get CPR protocol (ID 12)
curl http://192.168.1.219:5000/api/protocols/12 | json_pp

# Each step provides detailed instructions
```

---

## 🚀 Testing from Command Line

### Quick Health Check
```bash
#!/bin/bash
echo "Testing Survival Companion API..."
echo ""

echo "1. System Status:"
curl -s http://192.168.1.219:5000/api/status | jq '.state'

echo "2. GPS Fix:"
curl -s http://192.168.1.219:5000/api/gps/status | jq '.fix'

echo "3. Vitals:"
curl -s http://192.168.1.219:5000/api/vitals/current | jq '.heart_rate.value'

echo "4. Weather:"
curl -s http://192.168.1.219:5000/api/weather | jq '.temperature.value'

echo "5. Protocols Available:"
curl -s http://192.168.1.219:5000/api/protocols | jq '.count'

echo ""
echo "All systems operational!"
```

---

## 📝 Notes

- **Simulation Mode:** Until physical sensors are connected, the system returns simulated data that's realistic and useful for testing
- **Real Sensors:** When BME280, GPS, MAX30102, etc. are connected, data will come from actual hardware
- **Medical Safety:** All medical outputs pass through safety layer that blocks dangerous advice and adds required disclaimers
- **Offline Operation:** All endpoints work without internet connection

---

## 🔗 Additional Resources

- **Full Protocol List:** GET `/api/protocols` returns all 12 medical protocols with keywords for searching
- **System Configuration:** GET `/api/config` shows all configurable parameters
- **Hardware Setup:** See `HARDWARE_SETUP_GUIDE.md` for sensor wiring
- **Deployment Status:** See `DEPLOYMENT_STATUS.md` for current system state

---

*API Reference v1.0 - Last Updated: January 16, 2026*
