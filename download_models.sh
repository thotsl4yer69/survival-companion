#!/bin/bash
# ==============================================================================
# Survival Companion - AI Model Download Script
# ==============================================================================
# Downloads all required AI models for the Survival Companion system.
# Total download size: ~7GB
# Required storage: ~10GB (with extraction)
#
# Usage:
#   Local:  ./download_models.sh --local
#   Remote: ./download_models.sh --remote <pi_ip> [--user pi]
# ==============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

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

if [ "$REMOTE_MODE" = true ]; then
    TARGET_DIR="/home/${PI_USER}/survival-companion/personas/survival/models"
else
    TARGET_DIR="${PROJECT_ROOT}/personas/survival/models"
fi

# Utility functions
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

remote_exec() {
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "$@"
    else
        bash -c "$@"
    fi
}

print_header "AI MODEL DOWNLOAD"

# Check available disk space
print_step "Checking disk space..."
if [ "$REMOTE_MODE" = true ]; then
    AVAILABLE=$(ssh "${PI_USER}@${PI_IP}" "df -BG /home | tail -1 | awk '{print \$4}' | sed 's/G//'")
else
    AVAILABLE=$(df -BG "${PROJECT_ROOT}" | tail -1 | awk '{print $4}' | sed 's/G//')
fi

if [ "$AVAILABLE" -lt 12 ]; then
    print_error "Insufficient disk space: ${AVAILABLE}GB available, need at least 12GB"
    echo "Free up space and try again."
    exit 1
fi
print_success "Disk space OK: ${AVAILABLE}GB available"

# Create models directory
print_step "Creating models directory..."
remote_exec "mkdir -p ${TARGET_DIR}"
print_success "Models directory ready: ${TARGET_DIR}"

# ==============================================================================
# MODEL 1: Phi-3-mini (General queries, 2.5GB)
# ==============================================================================
print_step "Downloading Phi-3-mini (2.5GB) - General queries LLM"

PHI3_FILE="${TARGET_DIR}/phi-3-mini-4k-instruct-q4_k_m.gguf"
PHI3_URL="https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4_K_M.gguf"

if remote_exec "[ -f ${PHI3_FILE} ]"; then
    print_info "Phi-3-mini already exists, skipping"
else
    print_info "Downloading from HuggingFace..."
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "wget --progress=bar:force -O ${PHI3_FILE} ${PHI3_URL}"
    else
        wget --progress=bar:force -O "${PHI3_FILE}" "${PHI3_URL}"
    fi
    print_success "Phi-3-mini downloaded"
fi

# Verify file size (should be ~2.5GB)
PHI3_SIZE=$(remote_exec "du -h ${PHI3_FILE} | cut -f1")
print_info "Phi-3-mini size: ${PHI3_SIZE}"

# ==============================================================================
# MODEL 2: BioMistral-7B (Medical queries, 4GB)
# ==============================================================================
print_step "Downloading BioMistral-7B (4GB) - Medical queries LLM"

BIO_FILE="${TARGET_DIR}/biomistral-7b-dare-q4_k_m.gguf"
BIO_URL="https://huggingface.co/MaziyarPanahi/BioMistral-7B-GGUF/resolve/main/BioMistral-7B.Q4_K_M.gguf"

if remote_exec "[ -f ${BIO_FILE} ]"; then
    print_info "BioMistral already exists, skipping"
else
    print_info "Downloading from HuggingFace..."
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "wget --progress=bar:force -O ${BIO_FILE} ${BIO_URL}"
    else
        wget --progress=bar:force -O "${BIO_FILE}" "${BIO_URL}"
    fi
    print_success "BioMistral downloaded"
fi

BIO_SIZE=$(remote_exec "du -h ${BIO_FILE} | cut -f1")
print_info "BioMistral size: ${BIO_SIZE}"

# ==============================================================================
# MODEL 3: Whisper.cpp (Speech-to-text, 140MB)
# ==============================================================================
print_step "Downloading Whisper.cpp base model (140MB) - Speech recognition"

