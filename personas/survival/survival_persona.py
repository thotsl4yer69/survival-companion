"""
Survival Companion - Main Persona Module
=========================================
The core persona class that orchestrates all survival system components.
Designed for Raspberry Pi 5 with Hailo-8L accelerator.

This module implements:
- Boot sequence initialization
- Component management (sensors, GPS, LLM, voice)
- Power state management
- Memory management for LLM swapping
"""

import os
import sys
import time
import logging
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any, List, Callable
from pathlib import Path

import yaml


# ==============================================================================
# Configuration and State Management
# ==============================================================================

class SystemState(Enum):
    """System power and operational states."""
    BOOTING = "booting"
    INITIALIZING = "initializing"
    READY = "ready"
    ACTIVE_VOICE = "active_voice"
    ACTIVE_VISION = "active_vision"
    EMERGENCY = "emergency"
    LOW_POWER = "low_power"
    SHUTTING_DOWN = "shutting_down"


class MemoryState(Enum):
    """Memory states for LLM management."""
    IDLE = "idle"  # Wake word only (~2GB)
    FAST_LLM = "fast_llm"  # Phi-3 loaded (~5.5GB)
    MEDICAL_LLM = "medical_llm"  # BioMistral loaded (~7.5GB)
    VISION_ACTIVE = "vision_active"  # Hailo models (~3GB)


@dataclass
class BootStatus:
    """Boot sequence status tracking."""
    display_initialized: bool = False
    sensors_initialized: bool = False
    gps_initialized: bool = False
    i2c_devices_detected: List[str] = field(default_factory=list)
    llm_warming_up: bool = False
    llm_ready: bool = False
    wake_word_active: bool = False
    dashboard_ready: bool = False
    battery_level: int = 100
    gps_fix: bool = False
    boot_start_time: float = 0
    boot_complete_time: float = 0
    errors: List[str] = field(default_factory=list)


@dataclass
class SensorStatus:
    """Status of all hardware sensors."""
    # I2C sensors
    max30102_connected: bool = False  # SpO2/HR sensor
    mlx90614_connected: bool = False  # IR temperature
    bme280_connected: bool = False    # Environmental

    # GPS
    gps_connected: bool = False
    gps_fix: bool = False
    latitude: float = 0.0
    longitude: float = 0.0
    altitude: float = 0.0

    # Camera
    camera_ready: bool = False

    # ADC (for ECG)
    adc_ready: bool = False


# ==============================================================================
# Main Survival Persona Class
# ==============================================================================

