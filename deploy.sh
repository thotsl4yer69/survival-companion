#!/bin/bash
# ==============================================================================
# Survival Companion - Production Deployment Script
# ==============================================================================
# This script deploys the Survival Companion to a Raspberry Pi 5 with full
# production hardware setup including Hailo-8L, sensors, and display.
#
# Usage:
#   Local:  ./deploy.sh --local
#   Remote: ./deploy.sh --remote <pi_ip> [--user pi]
#
# Target Platform: Raspberry Pi 5 (8GB RAM)
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
REMOTE_MODE=false
PI_IP=""
PI_USER="pi"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --local)
            REMOTE_MODE=false
            shift
            ;;
        --remote)
            REMOTE_MODE=true
            PI_IP="$2"
            shift 2
            ;;
        --user)
            PI_USER="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--local | --remote <ip> [--user <username>]]"
            exit 1
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------
print_header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║ $1${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${CYAN}ℹ $1${NC}"
}

# -----------------------------------------------------------------------------
# Remote execution wrapper
# -----------------------------------------------------------------------------
remote_exec() {
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "$@"
    else
        bash -c "$@"
    fi
}

remote_copy() {
    local src="$1"
    local dst="$2"
    if [ "$REMOTE_MODE" = true ]; then
        scp -r "$src" "${PI_USER}@${PI_IP}:$dst"
    else
        cp -r "$src" "$dst"
    fi
}

# ==============================================================================
# DEPLOYMENT STAGES
# ==============================================================================

print_header "SURVIVAL COMPANION - PRODUCTION DEPLOYMENT"

# -----------------------------------------------------------------------------
# Stage 1: Pre-flight Checks
# -----------------------------------------------------------------------------
print_step "Stage 1: Pre-flight Checks"

if [ "$REMOTE_MODE" = true ]; then
    print_info "Deployment mode: Remote (${PI_USER}@${PI_IP})"

    # Test SSH connection
    if ! ssh -o ConnectTimeout=5 "${PI_USER}@${PI_IP}" "echo 'SSH connection successful'" > /dev/null 2>&1; then
        print_error "Cannot connect to ${PI_IP}"
        echo "Please ensure:"
        echo "  1. Raspberry Pi is powered on and network connected"
        echo "  2. SSH is enabled: sudo raspi-config > Interface Options > SSH"
        echo "  3. IP address is correct"
        exit 1
    fi
    print_success "SSH connection to ${PI_IP} verified"
else
    print_info "Deployment mode: Local"

    # Check if running on Raspberry Pi
    if [ -f /proc/device-tree/model ]; then
        MODEL=$(cat /proc/device-tree/model)
        if [[ "$MODEL" == *"Raspberry Pi 5"* ]]; then
            print_success "Running on Raspberry Pi 5"
        else
            print_error "This script must run on Raspberry Pi 5 (detected: $MODEL)"
            exit 1
        fi
    else
        print_error "Cannot detect Raspberry Pi model"
        exit 1
    fi
fi

# Check required files exist
required_files=("server.js" "package.json" "config/survival_config.yaml")
for file in "${required_files[@]}"; do
    if [ ! -f "$PROJECT_ROOT/$file" ]; then
        print_error "Required file missing: $file"
        exit 1
    fi
done
print_success "All required files present"

# -----------------------------------------------------------------------------
# Stage 2: System Prerequisites
# -----------------------------------------------------------------------------
print_step "Stage 2: Installing System Prerequisites"

remote_exec "sudo apt-get update && sudo apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    sqlite3 \
    i2c-tools \
    python3-smbus \
    python3-dev \
    build-essential \
    cmake \
    pkg-config \
    libasound2-dev \
    portaudio19-dev \
    libportaudio2 \
    libsndfile1 \
    ffmpeg"

print_success "System prerequisites installed"

# -----------------------------------------------------------------------------
# Stage 3: Hardware Configuration
# -----------------------------------------------------------------------------
print_step "Stage 3: Configuring Hardware Interfaces"

# Enable I2C
remote_exec "sudo raspi-config nonint do_i2c 0"
print_success "I2C enabled"

# Enable SPI
remote_exec "sudo raspi-config nonint do_spi 0"
print_success "SPI enabled"