WHISPER_FILE="${TARGET_DIR}/ggml-base.en.bin"
WHISPER_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

if remote_exec "[ -f ${WHISPER_FILE} ]"; then
    print_info "Whisper model already exists, skipping"
else
    print_info "Downloading from HuggingFace..."
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "wget --progress=bar:force -O ${WHISPER_FILE} ${WHISPER_URL}"
    else
        wget --progress=bar:force -O "${WHISPER_FILE}" "${WHISPER_URL}"
    fi
    print_success "Whisper model downloaded"
fi

WHISPER_SIZE=$(remote_exec "du -h ${WHISPER_FILE} | cut -f1")
print_info "Whisper model size: ${WHISPER_SIZE}"

# ==============================================================================
# MODEL 4: Piper TTS (Text-to-speech, 60MB)
# ==============================================================================
print_step "Downloading Piper TTS model (60MB) - Voice synthesis"

PIPER_MODEL="${TARGET_DIR}/en_US-lessac-medium.onnx"
PIPER_CONFIG="${TARGET_DIR}/en_US-lessac-medium.onnx.json"
PIPER_MODEL_URL="https://github.com/rhasspy/piper/releases/download/v1.2.0/en_US-lessac-medium.onnx"
PIPER_CONFIG_URL="https://github.com/rhasspy/piper/releases/download/v1.2.0/en_US-lessac-medium.onnx.json"

if remote_exec "[ -f ${PIPER_MODEL} ]"; then
    print_info "Piper model already exists, skipping"
else
    print_info "Downloading Piper model files..."
    if [ "$REMOTE_MODE" = true ]; then
        ssh "${PI_USER}@${PI_IP}" "wget --progress=bar:force -O ${PIPER_MODEL} ${PIPER_MODEL_URL}"
        ssh "${PI_USER}@${PI_IP}" "wget --progress=bar:force -O ${PIPER_CONFIG} ${PIPER_CONFIG_URL}"
    else
        wget --progress=bar:force -O "${PIPER_MODEL}" "${PIPER_MODEL_URL}"
        wget --progress=bar:force -O "${PIPER_CONFIG}" "${PIPER_CONFIG_URL}"
    fi
    print_success "Piper TTS downloaded"
fi

PIPER_SIZE=$(remote_exec "du -h ${PIPER_MODEL} | cut -f1")
print_info "Piper model size: ${PIPER_SIZE}"

# ==============================================================================
# MODEL 5: Hailo Vision Models (Optional - Requires Hailo SDK)
# ==============================================================================
print_step "Hailo Vision Models"

print_info "Vision models require compilation with Hailo Dataflow Compiler"
echo ""
echo "To compile vision models for Hailo-8L:"
echo "  1. Install Hailo Dataflow Compiler: https://hailo.ai/developer-zone/"
echo "  2. Download pre-trained models (MobileNetV2, EfficientNet)"
echo "  3. Compile to HEF format: hailo compile model.onnx"
echo "  4. Place .hef files in: ${TARGET_DIR}"
echo ""
echo "Required models:"
echo "  - skin_lesion_classifier.hef"
echo "  - plant_identifier.hef"
echo "  - wildlife_classifier.hef"
echo "  - wound_assessment.hef"
echo ""
print_info "Vision features will be unavailable without compiled HEF models"

# ==============================================================================
# Verify All Models
# ==============================================================================
print_header "VERIFICATION"

print_step "Verifying downloaded models..."

MODELS_OK=true

# Check each model
models=(
    "phi-3-mini-4k-instruct-q4_k_m.gguf:2000000000"
    "biomistral-7b-dare-q4_k_m.gguf:3500000000"
    "ggml-base.en.bin:130000000"
    "en_US-lessac-medium.onnx:50000000"
)

