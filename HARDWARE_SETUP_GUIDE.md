# Hardware Setup Guide - Survival Companion

**Target Platform:** Raspberry Pi 5 (16GB)
**Current Status:** Software deployed, hardware interfaces ready, physical sensors need connection

---

## ✅ Current Hardware Status

### Working
- ✅ **Hailo-8 AI Accelerator** - Detected and functional
  - Device: 0001:01:00.0
  - Firmware: 4.23.0
  - Architecture: HAILO8
  - Driver: `hailo_pci` module loaded and configured for auto-load

- ✅ **I2C Bus** - Ready for sensors
  - Interface: `/dev/i2c-1`
  - Status: Active, no devices connected yet
  - Scan command: `/usr/sbin/i2cdetect -y 1`

- ✅ **SPI Bus** - Ready for display
  - Devices: `/dev/spidev0.0`, `/dev/spidev0.1`, `/dev/spidev10.0`
  - Status: Active, waiting for display connection

- ✅ **Framebuffer** - Ready for display output
  - Device: `/dev/fb0`
  - Status: Available

- ✅ **PCIe** - Hailo accelerator working
- ✅ **USB** - Working for peripherals
- ✅ **Network** - 192.168.1.219
- ✅ **GPIO** - Available for sensors and piezo

### Pending Physical Connection
- 🔴 MAX30102 (SpO2/Heart Rate) - I2C 0x57
- 🔴 MLX90614 (IR Temperature) - I2C 0x5A
- 🔴 BME280 (Weather) - I2C 0x76
- 🔴 GPS Module (u-blox NEO-6M) - UART
- 🔴 Camera (OV5647/IMX219) - CSI
- 🔴 Display (ili9486 TFT) - SPI
- 🔴 Touchscreen (ADS7846) - SPI
- 🔴 Piezo Buzzer - GPIO18

---

## 📋 Required Hardware Components

### Core Sensors

