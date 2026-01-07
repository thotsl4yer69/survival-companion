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
        isListening: false,
        lowPowerMode: false
    },
    config: {
        pollInterval: 2000,
        apiBase: ''
    },
    intervals: {
        statusPoll: null,
        timeClock: null,
        powerPoll: null
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

    // Check power status (for low-power mode)
    checkPowerStatus();
    startPowerPolling();

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
// Font Scaling
// ==============================================================================
function setFontSize(size) {
    // Remove existing font size classes
    document.body.classList.remove('font-small', 'font-large');

    // Add new font size class (medium is default, no class needed)
    if (size === 'small') {
        document.body.classList.add('font-small');
    } else if (size === 'large') {
        document.body.classList.add('font-large');
    }
    // 'medium' uses default CSS variables

    // Persist to localStorage
    localStorage.setItem('fontSize', size);
}

function checkFontSize() {
    const savedSize = localStorage.getItem('fontSize') || 'medium';
    setFontSize(savedSize);
    return savedSize;
}

// Initialize font size on load
checkFontSize();

// ==============================================================================
// Power Management & Low-Power Mode
// ==============================================================================
async function checkPowerStatus() {
    const status = await apiGet('/api/power/status');

    if (status && status.success) {
        const isLowPower = status.low_power_mode.active;
        const batteryLevel = status.battery_level;

        // Update state
        SurvivalApp.state.lowPowerMode = isLowPower;
        SurvivalApp.state.batteryLevel = batteryLevel;

        // Update UI
        updateLowPowerUI(isLowPower, batteryLevel, status.low_power_mode);
        updateBatteryUI(batteryLevel, status.low_power_mode.critical_threshold, status.low_power_mode.warning_threshold);
    }
}

function startPowerPolling() {
    if (SurvivalApp.intervals.powerPoll) {
        clearInterval(SurvivalApp.intervals.powerPoll);
    }

    SurvivalApp.intervals.powerPoll = setInterval(checkPowerStatus, 5000); // Check every 5 seconds
}

function updateLowPowerUI(isActive, batteryLevel, lowPowerInfo) {
    // Update low-power indicator in status bar
    const indicator = document.getElementById('low-power-indicator');
    if (indicator) {
        if (isActive) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }

    // Update body class for dimmed UI
    if (isActive) {
        document.body.classList.add('low-power-mode-active');
    } else {
        document.body.classList.remove('low-power-mode-active');
    }

    // Show/create low-power banner
    let banner = document.getElementById('low-power-banner');
    if (isActive) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'low-power-banner';
            banner.className = 'low-power-banner';
            banner.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/>
                </svg>
                <span>LOW POWER MODE - Battery ${batteryLevel}% | Est. ${lowPowerInfo.estimated_runtime_hours || '--'}h remaining</span>
            `;
            document.body.insertBefore(banner, document.getElementById('main-content'));
        } else {
            banner.querySelector('span').textContent =
                `LOW POWER MODE - Battery ${batteryLevel}% | Est. ${lowPowerInfo.estimated_runtime_hours || '--'}h remaining`;
            banner.classList.remove('hidden');
        }

        // Adjust main content padding
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.style.paddingTop = 'calc(var(--status-bar-height) + 40px)';
        }
    } else {
        if (banner) {
            banner.classList.add('hidden');
        }

        // Reset main content padding
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.style.paddingTop = '';
        }
    }
}

function updateBatteryUI(level, criticalThreshold, warningThreshold) {
    const batteryStatus = document.getElementById('battery-status');
    const batteryPercent = document.getElementById('battery-percent');

    if (batteryPercent) {
        batteryPercent.textContent = `${level}%`;
    }

    if (batteryStatus) {
        batteryStatus.classList.remove('critical', 'low');

        if (level <= criticalThreshold) {
            batteryStatus.classList.add('critical');
        } else if (level <= warningThreshold) {
            batteryStatus.classList.add('low');
        }
    }
}

// ==============================================================================
// Export for use in templates
// ==============================================================================
window.SurvivalApp = SurvivalApp;
window.loadSensorData = loadSensorData;
window.activateEmergency = activateEmergency;
window.deactivateEmergency = deactivateEmergency;
window.toggleNightMode = toggleNightMode;
window.checkPowerStatus = checkPowerStatus;
window.setFontSize = setFontSize;
window.checkFontSize = checkFontSize;