# Enable Camera
remote_exec "sudo raspi-config nonint do_camera 0"
print_success "Camera enabled"

# Enable UART (for GPS)
remote_exec "sudo raspi-config nonint do_serial_hw 0"  # Enable hardware UART
remote_exec "sudo raspi-config nonint do_serial_cons 1"  # Disable console on serial
print_success "UART enabled for GPS"

print_info "Hardware interfaces configured. Reboot may be required."

# -----------------------------------------------------------------------------
# Stage 4: Deploy Application Files
# -----------------------------------------------------------------------------
print_step "Stage 4: Deploying Application Files"

if [ "$REMOTE_MODE" = true ]; then
    REMOTE_DIR="/home/${PI_USER}/survival-companion"

    # Create remote directory
    remote_exec "mkdir -p $REMOTE_DIR"

    # Copy application files
    print_info "Copying application files to ${PI_IP}..."
    rsync -avz --progress \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude '*.db' \
        --exclude 'models/*.gguf' \
        --exclude 'models/*.hef' \
        "${PROJECT_ROOT}/" "${PI_USER}@${PI_IP}:${REMOTE_DIR}/"

    print_success "Application files deployed to ${REMOTE_DIR}"
    PROJECT_ROOT="$REMOTE_DIR"
else
    print_success "Running locally, files already in place"
fi

# -----------------------------------------------------------------------------
# Stage 5: Install Node.js Dependencies
# -----------------------------------------------------------------------------
print_step "Stage 5: Installing Node.js Dependencies"

remote_exec "cd ${PROJECT_ROOT} && npm install --production"
print_success "Node.js dependencies installed"

# -----------------------------------------------------------------------------
# Stage 6: Install Python Dependencies
# -----------------------------------------------------------------------------
print_step "Stage 6: Installing Python Dependencies"

# Create virtual environment
remote_exec "cd ${PROJECT_ROOT} && python3 -m venv venv"
print_success "Python virtual environment created"

# Install Python packages
remote_exec "cd ${PROJECT_ROOT} && source venv/bin/activate && pip install --upgrade pip"
remote_exec "cd ${PROJECT_ROOT} && source venv/bin/activate && pip install \
    flask \
    flask-cors \
    requests \
    numpy \
    pyyaml \
    smbus2 \
    RPi.GPIO \
    spidev \
    pyserial \
    sounddevice \
    soundfile"

print_success "Python dependencies installed"

# -----------------------------------------------------------------------------
# Stage 7: Database Initialization
# -----------------------------------------------------------------------------
print_step "Stage 7: Initializing Databases"

# Check if databases exist, create if not
remote_exec "cd ${PROJECT_ROOT} && \
    if [ ! -f api/features.db ]; then
        sqlite3 api/features.db < /dev/null
        echo 'Created features.db'
    fi"

remote_exec "cd ${PROJECT_ROOT}/personas/survival && \
    if [ ! -f medical/protocols.db ]; then
        mkdir -p medical
        sqlite3 medical/protocols.db < /dev/null
        echo 'Created protocols.db'
    fi"

remote_exec "cd ${PROJECT_ROOT}/personas/survival && \
    if [ ! -f data/species.db ]; then
        mkdir -p data
        sqlite3 data/species.db < /dev/null
        echo 'Created species.db'
    fi"

remote_exec "cd ${PROJECT_ROOT}/personas/survival && \
    if [ ! -f data/user_data.db ]; then
        sqlite3 data/user_data.db < /dev/null
        echo 'Created user_data.db'
    fi"

print_success "Databases initialized"

# -----------------------------------------------------------------------------
# Stage 8: Model Download Instructions
# -----------------------------------------------------------------------------
print_step "Stage 8: AI Models"

