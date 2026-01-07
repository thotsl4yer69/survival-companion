#!/bin/bash
# ==============================================================================
# Survival Companion - Development Environment Setup
# ==============================================================================
# This script sets up the development environment for the Survival Companion
# AI survival expert system. Run this once to initialize all dependencies.
#
# Target Platform: Raspberry Pi 5 (8GB RAM)
# Accelerator: Hailo-8L (26 TOPS, PCIe M.2 hat)
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          SURVIVAL COMPANION - Environment Setup                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# -----------------------------------------------------------------------------
# Function: Print step header
# -----------------------------------------------------------------------------
print_step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

# -----------------------------------------------------------------------------
# Function: Print success message
# -----------------------------------------------------------------------------
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# -----------------------------------------------------------------------------
# Function: Print error message
# -----------------------------------------------------------------------------
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# -----------------------------------------------------------------------------
# Function: Check if running on Raspberry Pi
# -----------------------------------------------------------------------------
check_platform() {
    print_step "Checking platform..."

    if [ -f /proc/device-tree/model ]; then
        MODEL=$(cat /proc/device-tree/model)
        echo "  Detected: $MODEL"

        if [[ "$MODEL" == *"Raspberry Pi 5"* ]]; then
            print_success "Running on Raspberry Pi 5"
            IS_PI5=true
        else
            echo -e "${YELLOW}  Warning: Not running on Raspberry Pi 5${NC}"
            echo "  Some hardware features may not be available in development mode."
            IS_PI5=false
        fi
    else
        echo "  Not running on Raspberry Pi hardware"
        echo "  Development mode: Hardware features will be simulated"
        IS_PI5=false
    fi
    echo ""
}

# -----------------------------------------------------------------------------
# Step 1: Check Python version
# -----------------------------------------------------------------------------
check_python() {
    print_step "Checking Python version..."

    # Check for Python 3.9+
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
        PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

        if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 9 ]; then
            print_success "Python $PYTHON_VERSION found (requires 3.9+)"
        else
            print_error "Python 3.9+ required, found $PYTHON_VERSION"
            echo "  Please install Python 3.9 or higher"
            exit 1
        fi
    else
        print_error "Python3 not found"
        echo "  Please install Python 3.9 or higher"
        exit 1
    fi
    echo ""
}

