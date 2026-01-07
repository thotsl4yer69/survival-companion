"""
Survival Companion - Web Interface
==================================
Flask-based web interface for testing and development.
Provides a simulated touchscreen dashboard and API endpoints.
"""

import os
import sys
import json
import time
import logging
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_cors import CORS

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from personas.survival.survival_persona import SurvivalPersona, SystemState

# ==============================================================================
# Flask Application
# ==============================================================================

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# Global persona instance
persona = None
boot_log = []

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("WebUI")


# ==============================================================================
# Boot Callbacks
# ==============================================================================

def on_boot_progress(step_name, boot_status):
    """Callback for boot progress updates."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    boot_log.append({
        "time": timestamp,
        "step": step_name,
        "status": "in_progress"
    })
    logger.info(f"Boot progress: {step_name}")


def on_state_change(status):
    """Callback for system state changes."""
    logger.info(f"State changed to: {status['state']}")


# ==============================================================================
# Routes - Pages
# ==============================================================================

@app.route('/')
def index():
    """Main dashboard page."""
    return render_template('index.html')


@app.route('/emergency')
def emergency_page():
    """Emergency SOS page."""
    return render_template('emergency.html')


@app.route('/navigation')
def navigation_page():
    """Navigation/map page."""
    return render_template('navigation.html')


@app.route('/medical')
def medical_page():
    """Medical protocols page."""
    return render_template('medical.html')


@app.route('/weather')
def weather_page():
    """Weather dashboard page."""
    return render_template('weather.html')


@app.route('/settings')
def settings_page():
    """Settings page."""
    return render_template('settings.html')


# ==============================================================================
# Routes - API
# ==============================================================================

@app.route('/api/status')
def api_status():
    """Get current system status."""
    if persona:
        status = persona.get_status()
        status['boot_log'] = boot_log
        return jsonify(status)
    return jsonify({"error": "System not initialized", "state": "not_started"})


@app.route('/api/boot', methods=['POST'])
def api_boot():
    """Start the boot sequence."""
    global persona, boot_log

    boot_log = []

    # Create new persona instance
    persona = SurvivalPersona()
    persona.add_boot_callback(on_boot_progress)
    persona.add_state_callback(on_state_change)

    # Run boot in a separate thread to not block
    def run_boot():
        try:
            persona.boot(simulate=True)
        except Exception as e:
            logger.error(f"Boot error: {e}")

    thread = threading.Thread(target=run_boot)
    thread.start()

    return jsonify({"message": "Boot sequence started", "status": "booting"})


@app.route('/api/boot/status')
def api_boot_status():
    """Get detailed boot status."""
    if persona:
        boot_status = persona.boot_status
        return jsonify({
            "display_initialized": boot_status.display_initialized,
            "sensors_initialized": boot_status.sensors_initialized,
            "gps_initialized": boot_status.gps_initialized,
            "i2c_devices": boot_status.i2c_devices_detected,
            "llm_warming_up": boot_status.llm_warming_up,
            "llm_ready": boot_status.llm_ready,
            "wake_word_active": boot_status.wake_word_active,
            "dashboard_ready": boot_status.dashboard_ready,
            "battery_level": boot_status.battery_level,
            "gps_fix": boot_status.gps_fix,
            "errors": boot_status.errors,
            "boot_log": boot_log,
            "boot_time": boot_status.boot_complete_time - boot_status.boot_start_time if boot_status.boot_complete_time else 0
        })
    return jsonify({"error": "System not initialized"})


@app.route('/api/sensors')
def api_sensors():
    """Get sensor readings."""
    if persona:
        # Return simulated sensor readings
        return jsonify({
            "temperature": {
                "value": 23.5,
                "unit": "C",
                "source": "BME280"
            },
            "humidity": {
                "value": 65,
                "unit": "%",
                "source": "BME280"
            },
            "pressure": {
                "value": 1013.25,
                "unit": "hPa",
                "source": "BME280"
            },
            "heart_rate": {
                "value": 72,
                "unit": "bpm",
                "source": "MAX30102"
            },
            "spo2": {
                "value": 98,
                "unit": "%",
                "source": "MAX30102"
            },
            "body_temp": {
                "value": 36.8,
                "unit": "C",
                "source": "MLX90614"
            },
            "gps": {
                "latitude": -33.8688,
                "longitude": 151.2093,
                "altitude": 58,
                "fix": persona.sensor_status.gps_fix if persona else False
            }
        })
    return jsonify({"error": "System not initialized"})


@app.route('/api/battery', methods=['GET', 'POST'])
def api_battery():
    """Get or set battery level."""
    if request.method == 'POST':
        if persona:
            data = request.get_json()
            level = data.get('level', 100)
            persona.set_battery_level(level)
            return jsonify({"battery_level": persona.boot_status.battery_level})
        return jsonify({"error": "System not initialized"})

    if persona:
        return jsonify({"battery_level": persona.boot_status.battery_level})
    return jsonify({"battery_level": 100})


@app.route('/api/emergency/activate', methods=['POST'])
def api_emergency_activate():
    """Activate emergency SOS mode."""
    if persona:
        persona.state = SystemState.EMERGENCY
        return jsonify({
            "status": "emergency_activated",
            "gps": {
                "latitude": persona.sensor_status.latitude,
                "longitude": persona.sensor_status.longitude
            },
            "message": "SOS beacon activated. Broadcasting position."
        })
    return jsonify({"error": "System not initialized"})


@app.route('/api/emergency/deactivate', methods=['POST'])
def api_emergency_deactivate():
    """Deactivate emergency mode."""
    if persona:
        persona.state = SystemState.READY
        return jsonify({"status": "emergency_deactivated"})
    return jsonify({"error": "System not initialized"})


@app.route('/api/voice/command', methods=['POST'])
def api_voice_command():
    """Process a voice command (simulated)."""
    data = request.get_json()
    command = data.get('command', '')

    # Simple command processing for testing
    response = {
        "recognized": command,
        "confidence": 0.95,
        "response": f"Processing command: {command}",
        "action": None
    }

    # Basic command routing
    command_lower = command.lower()
    if "emergency" in command_lower or "sos" in command_lower or "help" in command_lower:
        response["action"] = "emergency"
        response["response"] = "Activating emergency mode. SOS beacon enabled."
    elif "weather" in command_lower:
        response["action"] = "weather"
        response["response"] = "Current conditions: 23.5C, 65% humidity, 1013 hPa. No storms expected."
    elif "location" in command_lower or "where" in command_lower:
        response["action"] = "navigation"
        response["response"] = "Your current position is being displayed on the map."
    elif "medical" in command_lower or "first aid" in command_lower:
        response["action"] = "medical"
        response["response"] = "Opening medical protocols. What injury or condition do you need help with?"

    return jsonify(response)


# ==============================================================================
# Static Files
# ==============================================================================

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files."""
    return send_from_directory('static', filename)


# ==============================================================================
# Error Handlers
# ==============================================================================

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({"error": "Internal server error"}), 500


# ==============================================================================
# Main
# ==============================================================================

if __name__ == '__main__':
    # Create templates and static directories
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static/css', exist_ok=True)
    os.makedirs('static/js', exist_ok=True)

    print("\n" + "=" * 60)
    print("SURVIVAL COMPANION - Web Interface")
    print("=" * 60)
    print("Starting development server...")
    print("Open http://localhost:5000 in your browser")
    print("=" * 60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=True)