print_info "AI models need to be downloaded manually due to size (7GB+):"
echo ""
echo "Required models:"
echo "  1. Phi-3-mini (2.5GB) - General queries"
echo "     Download: https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf"
echo "     File: phi-3-mini-4k-instruct-q4_k_m.gguf"
echo "     Target: ${PROJECT_ROOT}/personas/survival/models/"
echo ""
echo "  2. BioMistral-7B (4GB) - Medical queries"
echo "     Download: https://huggingface.co/BioMistral/BioMistral-7B-GGUF"
echo "     File: biomistral-7b-dare-q4_k_m.gguf"
echo "     Target: ${PROJECT_ROOT}/personas/survival/models/"
echo ""
echo "  3. Whisper.cpp (STT)"
echo "     Download: https://huggingface.co/ggerganov/whisper.cpp"
echo "     File: ggml-base.en.bin"
echo "     Target: ${PROJECT_ROOT}/personas/survival/models/"
echo ""
echo "  4. Piper (TTS)"
echo "     Download: https://github.com/rhasspy/piper/releases"
echo "     File: en_US-lessac-medium.onnx + .json"
echo "     Target: ${PROJECT_ROOT}/personas/survival/models/"
echo ""

# Create models directory
remote_exec "mkdir -p ${PROJECT_ROOT}/personas/survival/models"

# Check if models exist
MODELS_EXIST=false
remote_exec "if [ -f ${PROJECT_ROOT}/personas/survival/models/phi-3-mini-4k-instruct-q4_k_m.gguf ]; then echo 'PHI3_EXISTS'; fi" | grep -q "PHI3_EXISTS" && MODELS_EXIST=true

if [ "$MODELS_EXIST" = true ]; then
    print_success "Models directory exists with some models"
else
    print_info "Models not yet downloaded. System will run in degraded mode."
    echo "Use the download_models.sh script to fetch models:"
    echo "  ./download_models.sh --remote ${PI_IP}"
fi

# -----------------------------------------------------------------------------
# Stage 9: Hailo-8L Setup
# -----------------------------------------------------------------------------
print_step "Stage 9: Hailo-8L Accelerator Setup"

# Check if Hailo is installed
if remote_exec "lspci | grep -i hailo" > /dev/null 2>&1; then
    print_success "Hailo-8L accelerator detected"

    # Install Hailo drivers if not present
    if ! remote_exec "which hailortcli" > /dev/null 2>&1; then
        print_info "Installing Hailo Runtime..."
        remote_exec "wget -O /tmp/hailort.deb https://hailo.ai/downloads/hailort/latest/hailort_4.17.0_arm64.deb"
        remote_exec "sudo dpkg -i /tmp/hailort.deb || sudo apt-get install -f -y"
        print_success "Hailo Runtime installed"
    else
        print_success "Hailo Runtime already installed"
    fi
else
    print_info "Hailo-8L not detected. Vision features will be unavailable."
    echo "If you have a Hailo-8L, ensure:"
    echo "  1. It's properly seated in the M.2 slot"
    echo "  2. PCIe is enabled in raspi-config"
    echo "  3. System has been rebooted after installation"
fi

# -----------------------------------------------------------------------------
# Stage 10: Sensor Testing
# -----------------------------------------------------------------------------
print_step "Stage 10: Testing Sensors"

print_info "Scanning I2C bus for connected sensors..."
if remote_exec "i2cdetect -y 1" > /tmp/i2c_scan.txt 2>&1; then
    cat /tmp/i2c_scan.txt

    # Check for expected sensors
    if grep -q "57" /tmp/i2c_scan.txt; then
        print_success "MAX30102 (SpO2/HR) detected at 0x57"
    else
        print_info "MAX30102 not detected at 0x57"
    fi

    if grep -q "5a" /tmp/i2c_scan.txt; then
        print_success "MLX90614 (IR temp) detected at 0x5A"
    else
        print_info "MLX90614 not detected at 0x5A"
    fi

    if grep -q "76" /tmp/i2c_scan.txt; then
        print_success "BME280 (weather) detected at 0x76"
    else
        print_info "BME280 not detected at 0x76"
    fi
else
    print_info "I2C scan failed. Sensors may not be connected."
fi

# Test GPS (UART)
print_info "Testing GPS module..."
if remote_exec "timeout 5 cat /dev/ttyAMA0 2>/dev/null | grep -q '$GPRMC'"; then
    print_success "GPS module detected and transmitting NMEA data"
else
    print_info "GPS module not detected on /dev/ttyAMA0"
    echo "Check:"
    echo "  1. GPS is connected to GPIO14 (TX) and GPIO15 (RX)"
    echo "  2. UART is enabled: sudo raspi-config > Interface Options > Serial"
    echo "  3. GPS has clear sky view for satellite acquisition"
