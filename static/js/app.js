/**
 * Survival Companion - Main Application JavaScript
 * ==================================================
 * Handles all client-side functionality for the web interface.
 */

// ==============================================================================
// Global State
// ==============================================================================
const SurvivalApp = {
    state: {
        isBooted: false,
        systemState: 'not_started',
        batteryLevel: 100,
        gpsFixed: false,
        isListening: false
    },
    config: {
        pollInterval: 2000,
        apiBase: ''
    },
    intervals: {
        statusPoll: null,
        timeClock: null
    }
};

// ==============================================================================
// Initialization
// ==============================================================================
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Start time clock
    updateClock();
    SurvivalApp.intervals.timeClock = setInterval(updateClock, 1000);

    // Check initial system status
    checkSystemStatus();

    // Set up event listeners
    setupEventListeners();
}

function setupEventListeners() {
    // Voice button
    const voiceBtn = document.getElementById('voice-btn');
    if (voiceBtn) {
        voiceBtn.addEventListener('click', toggleVoiceInput);
    }

    // Voice overlay click to close
    const voiceOverlay = document.getElementById('voice-overlay');
    if (voiceOverlay) {
        voiceOverlay.addEventListener('click', function(e) {
            if (e.target === voiceOverlay) {
                hideVoiceOverlay();
            }
        });
    }
}

// ==============================================================================
// Time Display
// ==============================================================================
function updateClock() {
    const timeEl = document.getElementById('time');
    if (timeEl) {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        timeEl.textContent = `${hours}:${minutes}`;
    }
}

// ==============================================================================
// API Functions
// ==============================================================================
async function apiGet(endpoint) {
    try {
        const response = await fetch(SurvivalApp.config.apiBase + endpoint);
        return await response.json();
    } catch (error) {
        console.error(`API GET ${endpoint} failed:`, error);
        return null;
    }
}