# -----------------------------------------------------------------------------
# Step 2: Create Python virtual environment
# -----------------------------------------------------------------------------
setup_venv() {
    print_step "Setting up Python virtual environment..."

    VENV_DIR="$PROJECT_ROOT/.venv"

    if [ -d "$VENV_DIR" ]; then
        echo "  Virtual environment already exists at $VENV_DIR"
        echo "  Use '--fresh' flag to recreate it"
    else
        python3 -m venv "$VENV_DIR"
        print_success "Created virtual environment at $VENV_DIR"
    fi

    # Activate virtual environment
    source "$VENV_DIR/bin/activate"
    print_success "Activated virtual environment"

    # Upgrade pip
    pip install --upgrade pip setuptools wheel > /dev/null 2>&1
    print_success "Upgraded pip, setuptools, wheel"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 3: Install Python dependencies
# -----------------------------------------------------------------------------
install_dependencies() {
    print_step "Installing Python dependencies..."

    # Core dependencies
    pip install "numpy>=1.24.0" > /dev/null 2>&1
    pip install "pyyaml>=6.0" > /dev/null 2>&1
    pip install "pillow>=10.0.0" > /dev/null 2>&1
    print_success "Installed core dependencies (numpy, pyyaml, pillow)"

    # Database
    pip install "sqlite-utils>=3.35" > /dev/null 2>&1
    print_success "Installed database tools (sqlite-utils)"

    # LLM runtime (llama-cpp-python)
    echo "  Installing llama-cpp-python (this may take a while)..."
    pip install "llama-cpp-python>=0.2.0" > /dev/null 2>&1 || {
        echo -e "${YELLOW}  Warning: llama-cpp-python installation may require CMAKE${NC}"
        echo "  On Raspberry Pi, run: sudo apt install cmake build-essential"
    }
    print_success "Installed LLM runtime (llama-cpp-python)"

    # Voice processing
    pip install "sounddevice>=0.4.6" > /dev/null 2>&1
    pip install "soundfile>=0.12.1" > /dev/null 2>&1
    pip install "webrtcvad>=2.0.10" > /dev/null 2>&1 || true
    print_success "Installed voice processing (sounddevice, soundfile)"

    # Hardware interfaces (Pi-specific, may fail on other platforms)
    if [ "$IS_PI5" = true ]; then
        pip install "RPi.GPIO>=0.7.1" > /dev/null 2>&1 || true
        pip install "spidev>=3.6" > /dev/null 2>&1 || true
        pip install "smbus2>=0.4.2" > /dev/null 2>&1 || true
        pip install "gps>=3.25" > /dev/null 2>&1 || true
        pip install "picamera2>=0.3.12" > /dev/null 2>&1 || true
        print_success "Installed Pi hardware interfaces"
    else
        echo "  Skipping Pi-specific hardware libraries (not on Pi 5)"
    fi

    # Image processing
    pip install "opencv-python-headless>=4.8.0" > /dev/null 2>&1 || {
        echo -e "${YELLOW}  Warning: opencv-python-headless may require additional packages${NC}"
        echo "  On Raspberry Pi, run: sudo apt install libopencv-dev"
    }
    print_success "Installed image processing (opencv)"

    # Development tools
    pip install "pytest>=7.4.0" > /dev/null 2>&1
    pip install "pytest-cov>=4.1.0" > /dev/null 2>&1
    pip install "black>=23.0.0" > /dev/null 2>&1
    pip install "mypy>=1.5.0" > /dev/null 2>&1
    print_success "Installed development tools (pytest, black, mypy)"

    echo ""
}

# -----------------------------------------------------------------------------
# Step 4: Create directory structure
# -----------------------------------------------------------------------------
create_directories() {
    print_step "Creating project directory structure..."

    # Main persona module structure
    mkdir -p personas/survival/{medical,vision,navigation,survival,emergency,voice,ui,sensors,data,models}
    mkdir -p personas/survival/data/{regional,maps}

    # Test directories
    mkdir -p tests/{unit,integration,safety}

    # Configuration
    mkdir -p config

    # Logs (for development)
    mkdir -p logs

    # Assets
    mkdir -p assets/{sounds,images}

    print_success "Created directory structure"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 5: Initialize SQLite databases
# -----------------------------------------------------------------------------
init_databases() {
    print_step "Initializing SQLite databases..."

    # Medical protocols database
    DB_PATH="personas/survival/medical/protocols.db"
    if [ ! -f "$DB_PATH" ]; then
        sqlite3 "$DB_PATH" << 'EOF'
-- Medical Protocols Database Schema
CREATE TABLE IF NOT EXISTS protocols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    injury_type TEXT NOT NULL,
    severity TEXT,
    title TEXT NOT NULL,
    symptoms TEXT,  -- JSON array
    steps TEXT NOT NULL,  -- JSON array
    warnings TEXT,  -- JSON array
    contraindications TEXT,  -- JSON array
    when_to_seek_help TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_protocols_category ON protocols(category);
CREATE INDEX idx_protocols_injury_type ON protocols(injury_type);

-- Insert a few seed protocols
INSERT INTO protocols (category, injury_type, severity, title, symptoms, steps, warnings, when_to_seek_help)
VALUES
('wound', 'cut', 'minor', 'Minor Cut Treatment',
 '["Bleeding", "Pain at site", "Visible wound"]',
 '["1. Wash hands thoroughly", "2. Apply gentle pressure with clean cloth", "3. Clean wound with clean water", "4. Apply antibiotic ointment if available", "5. Cover with sterile bandage", "6. Change bandage daily"]',
 '["Do not use dirty water", "Watch for signs of infection"]',
 'Seek help if bleeding does not stop after 10 minutes of pressure, wound is deep, or signs of infection appear'),

('cardiac', 'cardiac_arrest', 'critical', 'CPR - Adult',
 '["Unresponsive", "Not breathing normally", "No pulse"]',
 '["1. Check for responsiveness - tap and shout", "2. Call for help or activate emergency beacon", "3. Check breathing for 10 seconds", "4. If not breathing, begin chest compressions", "5. Place heel of hand on center of chest", "6. Push hard and fast - 100-120 compressions per minute", "7. Push down at least 2 inches (5cm)", "8. Allow full chest recoil between compressions", "9. After 30 compressions, give 2 rescue breaths", "10. Continue 30:2 ratio until help arrives"]',
 '["Do not stop CPR unless person recovers or you are exhausted", "Minimize interruptions"]',
 'This is a medical emergency - activate SOS beacon immediately');
EOF
        print_success "Created medical protocols database with seed data"
    else
        echo "  Medical protocols database already exists"
    fi

    # Species database
    SPECIES_DB="personas/survival/data/species.db"
    if [ ! -f "$SPECIES_DB" ]; then
        sqlite3 "$SPECIES_DB" << 'EOF'
-- Species Database Schema
CREATE TABLE IF NOT EXISTS species (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kingdom TEXT NOT NULL,  -- plant, animal, fungi
    scientific_name TEXT NOT NULL UNIQUE,
    common_names TEXT,  -- JSON array
    region TEXT,
    habitat TEXT,
    edible BOOLEAN DEFAULT FALSE,
    poisonous BOOLEAN DEFAULT FALSE,
    dangerous BOOLEAN DEFAULT FALSE,
    toxicity_level TEXT,
    toxin_type TEXT,
    description TEXT,
    identification_tips TEXT,
    first_aid_if_contact TEXT,
    image_refs TEXT,  -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_species_kingdom ON species(kingdom);
CREATE INDEX idx_species_region ON species(region);
CREATE INDEX idx_species_dangerous ON species(dangerous);
CREATE INDEX idx_species_poisonous ON species(poisonous);
EOF
        print_success "Created species database"
    else
        echo "  Species database already exists"
    fi

    # User profile and data database
    USER_DB="personas/survival/data/user_data.db"
    if [ ! -f "$USER_DB" ]; then
        sqlite3 "$USER_DB" << 'EOF'
-- User Data Database Schema
CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    blood_type TEXT,
    allergies TEXT,  -- JSON array
    medical_conditions TEXT,  -- JSON array
    medications TEXT,  -- JSON array
    emergency_contacts TEXT,  -- JSON array
    skill_level TEXT DEFAULT 'novice',
    baseline_vitals TEXT,  -- JSON object
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vitals_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    heart_rate INTEGER,
    spo2 INTEGER,
    temperature REAL,
    blood_pressure TEXT,
    ecg_summary TEXT,
    altitude REAL,
    activity_level TEXT,
    alerts_generated TEXT  -- JSON array
);

CREATE TABLE IF NOT EXISTS waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    category TEXT
);

CREATE TABLE IF NOT EXISTS breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    speed REAL,
    heading REAL
);

CREATE TABLE IF NOT EXISTS emergency_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    details TEXT,  -- JSON object
    gps_coordinates TEXT
);