fi

# -----------------------------------------------------------------------------
# Stage 11: Create Systemd Service
# -----------------------------------------------------------------------------
print_step "Stage 11: Creating Systemd Service"

SERVICE_FILE="/tmp/survival-companion.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Survival Companion AI System
After=network.target

[Service]
Type=simple
User=${PI_USER}
WorkingDirectory=${PROJECT_ROOT}
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node ${PROJECT_ROOT}/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

if [ "$REMOTE_MODE" = true ]; then
    scp "$SERVICE_FILE" "${PI_USER}@${PI_IP}:/tmp/survival-companion.service"
fi

remote_exec "sudo mv /tmp/survival-companion.service /etc/systemd/system/"
remote_exec "sudo systemctl daemon-reload"
remote_exec "sudo systemctl enable survival-companion"
print_success "Systemd service installed"

# -----------------------------------------------------------------------------
# Stage 12: Firewall Configuration
# -----------------------------------------------------------------------------
print_step "Stage 12: Configuring Firewall"

remote_exec "sudo ufw allow 5000/tcp comment 'Survival Companion API'"
remote_exec "sudo ufw --force enable || true"
print_success "Firewall configured (port 5000 open)"

# -----------------------------------------------------------------------------
# Stage 13: Final Checks
# -----------------------------------------------------------------------------
print_step "Stage 13: Final Verification"

# Test Node.js
if remote_exec "node --version" > /dev/null 2>&1; then
    NODE_VERSION=$(remote_exec "node --version")
    print_success "Node.js: $NODE_VERSION"
else
    print_error "Node.js not found"
fi

# Test Python
if remote_exec "python3 --version" > /dev/null 2>&1; then
    PY_VERSION=$(remote_exec "python3 --version")
    print_success "Python: $PY_VERSION"
else
    print_error "Python not found"
fi

# Test SQLite
if remote_exec "sqlite3 --version" > /dev/null 2>&1; then
    SQLITE_VERSION=$(remote_exec "sqlite3 --version" | awk '{print $1}')
    print_success "SQLite: $SQLITE_VERSION"
else
    print_error "SQLite not found"
fi

# ==============================================================================
# DEPLOYMENT COMPLETE
# ==============================================================================

print_header "DEPLOYMENT COMPLETE"

echo "Next steps:"
echo ""
echo "1. Download AI models (required for functionality):"
echo "   ./download_models.sh --remote ${PI_IP}"
echo ""
echo "2. Start the service:"
if [ "$REMOTE_MODE" = true ]; then
    echo "   ssh ${PI_USER}@${PI_IP} 'sudo systemctl start survival-companion'"
else
    echo "   sudo systemctl start survival-companion"
fi
echo ""
echo "3. Check service status:"
if [ "$REMOTE_MODE" = true ]; then
    echo "   ssh ${PI_USER}@${PI_IP} 'sudo systemctl status survival-companion'"
else
    echo "   sudo systemctl status survival-companion"
fi
echo ""
echo "4. View logs:"
if [ "$REMOTE_MODE" = true ]; then
    echo "   ssh ${PI_USER}@${PI_IP} 'sudo journalctl -u survival-companion -f'"
else
    echo "   sudo journalctl -u survival-companion -f"
fi
echo ""
echo "5. Access the web interface:"
if [ "$REMOTE_MODE" = true ]; then
    echo "   http://${PI_IP}:5000"
else
    echo "   http://localhost:5000"
fi
echo ""
echo "6. Test sensor readings:"
echo "   curl http://${PI_IP:-localhost}:5000/api/sensors"
echo ""
echo "7. Manual testing mode (without systemd):"
if [ "$REMOTE_MODE" = true ]; then
    echo "   ssh ${PI_USER}@${PI_IP}"
    echo "   cd ${PROJECT_ROOT}"
    echo "   node server.js"
else
    echo "   cd ${PROJECT_ROOT}"
    echo "   node server.js"
fi
echo ""

print_info "⚠ IMPORTANT: System will operate in degraded mode until models are downloaded"
print_info "⚠ Some sensors may show errors if not physically connected"

echo ""
print_success "Deployment script completed successfully!"
echo ""