| Component | Interface | Address/Pin | Purpose | Priority |
|-----------|-----------|-------------|---------|----------|
| BME280 | I2C | 0x76 | Temperature, humidity, pressure, altitude | HIGH |
| GPS Module (NEO-6M) | UART | /dev/ttyAMA0 | Position, navigation, timestamps | HIGH |
| Camera (OV5647/IMX219) | CSI | Camera port | Image capture for vision AI | HIGH |
| Display (ili9486 3.5-5") | SPI | GPIO8 (CE0) | Primary UI output | HIGH |
| Touchscreen (ADS7846) | SPI | GPIO7 (CE1) | User input | HIGH |

### Medical Sensors

| Component | Interface | Address/Pin | Purpose | Priority |
|-----------|-----------|-------------|---------|----------|
| MAX30102 | I2C | 0x57 | SpO2 and heart rate monitoring | MEDIUM |
| MLX90614 | I2C | 0x5A | Non-contact IR temperature | MEDIUM |
| AD8232 | SPI/Analog | MCP3008 CH0 | ECG monitoring | LOW |

### Emergency Equipment

| Component | Interface | Address/Pin | Purpose | Priority |
|-----------|-----------|-------------|---------|----------|
| Piezo Buzzer | GPIO | GPIO18 (PWM) | SOS audio beacon (2800Hz) | MEDIUM |

---

## 🔌 Wiring Diagrams

### I2C Bus (All Sensors Share Same Lines)

```
Raspberry Pi 5          I2C Sensors (BME280, MAX30102, MLX90614)
┌────────────┐         ┌──────────┐
│            │         │  BME280  │
│  GPIO2 SDA ├─────────┤   SDA    │
│  GPIO3 SCL ├─────────┤   SCL    │
│  3.3V      ├─────────┤   VCC    │
│  GND       ├─────────┤   GND    │
└────────────┘         └──────────┘
       │               ┌──────────┐
       │               │ MAX30102 │
       ├───────────────┤   SDA    │
       ├───────────────┤   SCL    │
       ├───────────────┤   VIN    │
       ├───────────────┤   GND    │
       │               └──────────┘
       │               ┌──────────┐
       │               │ MLX90614 │
       ├───────────────┤   SDA    │
       ├───────────────┤   SCL    │
       ├───────────────┤   VCC    │
       └───────────────┤   GND    │
                       └──────────┘
```

**I2C Notes:**
- All devices share GPIO2 (SDA) and GPIO3 (SCL)
- MLX90614 limits bus speed to 100kHz
- Use 4.7kΩ pull-up resistors on SDA/SCL (often built into breakout boards)
- Maximum cable length: 1 meter for reliability

### GPS Module (UART)

```
Raspberry Pi 5          NEO-6M GPS
┌────────────┐         ┌──────────┐
│            │         │          │
│  GPIO14 TX ├─────────┤   RX     │ (GPS receives from Pi)
│  GPIO15 RX ├─────────┤   TX     │ (GPS transmits to Pi)
│  5V        ├─────────┤   VCC    │ (GPS needs 5V, not 3.3V)
│  GND       ├─────────┤   GND    │
└────────────┘         └──────────┘
```

**GPS Notes:**
- NEO-6M operates at 5V (will not work on 3.3V reliably)
- UART configured at 9600 baud
- Cold start: ~45 seconds to first fix
- Warm start: ~30 seconds
- Hot start: <1 second

### Camera (CSI)

```
Raspberry Pi 5          OV5647 / IMX219 Camera
┌────────────┐         ┌──────────┐
│            │         │          │
│  CSI Port  ├─────────┤ Ribbon   │ (15-pin flex cable)
│            │         │ Cable    │
└────────────┘         └──────────┘
```

**Camera Notes:**
- Connect ribbon cable with metal contacts facing away from ethernet port
- Lock connector by pressing down white clip
- Test: `libcamera-hello --list-cameras`
- Resolution: 1920x1080, downsampled to 224x224 for inference

### Display (SPI) - ili9486 TFT

```
Raspberry Pi 5          ili9486 Display
┌────────────┐         ┌──────────┐
│  SPI0      │         │ ili9486  │
│  GPIO8(CE0)├─────────┤   CS     │ (Chip Select)
│  GPIO10    ├─────────┤   MOSI   │ (Data Out)
│  GPIO9     ├─────────┤   MISO   │ (Data In)
│  GPIO11    ├─────────┤   SCK    │ (Clock)
│  GPIO25    ├─────────┤   DC     │ (Data/Command)
│  GPIO24    ├─────────┤   RST    │ (Reset)
│  GPIO18    ├─────────┤   LED    │ (Backlight PWM)
│  3.3V      ├─────────┤   VCC    │
│  GND       ├─────────┤   GND    │
└────────────┘         └──────────┘
```

**Display Notes:**
- Resolution: 480x320 (3.5") or 320x480 (2.8")
- Driver: ili9486 (may need fbcp or fbtft)
- Backlight control via GPIO18 PWM
- Frame rate: 20-30 FPS typical

### Touchscreen (ADS7846) - If Separate

```
Raspberry Pi 5          ADS7846 Touch Controller
┌────────────┐         ┌──────────┐
│  SPI0      │         │ ADS7846  │
│  GPIO7(CE1)├─────────┤   CS     │ (Different CS than display)
│  GPIO10    ├─────────┤   DIN    │
│  GPIO9     ├─────────┤   DOUT   │
│  GPIO11    ├─────────┤   CLK    │
│  GPIO17    ├─────────┤   IRQ    │ (Interrupt)
│  3.3V      ├─────────┤   VCC    │
│  GND       ├─────────┤   GND    │
└────────────┘         └──────────┘
```

**Touchscreen Notes:**
- Often integrated with display module
- Calibration required: `sudo TSLIB_TSDEVICE=/dev/input/event0 ts_calibrate`
- Test: `evtest /dev/input/event0`

### Piezo Buzzer (Emergency SOS)

```
Raspberry Pi 5          Piezo Buzzer
┌────────────┐         ┌──────────┐
│            │         │          │
│  GPIO18    ├─────────┤  Signal  │ (PWM for 2800Hz)
│  GND       ├─────────┤  GND     │
└────────────┘         └──────────┘
```

**Buzzer Notes:**
- Frequency: 2800Hz (international distress frequency)
- Pattern: SOS morse code (... --- ...)
- Volume: 85dB+ at 1 meter
- Connect through 100Ω resistor if buzzer is active type

---

## 🚀 Step-by-Step Assembly

### Phase 1: Core System (Start Here)

**1. BME280 Weather Sensor** ⭐ EASIEST FIRST
- **Why first?** Simplest sensor, instant feedback
- **Connections:** 4 wires (VCC, GND, SDA, SCL)
- **Testing:**
  ```bash
  ssh pi1@192.168.1.219
  /usr/sbin/i2cdetect -y 1
  # Should show 76 or 77
  ```
- **Troubleshooting:**
  - If not detected: Check VCC is 3.3V (not 5V!)
  - Swap SDA/SCL if no response
  - Verify solder connections on breakout board

**2. GPS Module**
- **Connections:** 4 wires (VCC=5V, GND, TX, RX)
- **Testing:**
  ```bash
  cat /dev/ttyAMA0
  # Should see NMEA sentences like: $GPRMC,,,V,,,,,,,,N*53
  ```
- **Troubleshooting:**
  - Blinking LED = power but no fix
  - Solid LED = GPS fix acquired
  - Takes 30-45 seconds outdoors with clear sky view
  - Will NOT work indoors

**3. Camera**
- **Connections:** 15-pin ribbon cable to CSI port
- **Testing:**
  ```bash
  libcamera-hello --list-cameras
  libcamera-jpeg -o test.jpg
  ```
- **Troubleshooting:**
  - Ensure ribbon is fully seated and locked
  - Metal contacts face away from ethernet port
  - Check `/boot/config.txt` has `camera_auto_detect=1`

### Phase 2: User Interface

**4. Display**
- **Connections:** 8-10 wires (see diagram above)
- **Driver Installation:**
  ```bash
  # Add to /boot/config.txt
  dtoverlay=ili9486,speed=32000000,fps=30,rotate=90
  dtparam=spi=on
  ```
- **Framebuffer Configuration:**
  ```bash
  # Install fbcp for mirroring
  sudo apt-get install cmake
  git clone https://github.com/juj/fbcp-ili9341
  cd fbcp-ili9341
  mkdir build && cd build
  cmake ..
  make -j4
  sudo ./fbcp-ili9341
  ```
- **Testing:**
  ```bash
  # Test pattern
  sudo fbi -d /dev/fb0 -T 1 test.jpg
  ```

**5. Touchscreen**
- **If integrated:** Should work automatically
- **If separate:** See ADS7846 wiring above
- **Calibration:**
  ```bash
  sudo apt-get install xinput-calibrator
  DISPLAY=:0 xinput_calibrator
  ```

### Phase 3: Medical Sensors (Optional)

**6. MAX30102 (Heart Rate / SpO2)**
- **Connections:** 4 wires to I2C bus
- **Testing:** Should appear at address 0x57
- **Note:** Requires finger contact, may need calibration

**7. MLX90614 (IR Temperature)**
- **Connections:** 4 wires to I2C bus
- **Testing:** Should appear at address 0x5A
- **Note:** Non-contact measurement, point at forehead

**8. Piezo Buzzer**
- **Connections:** 2 wires (GPIO18 + GND)
- **Testing:**
  ```bash
  # Test 2800Hz tone
  echo "18" > /sys/class/gpio/export
  echo "out" > /sys/class/gpio/gpio18/direction
  # Use PWM to generate tone (requires additional setup)
  ```

---

## 🧪 Testing After Each Component

### After Each Sensor Addition:

1. **Verify Detection:**
   ```bash
   ssh pi1@192.168.1.219
   curl http://localhost:5000/api/sensors
   ```

2. **Check System Status:**
   ```bash
   curl http://localhost:5000/api/status | python3 -m json.tool
   ```

3. **View Sensor Readings:**
   ```bash
   # BME280
   curl http://localhost:5000/api/weather

   # GPS
   curl http://localhost:5000/api/gps

   # Medical sensors
   curl http://localhost:5000/api/vitals
   ```

### Full System Test:

```bash
# Test all endpoints
curl http://localhost:5000/api/boot/status
curl http://localhost:5000/api/sensors/health
curl http://localhost:5000/api/models/status
```

---

## 📦 Shopping List

### Core System (Required)
- [x] Raspberry Pi 5 (16GB) - ✅ **You have this**
- [x] Hailo-8 AI Accelerator - ✅ **You have this**
- [ ] BME280 Sensor - $5-10
- [ ] u-blox NEO-6M GPS - $10-15
- [ ] OV5647 or IMX219 Camera - $15-25
- [ ] 3.5" ili9486 TFT Display with Touch - $20-30
- [ ] Piezo Buzzer - $2-5
- [ ] Jumper wires (F-F, M-F) - $5-10
- [ ] Breadboard (optional for testing) - $5

### Medical Sensors (Optional)
- [ ] MAX30102 (Heart Rate/SpO2) - $8-12
- [ ] MLX90614 (IR Temperature) - $15-20
- [ ] AD8232 ECG Sensor + MCP3008 ADC - $20-30

### Power & Mounting
- [ ] USB-C PD Power Supply (27W minimum) - $15-20
- [ ] 20,000mAh USB-C Power Bank - $30-50
- [ ] Enclosure/Case with ventilation - $15-30
- [ ] Heat sinks for Pi 5 - $5-10

**Total Estimated Cost (Core System):** $90-140
**Total Estimated Cost (With Medical Sensors):** $140-220

---

## ⚠️ Common Issues & Solutions

### I2C Sensor Not Detected

**Symptoms:** `/usr/sbin/i2cdetect -y 1` shows no devices

**Solutions:**
1. Check connections (especially GND)
2. Verify 3.3V power (measure with multimeter)
3. Try swapping SDA/SCL pins
4. Test sensor on breadboard first
5. Check if sensor needs 5V instead of 3.3V
6. Verify I2C is enabled: `sudo raspi-config` → Interface Options → I2C

### GPS Not Getting Fix

**Symptoms:** LED blinks but no $GPRMC sentences

**Solutions:**
1. Move outdoors with clear sky view
2. Wait 30-45 seconds for cold start
3. Check antenna connection (if external)
4. Verify 5V power supply (not 3.3V)
5. Test with: `cat /dev/ttyAMA0 | grep '$GPRMC'`

### Display Not Working

**Symptoms:** Backlight on but no image

**Solutions:**
1. Check `/boot/config.txt` has correct dtoverlay
2. Verify SPI is enabled
3. Test with: `sudo fbi -d /dev/fb0 -T 1 image.jpg`
4. Check display power (should be 3.3V, not 5V)
5. Verify all SPI connections (especially MOSI, SCK)
6. Try lower SPI speed in dtoverlay (speed=16000000)

### Camera Not Detected

**Symptoms:** `libcamera-hello` shows "No cameras available"

**Solutions:**
1. Reseat ribbon cable firmly
2. Ensure metal contacts face correct direction
3. Check `/boot/config.txt` has `camera_auto_detect=1`
4. Reboot after connecting camera
5. Try: `vcgencmd get_camera` (should show detected=1)

### Hailo Not Working After Reboot

**Symptoms:** `hailortcli scan` shows "No devices found"

**Solutions:**
1. Check module is loaded: `lsmod | grep hailo`
2. Load manually: `sudo modprobe hailo_pci`
3. Verify auto-load: `cat /etc/modules-load.d/hailo.conf`
4. Check PCIe: `lspci | grep Hailo`
5. Rebuild module if kernel updated

---

## 🎯 Success Criteria

System is fully operational when:

- [x] Hailo-8 accelerator detected
- [x] I2C bus active
- [x] SPI bus active
- [x] Framebuffer available
- [ ] BME280 sensor reading temp/humidity/pressure
- [ ] GPS acquiring satellites and reporting position
- [ ] Camera capturing images
- [ ] Display showing UI
- [ ] Touch input responsive
- [ ] Piezo buzzer producing SOS tone
- [ ] All API endpoints returning real data (not simulated)

**Current Progress:** 4/11 hardware components ready (36%)

---

## 🔗 Quick Reference

**SSH Access:**
```bash
ssh pi1@192.168.1.219  # Password: 54232105
```

**Test Commands:**
```bash
# I2C scan
/usr/sbin/i2cdetect -y 1

# GPS test
cat /dev/ttyAMA0 | head -20

# Camera test
libcamera-hello --list-cameras

# Display test
sudo fbi -d /dev/fb0 test.jpg

# SPI devices
ls -l /dev/spidev*

# API health check
curl http://localhost:5000/api/sensors
```

**Log Files:**
```bash
~/survival-companion/server.log
dmesg | grep -i hailo
dmesg | grep -i i2c
journalctl -u survival-companion
```

---

*Last Updated: January 16, 2026 - Hardware interfaces verified, waiting for physical sensor connection*