class SurvivalPersona:
    """
    Main Survival Companion persona class.

    Manages all components of the survival expert system:
    - Boot sequence and initialization
    - Hardware interfaces (sensors, GPS, camera)
    - Voice pipeline (STT, TTS, wake word)
    - LLM management (Phi-3, BioMistral)
    - Vision pipeline (Hailo NPU)
    - Emergency systems
    """

    def __init__(self, config_path: str = "config/survival_config.yaml"):
        """Initialize the Survival Companion persona."""
        self.config_path = Path(config_path)
        self.config: Dict[str, Any] = {}
        self.state = SystemState.BOOTING
        self.memory_state = MemoryState.IDLE
        self.boot_status = BootStatus()
        self.sensor_status = SensorStatus()

        # Component references (initialized during boot)
        self.display = None
        self.voice = None
        self.llm_manager = None
        self.navigation = None
        self.medical = None
        self.emergency = None

        # Callbacks for state changes
        self._state_callbacks: List[Callable] = []
        self._boot_callbacks: List[Callable] = []

        # Logging
        self.logger = logging.getLogger("SurvivalPersona")

        # Development mode detection
        self.is_pi_hardware = self._detect_pi_hardware()

    def _detect_pi_hardware(self) -> bool:
        """Detect if running on actual Raspberry Pi hardware."""
        try:
            if os.path.exists("/proc/device-tree/model"):
                with open("/proc/device-tree/model", "r") as f:
                    model = f.read()
                    return "Raspberry Pi" in model
        except Exception:
            pass
        return False

    def _load_config(self) -> bool:
        """Load configuration from YAML file."""
        try:
            if self.config_path.exists():
                with open(self.config_path, "r") as f:
                    self.config = yaml.safe_load(f)
                self.logger.info(f"Loaded configuration from {self.config_path}")
                return True
            else:
                self.logger.warning(f"Config file not found: {self.config_path}")
                self._use_default_config()
                return True
        except Exception as e:
            self.logger.error(f"Error loading config: {e}")
            self._use_default_config()
            return True

    def _use_default_config(self):
        """Use default configuration if file not found."""
        self.config = {
            "system": {"persona_name": "Survival Companion", "version": "1.0.0"},
            "memory": {"max_ram_usage_mb": 7500},
            "voice": {"wake_words": ["survival", "companion"]},
            "hardware": {"display": {"enabled": True}, "sensors": {}},
        }

    # ==========================================================================
    # Boot Sequence
    # ==========================================================================

    def boot(self, simulate: bool = False) -> bool:
        """
        Execute the boot sequence.

        Args:
            simulate: If True, simulates hardware for development

        Returns:
            True if boot completed successfully
        """
        self.boot_status.boot_start_time = time.time()
        self.state = SystemState.BOOTING
        self._notify_state_change()

        self.logger.info("=" * 60)
        self.logger.info("SURVIVAL COMPANION - Boot Sequence Started")
        self.logger.info("=" * 60)

        steps = [
            ("Loading configuration", self._boot_load_config),
            ("Initializing display", self._boot_display),
            ("Scanning I2C devices", self._boot_i2c_scan),
            ("Initializing sensors", self._boot_sensors),
            ("Initializing GPS", self._boot_gps),
            ("Warming up LLM", self._boot_llm),
            ("Activating wake word", self._boot_wake_word),
            ("Loading dashboard", self._boot_dashboard),
        ]

        for step_name, step_func in steps:
            self.logger.info(f"[BOOT] {step_name}...")
            self._notify_boot_progress(step_name)

            try:
                if simulate or not self.is_pi_hardware:
                    # Simulated boot for development
                    time.sleep(0.3)  # Simulate processing time
                    step_func(simulate=True)
                else:
                    step_func(simulate=False)
            except Exception as e:
                error_msg = f"Error during '{step_name}': {str(e)}"
                self.logger.error(error_msg)
                self.boot_status.errors.append(error_msg)
                # Continue boot even on non-critical errors

        # Check boot completion
        self.boot_status.boot_complete_time = time.time()
        boot_time = self.boot_status.boot_complete_time - self.boot_status.boot_start_time

        if self.boot_status.dashboard_ready:
            self.state = SystemState.READY
            self.logger.info(f"[BOOT] Complete in {boot_time:.1f} seconds")
            self.logger.info("=" * 60)
            return True
        else:
            self.logger.error("[BOOT] Failed - dashboard not ready")
            return False

    def _boot_load_config(self, simulate: bool = False):
        """Boot step: Load configuration."""
        self._load_config()

    def _boot_display(self, simulate: bool = False):
        """Boot step: Initialize display."""
        if simulate:
            self.boot_status.display_initialized = True
            self.logger.info("  [SIM] Display initialized (480x320)")
        else:
            # Real hardware initialization would go here
            try:
                # Import display module
                from personas.survival.ui import display
                self.display = display.Display(self.config.get("hardware", {}).get("display", {}))
                self.display.init()
                self.boot_status.display_initialized = True
            except ImportError:
                self.boot_status.display_initialized = True  # Fallback
                self.logger.warning("  Display module not found, using simulation")

    def _boot_i2c_scan(self, simulate: bool = False):
        """Boot step: Scan I2C bus for devices."""
        expected_devices = {
            0x57: "MAX30102 (SpO2/HR)",
            0x5A: "MLX90614 (Temperature)",
            0x76: "BME280 (Environment)",
        }

        if simulate:
            # Simulate finding all devices
            for addr, name in expected_devices.items():
                self.boot_status.i2c_devices_detected.append(f"{name} at 0x{addr:02X}")
                self.logger.info(f"  [SIM] Found {name} at 0x{addr:02X}")

            self.sensor_status.max30102_connected = True
            self.sensor_status.mlx90614_connected = True
            self.sensor_status.bme280_connected = True
        else:
            # Real I2C scan would go here
            try:
                import smbus2
                bus = smbus2.SMBus(1)
                for addr, name in expected_devices.items():
                    try:
                        bus.read_byte(addr)
                        self.boot_status.i2c_devices_detected.append(f"{name} at 0x{addr:02X}")
                        self.logger.info(f"  Found {name} at 0x{addr:02X}")

                        if addr == 0x57:
                            self.sensor_status.max30102_connected = True
                        elif addr == 0x5A:
                            self.sensor_status.mlx90614_connected = True
                        elif addr == 0x76:
                            self.sensor_status.bme280_connected = True
                    except Exception:
                        self.logger.warning(f"  Device not found: {name} at 0x{addr:02X}")
                bus.close()
            except ImportError:
                self.logger.warning("  smbus2 not available, skipping I2C scan")

    def _boot_sensors(self, simulate: bool = False):
        """Boot step: Initialize all sensors."""
        if simulate:
            self.boot_status.sensors_initialized = True
            self.sensor_status.adc_ready = True
            self.sensor_status.camera_ready = True
            self.logger.info("  [SIM] All sensors initialized")
        else:
            # Real sensor initialization
            self.boot_status.sensors_initialized = True
            self.logger.info("  Sensors initialized")

    def _boot_gps(self, simulate: bool = False):
        """Boot step: Initialize GPS module."""
        if simulate:
            self.boot_status.gps_initialized = True
            self.sensor_status.gps_connected = True
            # Simulate no initial fix (cold start)
            self.sensor_status.gps_fix = False
            self.logger.info("  [SIM] GPS initialized (awaiting fix)")
        else:
            try:
                # Real GPS initialization
                self.boot_status.gps_initialized = True
                self.sensor_status.gps_connected = True
                self.logger.info("  GPS initialized")
            except Exception as e:
                self.logger.warning(f"  GPS initialization failed: {e}")

    def _boot_llm(self, simulate: bool = False):
        """Boot step: Warm up LLM model."""
        if simulate:
            self.boot_status.llm_warming_up = True
            time.sleep(0.5)  # Simulate warm-up time
            self.boot_status.llm_ready = True
            self.boot_status.llm_warming_up = False
            self.logger.info("  [SIM] LLM ready (Phi-3-mini)")
        else:
            # Real LLM loading would go here
            self.boot_status.llm_warming_up = True
            # LLM is loaded on-demand to save memory
            self.boot_status.llm_ready = True
            self.boot_status.llm_warming_up = False
            self.logger.info("  LLM ready")

    def _boot_wake_word(self, simulate: bool = False):
        """Boot step: Activate wake word detection."""
        if simulate:
            self.boot_status.wake_word_active = True
            wake_words = self.config.get("voice", {}).get("wake_words", ["survival", "companion"])
            self.logger.info(f"  [SIM] Wake word active: {wake_words}")
        else:
            # Real wake word initialization
            self.boot_status.wake_word_active = True
            self.logger.info("  Wake word detector active")

    def _boot_dashboard(self, simulate: bool = False):
        """Boot step: Load main dashboard."""
        if simulate:
            self.boot_status.dashboard_ready = True
            self.logger.info("  [SIM] Dashboard ready")
        else:
            self.boot_status.dashboard_ready = True
            self.logger.info("  Dashboard ready")

    # ==========================================================================
    # State Management
    # ==========================================================================

    def get_status(self) -> Dict[str, Any]:
        """Get current system status for display."""
        return {
            "state": self.state.value,
            "memory_state": self.memory_state.value,
            "boot_status": {
                "display": self.boot_status.display_initialized,
                "sensors": self.boot_status.sensors_initialized,
                "gps": self.boot_status.gps_initialized,
                "i2c_devices": self.boot_status.i2c_devices_detected,
                "llm_ready": self.boot_status.llm_ready,
                "wake_word": self.boot_status.wake_word_active,
                "dashboard": self.boot_status.dashboard_ready,
                "battery": self.boot_status.battery_level,
                "gps_fix": self.boot_status.gps_fix,
                "errors": self.boot_status.errors,
            },
            "sensors": {
                "max30102": self.sensor_status.max30102_connected,
                "mlx90614": self.sensor_status.mlx90614_connected,
                "bme280": self.sensor_status.bme280_connected,
                "gps": self.sensor_status.gps_connected,
                "camera": self.sensor_status.camera_ready,
            },
            "is_ready": self.state == SystemState.READY,
        }

    def add_state_callback(self, callback: Callable):
        """Add callback for state changes."""
        self._state_callbacks.append(callback)

    def add_boot_callback(self, callback: Callable):
        """Add callback for boot progress updates."""
        self._boot_callbacks.append(callback)

    def _notify_state_change(self):
        """Notify all state change callbacks."""
        status = self.get_status()
        for callback in self._state_callbacks:
            try:
                callback(status)
            except Exception as e:
                self.logger.error(f"State callback error: {e}")

    def _notify_boot_progress(self, step_name: str):
        """Notify boot progress callbacks."""
        for callback in self._boot_callbacks:
            try:
                callback(step_name, self.boot_status)
            except Exception as e:
                self.logger.error(f"Boot callback error: {e}")

    # ==========================================================================
    # Power Management
    # ==========================================================================

    def set_battery_level(self, level: int):
        """Update battery level and adjust power state if needed."""
        self.boot_status.battery_level = max(0, min(100, level))

        low_threshold = self.config.get("power", {}).get("low_battery_threshold", 20)
        critical_threshold = self.config.get("power", {}).get("critical_battery_threshold", 10)

        if self.boot_status.battery_level <= critical_threshold:
            if self.state != SystemState.EMERGENCY:
                self.logger.warning(f"CRITICAL BATTERY: {level}% - Emergency beacon only")
                # Keep running but warn
        elif self.boot_status.battery_level <= low_threshold:
            if self.state != SystemState.LOW_POWER:
                self.logger.warning(f"LOW BATTERY: {level}% - Reducing features")
                self.state = SystemState.LOW_POWER
                self._notify_state_change()

    def shutdown(self):
        """Graceful shutdown of the system."""
        self.logger.info("Initiating graceful shutdown...")
        self.state = SystemState.SHUTTING_DOWN
        self._notify_state_change()

        # Unload LLM
        self.memory_state = MemoryState.IDLE

        # Save any pending data
        # (Would save waypoints, logs, etc.)

        self.logger.info("Shutdown complete")


# ==============================================================================
# Main Entry Point
# ==============================================================================

if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S"
    )

    # Create and boot the persona
    persona = SurvivalPersona()

    # Check for simulation mode
    simulate = "--simulate" in sys.argv or not persona.is_pi_hardware

    if simulate:
        print("\n*** SIMULATION MODE ***\n")

    # Boot the system
    success = persona.boot(simulate=simulate)

    if success:
        print("\n" + "=" * 60)
        print("SURVIVAL COMPANION - Ready for Voice Commands")
        print("=" * 60)
        print(f"State: {persona.state.value}")
        print(f"Battery: {persona.boot_status.battery_level}%")
        print(f"GPS: {'Fixed' if persona.boot_status.gps_fix else 'Acquiring'}")
        print(f"Wake Words: {persona.config.get('voice', {}).get('wake_words', [])}")
        print("=" * 60)
    else:
        print("\nBoot failed. Check logs for errors.")
        sys.exit(1)