for model_spec in "${models[@]}"; do
    IFS=':' read -r model_name min_size <<< "$model_spec"
    model_path="${TARGET_DIR}/${model_name}"

    if remote_exec "[ -f ${model_path} ]"; then
        size=$(remote_exec "stat -f%z ${model_path} 2>/dev/null || stat -c%s ${model_path}")

        if [ "$size" -gt "$min_size" ]; then
            print_success "${model_name} ($(numfmt --to=iec $size))"
        else
            print_error "${model_name} exists but size is too small"
            MODELS_OK=false
        fi
    else
        print_error "${model_name} not found"
        MODELS_OK=false
    fi
done

# ==============================================================================
# Generate Model Checksums
# ==============================================================================
print_step "Generating model checksums..."

CHECKSUM_FILE="${TARGET_DIR}/model_checksums.json"

if [ "$REMOTE_MODE" = true ]; then
    ssh "${PI_USER}@${PI_IP}" "cd ${TARGET_DIR} && cat > model_checksums.json << 'EOF'
{
  \"generated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"models\": {
    \"phi3\": {
      \"file\": \"phi-3-mini-4k-instruct-q4_k_m.gguf\",
      \"sha256\": \"$(sha256sum phi-3-mini-4k-instruct-q4_k_m.gguf 2>/dev/null | awk '{print \$1}' || echo 'not_found')\"
    },
    \"biomistral\": {
      \"file\": \"biomistral-7b-dare-q4_k_m.gguf\",
      \"sha256\": \"$(sha256sum biomistral-7b-dare-q4_k_m.gguf 2>/dev/null | awk '{print \$1}' || echo 'not_found')\"
    },
    \"whisper\": {
      \"file\": \"ggml-base.en.bin\",
      \"sha256\": \"$(sha256sum ggml-base.en.bin 2>/dev/null | awk '{print \$1}' || echo 'not_found')\"
    },
    \"piper\": {
      \"file\": \"en_US-lessac-medium.onnx\",
      \"sha256\": \"$(sha256sum en_US-lessac-medium.onnx 2>/dev/null | awk '{print \$1}' || echo 'not_found')\"
    }
  }
}
EOF
"
else
    cd "${TARGET_DIR}"
    cat > model_checksums.json << EOF
{
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "models": {
    "phi3": {
      "file": "phi-3-mini-4k-instruct-q4_k_m.gguf",
      "sha256": "$(sha256sum phi-3-mini-4k-instruct-q4_k_m.gguf 2>/dev/null | awk '{print $1}' || echo 'not_found')"
    },
    "biomistral": {
      "file": "biomistral-7b-dare-q4_k_m.gguf",
      "sha256": "$(sha256sum biomistral-7b-dare-q4_k_m.gguf 2>/dev/null | awk '{print $1}' || echo 'not_found')"
    },
    "whisper": {
      "file": "ggml-base.en.bin",
      "sha256": "$(sha256sum ggml-base.en.bin 2>/dev/null | awk '{print $1}' || echo 'not_found')"
    },
    "piper": {
      "file": "en_US-lessac-medium.onnx",
      "sha256": "$(sha256sum en_US-lessac-medium.onnx 2>/dev/null | awk '{print $1}' || echo 'not_found')"
    }
  }
}
EOF
fi

print_success "Checksums saved to ${CHECKSUM_FILE}"

# ==============================================================================
# COMPLETION
# ==============================================================================
print_header "MODEL DOWNLOAD COMPLETE"

if [ "$MODELS_OK" = true ]; then
    print_success "All models verified successfully"
    echo ""
    echo "Models installed:"
    echo "  ✓ Phi-3-mini (General LLM)"
    echo "  ✓ BioMistral (Medical LLM)"
    echo "  ✓ Whisper (Speech-to-text)"
    echo "  ✓ Piper (Text-to-speech)"
    echo ""
    echo "Your Survival Companion is ready to run!"
    echo ""
    echo "Start the server:"
    if [ "$REMOTE_MODE" = true ]; then
        echo "  ssh ${PI_USER}@${PI_IP} 'cd ${TARGET_DIR%/personas*} && node server.js'"
    else
        echo "  cd ${PROJECT_ROOT} && node server.js"
    fi
else
    print_error "Some models failed verification"
    echo "Please check the error messages above and retry."
    exit 1
fi

echo ""