async function apiPost(endpoint, data = {}) {
    try {
        const response = await fetch(SurvivalApp.config.apiBase + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error(`API POST ${endpoint} failed:`, error);
        return null;
    }
}

// ==============================================================================
// System Status
// ==============================================================================
async function checkSystemStatus() {
    const status = await apiGet('/api/status');

    if (status && status.is_ready) {
        SurvivalApp.state.isBooted = true;
        SurvivalApp.state.systemState = status.state;
        updateStatusBar(status);

        // Start polling for updates
        startStatusPolling();
    }
}

function startStatusPolling() {
    if (SurvivalApp.intervals.statusPoll) {
        clearInterval(SurvivalApp.intervals.statusPoll);
    }

    SurvivalApp.intervals.statusPoll = setInterval(async () => {
        const status = await apiGet('/api/status');
        if (status) {
            updateStatusBar(status);
        }
    }, SurvivalApp.config.pollInterval);
}

function updateStatusBar(status) {
    // Update system state
    const stateEl = document.getElementById('system-state');
    if (stateEl) {
        stateEl.textContent = status.state.toUpperCase();
        stateEl.className = 'status-item state-' + status.state;
    }

    // Update battery
    if (status.boot_status) {
        const batteryEl = document.getElementById('battery-percent');
        if (batteryEl) {
            batteryEl.textContent = status.boot_status.battery + '%';
        }

        // Update GPS
        const gpsEl = document.getElementById('gps-status');
        if (gpsEl) {
            gpsEl.className = status.boot_status.gps_fix
                ? 'status-item gps-fixed'
                : 'status-item gps-searching';
        }
    }
}

// ==============================================================================
// Voice Interface
// ==============================================================================
function toggleVoiceInput() {
    if (SurvivalApp.state.isListening) {
        hideVoiceOverlay();
    } else {
        showVoiceOverlay();
    }
}

function showVoiceOverlay() {
    const overlay = document.getElementById('voice-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        SurvivalApp.state.isListening = true;

        // Simulate voice recognition (in real app, this would use Web Speech API)
        document.getElementById('voice-transcript').textContent = 'Listening...';

        // For demo: auto-close after 5 seconds
        setTimeout(() => {
            if (SurvivalApp.state.isListening) {
                processVoiceCommand('show weather conditions');
            }
        }, 3000);
    }
}

function hideVoiceOverlay() {
    const overlay = document.getElementById('voice-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        SurvivalApp.state.isListening = false;
    }
}

async function processVoiceCommand(command) {
    document.getElementById('voice-transcript').textContent = `"${command}"`;

    const response = await apiPost('/api/voice/command', { command });

    if (response) {
        document.getElementById('voice-transcript').textContent = response.response;

        // Handle navigation actions
        setTimeout(() => {
            hideVoiceOverlay();

            if (response.action) {
                switch (response.action) {
                    case 'emergency':
                        window.location.href = '/emergency';
                        break;
                    case 'weather':
                        window.location.href = '/weather';
                        break;
                    case 'navigation':
                        window.location.href = '/navigation';
                        break;
                    case 'medical':
                        window.location.href = '/medical';
                        break;
                }
            }
        }, 2000);
    }
}

// ==============================================================================
// Emergency Functions
// ==============================================================================
async function activateEmergency() {
    const response = await apiPost('/api/emergency/activate');
    if (response && response.status === 'emergency_activated') {
        SurvivalApp.state.systemState = 'emergency';
        updateStatusBar({ state: 'emergency', boot_status: SurvivalApp.state });
        return true;
    }
    return false;
}

async function deactivateEmergency() {
    const response = await apiPost('/api/emergency/deactivate');
    if (response && response.status === 'emergency_deactivated') {
        SurvivalApp.state.systemState = 'ready';
        updateStatusBar({ state: 'ready', boot_status: SurvivalApp.state });
        return true;
    }
    return false;
}

// ==============================================================================
// Sensor Data
// ==============================================================================
async function loadSensorData() {
    const sensors = await apiGet('/api/sensors');

    if (sensors) {
        // Temperature
        if (sensors.temperature) {
            updateElement('temp-value', sensors.temperature.value.toFixed(1));
        }

        // Humidity
        if (sensors.humidity) {
            updateElement('humidity-value', sensors.humidity.value);
        }

        // Pressure
        if (sensors.pressure) {
            updateElement('pressure-value', sensors.pressure.value.toFixed(0));
        }

        // Heart Rate
        if (sensors.heart_rate) {
            updateElement('hr-value', sensors.heart_rate.value);
        }

        // SpO2
        if (sensors.spo2) {
            updateElement('spo2-value', sensors.spo2.value);
        }

        // Body Temperature
        if (sensors.body_temp) {
            updateElement('body-temp-value', sensors.body_temp.value.toFixed(1));
        }

        // GPS
        if (sensors.gps) {
            updateElement('lat-value', sensors.gps.latitude.toFixed(4));
            updateElement('lon-value', sensors.gps.longitude.toFixed(4));
            updateElement('alt-value', sensors.gps.altitude);

            const fixStatus = document.getElementById('gps-fix-status');
            if (fixStatus) {
                if (sensors.gps.fix) {
                    fixStatus.textContent = 'GPS Fix Acquired';
                    fixStatus.className = 'gps-status fixed';
                } else {
                    fixStatus.textContent = 'Searching for GPS fix...';
                    fixStatus.className = 'gps-status searching';
                }
            }
        }
    }

    return sensors;
}

// ==============================================================================
// Utility Functions
// ==============================================================================
function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function formatCoordinate(value, type) {
    const direction = type === 'lat'
        ? (value >= 0 ? 'N' : 'S')
        : (value >= 0 ? 'E' : 'W');
    return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

// ==============================================================================
// Night Mode
// ==============================================================================
function toggleNightMode() {
    document.body.classList.toggle('night-mode');
    const isNightMode = document.body.classList.contains('night-mode');
    localStorage.setItem('nightMode', isNightMode);
}

function checkNightMode() {
    const isNightMode = localStorage.getItem('nightMode') === 'true';
    if (isNightMode) {
        document.body.classList.add('night-mode');
    }
}

// Check night mode on load
checkNightMode();

// ==============================================================================
// Export for use in templates
// ==============================================================================
window.SurvivalApp = SurvivalApp;
window.loadSensorData = loadSensorData;
window.activateEmergency = activateEmergency;
window.deactivateEmergency = deactivateEmergency;
window.toggleNightMode = toggleNightMode;