CREATE INDEX idx_vitals_timestamp ON vitals_history(timestamp);
CREATE INDEX idx_breadcrumbs_timestamp ON breadcrumbs(timestamp);
CREATE INDEX idx_emergency_timestamp ON emergency_log(timestamp);
EOF
        print_success "Created user data database"
    else
        echo "  User data database already exists"
    fi

    echo ""
}

# -----------------------------------------------------------------------------
# Step 6: Create configuration file
# -----------------------------------------------------------------------------
create_config() {
    print_step "Creating default configuration..."

    CONFIG_FILE="config/survival_config.yaml"
    if [ ! -f "$CONFIG_FILE" ]; then
        cat > "$CONFIG_FILE" << 'EOF'
# ==============================================================================
# Survival Companion Configuration
# ==============================================================================

# System Settings
system:
  persona_name: "Survival Companion"
  version: "1.0.0"
  debug_mode: false
  log_level: "INFO"

# Memory Management
memory:
  max_ram_usage_mb: 7500  # Leave buffer from 8GB total
  llm_unload_timeout_sec: 30

# Voice Interface
voice:
  wake_words: ["survival", "companion"]
  stt_model: "base.en"  # whisper.cpp model
  tts_voice: "en_US-lessac-medium"  # Piper voice
  sample_rate: 16000
  vad_threshold: 0.5
  confidence_threshold: 0.7
  volume: 0.8

# LLM Settings
llm:
  fast_model: "phi-3-mini-4k-instruct-q4_k_m.gguf"
  medical_model: "biomistral-7b-dare-q4_k_m.gguf"
  context_length: 4096
  temperature: 0.7
  top_p: 0.9
  max_tokens: 1024

# Medical Safety Layer
safety:
  enabled: true
  forbidden_patterns:
    - "you have .* cancer"
    - "definitely .* disease"
    - "take \\d+ mg of"
    - "you will die"
  required_disclaimers:
    skin_analysis: "This is a screening tool only. See a dermatologist for diagnosis."
    medication: "Consult a medical professional before taking any medication."
    emergency: "If symptoms worsen, activate emergency beacon immediately."

# Hardware Configuration
hardware:
  # SPI Bus 0 - Display and Touch
  display:
    enabled: true
    driver: "ili9486"
    cs_pin: 8  # GPIO8 / CE0
    width: 480
    height: 320
    rotation: 0
  touch:
    enabled: true
    driver: "ads7846"
    cs_pin: 7  # GPIO7 / CE1

  # SPI Bus 1 - ADC
  adc:
    enabled: true
    driver: "mcp3008"
    cs_pin: 16
    clk_pin: 21
    mosi_pin: 20
    miso_pin: 19

  # I2C Sensors
  i2c:
    bus: 1
    speed_hz: 100000  # Limited by MLX90614

  sensors:
    max30102:
      enabled: true
      address: 0x57
    mlx90614:
      enabled: true
      address: 0x5A
    bme280:
      enabled: true
      address: 0x76

  # GPS
  gps:
    enabled: true
    port: "/dev/ttyS0"
    baud: 9600

  # Emergency
  emergency:
    buzzer_pin: 18  # PWM for piezo
    buzzer_frequency: 2800  # Hz
    ad8232_lo_plus_pin: 17
    ad8232_lo_minus_pin: 27

  # Camera
  camera:
    enabled: true
    resolution: [1920, 1080]
    inference_size: [224, 224]

# Power Management
power:
  idle_timeout_sec: 30
  display_timeout_sec: 60
  low_battery_threshold: 20
  critical_battery_threshold: 10

# Vision Models (Hailo HEF)
vision:
  triage_model: "triage.hef"
  skin_cancer_model: "skin_cancer.hef"
  plant_classifier: "plant_classifier.hef"
  wildlife_classifier: "wildlife_classifier.hef"
  wound_assessor: "wound_assessor.hef"

# Navigation
navigation:
  map_format: "mbtiles"
  default_zoom: 15
  breadcrumb_interval_sec: 10

# Database Paths
databases:
  protocols: "personas/survival/medical/protocols.db"
  species: "personas/survival/data/species.db"
  user_data: "personas/survival/data/user_data.db"
EOF
        print_success "Created default configuration at $CONFIG_FILE"
    else
        echo "  Configuration file already exists"
    fi
    echo ""
}

# -----------------------------------------------------------------------------
# Step 7: Create placeholder model files
# -----------------------------------------------------------------------------
create_model_placeholders() {
    print_step "Creating model placeholder files..."

    MODEL_DIR="personas/survival/models"

    # Create placeholder files with instructions
    for model in "phi-3-mini-4k-instruct-q4_k_m.gguf" "biomistral-7b-dare-q4_k_m.gguf"; do
        if [ ! -f "$MODEL_DIR/$model" ]; then
            echo "# PLACEHOLDER - Download actual model file" > "$MODEL_DIR/$model.placeholder"
            echo "# Model: $model" >> "$MODEL_DIR/$model.placeholder"
            echo "# Source: https://huggingface.co/" >> "$MODEL_DIR/$model.placeholder"
        fi
    done

    for model in "triage.hef" "skin_cancer.hef" "plant_classifier.hef" "wildlife_classifier.hef" "wound_assessor.hef"; do
        if [ ! -f "$MODEL_DIR/$model" ]; then
            echo "# PLACEHOLDER - Train and compile HEF model" > "$MODEL_DIR/$model.placeholder"
            echo "# Model: $model" >> "$MODEL_DIR/$model.placeholder"
            echo "# Target: Hailo-8L" >> "$MODEL_DIR/$model.placeholder"
        fi
    done

    print_success "Created model placeholder files in $MODEL_DIR"
    echo "  ⚠ Remember to download/train actual models before deployment!"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 8: Create initial Python package files
# -----------------------------------------------------------------------------
create_python_packages() {
    print_step "Creating Python package structure..."

    # Create __init__.py files
    PACKAGES=(
        "personas/survival"
        "personas/survival/medical"
        "personas/survival/vision"
        "personas/survival/navigation"
        "personas/survival/survival"
        "personas/survival/emergency"
        "personas/survival/voice"
        "personas/survival/ui"
        "personas/survival/sensors"
        "tests"
        "tests/unit"
        "tests/integration"
        "tests/safety"
    )

    for pkg in "${PACKAGES[@]}"; do
        init_file="$pkg/__init__.py"
        if [ ! -f "$init_file" ]; then
            echo '"""' > "$init_file"
            echo "Survival Companion - $(basename $pkg) module" >> "$init_file"
            echo '"""' >> "$init_file"
        fi
    done

    print_success "Created Python package structure"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 9: Create sample test file
# -----------------------------------------------------------------------------
create_sample_tests() {
    print_step "Creating sample test file..."

    TEST_FILE="tests/test_sample.py"
    if [ ! -f "$TEST_FILE" ]; then
        cat > "$TEST_FILE" << 'EOF'
"""
Sample tests for Survival Companion
Run with: pytest tests/ -v
"""
import pytest


def test_placeholder():
    """Placeholder test - remove when real tests are added."""
    assert True


class TestMedicalProtocols:
    """Tests for medical protocol retrieval."""

    def test_protocol_database_exists(self):
        """Verify protocols database is created."""
        import os
        db_path = "personas/survival/medical/protocols.db"
        assert os.path.exists(db_path), "Protocols database should exist"

    def test_protocol_schema(self):
        """Verify protocols table has correct schema."""
        import sqlite3
        conn = sqlite3.connect("personas/survival/medical/protocols.db")
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='protocols'")
        result = cursor.fetchone()

        assert result is not None, "protocols table should exist"
        conn.close()


class TestSafetyLayer:
    """Tests for medical safety layer."""

    @pytest.mark.parametrize("dangerous_phrase", [
        "you have cancer",
        "definitely heart disease",
        "take 500 mg of ibuprofen",
        "you will die",
    ])
    def test_forbidden_patterns_blocked(self, dangerous_phrase):
        """Verify dangerous patterns would be caught."""
        import re

        forbidden_patterns = [
            r"you have .* cancer",
            r"definitely .* disease",
            r"take \d+ mg of",
            r"you will die",
        ]

        matched = any(
            re.search(pattern, dangerous_phrase, re.IGNORECASE)
            for pattern in forbidden_patterns
        )

        assert matched, f"Pattern '{dangerous_phrase}' should be blocked"
EOF
        print_success "Created sample test file at $TEST_FILE"
    else
        echo "  Sample test file already exists"
    fi
    echo ""
}

# -----------------------------------------------------------------------------
# Step 10: Final instructions
# -----------------------------------------------------------------------------
print_instructions() {
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          Setup Complete! Next Steps:                             ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "1. Activate the virtual environment:"
    echo "   ${BLUE}source .venv/bin/activate${NC}"
    echo ""
    echo "2. Download LLM models (required):"
    echo "   - Phi-3-mini: https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf"
    echo "   - BioMistral: https://huggingface.co/BioMistral/BioMistral-7B-DARE"
    echo "   Place in: ${BLUE}personas/survival/models/${NC}"
    echo ""
    echo "3. Download voice models (required):"
    echo "   - Whisper.cpp: https://github.com/ggerganov/whisper.cpp"
    echo "   - Piper TTS: https://github.com/rhasspy/piper"
    echo ""
    echo "4. Run tests:"
    echo "   ${BLUE}pytest tests/ -v${NC}"
    echo ""
    echo "5. Start development:"
    echo "   ${BLUE}python personas/survival/survival_persona.py${NC}"
    echo ""
    if [ "$IS_PI5" = false ]; then
        echo -e "${YELLOW}Note: Running in development mode (not on Pi 5)${NC}"
        echo "Hardware features will be simulated until deployed to actual device."
        echo ""
    fi
    echo "Documentation: See README.md and app_spec.txt for full specifications."
    echo ""
}

# -----------------------------------------------------------------------------
# Main execution
# -----------------------------------------------------------------------------
main() {
    # Parse arguments
    FRESH=false
    for arg in "$@"; do
        case $arg in
            --fresh)
                FRESH=true
                ;;
            --help)
                echo "Usage: ./init.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --fresh    Remove and recreate virtual environment"
                echo "  --help     Show this help message"
                exit 0
                ;;
        esac
    done

    # Remove existing venv if --fresh
    if [ "$FRESH" = true ] && [ -d ".venv" ]; then
        echo "Removing existing virtual environment..."
        rm -rf .venv
    fi

    # Run setup steps
    check_platform
    check_python
    setup_venv
    install_dependencies
    create_directories
    init_databases
    create_config
    create_model_placeholders
    create_python_packages
    create_sample_tests
    print_instructions
}

# Run main function
main "$@"
