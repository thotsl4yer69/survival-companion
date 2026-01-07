/**
 * Survival Companion - Node.js Express Server
 * ============================================
 * Web interface for testing and development.
 * Provides simulated hardware interfaces and boot sequence.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Explicit static file routes
app.get('/static/css/:file', (req, res) => {
    const filePath = join(__dirname, 'static', 'css', req.params.file);
    console.log('CSS request for:', filePath, 'exists:', fs.existsSync(filePath));
    if (fs.existsSync(filePath)) {
        res.type('text/css').send(fs.readFileSync(filePath, 'utf8'));
    } else {
        res.status(404).send('File not found: ' + filePath);
    }
});

app.get('/static/js/:file', (req, res) => {
    const filePath = join(__dirname, 'static', 'js', req.params.file);
    if (fs.existsSync(filePath)) {
        res.type('application/javascript').send(fs.readFileSync(filePath, 'utf8'));
    } else {
        res.status(404).send('File not found');
    }
});

// General static files
app.use('/static', express.static(join(__dirname, 'static')));

// ==============================================================================
// Global State
// ==============================================================================
const systemState = {
    state: 'not_started',
    memoryState: 'idle',
    bootStatus: {
        display_initialized: false,
        sensors_initialized: false,
        gps_initialized: false,
        i2c_devices_detected: [],
        llm_warming_up: false,
        llm_ready: false,
        wake_word_active: false,
        dashboard_ready: false,
        battery_level: 100,
        gps_fix: false,
        errors: []
    },
    sensors: {
        max30102: false,
        mlx90614: false,
        bme280: false,
        gps: false,
        camera: false
    },
    bootLog: []
};

// Simulated sensor data
const sensorData = {
    temperature: { value: 23.5, unit: 'C', source: 'BME280' },
    humidity: { value: 65, unit: '%', source: 'BME280' },
    pressure: { value: 1013.25, unit: 'hPa', source: 'BME280' },
    heart_rate: { value: 72, unit: 'bpm', source: 'MAX30102' },
    spo2: { value: 98, unit: '%', source: 'MAX30102' },
    body_temp: { value: 36.8, unit: 'C', source: 'MLX90614' },
    gps: {
        latitude: -33.8688,
        longitude: 151.2093,
        altitude: 58,
        fix: false
    }
};

// ==============================================================================
// Template Engine (Simple)
// ==============================================================================
function renderTemplate(templateName, data = {}) {
    const templatePath = join(__dirname, 'templates', templateName);
    let html = fs.readFileSync(templatePath, 'utf8');

    // Simple variable replacement
    for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    }

    // Handle extends
    const extendsMatch = html.match(/\{% extends ["'](.+?)["'] %\}/);
    if (extendsMatch) {
        const basePath = join(__dirname, 'templates', extendsMatch[1]);
        let baseHtml = fs.readFileSync(basePath, 'utf8');

        // Extract blocks from child template
        const blockRegex = /\{% block (\w+) %\}([\s\S]*?)\{% endblock %\}/g;
        const blocks = {};
        let match;
        while ((match = blockRegex.exec(html)) !== null) {
            blocks[match[1]] = match[2];
        }

        // Replace blocks in base template
        for (const [blockName, content] of Object.entries(blocks)) {
            baseHtml = baseHtml.replace(
                new RegExp(`\\{% block ${blockName} %\\}[\\s\\S]*?\\{% endblock %\\}`, 'g'),
                content
            );
        }

        // Clean up remaining empty blocks
        baseHtml = baseHtml.replace(/\{% block \w+ %\}\{% endblock %\}/g, '');

        html = baseHtml;
    }

    // Clean up Jinja syntax that wasn't processed
    html = html.replace(/\{%[\s\S]*?%\}/g, '');
    html = html.replace(/\{\{[\s\S]*?\}\}/g, '');

    return html;
}

// ==============================================================================
// Page Routes
// ==============================================================================
app.get('/', (req, res) => {
    try {
        const html = renderTemplate('index.html');
        res.send(html);
    } catch (error) {
        console.error('Template error:', error);
        res.status(500).send('Template error: ' + error.message);
    }
});

app.get('/emergency', (req, res) => {
    try {
        const html = renderTemplate('emergency.html');
        res.send(html);
    } catch (error) {
        res.status(500).send('Template error: ' + error.message);
    }
});

app.get('/navigation', (req, res) => {
    try {
        const html = renderTemplate('navigation.html');
        res.send(html);
    } catch (error) {
        res.status(500).send('Template error: ' + error.message);
    }
});

app.get('/medical', (req, res) => {
    try {
        const html = renderTemplate('medical.html');
        res.send(html);
    } catch (error) {
        res.status(500).send('Template error: ' + error.message);
    }
});

app.get('/weather', (req, res) => {
    try {
        const html = renderTemplate('weather.html');
        res.send(html);
    } catch (error) {
        res.status(500).send('Template error: ' + error.message);
    }
});

app.get('/settings', (req, res) => {
    try {
        const html = renderTemplate('settings.html');
        res.send(html);
    } catch (error) {
        res.status(500).send('Template error: ' + error.message);
    }
});

// ==============================================================================
// API Routes
// ==============================================================================

// Get system status
app.get('/api/status', (req, res) => {
    res.json({
        state: systemState.state,
        memory_state: systemState.memoryState,
        boot_status: {
            display: systemState.bootStatus.display_initialized,
            sensors: systemState.bootStatus.sensors_initialized,
            gps: systemState.bootStatus.gps_initialized,
            i2c_devices: systemState.bootStatus.i2c_devices_detected,
            llm_ready: systemState.bootStatus.llm_ready,
            wake_word: systemState.bootStatus.wake_word_active,
            dashboard: systemState.bootStatus.dashboard_ready,
            battery: systemState.bootStatus.battery_level,
            gps_fix: systemState.bootStatus.gps_fix,
            errors: systemState.bootStatus.errors
        },
        sensors: systemState.sensors,
        is_ready: systemState.state === 'ready',
        boot_log: systemState.bootLog
    });
});

// Start boot sequence
app.post('/api/boot', async (req, res) => {
    // Reset state
    systemState.bootLog = [];
    systemState.state = 'booting';

    res.json({ message: 'Boot sequence started', status: 'booting' });

    // Run boot sequence asynchronously
    runBootSequence();
});

// Get boot status
app.get('/api/boot/status', (req, res) => {
    res.json({
        display_initialized: systemState.bootStatus.display_initialized,
        sensors_initialized: systemState.bootStatus.sensors_initialized,
        gps_initialized: systemState.bootStatus.gps_initialized,
        i2c_devices: systemState.bootStatus.i2c_devices_detected,
        llm_warming_up: systemState.bootStatus.llm_warming_up,
        llm_ready: systemState.bootStatus.llm_ready,
        wake_word_active: systemState.bootStatus.wake_word_active,
        dashboard_ready: systemState.bootStatus.dashboard_ready,
        battery_level: systemState.bootStatus.battery_level,
        gps_fix: systemState.bootStatus.gps_fix,
        errors: systemState.bootStatus.errors,
        boot_log: systemState.bootLog,
        boot_time: 0
    });
});

// Get sensor readings
app.get('/api/sensors', (req, res) => {
    // Add some variation to sensor data
    const data = {
        ...sensorData,
        temperature: {
            ...sensorData.temperature,
            value: 23.5 + (Math.random() - 0.5)
        },
        humidity: {
            ...sensorData.humidity,
            value: Math.round(65 + (Math.random() - 0.5) * 2)
        },
        pressure: {
            ...sensorData.pressure,
            value: 1013.25 + (Math.random() - 0.5) * 2
        },
        heart_rate: {
            ...sensorData.heart_rate,
            value: Math.round(72 + (Math.random() - 0.5) * 4)
        },
        gps: {
            ...sensorData.gps,
            fix: systemState.bootStatus.gps_fix
        }
    };
    res.json(data);
});

// ==============================================================================
// Weather / Pressure History and Storm Prediction
// ==============================================================================

// Pressure history for trend analysis (3-hour window)
const pressureHistory = [];
const PRESSURE_HISTORY_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours
const PRESSURE_SAMPLE_INTERVAL_MS = 60 * 1000; // Sample every minute

// Storm alert state
let activeStormAlert = null;
let pressureRecordingInterval = null;

// Storm thresholds
const STORM_THRESHOLDS = {
    minor: { drop_per_hour: 2, severity: 'minor', message: 'Slight pressure drop detected - weather may change' },
    moderate: { drop_per_hour: 4, severity: 'moderate', message: 'Moderate pressure drop - storm possible in next few hours' },
    severe: { drop_per_hour: 6, severity: 'severe', message: 'Rapid pressure drop - storm likely imminent, seek shelter!' },
    extreme: { drop_per_hour: 10, severity: 'extreme', message: 'EXTREME pressure drop - severe storm approaching, take cover immediately!' }
};

// Initialize pressure recording
function startPressureRecording() {
    if (pressureRecordingInterval) {
        clearInterval(pressureRecordingInterval);
    }

    // Record initial pressure
    recordPressure();

    // Record every minute
    pressureRecordingInterval = setInterval(recordPressure, PRESSURE_SAMPLE_INTERVAL_MS);
}

function recordPressure() {
    const currentPressure = sensorData.pressure.value + (Math.random() - 0.5) * 2;
    const timestamp = Date.now();

    pressureHistory.push({
        timestamp,
        pressure: currentPressure
    });

    // Remove old entries (older than 3 hours)
    const cutoff = timestamp - PRESSURE_HISTORY_DURATION_MS;
    while (pressureHistory.length > 0 && pressureHistory[0].timestamp < cutoff) {
        pressureHistory.shift();
    }

    // Check for storm conditions
    checkForStorm();
}

function checkForStorm() {
    if (pressureHistory.length < 2) return;

    // Calculate pressure change over the last hour (or available time)
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Find the earliest reading within the last hour
    let earliestReading = null;
    for (const reading of pressureHistory) {
        if (reading.timestamp >= oneHourAgo) {
            earliestReading = reading;
            break;
        }
    }

    if (!earliestReading) {
        earliestReading = pressureHistory[0];
    }

    const latestReading = pressureHistory[pressureHistory.length - 1];
    const timeSpanHours = (latestReading.timestamp - earliestReading.timestamp) / (60 * 60 * 1000);

    if (timeSpanHours < 0.1) return; // Need at least some time span

    const pressureChange = latestReading.pressure - earliestReading.pressure;
    const pressureChangePerHour = pressureChange / timeSpanHours;

    // Check thresholds (negative values = pressure drop = potential storm)
    let newAlert = null;

    if (pressureChangePerHour <= -STORM_THRESHOLDS.extreme.drop_per_hour) {
        newAlert = createStormAlert('extreme', pressureChangePerHour, latestReading.pressure);
    } else if (pressureChangePerHour <= -STORM_THRESHOLDS.severe.drop_per_hour) {
        newAlert = createStormAlert('severe', pressureChangePerHour, latestReading.pressure);
    } else if (pressureChangePerHour <= -STORM_THRESHOLDS.moderate.drop_per_hour) {
        newAlert = createStormAlert('moderate', pressureChangePerHour, latestReading.pressure);
    } else if (pressureChangePerHour <= -STORM_THRESHOLDS.minor.drop_per_hour) {
        newAlert = createStormAlert('minor', pressureChangePerHour, latestReading.pressure);
    }

    // Only update alert if severity increased or no previous alert
    if (newAlert) {
        if (!activeStormAlert ||
            getSeverityRank(newAlert.severity) > getSeverityRank(activeStormAlert.severity)) {
            activeStormAlert = newAlert;
            console.log(`Storm alert: ${newAlert.severity} - ${newAlert.message}`);
        }
    } else if (activeStormAlert && pressureChangePerHour > -1) {
        // Clear alert if pressure stabilized
        console.log('Storm alert cleared - pressure stabilized');
        activeStormAlert = null;
    }
}

function getSeverityRank(severity) {
    const ranks = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
    return ranks[severity] || 0;
}

function createStormAlert(severity, changePerHour, currentPressure) {
    const threshold = STORM_THRESHOLDS[severity];
    return {
        severity,
        message: threshold.message,
        pressure_change_per_hour: changePerHour.toFixed(1),
        current_pressure: currentPressure.toFixed(1),
        timestamp: new Date().toISOString(),
        recommended_action: getRecommendedAction(severity),
        audio_alert: severity === 'severe' || severity === 'extreme'
    };
}

function getRecommendedAction(severity) {
    switch (severity) {
        case 'minor':
            return 'Monitor conditions. Consider adjusting travel plans if weather worsens.';
        case 'moderate':
            return 'Prepare for weather change. Identify shelter options. Secure loose items.';
        case 'severe':
            return 'Seek shelter immediately. Avoid exposed areas. Stay away from trees and water.';
        case 'extreme':
            return 'TAKE COVER NOW. Move to the lowest, most protected area available. Stay away from windows.';
        default:
            return 'Monitor weather conditions.';
    }
}

// Start pressure recording on server start
startPressureRecording();

// Get weather with storm alerts
app.get('/api/weather', (req, res) => {
    const currentPressure = sensorData.pressure.value + (Math.random() - 0.5) * 2;
    const currentTemp = sensorData.temperature.value + (Math.random() - 0.5);
    const currentHumidity = Math.round(sensorData.humidity.value + (Math.random() - 0.5) * 2);

    // Calculate pressure trend
    let trend = 'stable';
    let trendChange = 0;

    if (pressureHistory.length >= 2) {
        const threeHoursAgo = Date.now() - PRESSURE_HISTORY_DURATION_MS;
        const oldReading = pressureHistory.find(r => r.timestamp >= threeHoursAgo) || pressureHistory[0];
        const newReading = pressureHistory[pressureHistory.length - 1];
        trendChange = newReading.pressure - oldReading.pressure;

        if (trendChange > 1) trend = 'rising';
        else if (trendChange < -1) trend = 'falling';
    }

    // Get history for graph (last 7 points representing 3 hours)
    const historyPoints = [];
    const step = Math.max(1, Math.floor(pressureHistory.length / 7));
    for (let i = 0; i < pressureHistory.length; i += step) {
        historyPoints.push({
            timestamp: pressureHistory[i].timestamp,
            pressure: pressureHistory[i].pressure
        });
    }
    if (historyPoints.length > 7) {
        historyPoints.splice(0, historyPoints.length - 7);
    }

    res.json({
        temperature: {
            value: currentTemp,
            unit: 'C',
            source: 'BME280'
        },
        humidity: {
            value: currentHumidity,
            unit: '%',
            source: 'BME280'
        },
        pressure: {
            value: currentPressure,
            unit: 'hPa',
            source: 'BME280',
            trend,
            trend_change: trendChange.toFixed(1),
            history: historyPoints
        },
        altitude: sensorData.gps.altitude,
        storm_alert: activeStormAlert,
        timestamp: new Date().toISOString()
    });
});

// Get pressure history for detailed analysis
app.get('/api/weather/pressure-history', (req, res) => {
    res.json({
        success: true,
        history: pressureHistory,
        count: pressureHistory.length,
        oldest: pressureHistory.length > 0 ? new Date(pressureHistory[0].timestamp).toISOString() : null,
        newest: pressureHistory.length > 0 ? new Date(pressureHistory[pressureHistory.length - 1].timestamp).toISOString() : null
    });
});

// Simulate pressure drop for testing storm alerts
app.post('/api/weather/simulate-pressure-drop', (req, res) => {
    const { drop_rate } = req.body; // hPa per hour

    if (!drop_rate || typeof drop_rate !== 'number') {
        return res.status(400).json({
            success: false,
            error: 'drop_rate required (hPa per hour, positive number for drop)'
        });
    }

    // Clear existing history
    pressureHistory.length = 0;

    // Simulate 1 hour of pressure readings at the specified drop rate
    const now = Date.now();
    const startPressure = 1013.25;
    const numSamples = 60; // One per minute for an hour

    for (let i = 0; i < numSamples; i++) {
        const timestamp = now - (numSamples - i - 1) * 60 * 1000;
        const timeHours = (numSamples - i - 1) / 60;
        const pressure = startPressure - (drop_rate * (1 - timeHours));

        pressureHistory.push({
            timestamp,
            pressure: pressure + (Math.random() - 0.5) * 0.5 // Small noise
        });
    }

    // Check for storm conditions
    checkForStorm();

    res.json({
        success: true,
        message: `Simulated ${drop_rate} hPa/hour pressure drop over 1 hour`,
        samples_added: numSamples,
        current_pressure: pressureHistory[pressureHistory.length - 1].pressure.toFixed(1),
        storm_alert: activeStormAlert
    });
});

// Get current storm alert status
app.get('/api/weather/storm-alert', (req, res) => {
    res.json({
        has_alert: activeStormAlert !== null,
        alert: activeStormAlert
    });
});

// Clear storm alert manually
app.post('/api/weather/clear-alert', (req, res) => {
    const cleared = activeStormAlert !== null;
    activeStormAlert = null;

    res.json({
        success: true,
        cleared,
        message: cleared ? 'Storm alert cleared' : 'No active alert to clear'
    });
});

// ==============================================================================
// Battery Management & Low-Power Emergency Mode
// ==============================================================================

// Low-power mode state
let lowPowerState = {
    active: false,
    activated_at: null,
    auto_activated: false,
    critical_threshold: 10, // 10% battery triggers low-power mode
    warning_threshold: 20,  // 20% battery shows warning
    disabled_features: [],
    estimated_runtime_hours: null
};

// Battery level endpoint
app.get('/api/battery', (req, res) => {
    const level = systemState.bootStatus.battery_level;
    const is_critical = level <= lowPowerState.critical_threshold;
    const is_low = level <= lowPowerState.warning_threshold;

    res.json({
        battery_level: level,
        is_critical: is_critical,
        is_low: is_low,
        low_power_mode: lowPowerState.active,
        charging: false, // Simulated - would check actual charging state
        estimated_runtime_minutes: Math.round(level * 3.6), // Rough estimate: 6 hours at 100%
        warning_threshold: lowPowerState.warning_threshold,
        critical_threshold: lowPowerState.critical_threshold
    });
});

// Set battery level (for simulation/testing)
app.post('/api/battery', (req, res) => {
    const { level } = req.body;
    if (typeof level === 'number') {
        const oldLevel = systemState.bootStatus.battery_level;
        systemState.bootStatus.battery_level = Math.max(0, Math.min(100, level));

        // Check if we need to auto-activate low-power mode
        if (systemState.bootStatus.battery_level <= lowPowerState.critical_threshold &&
            oldLevel > lowPowerState.critical_threshold &&
            !lowPowerState.active) {
            // Auto-activate low-power emergency mode
            activateLowPowerMode(true);
        }

        // Check if we can deactivate low-power mode
        if (systemState.bootStatus.battery_level > lowPowerState.warning_threshold &&
            lowPowerState.active &&
            lowPowerState.auto_activated) {
            // Auto-deactivate if battery recovered and was auto-activated
            deactivateLowPowerMode();
        }
    }

    const level_now = systemState.bootStatus.battery_level;
    res.json({
        battery_level: level_now,
        is_critical: level_now <= lowPowerState.critical_threshold,
        is_low: level_now <= lowPowerState.warning_threshold,
        low_power_mode: lowPowerState.active,
        message: lowPowerState.active ? 'Battery critical - Low-power emergency mode active' : undefined
    });
});

// Low-power mode status
app.get('/api/power/status', (req, res) => {
    const level = systemState.bootStatus.battery_level;

    res.json({
        success: true,
        battery_level: level,
        low_power_mode: {
            active: lowPowerState.active,
            activated_at: lowPowerState.activated_at,
            auto_activated: lowPowerState.auto_activated,
            critical_threshold: lowPowerState.critical_threshold,
            warning_threshold: lowPowerState.warning_threshold,
            disabled_features: lowPowerState.disabled_features,
            estimated_runtime_hours: lowPowerState.estimated_runtime_hours
        },
        active_features: {
            gps_beacon: true, // Always active in low-power mode
            emergency_beacon: true, // Always active in low-power mode
            audio_beacon: lowPowerState.active ? 'reduced' : 'full',
            display: lowPowerState.active ? 'minimal' : 'full',
            sensors: lowPowerState.active ? 'essential_only' : 'all',
            llm: lowPowerState.active ? false : true,
            voice_recognition: lowPowerState.active ? false : true,
            camera: lowPowerState.active ? false : true
        }
    });
});

// Activate low-power emergency mode
app.post('/api/power/low-power/activate', (req, res) => {
    if (lowPowerState.active) {
        return res.json({
            success: true,
            already_active: true,
            message: 'Low-power emergency mode is already active'
        });
    }

    activateLowPowerMode(false);

    res.json({
        success: true,
        low_power_mode: {
            active: true,
            activated_at: lowPowerState.activated_at,
            disabled_features: lowPowerState.disabled_features,
            estimated_runtime_hours: lowPowerState.estimated_runtime_hours
        },
        message: 'Low-power emergency mode activated. Non-essential functions disabled.',
        active_features: ['GPS Beacon', 'Emergency Beacon', 'Basic Display', 'Essential Sensors']
    });
});

// Deactivate low-power emergency mode
app.post('/api/power/low-power/deactivate', (req, res) => {
    if (!lowPowerState.active) {
        return res.json({
            success: true,
            already_inactive: true,
            message: 'Low-power mode is not active'
        });
    }

    const level = systemState.bootStatus.battery_level;

    // Warn if battery is still critical
    if (level <= lowPowerState.critical_threshold) {
        return res.status(400).json({
            success: false,
            error: 'Cannot deactivate low-power mode while battery is critical',
            battery_level: level,
            message: 'Battery level must be above ' + lowPowerState.critical_threshold + '% to deactivate'
        });
    }

    deactivateLowPowerMode();

    res.json({
        success: true,
        low_power_mode: {
            active: false,
            was_active_for_seconds: Math.round((Date.now() - new Date(lowPowerState.activated_at).getTime()) / 1000)
        },
        message: 'Low-power mode deactivated. Full functionality restored.',
        battery_level: level
    });
});

// Helper function to activate low-power mode
function activateLowPowerMode(autoActivated) {
    const level = systemState.bootStatus.battery_level;

    // Calculate estimated runtime in low-power mode
    // In low-power mode, we can extend runtime by ~3x
    const baseRuntime = level * 3.6 / 60; // Base runtime in hours
    const extendedRuntime = baseRuntime * 3; // Triple in low-power mode

    lowPowerState = {
        active: true,
        activated_at: new Date().toISOString(),
        auto_activated: autoActivated,
        critical_threshold: lowPowerState.critical_threshold,
        warning_threshold: lowPowerState.warning_threshold,
        disabled_features: [
            'LLM (AI Assistant)',
            'Voice Recognition',
            'Camera',
            'Non-essential Sensors',
            'Full Display Mode',
            'Background Sync'
        ],
        estimated_runtime_hours: Math.round(extendedRuntime * 10) / 10
    };

    console.log(`LOW-POWER MODE ${autoActivated ? 'AUTO-' : ''}ACTIVATED at ${level}% battery`);
    console.log(`Estimated runtime: ${lowPowerState.estimated_runtime_hours} hours`);
}

// Helper function to deactivate low-power mode
function deactivateLowPowerMode() {
    const wasActive = lowPowerState.active;

    lowPowerState = {
        active: false,
        activated_at: null,
        auto_activated: false,
        critical_threshold: 10,
        warning_threshold: 20,
        disabled_features: [],
        estimated_runtime_hours: null
    };

    if (wasActive) {
        console.log('LOW-POWER MODE DEACTIVATED - Full functionality restored');
    }
}

// Simulate battery drain over time (for testing)
app.post('/api/battery/simulate-drain', (req, res) => {
    const { drain_to, drain_rate_percent_per_second } = req.body;
    const targetLevel = drain_to !== undefined ? drain_to : 5;
    const drainRate = drain_rate_percent_per_second || 1;

    // Start draining in background
    const drainInterval = setInterval(() => {
        if (systemState.bootStatus.battery_level > targetLevel) {
            const oldLevel = systemState.bootStatus.battery_level;
            systemState.bootStatus.battery_level = Math.max(targetLevel, systemState.bootStatus.battery_level - drainRate);

            // Check for auto low-power mode activation
            if (systemState.bootStatus.battery_level <= lowPowerState.critical_threshold &&
                oldLevel > lowPowerState.critical_threshold &&
                !lowPowerState.active) {
                activateLowPowerMode(true);
            }
        } else {
            clearInterval(drainInterval);
        }
    }, 1000);

    // Stop after 60 seconds max
    setTimeout(() => clearInterval(drainInterval), 60000);

    res.json({
        success: true,
        message: `Battery drain simulation started. Draining to ${targetLevel}% at ${drainRate}%/sec`,
        current_level: systemState.bootStatus.battery_level,
        target_level: targetLevel,
        low_power_will_activate_at: lowPowerState.critical_threshold
    });
});

// Confirmation state for critical actions
let pendingConfirmation = null;

// Last response storage for "repeat that" functionality
let lastResponse = {
    text: null,
    action: null,
    timestamp: null
};

// Hands-free navigation state
let navigationState = {
    currentPage: 'home',
    currentProtocol: null,
    currentStep: 0,
    totalSteps: 0,
    protocolSteps: [],
    touchless_mode: true
};

// Medical protocol data for hands-free guidance
const medicalProtocols = {
    cpr: {
        name: 'CPR (Cardiopulmonary Resuscitation)',
        steps: [
            { summary: 'Check responsiveness', detail: 'Tap the person\'s shoulder and shout "Are you okay?" Check for response for 5-10 seconds.' },
            { summary: 'Call for help', detail: 'Call emergency services or have someone else call. If alone with a phone, put it on speaker.' },
            { summary: 'Check breathing', detail: 'Look for chest rise and fall. Listen for breath sounds. Feel for air on your cheek. Do this for no more than 10 seconds.' },
            { summary: 'Begin chest compressions', detail: 'Place heel of one hand on center of chest, between nipples. Place other hand on top. Keep arms straight. Push hard and fast, at least 2 inches deep, at 100-120 compressions per minute.' },
            { summary: 'Give rescue breaths', detail: 'After 30 compressions, tilt head back, lift chin, pinch nose. Give 2 breaths, each lasting about 1 second. Watch for chest rise.' },
            { summary: 'Continue cycles', detail: 'Continue cycles of 30 compressions and 2 breaths. Do not stop until help arrives, an AED is available, or the person starts breathing.' }
        ]
    },
    choking: {
        name: 'Choking Response',
        steps: [
            { summary: 'Assess the situation', detail: 'Ask "Are you choking?" If they can cough or speak, encourage them to keep coughing. Only intervene if they cannot breathe, speak, or cough.' },
            { summary: 'Call for help', detail: 'Have someone call emergency services while you assist.' },
            { summary: 'Perform back blows', detail: 'Stand behind the person. Give 5 back blows between shoulder blades with heel of hand.' },
            { summary: 'Perform abdominal thrusts', detail: 'Stand behind person, wrap arms around waist. Make a fist, place thumb side against abdomen above navel. Grasp fist with other hand. Give 5 quick upward thrusts.' },
            { summary: 'Repeat cycle', detail: 'Continue alternating 5 back blows and 5 abdominal thrusts until object is expelled or person becomes unconscious.' }
        ]
    },
    bleeding: {
        name: 'Severe Bleeding Control',
        steps: [
            { summary: 'Apply direct pressure', detail: 'Use a clean cloth or bandage. Press firmly on the wound. Maintain constant pressure for at least 15 minutes.' },
            { summary: 'Elevate if possible', detail: 'If the wound is on a limb, raise it above heart level while maintaining pressure.' },
            { summary: 'Apply pressure bandage', detail: 'If bleeding continues, add more material on top - do not remove original dressing. Wrap firmly with bandage.' },
            { summary: 'Consider tourniquet', detail: 'For life-threatening limb bleeding that cannot be controlled, apply tourniquet 2-3 inches above wound. Note the time applied.' }
        ]
    }
};

// ==============================================================================
// Medical First Aid Protocol Database
// ==============================================================================

const firstAidProtocolDatabase = [
    // BEE STING - with anaphylaxis warnings
    {
        id: 1,
        category: 'poison',
        name: 'Bee Sting Treatment',
        severity: 'moderate',
        keywords: ['bee', 'sting', 'bee sting', 'wasp', 'hornet', 'insect sting', 'swelling', 'allergic'],
        summary: 'First aid for bee, wasp, and insect stings including anaphylaxis recognition',
        steps: [
            { step: 1, summary: 'Remove the stinger', detail: 'If stinger is visible, scrape it out horizontally using a flat object like a credit card or fingernail. Do NOT squeeze or use tweezers as this can inject more venom.' },
            { step: 2, summary: 'Clean the area', detail: 'Wash the sting site with soap and clean water to prevent infection.' },
            { step: 3, summary: 'Apply cold compress', detail: 'Apply a cold pack or cloth with ice wrapped in fabric for 10-20 minutes. This reduces pain and swelling.' },
            { step: 4, summary: 'Reduce swelling', detail: 'If stung on arm or leg, keep limb elevated. Consider antihistamine if available (follow package directions).' },
            { step: 5, summary: 'Monitor for allergic reaction', detail: 'Watch for signs of anaphylaxis: difficulty breathing, swelling of face/throat, dizziness, rapid heartbeat, hives spreading beyond sting site.' },
            { step: 6, summary: 'Pain management', detail: 'Over-the-counter pain relievers may help. Apply hydrocortisone cream or calamine lotion if available.' }
        ],
        warnings: [
            'CRITICAL: If person has known bee allergy, has an EpiPen, USE IT IMMEDIATELY and activate emergency SOS',
            'Watch closely for anaphylaxis signs for at least 30 minutes after sting',
            'Multiple stings (10+) can be dangerous even without allergy - seek help',
            'Stings inside mouth or throat are medical emergencies - swelling can block airway',
            'Do NOT squeeze the stinger - this injects more venom'
        ],
        anaphylaxis_escalation: {
            title: 'ANAPHYLAXIS - LIFE-THREATENING EMERGENCY',
            symptoms: [
                'Difficulty breathing or wheezing',
                'Swelling of face, lips, tongue, or throat',
                'Rapid or weak pulse',
                'Skin rash, hives spreading over body',
                'Dizziness or fainting',
                'Nausea, vomiting, or diarrhea',
                'Feeling of impending doom'
            ],
            immediate_actions: [
                'Use epinephrine auto-injector (EpiPen) if available - inject into outer thigh',
                'ACTIVATE EMERGENCY SOS IMMEDIATELY',
                'Have person lie flat with legs elevated (unless difficulty breathing)',
                'If not breathing, begin CPR',
                'Keep person calm and still',
                'Note time of sting and symptoms for rescuers'
            ]
        },
        contraindications: ['Do not apply heat', 'Do not apply mud or other folk remedies', 'Do not squeeze stinger'],
        when_to_seek_help: 'Seek immediate medical help if: any signs of anaphylaxis appear, person has known severe allergy, multiple stings (10+), sting in mouth/throat, symptoms worsen after 24 hours, or signs of infection develop'
    },
    // SNAKE BITE
    {
        id: 2,
        category: 'poison',
        name: 'Snake Bite Protocol',
        severity: 'critical',
        keywords: ['snake', 'bite', 'snake bite', 'venom', 'venomous', 'serpent'],
        summary: 'Emergency response for venomous and non-venomous snake bites',
        steps: [
            { step: 1, summary: 'Move away from snake', detail: 'Get the person and yourself to a safe distance. Do not try to capture or kill the snake - note its appearance if possible.' },
            { step: 2, summary: 'Keep calm and still', detail: 'Have the person lie down and remain as still as possible. Movement spreads venom faster through the body.' },
            { step: 3, summary: 'Remove constricting items', detail: 'Remove jewelry, watches, and tight clothing near the bite before swelling starts.' },
            { step: 4, summary: 'Position the limb', detail: 'Keep the bitten area below heart level if possible. Do NOT elevate.' },
            { step: 5, summary: 'Clean the wound gently', detail: 'If available, gently clean around the bite with water. Do not scrub or apply pressure.' },
            { step: 6, summary: 'Immobilize the limb', detail: 'Splint the limb to prevent movement. Use bandages, sticks, or clothing to keep it still.' },
            { step: 7, summary: 'Activate emergency', detail: 'ACTIVATE SOS BEACON. Time is critical - antivenom may be needed within hours.' },
            { step: 8, summary: 'Monitor vital signs', detail: 'Watch for breathing difficulties, changes in consciousness, or severe swelling. Note the time of bite.' }
        ],
        warnings: [
            'ASSUME ALL SNAKE BITES ARE VENOMOUS until proven otherwise',
            'Do NOT cut the wound or try to suck out venom',
            'Do NOT apply tourniquet - this can cause tissue death',
            'Do NOT apply ice or immerse in cold water',
            'Do NOT give alcohol or caffeine',
            'Do NOT apply electric shock',
            'Time is critical - evacuate to medical care ASAP'
        ],
        contraindications: ['No cutting the wound', 'No suction devices', 'No tourniquets', 'No ice/cold', 'No alcohol'],
        when_to_seek_help: 'ALL snake bites require professional medical evaluation. Activate SOS immediately and evacuate to hospital. Antivenom is time-sensitive.'
    },
    // HYPOTHERMIA
    {
        id: 3,
        category: 'environmental',
        name: 'Hypothermia Treatment',
        severity: 'critical',
        keywords: ['cold', 'hypothermia', 'freezing', 'shivering', 'cold exposure', 'frostbite'],
        summary: 'Recognition and treatment of cold-related emergencies',
        steps: [
            { step: 1, summary: 'Move to shelter', detail: 'Get the person out of the cold and wind into a dry, warm shelter if possible.' },
            { step: 2, summary: 'Remove wet clothing', detail: 'Gently remove any wet clothing and replace with dry layers or blankets.' },
            { step: 3, summary: 'Insulate from ground', detail: 'Place insulating material (foam pad, branches, dry leaves) between person and ground.' },
            { step: 4, summary: 'Warm the core first', detail: 'Apply warm (not hot) compresses to neck, armpits, and groin. Use body heat from another person if needed.' },
            { step: 5, summary: 'Give warm fluids', detail: 'If person is conscious and can swallow, give warm, sweet liquids. NOT alcohol.' },
            { step: 6, summary: 'Handle gently', detail: 'Move the person very gently - rough handling can cause cardiac arrest in severe hypothermia.' },
            { step: 7, summary: 'Monitor continuously', detail: 'Watch breathing and pulse. Be prepared for CPR. Hypothermic hearts are fragile.' }
        ],
        warnings: [
            'Do NOT apply direct heat to skin (heating pads, hot water bottles directly on skin)',
            'Do NOT give alcohol - it causes more heat loss',
            'Do NOT rub or massage limbs - this can cause cardiac arrest',
            'Handle very gently - sudden movements can trigger heart problems',
            'In severe hypothermia, person may appear dead - continue warming and seek help'
        ],
        contraindications: ['No alcohol', 'No direct heat application', 'No massage', 'No rough handling'],
        when_to_seek_help: 'Seek help immediately for severe hypothermia (confusion, slurred speech, loss of consciousness, very slow breathing). Mild hypothermia (shivering, alert) can be treated in field if shelter is available.'
    },
    // HEAT STROKE
    {
        id: 4,
        category: 'environmental',
        name: 'Heat Stroke Emergency',
        severity: 'critical',
        keywords: ['heat', 'stroke', 'heat stroke', 'hot', 'overheating', 'heat exhaustion', 'sun'],
        summary: 'Emergency cooling for life-threatening heat illness',
        steps: [
            { step: 1, summary: 'Move to shade/cool', detail: 'Get the person to shade or a cooler area immediately.' },
            { step: 2, summary: 'Remove excess clothing', detail: 'Remove unnecessary clothing to help cooling.' },
            { step: 3, summary: 'Cool rapidly', detail: 'Apply cold water to skin, especially neck, armpits, and groin. Use wet cloths, pour water, or immerse if possible.' },
            { step: 4, summary: 'Fan the person', detail: 'Create air movement across wet skin to maximize evaporative cooling.' },
            { step: 5, summary: 'Apply ice packs', detail: 'If available, apply ice packs to neck, armpits, and groin (major blood vessels).' },
            { step: 6, summary: 'Monitor temperature', detail: 'Continue cooling until body feels cooler. Target is to get below 39°C (102°F).' },
            { step: 7, summary: 'Hydrate if conscious', detail: 'If person is conscious and can swallow, give cool water in small sips.' }
        ],
        warnings: [
            'Heat stroke is a MEDICAL EMERGENCY - can be fatal within hours',
            'Do NOT give fluids if person is unconscious or confused',
            'Do NOT use ice water bath if person is confused - hypothermia risk',
            'Confusion, seizures, or unconsciousness indicate severe heat stroke',
            'Cool first, transport second - every minute counts'
        ],
        contraindications: ['No fluids if unconscious', 'No fever-reducing medications'],
        when_to_seek_help: 'Heat stroke requires emergency medical care. Activate SOS. Signs: body temp above 40°C (104°F), confusion, loss of consciousness, hot dry skin, seizures.'
    },
    // BURNS
    {
        id: 5,
        category: 'wound',
        name: 'Burns Treatment',
        severity: 'moderate',
        keywords: ['burn', 'burns', 'fire', 'scald', 'hot', 'blister', 'thermal'],
        summary: 'First aid for first, second, and third degree burns',
        steps: [
            { step: 1, summary: 'Stop the burning', detail: 'Remove person from heat source. If clothing is on fire: Stop, Drop, Roll. Remove smoldering clothing unless stuck to skin.' },
            { step: 2, summary: 'Cool the burn', detail: 'Run cool (not cold) water over burn for 10-20 minutes. This is the most important step.' },
            { step: 3, summary: 'Remove constrictive items', detail: 'Remove jewelry, belts, tight clothing from burned area before swelling starts.' },
            { step: 4, summary: 'Assess burn severity', detail: '1st degree: red, painful. 2nd degree: blisters. 3rd degree: white/charred, may not hurt (nerves damaged).' },
            { step: 5, summary: 'Cover the burn', detail: 'Cover loosely with clean, dry bandage or cloth. Do not wrap tightly.' },
            { step: 6, summary: 'Prevent shock', detail: 'Keep person warm (cover unburned areas), elevate burned limbs if possible.' }
        ],
        warnings: [
            'Do NOT apply ice - can cause frostbite on damaged tissue',
            'Do NOT apply butter, oil, or toothpaste',
            'Do NOT break blisters - increases infection risk',
            'Do NOT remove clothing stuck to burn',
            'Chemical burns: brush off dry chemicals, then flush with water for 20+ minutes'
        ],
        contraindications: ['No ice', 'No butter/oils', 'No breaking blisters', 'No tight bandages'],
        when_to_seek_help: 'Seek help for: burns larger than palm of hand, burns on face/hands/feet/genitals/joints, all 3rd degree burns, electrical or chemical burns, burns with difficulty breathing, burns in children or elderly.'
    },
    // FRACTURE
    {
        id: 6,
        category: 'wound',
        name: 'Fracture Immobilization',
        severity: 'moderate',
        keywords: ['fracture', 'broken', 'bone', 'break', 'crack', 'dislocation', 'sprain'],
        summary: 'Stabilization of suspected fractures and dislocations',
        steps: [
            { step: 1, summary: 'Assess the injury', detail: 'Look for deformity, swelling, bruising, inability to move. Check circulation below injury (pulse, color, sensation).' },
            { step: 2, summary: 'Control bleeding', detail: 'If open fracture (bone visible), cover wound with clean dressing. Apply gentle pressure if bleeding.' },
            { step: 3, summary: 'Do not realign', detail: 'Do NOT attempt to push bone back in or straighten the limb unless no pulse below injury.' },
            { step: 4, summary: 'Immobilize', detail: 'Splint the injury in the position found. Include joints above and below the fracture.' },
            { step: 5, summary: 'Pad the splint', detail: 'Use soft padding between splint and skin. Splint materials: sticks, boards, rolled clothing, foam pad.' },
            { step: 6, summary: 'Check circulation', detail: 'After splinting, check pulse, color, and feeling below injury. Loosen if circulation compromised.' },
            { step: 7, summary: 'Treat for shock', detail: 'Keep person warm and calm. Elevate legs if no leg injury. Give fluids if conscious.' }
        ],
        warnings: [
            'Spinal injury: do NOT move unless in immediate danger',
            'If no pulse below injury, gentle realignment may be needed',
            'Splint should be firm but not cut off circulation',
            'Open fractures have high infection risk - keep wound clean'
        ],
        contraindications: ['No forced realignment', 'No movement with suspected spinal injury'],
        when_to_seek_help: 'All fractures need medical evaluation. Emergencies: open fractures, no pulse below injury, severe deformity, suspected spinal injury, fractures with numbness or tingling.'
    },
    // DEHYDRATION
    {
        id: 7,
        category: 'environmental',
        name: 'Dehydration Treatment',
        severity: 'moderate',
        keywords: ['dehydration', 'thirst', 'water', 'fluid', 'dry', 'electrolyte'],
        summary: 'Recognition and treatment of dehydration in wilderness settings',
        steps: [
            { step: 1, summary: 'Recognize symptoms', detail: 'Signs: thirst, dark urine, headache, dizziness, fatigue, dry mouth, decreased urination.' },
            { step: 2, summary: 'Rest in shade', detail: 'Stop activity and rest in cool, shaded area to prevent further fluid loss.' },
            { step: 3, summary: 'Drink fluids slowly', detail: 'Sip water slowly - drinking too fast can cause vomiting. Small amounts frequently.' },
            { step: 4, summary: 'Replace electrolytes', detail: 'If available, add electrolyte powder to water, or improvise with small amount of salt and sugar.' },
            { step: 5, summary: 'Monitor urine', detail: 'Adequate hydration = light yellow urine. Dark urine = still dehydrated.' },
            { step: 6, summary: 'Address cause', detail: 'Treat underlying cause: heat exposure, vomiting, diarrhea, etc.' }
        ],
        warnings: [
            'Severe dehydration can be life-threatening',
            'Do NOT give fluids if person is unconscious',
            'Children and elderly dehydrate faster',
            'High altitude increases dehydration risk'
        ],
        contraindications: ['No fluids if unconscious', 'No caffeine or alcohol'],
        when_to_seek_help: 'Seek help for: confusion or altered consciousness, inability to keep fluids down, no urination for 8+ hours, rapid heartbeat, sunken eyes, severe weakness.'
    },
    // MINOR CUT
    {
        id: 8,
        category: 'wound',
        name: 'Minor Cut Treatment',
        severity: 'minor',
        keywords: ['cut', 'wound', 'bleeding', 'laceration', 'scrape', 'abrasion'],
        summary: 'Cleaning and bandaging minor wounds to prevent infection',
        steps: [
            { step: 1, summary: 'Wash your hands', detail: 'Clean your hands thoroughly before treating wound to prevent infection.' },
            { step: 2, summary: 'Stop bleeding', detail: 'Apply gentle pressure with clean cloth for 5-10 minutes. Most minor cuts stop bleeding on their own.' },
            { step: 3, summary: 'Clean the wound', detail: 'Rinse with clean water. Remove any debris gently. Do not use hydrogen peroxide or iodine on open wounds.' },
            { step: 4, summary: 'Apply antibiotic', detail: 'If available, apply thin layer of antibiotic ointment to prevent infection.' },
            { step: 5, summary: 'Cover wound', detail: 'Apply clean bandage. Change daily or when wet/dirty.' },
            { step: 6, summary: 'Monitor for infection', detail: 'Watch for: increasing pain, redness spreading, swelling, pus, fever, red streaks from wound.' }
        ],
        warnings: [
            'Deep cuts may need stitches - seek help if edges gap',
            'Animal bites always need medical evaluation - high infection risk',
            'Puncture wounds are prone to infection',
            'Watch for tetanus risk with dirty wounds'
        ],
        contraindications: ['No hydrogen peroxide on open wounds', 'No iodine directly in wound'],
        when_to_seek_help: 'Seek help if: bleeding does not stop after 10 minutes of pressure, wound is deep or gaping, caused by dirty/rusty object, animal bite, signs of infection appear.'
    },
    // ALLERGIC REACTION
    {
        id: 9,
        category: 'poison',
        name: 'Allergic Reaction Response',
        severity: 'critical',
        keywords: ['allergy', 'allergic', 'reaction', 'anaphylaxis', 'hives', 'swelling', 'epipen'],
        summary: 'Recognition and treatment of allergic reactions including anaphylaxis',
        steps: [
            { step: 1, summary: 'Identify the reaction', detail: 'Mild: localized hives, itching, mild swelling. Severe: throat tightness, breathing difficulty, widespread hives, dizziness.' },
            { step: 2, summary: 'Remove the allergen', detail: 'If known trigger (food, sting, plant), remove contact if possible.' },
            { step: 3, summary: 'Check for EpiPen', detail: 'If person has prescribed epinephrine auto-injector and showing severe symptoms, USE IT NOW in outer thigh.' },
            { step: 4, summary: 'Position the person', detail: 'If breathing difficulty: sit upright. If feeling faint: lie flat with legs raised. If vomiting: recovery position.' },
            { step: 5, summary: 'Give antihistamine', detail: 'If available and person can swallow, give oral antihistamine for mild reactions.' },
            { step: 6, summary: 'Monitor closely', detail: 'Symptoms can worsen rapidly. Stay with person. Be prepared for CPR.' }
        ],
        warnings: [
            'Anaphylaxis can kill within minutes - act FAST',
            'After using EpiPen, person still needs emergency medical care',
            'Biphasic reactions: symptoms may return hours later',
            'Do NOT hesitate to use EpiPen if severe symptoms present'
        ],
        anaphylaxis_escalation: {
            title: 'ANAPHYLAXIS - LIFE-THREATENING',
            symptoms: [
                'Difficulty breathing, wheezing, stridor',
                'Swelling of tongue, throat, or lips',
                'Rapid or weak pulse',
                'Widespread hives or flushing',
                'Severe dizziness or loss of consciousness',
                'Sense of doom'
            ],
            immediate_actions: [
                'Give epinephrine (EpiPen) immediately - inject into outer thigh, through clothing if needed',
                'ACTIVATE EMERGENCY SOS',
                'Call for help - shout for assistance',
                'If no breathing, begin CPR',
                'A second dose of epinephrine may be given after 5-15 minutes if no improvement'
            ]
        },
        contraindications: [],
        when_to_seek_help: 'ANY signs of severe allergic reaction require emergency medical care. Activate SOS immediately for: breathing difficulty, throat swelling, confusion, fainting, or if EpiPen was used.'
    },
    // SPRAIN/STRAIN
    {
        id: 10,
        category: 'wound',
        name: 'Sprain and Strain Treatment',
        severity: 'minor',
        keywords: ['sprain', 'strain', 'ankle', 'twisted', 'muscle', 'ligament', 'swelling'],
        summary: 'RICE protocol for muscle and ligament injuries',
        steps: [
            { step: 1, summary: 'Rest', detail: 'Stop using the injured area. Avoid putting weight on injured limb.' },
            { step: 2, summary: 'Ice', detail: 'Apply cold pack wrapped in cloth for 15-20 minutes every 2-3 hours for first 48 hours.' },
            { step: 3, summary: 'Compress', detail: 'Wrap with elastic bandage - snug but not tight. Check circulation (numbness, color, pulse).' },
            { step: 4, summary: 'Elevate', detail: 'Keep injured area above heart level when possible to reduce swelling.' },
            { step: 5, summary: 'Protect', detail: 'Use splint or support to prevent further injury. May need improvised crutch for ankle.' },
            { step: 6, summary: 'Pain management', detail: 'Over-the-counter pain relievers if available. Avoid ibuprofen first 48 hours if significant bruising.' }
        ],
        warnings: [
            'Severe pain or inability to bear any weight may indicate fracture',
            'Do NOT apply ice directly to skin',
            'Bandage should not cut off circulation',
            'If no improvement in 48 hours, may be more serious'
        ],
        contraindications: ['No heat for first 48 hours', 'No ice directly on skin'],
        when_to_seek_help: 'Seek help if: cannot bear any weight, obvious deformity, severe pain, numbness or tingling, no improvement after 48 hours, significant bruising.'
    },
    // CHOKING
    {
        id: 11,
        category: 'cardiac',
        name: 'Choking Response',
        severity: 'critical',
        keywords: ['choking', 'heimlich', 'airway', 'obstruction', 'cant breathe', 'throat'],
        summary: 'Clearing airway obstruction in conscious and unconscious victims',
        steps: [
            { step: 1, summary: 'Recognize choking', detail: 'Signs: hands at throat, unable to speak or cough, blue lips/face, high-pitched sounds or silence.' },
            { step: 2, summary: 'Ask if choking', detail: 'Ask "Are you choking?" If they can cough or speak, encourage coughing. Only intervene if they cannot breathe.' },
            { step: 3, summary: 'Call for help', detail: 'Have someone call emergency services or activate beacon while you help.' },
            { step: 4, summary: 'Give back blows', detail: 'Stand behind person. Give 5 sharp back blows between shoulder blades with heel of hand.' },
            { step: 5, summary: 'Abdominal thrusts', detail: 'Stand behind, wrap arms around waist. Fist above navel, grasp with other hand. Give 5 quick upward thrusts.' },
            { step: 6, summary: 'Repeat cycle', detail: 'Alternate 5 back blows and 5 abdominal thrusts until object expelled or person unconscious.' },
            { step: 7, summary: 'If unconscious', detail: 'Lower to ground, begin CPR. Before each breath, look in mouth and remove visible object.' }
        ],
        warnings: [
            'For pregnant or obese persons: use chest thrusts instead of abdominal thrusts',
            'For infants: use back blows and chest thrusts (NOT abdominal)',
            'If alone and choking: perform self-Heimlich using chair back',
            'After choking episode, seek medical evaluation'
        ],
        contraindications: ['No abdominal thrusts on infants', 'No abdominal thrusts if pregnant - use chest thrusts'],
        when_to_seek_help: 'After any choking incident, medical evaluation is recommended. Activate SOS if: person becomes unconscious, object cannot be removed, or breathing does not return to normal.'
    },
    // CPR
    {
        id: 12,
        category: 'cardiac',
        name: 'CPR - Adult',
        severity: 'critical',
        keywords: ['cpr', 'cardiac', 'arrest', 'heart', 'not breathing', 'unconscious', 'pulse', 'aed', 'defibrillator'],
        summary: 'Cardiopulmonary resuscitation for unresponsive adults',
        steps: [
            { step: 1, summary: 'Check responsiveness', detail: 'Tap shoulders and shout "Are you okay?" Look for movement or response for 5-10 seconds.' },
            { step: 2, summary: 'Call for help', detail: 'Shout for help. Activate SOS beacon. If alone with phone, put on speaker. Send someone for an AED if available.' },
            { step: 3, summary: 'Check breathing', detail: 'Look for chest movement, listen for breathing, feel for breath on cheek. No more than 10 seconds.' },
            { step: 4, summary: 'Begin compressions', detail: 'Place heel of hand on center of chest (on breastbone, between nipples). Other hand on top, fingers interlaced. Keep arms straight.' },
            { step: 5, summary: 'Push hard and fast', detail: 'Push at least 2 inches (5cm) deep. Rate: 100-120 compressions per minute (rhythm of "Stayin\' Alive" by Bee Gees). Allow full chest recoil between compressions.' },
            { step: 6, summary: 'Give rescue breaths', detail: 'After 30 compressions: tilt head back, lift chin, pinch nose, give 2 breaths (1 second each). Watch for chest rise. Resume compressions immediately.' },
            { step: 7, summary: 'Continue 30:2 cycles', detail: 'Continue cycles of 30 compressions and 2 breaths. Switch with another person every 2 minutes if possible. Do NOT stop.' },
            { step: 8, summary: 'Use AED if available', detail: 'When AED arrives: Turn it ON, follow voice prompts, attach pads to bare chest (one upper right, one lower left). Stand clear when analyzing/shocking. Resume CPR immediately after shock.' }
        ],
        warnings: [
            'High quality compressions are critical - push HARD and FAST',
            'Minimize ALL interruptions to chest compressions',
            'If unwilling/unable to give breaths, compression-only CPR is better than nothing',
            'CPR is exhausting - switch with another rescuer every 2 minutes if possible',
            'Do NOT give up - continue until professional help takes over',
            'For drowning victims: give 5 rescue breaths FIRST, then start compressions'
        ],
        aed_guidance: {
            title: 'AED (Automated External Defibrillator) Instructions',
            steps: [
                'Turn ON the AED - it will give voice instructions',
                'Expose the chest - remove clothing, dry if wet, shave chest hair if needed',
                'Attach pads - place one on upper right chest (below collarbone), one on lower left side',
                'Plug in connector if not pre-connected',
                'Stand clear during analysis - do not touch the person',
                'If shock advised: ensure NO ONE is touching the person, press shock button',
                'Immediately resume CPR for 2 minutes after shock',
                'AED will prompt you to stop for re-analysis - follow all voice prompts'
            ],
            warnings: [
                'Remove any medication patches before applying pads',
                'If person has implanted pacemaker (bump under skin), place pad below it',
                'For children 1-8 years: use pediatric pads if available',
                'Dry the chest if wet - water can interfere with shock delivery'
            ]
        },
        metronome_available: true,
        compression_rate: { min: 100, max: 120, recommended: 110 },
        contraindications: [],
        when_to_seek_help: 'This IS the emergency. SOS should already be activated. Continue CPR until: professional help takes over, an AED delivers a shock and person recovers, or the person starts breathing normally.'
    }
];

// ==============================================================================
// Medical Protocol Search and Retrieval API
// ==============================================================================

// Search protocols by query
app.get('/api/protocols', (req, res) => {
    const { query, category, severity } = req.query;

    let results = [...firstAidProtocolDatabase];

    // Filter by category
    if (category && category !== 'all') {
        results = results.filter(p => p.category === category);
    }

    // Filter by severity
    if (severity) {
        results = results.filter(p => p.severity === severity);
    }

    // Search by query
    if (query) {
        const searchLower = query.toLowerCase();
        results = results.filter(p => {
            const nameMatch = p.name.toLowerCase().includes(searchLower);
            const summaryMatch = p.summary.toLowerCase().includes(searchLower);
            const keywordMatch = p.keywords.some(k => k.toLowerCase().includes(searchLower));
            return nameMatch || summaryMatch || keywordMatch;
        });
    }

    // Return simplified list for browsing
    const simplified = results.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        severity: p.severity,
        summary: p.summary,
        keywords: p.keywords
    }));

    res.json({
        success: true,
        count: simplified.length,
        protocols: simplified
    });
});

// Get full protocol details by ID
app.get('/api/protocols/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const protocol = firstAidProtocolDatabase.find(p => p.id === id);

    if (!protocol) {
        return res.status(404).json({
            success: false,
            error: 'Protocol not found'
        });
    }

    res.json({
        success: true,
        protocol: protocol
    });
});

// Natural language protocol lookup (for voice queries like "what do I do for a bee sting")
app.post('/api/protocols/lookup', (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({
            success: false,
            error: 'Query required'
        });
    }

    const queryLower = query.toLowerCase();

    // Score each protocol based on keyword matches
    const scored = firstAidProtocolDatabase.map(protocol => {
        let score = 0;

        // Check name match (highest weight)
        if (protocol.name.toLowerCase().includes(queryLower)) {
            score += 100;
        }

        // Check keyword matches
        protocol.keywords.forEach(keyword => {
            if (queryLower.includes(keyword.toLowerCase())) {
                score += 50;
            }
            if (keyword.toLowerCase().includes(queryLower)) {
                score += 25;
            }
        });

        // Check summary match
        if (protocol.summary.toLowerCase().includes(queryLower)) {
            score += 20;
        }

        return { protocol, score };
    });

    // Sort by score and filter to those with any match
    const matches = scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
        return res.json({
            success: true,
            found: false,
            message: 'No matching protocol found. Try describing the injury or condition differently.',
            suggestions: ['bee sting', 'snake bite', 'bleeding', 'burn', 'broken bone', 'choking', 'CPR', 'dehydration']
        });
    }

    const bestMatch = matches[0].protocol;

    // Format response for display/voice
    const formattedSteps = bestMatch.steps.map(s => `Step ${s.step}: ${s.summary} - ${s.detail}`);

    res.json({
        success: true,
        found: true,
        protocol: {
            id: bestMatch.id,
            name: bestMatch.name,
            category: bestMatch.category,
            severity: bestMatch.severity,
            summary: bestMatch.summary,
            steps: bestMatch.steps,
            formatted_steps: formattedSteps,
            warnings: bestMatch.warnings,
            anaphylaxis_escalation: bestMatch.anaphylaxis_escalation || null,
            contraindications: bestMatch.contraindications,
            when_to_seek_help: bestMatch.when_to_seek_help
        },
        other_matches: matches.slice(1, 4).map(m => ({
            id: m.protocol.id,
            name: m.protocol.name,
            score: m.score
        }))
    });
});

// Voice command handler for protocol lookup
app.post('/api/voice/protocol', (req, res) => {
    const { command } = req.body;

    if (!command) {
        return res.status(400).json({
            success: false,
            error: 'Command required'
        });
    }

    const commandLower = command.toLowerCase();

    // Extract the condition/injury from the command
    // Examples: "what do I do for a bee sting", "how to treat a burn", "help with snake bite"
    let searchQuery = commandLower
        .replace(/what do i do for/gi, '')
        .replace(/how to treat/gi, '')
        .replace(/how do i treat/gi, '')
        .replace(/help with/gi, '')
        .replace(/first aid for/gi, '')
        .replace(/treatment for/gi, '')
        .replace(/^a\s+/gi, '')
        .replace(/^an\s+/gi, '')
        .trim();

    // Score protocols
    const scored = firstAidProtocolDatabase.map(protocol => {
        let score = 0;

        protocol.keywords.forEach(keyword => {
            if (searchQuery.includes(keyword.toLowerCase())) {
                score += 50;
            }
            if (keyword.toLowerCase().includes(searchQuery)) {
                score += 25;
            }
        });

        if (protocol.name.toLowerCase().includes(searchQuery)) {
            score += 100;
        }

        return { protocol, score };
    });

    const matches = scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
        return res.json({
            success: true,
            found: false,
            response: `I couldn't find a specific protocol for "${searchQuery}". Try asking about bee stings, snake bites, burns, bleeding, broken bones, or other common injuries.`,
            action: 'no_match'
        });
    }

    const bestMatch = matches[0].protocol;

    // Generate voice-friendly response
    let voiceResponse = `Found protocol for ${bestMatch.name}. ${bestMatch.summary}. `;
    voiceResponse += `This is a ${bestMatch.severity} severity condition. `;
    voiceResponse += `There are ${bestMatch.steps.length} steps. `;
    voiceResponse += `Step 1: ${bestMatch.steps[0].summary}. `;
    voiceResponse += `Say "next" to continue, or "more detail" for detailed instructions.`;

    // Check for critical warnings (like anaphylaxis)
    let criticalWarning = null;
    if (bestMatch.anaphylaxis_escalation) {
        criticalWarning = `WARNING: Watch for signs of anaphylaxis - ${bestMatch.anaphylaxis_escalation.symptoms.slice(0, 3).join(', ')}. If any occur, use EpiPen immediately and activate SOS.`;
    }

    // Set up navigation state for step-through
    navigationState.currentProtocol = bestMatch.id;
    navigationState.currentPage = 'medical';
    navigationState.protocolSteps = bestMatch.steps;
    navigationState.currentStep = 0;
    navigationState.totalSteps = bestMatch.steps.length;

    res.json({
        success: true,
        found: true,
        response: voiceResponse,
        critical_warning: criticalWarning,
        action: 'start_protocol',
        protocol: {
            id: bestMatch.id,
            name: bestMatch.name,
            severity: bestMatch.severity,
            category: bestMatch.category,
            summary: bestMatch.summary,
            steps: bestMatch.steps,
            warnings: bestMatch.warnings,
            anaphylaxis_escalation: bestMatch.anaphylaxis_escalation,
            when_to_seek_help: bestMatch.when_to_seek_help
        },
        current_step: 0,
        total_steps: bestMatch.steps.length
    });
});

// ==============================================================================
// CPR Audio Metronome System
// ==============================================================================

let cprMetronomeState = {
    active: false,
    started_at: null,
    bpm: 110, // Default: middle of 100-120 range
    compression_count: 0,
    cycle_count: 0 // 30 compressions = 1 cycle
};

// Get CPR metronome status
app.get('/api/cpr/metronome/status', (req, res) => {
    res.json({
        success: true,
        active: cprMetronomeState.active,
        bpm: cprMetronomeState.bpm,
        compression_count: cprMetronomeState.compression_count,
        cycle_count: cprMetronomeState.cycle_count,
        started_at: cprMetronomeState.started_at,
        guidance: {
            target_rate: '100-120 compressions per minute',
            current_rate: cprMetronomeState.bpm,
            depth: 'At least 2 inches (5cm)',
            song_reference: '"Stayin\' Alive" by Bee Gees (110 BPM)'
        }
    });
});

// Start CPR metronome
app.post('/api/cpr/metronome/start', (req, res) => {
    const { bpm } = req.body;

    // Validate BPM is in correct range
    let targetBpm = bpm || 110;
    if (targetBpm < 100) targetBpm = 100;
    if (targetBpm > 120) targetBpm = 120;

    cprMetronomeState = {
        active: true,
        started_at: new Date().toISOString(),
        bpm: targetBpm,
        compression_count: 0,
        cycle_count: 0
    };

    console.log(`CPR Metronome started at ${targetBpm} BPM`);

    res.json({
        success: true,
        message: `CPR metronome started at ${targetBpm} beats per minute`,
        bpm: targetBpm,
        interval_ms: Math.round(60000 / targetBpm), // Milliseconds between beats
        audio_frequency: 440, // Hz for the beep (A4 note)
        guidance: 'Push on each beat. After 30 compressions, pause for 2 rescue breaths.'
    });
});

// Stop CPR metronome
app.post('/api/cpr/metronome/stop', (req, res) => {
    const duration = cprMetronomeState.started_at
        ? Math.round((Date.now() - new Date(cprMetronomeState.started_at).getTime()) / 1000)
        : 0;

    const result = {
        success: true,
        message: 'CPR metronome stopped',
        summary: {
            duration_seconds: duration,
            total_compressions: cprMetronomeState.compression_count,
            total_cycles: cprMetronomeState.cycle_count,
            bpm_used: cprMetronomeState.bpm
        }
    };

    cprMetronomeState = {
        active: false,
        started_at: null,
        bpm: 110,
        compression_count: 0,
        cycle_count: 0
    };

    console.log(`CPR Metronome stopped after ${duration} seconds`);

    res.json(result);
});

// Count compression (called by frontend on each metronome beat)
app.post('/api/cpr/metronome/compression', (req, res) => {
    if (!cprMetronomeState.active) {
        return res.json({
            success: false,
            message: 'Metronome not active'
        });
    }

    cprMetronomeState.compression_count++;

    // Check if we've completed a cycle of 30
    let breathReminder = false;
    if (cprMetronomeState.compression_count % 30 === 0) {
        cprMetronomeState.cycle_count++;
        breathReminder = true;
    }

    res.json({
        success: true,
        compression_count: cprMetronomeState.compression_count,
        cycle_count: cprMetronomeState.cycle_count,
        breath_reminder: breathReminder,
        message: breathReminder
            ? 'PAUSE - Give 2 rescue breaths now, then resume compressions'
            : null
    });
});

// Get CPR protocol with metronome info
app.get('/api/cpr/guide', (req, res) => {
    const cprProtocol = firstAidProtocolDatabase.find(p => p.id === 12);

    if (!cprProtocol) {
        return res.status(404).json({ success: false, error: 'CPR protocol not found' });
    }

    res.json({
        success: true,
        protocol: cprProtocol,
        metronome: {
            available: true,
            recommended_bpm: 110,
            range: { min: 100, max: 120 },
            audio_frequency: 440,
            beat_pattern: '30 compressions, then pause for 2 breaths'
        },
        quick_reference: {
            rate: '100-120/min',
            depth: '2+ inches (5cm)',
            ratio: '30:2 (compressions:breaths)',
            song: '"Stayin\' Alive" (110 BPM)',
            switch: 'Every 2 minutes if possible'
        }
    });
});

// Request confirmation for critical action
app.post('/api/confirm/request', (req, res) => {
    const { action, description } = req.body;

    const criticalActions = ['emergency_activate', 'factory_reset', 'clear_all_data'];

    if (criticalActions.includes(action)) {
        pendingConfirmation = {
            action,
            description,
            timestamp: Date.now(),
            expires: Date.now() + 30000 // 30 second timeout
        };

        res.json({
            requires_confirmation: true,
            action,
            prompt: `Are you sure you want to ${description || action}? Say 'yes' to confirm or 'no' to cancel.`,
            timeout_seconds: 30
        });
    } else {
        res.json({
            requires_confirmation: false,
            action,
            message: 'Action does not require confirmation'
        });
    }
});

// Respond to confirmation prompt
app.post('/api/confirm/respond', (req, res) => {
    const { response } = req.body;
    const responseLower = (response || '').toLowerCase();

    if (!pendingConfirmation) {
        return res.json({
            success: false,
            message: 'No pending confirmation'
        });
    }

    if (Date.now() > pendingConfirmation.expires) {
        pendingConfirmation = null;
        return res.json({
            success: false,
            message: 'Confirmation timed out'
        });
    }

    if (responseLower === 'yes' || responseLower === 'confirm') {
        const action = pendingConfirmation.action;
        pendingConfirmation = null;

        // Execute the confirmed action
        if (action === 'emergency_activate') {
            // Create emergency log entry
            const emergencyLog = {
                id: emergencyLogs.length + 1,
                activated_at: new Date().toISOString(),
                deactivated_at: null,
                duration_seconds: null,
                activation_source: 'voice',
                position_at_activation: {
                    latitude: sensorData.gps.latitude,
                    longitude: sensorData.gps.longitude,
                    altitude: sensorData.gps.altitude,
                    accuracy: sensorData.gps.accuracy || 5
                },
                beacon_active: true,
                resolved: false,
                notes: []
            };

            emergencyLogs.push(emergencyLog);
            currentEmergency = emergencyLog;
            systemState.state = 'emergency';

            console.log(`EMERGENCY ACTIVATED [${emergencyLog.id}] via voice confirmation`);

            return res.json({
                success: true,
                confirmed: true,
                action,
                message: 'Emergency beacon activated',
                emergency_id: emergencyLog.id,
                navigate_to: '/emergency',
                result: {
                    status: 'emergency_activated',
                    gps: sensorData.gps,
                    log_created: true
                }
            });
        }

        return res.json({
            success: true,
            confirmed: true,
            action,
            message: `${action} confirmed and executed`
        });
    } else if (responseLower === 'no' || responseLower === 'cancel') {
        const action = pendingConfirmation.action;
        pendingConfirmation = null;

        return res.json({
            success: true,
            confirmed: false,
            action,
            message: 'Action cancelled'
        });
    }

    res.json({
        success: false,
        message: 'Please respond with "yes" or "no"'
    });
});

// ==============================================================================
// Emergency SOS System with Logging
// ==============================================================================

// Emergency log storage
const emergencyLogs = [];
let currentEmergency = null;

// Emergency activation
app.post('/api/emergency/activate', (req, res) => {
    const { source } = req.body; // 'voice', 'button', or 'api'

    // Create emergency log entry
    const emergencyLog = {
        id: emergencyLogs.length + 1,
        activated_at: new Date().toISOString(),
        deactivated_at: null,
        duration_seconds: null,
        activation_source: source || 'button',
        position_at_activation: {
            latitude: sensorData.gps.latitude,
            longitude: sensorData.gps.longitude,
            altitude: sensorData.gps.altitude,
            accuracy: sensorData.gps.accuracy || 5
        },
        beacon_active: true,
        resolved: false,
        notes: []
    };

    emergencyLogs.push(emergencyLog);
    currentEmergency = emergencyLog;
    systemState.state = 'emergency';

    console.log(`EMERGENCY ACTIVATED [${emergencyLog.id}] - Source: ${emergencyLog.activation_source}`);
    console.log(`Position: ${emergencyLog.position_at_activation.latitude}, ${emergencyLog.position_at_activation.longitude}`);

    res.json({
        status: 'emergency_activated',
        emergency_id: emergencyLog.id,
        gps: {
            latitude: sensorData.gps.latitude,
            longitude: sensorData.gps.longitude,
            altitude: sensorData.gps.altitude
        },
        message: 'SOS beacon activated. Broadcasting position.',
        beacon_active: true,
        log_created: true
    });
});

app.post('/api/emergency/deactivate', (req, res) => {
    const wasActive = currentEmergency !== null;

    if (currentEmergency) {
        currentEmergency.deactivated_at = new Date().toISOString();
        currentEmergency.beacon_active = false;
        currentEmergency.resolved = true;
        currentEmergency.duration_seconds = Math.floor(
            (new Date(currentEmergency.deactivated_at) - new Date(currentEmergency.activated_at)) / 1000
        );
        console.log(`EMERGENCY DEACTIVATED [${currentEmergency.id}] - Duration: ${currentEmergency.duration_seconds}s`);
    }

    currentEmergency = null;
    systemState.state = 'ready';

    res.json({
        status: 'emergency_deactivated',
        was_active: wasActive,
        message: wasActive ? 'Emergency beacon deactivated. Stay safe.' : 'No active emergency to deactivate.'
    });
});

// Get emergency status
app.get('/api/emergency/status', (req, res) => {
    res.json({
        active: currentEmergency !== null,
        emergency: currentEmergency,
        position: currentEmergency ? {
            latitude: sensorData.gps.latitude,
            longitude: sensorData.gps.longitude,
            altitude: sensorData.gps.altitude
        } : null,
        total_emergencies: emergencyLogs.length
    });
});

// Get emergency logs
app.get('/api/emergency/logs', (req, res) => {
    res.json({
        success: true,
        logs: emergencyLogs,
        count: emergencyLogs.length,
        active: currentEmergency !== null
    });
});

// ==============================================================================
// Audio Beacon System (SOS Morse Pattern)
// ==============================================================================

// Audio beacon state
let audioBeaconState = {
    active: false,
    frequency: 2800, // Hz - piezo buzzer frequency
    pattern: 'sos', // SOS morse pattern: ... --- ...
    started_at: null,
    cycles_completed: 0
};

// SOS Morse timing (in milliseconds)
// Dot = 1 unit, Dash = 3 units, Gap between dots/dashes = 1 unit, Gap between letters = 3 units
const MORSE_TIMING = {
    unit: 200, // base unit in ms
    dot: 200,
    dash: 600,
    intraChar: 200, // gap between dots/dashes in same letter
    interChar: 600, // gap between letters
    interWord: 1400, // gap between words/pattern repeat
    // SOS pattern: ... --- ... = 3 dots, 3 dashes, 3 dots
    sosPattern: [
        // S: dot dot dot
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 600 }, // inter-char gap
        // O: dash dash dash
        { type: 'tone', duration: 600 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 600 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 600 },
        { type: 'silence', duration: 600 }, // inter-char gap
        // S: dot dot dot
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 200 },
        { type: 'tone', duration: 200 },
        { type: 'silence', duration: 1400 } // inter-word gap before repeat
    ]
};

// Enable audio beacon
app.post('/api/emergency/beacon/enable', (req, res) => {
    const { frequency, volume } = req.body;

    if (!currentEmergency) {
        return res.status(400).json({
            success: false,
            error: 'No active emergency. Activate emergency mode first.',
            code: 'NO_EMERGENCY'
        });
    }

    audioBeaconState = {
        active: true,
        frequency: frequency || 2800,
        volume: Math.min(1.0, Math.max(0.1, volume || 0.8)),
        pattern: 'sos',
        started_at: new Date().toISOString(),
        cycles_completed: 0
    };

    // Update emergency record
    if (currentEmergency) {
        currentEmergency.beacon_active = true;
        currentEmergency.audio_beacon_started = audioBeaconState.started_at;
    }

    console.log(`AUDIO BEACON ENABLED - ${audioBeaconState.frequency}Hz SOS pattern`);

    res.json({
        success: true,
        beacon: {
            active: true,
            frequency: audioBeaconState.frequency,
            volume: audioBeaconState.volume,
            pattern: 'SOS (... --- ...)',
            timing: MORSE_TIMING.sosPattern,
            message: 'Audio beacon enabled. Playing SOS pattern at 2800Hz.'
        }
    });
});

// Disable audio beacon
app.post('/api/emergency/beacon/disable', (req, res) => {
    const wasActive = audioBeaconState.active;

    audioBeaconState = {
        active: false,
        frequency: 2800,
        pattern: 'sos',
        started_at: null,
        cycles_completed: audioBeaconState.cycles_completed
    };

    // Update emergency record if still active
    if (currentEmergency) {
        currentEmergency.audio_beacon_stopped = new Date().toISOString();
    }

    console.log(`AUDIO BEACON DISABLED - ${audioBeaconState.cycles_completed} cycles completed`);

    res.json({
        success: true,
        beacon: {
            active: false,
            was_active: wasActive,
            cycles_completed: audioBeaconState.cycles_completed,
            message: wasActive ? 'Audio beacon disabled.' : 'Audio beacon was not active.'
        }
    });
});

// Get audio beacon status
app.get('/api/emergency/beacon/status', (req, res) => {
    const duration = audioBeaconState.started_at
        ? Math.floor((Date.now() - new Date(audioBeaconState.started_at).getTime()) / 1000)
        : 0;

    res.json({
        success: true,
        beacon: {
            active: audioBeaconState.active,
            frequency: audioBeaconState.frequency,
            volume: audioBeaconState.volume || 0.8,
            pattern: audioBeaconState.pattern,
            pattern_description: 'SOS (... --- ...)',
            started_at: audioBeaconState.started_at,
            duration_seconds: duration,
            cycles_completed: audioBeaconState.cycles_completed,
            timing: MORSE_TIMING.sosPattern
        },
        emergency_active: currentEmergency !== null
    });
});

// Increment beacon cycle count (called by client after each SOS pattern completion)
app.post('/api/emergency/beacon/cycle', (req, res) => {
    if (audioBeaconState.active) {
        audioBeaconState.cycles_completed++;
    }

    res.json({
        success: true,
        cycles_completed: audioBeaconState.cycles_completed,
        active: audioBeaconState.active
    });
});

// Voice-activated SOS (requires confirmation)
app.post('/api/voice/sos', (req, res) => {
    const { confirmed } = req.body;

    if (!confirmed) {
        // Request confirmation
        pendingConfirmation = {
            action: 'emergency_activate',
            description: 'activate emergency SOS beacon',
            timestamp: Date.now(),
            expires: Date.now() + 30000
        };

        res.json({
            requires_confirmation: true,
            action: 'emergency_activate',
            voice_prompt: 'I heard you want to activate emergency SOS. Say "yes" or "confirm" to activate, or "no" to cancel.',
            display_prompt: 'EMERGENCY SOS - Confirm activation?',
            timeout_seconds: 30
        });
    } else {
        // Confirmed - activate emergency
        const emergencyLog = {
            id: emergencyLogs.length + 1,
            activated_at: new Date().toISOString(),
            deactivated_at: null,
            duration_seconds: null,
            activation_source: 'voice',
            position_at_activation: {
                latitude: sensorData.gps.latitude,
                longitude: sensorData.gps.longitude,
                altitude: sensorData.gps.altitude,
                accuracy: sensorData.gps.accuracy || 5
            },
            beacon_active: true,
            resolved: false,
            notes: []
        };

        emergencyLogs.push(emergencyLog);
        currentEmergency = emergencyLog;
        systemState.state = 'emergency';

        res.json({
            success: true,
            status: 'emergency_activated',
            emergency_id: emergencyLog.id,
            voice_response: 'Emergency SOS activated. Beacon is now broadcasting your position. Your coordinates are displayed on screen.',
            gps: {
                latitude: sensorData.gps.latitude,
                longitude: sensorData.gps.longitude,
                altitude: sensorData.gps.altitude
            },
            navigate_to: '/emergency'
        });
    }
});

// Wake word detection (simulated)
app.post('/api/wake', (req, res) => {
    const { word } = req.body;
    const validWakeWords = ['survival', 'companion'];

    if (validWakeWords.includes((word || '').toLowerCase())) {
        systemState.state = 'active_voice';
        res.json({
            detected: true,
            wake_word: word.toLowerCase(),
            message: 'Wake word detected. Listening for command...',
            listening: true
        });
    } else {
        res.json({
            detected: false,
            wake_word: null,
            message: 'Wake word not recognized',
            listening: false
        });
    }
});

// Get wake word status
app.get('/api/wake/status', (req, res) => {
    res.json({
        active: systemState.bootStatus.wake_word_active,
        wake_words: ['survival', 'companion'],
        state: systemState.state
    });
});

// Text-to-speech processing (simulated)
// In production, this would use Piper TTS to generate audio
app.post('/api/tts', (req, res) => {
    const { text, voice, volume } = req.body;
    const startTime = Date.now();

    // Simulate TTS processing time (~50ms per 10 words)
    const wordCount = (text || '').split(' ').length;
    const processingTime = Math.floor((wordCount / 10) * 50) + 100;

    setTimeout(() => {
        res.json({
            text: text || '',
            voice: voice || 'en_US-lessac-medium',
            volume: volume || 0.8,
            duration_ms: wordCount * 300, // ~300ms per word
            processing_ms: Date.now() - startTime,
            speaking: true,
            message: 'TTS generated and playing',
            clear_voice: true,
            stress_optimized: true // Piper voice is clear under stress
        });
    }, processingTime);
});

// Get TTS status
app.get('/api/tts/status', (req, res) => {
    res.json({
        available: true,
        voice: 'en_US-lessac-medium',
        volume: 0.8,
        speaking: false
    });
});

// Speech-to-text processing (simulated)
// In production, this would receive audio and use Whisper.cpp
app.post('/api/stt', (req, res) => {
    const { audio_text, latency_ms } = req.body;
    const startTime = Date.now();

    // Simulate processing delay (in real system, Whisper.cpp would process)
    const simulatedLatency = latency_ms || Math.floor(Math.random() * 1500) + 500; // 0.5-2s

    setTimeout(() => {
        const processingTime = Date.now() - startTime;
        res.json({
            transcription: audio_text || '',
            confidence: 0.92 + Math.random() * 0.07, // 92-99%
            latency_ms: processingTime,
            within_target: processingTime < 3000, // Target: <3 seconds
            language: 'en',
            model: 'whisper.cpp base.en'
        });
    }, simulatedLatency);
});

// Voice command processing
app.post('/api/voice/command', (req, res) => {
    const { command } = req.body;
    const commandLower = (command || '').toLowerCase();

    // Check for "repeat that" commands first
    if (commandLower.includes('repeat') ||
        commandLower.includes('say that again') ||
        commandLower.includes('what did you say') ||
        commandLower.includes('say again')) {

        if (lastResponse.text) {
            return res.json({
                recognized: command,
                confidence: 0.95,
                response: lastResponse.text,
                action: lastResponse.action,
                is_repeat: true,
                original_timestamp: lastResponse.timestamp
            });
        } else {
            return res.json({
                recognized: command,
                confidence: 0.95,
                response: 'I have not said anything yet.',
                action: null,
                is_repeat: true,
                no_previous_response: true
            });
        }
    }

    let response = {
        recognized: command,
        confidence: 0.95,
        response: `Processing command: ${command}`,
        action: null
    };

    if (commandLower.includes('activate sos') || commandLower === 'sos' || commandLower === 'emergency' ||
        (commandLower.includes('emergency') && !commandLower.includes('deactivate'))) {
        // Request confirmation for emergency activation via voice
        pendingConfirmation = {
            action: 'emergency_activate',
            description: 'activate emergency SOS beacon',
            timestamp: Date.now(),
            expires: Date.now() + 30000
        };
        response.action = 'confirm_emergency';
        response.requires_confirmation = true;
        response.response = 'Emergency SOS requested. Say "yes" or "confirm" to activate the beacon, or "no" to cancel.';
    } else if (commandLower.includes('help')) {
        response.action = 'emergency';
        response.response = 'Do you need emergency help? Say "activate SOS" for emergency beacon, or tell me what kind of help you need.';
    } else if (commandLower.includes('weather')) {
        response.action = 'weather';
        response.response = 'Current conditions: 23.5°C, 65% humidity, 1013 hPa. No storms expected.';
    } else if (commandLower.includes('location') || commandLower.includes('where')) {
        response.action = 'navigation';
        response.response = 'Your current position is being displayed on the map.';
    } else if (commandLower.includes('medical') || commandLower.includes('first aid')) {
        response.action = 'medical';
        response.response = 'Opening medical protocols. What injury or condition do you need help with?';
    }

    // Store this response for "repeat that" functionality
    lastResponse = {
        text: response.response,
        action: response.action,
        timestamp: Date.now()
    };

    res.json(response);
});

// Dedicated endpoint for repeat functionality
app.post('/api/repeat', (req, res) => {
    if (lastResponse.text) {
        res.json({
            success: true,
            response: lastResponse.text,
            action: lastResponse.action,
            timestamp: lastResponse.timestamp,
            is_repeat: true
        });
    } else {
        res.json({
            success: false,
            response: 'I have not said anything yet.',
            message: 'No previous response to repeat',
            is_repeat: true
        });
    }
});

// Get last response (for verification)
app.get('/api/repeat/last', (req, res) => {
    res.json({
        has_response: lastResponse.text !== null,
        response: lastResponse.text,
        action: lastResponse.action,
        timestamp: lastResponse.timestamp
    });
});

// ==============================================================================
// Hands-Free Navigation API
// ==============================================================================

// Hands-free voice navigation command
app.post('/api/handsfree/command', (req, res) => {
    const { command } = req.body;
    const commandLower = (command || '').toLowerCase();
    let response = { success: true, touchless: true };

    // Navigation commands: next, previous, go back, home
    if (commandLower.includes('next') || commandLower.includes('continue')) {
        if (navigationState.currentProtocol && navigationState.currentStep < navigationState.totalSteps - 1) {
            navigationState.currentStep++;
            const step = navigationState.protocolSteps[navigationState.currentStep];
            response.action = 'next_step';
            response.step = navigationState.currentStep + 1;
            response.totalSteps = navigationState.totalSteps;
            response.summary = step.summary;
            response.response = `Step ${navigationState.currentStep + 1} of ${navigationState.totalSteps}: ${step.summary}`;
        } else if (navigationState.currentProtocol) {
            response.response = 'You have reached the last step. Say "start over" to begin again or "go home" to exit.';
            response.action = 'end_of_protocol';
        } else {
            response.response = 'No active protocol. Ask about a medical topic like CPR to get started.';
            response.action = 'no_protocol';
        }
    }
    else if (commandLower.includes('previous') || commandLower.includes('back') && !commandLower.includes('go back')) {
        if (navigationState.currentProtocol && navigationState.currentStep > 0) {
            navigationState.currentStep--;
            const step = navigationState.protocolSteps[navigationState.currentStep];
            response.action = 'previous_step';
            response.step = navigationState.currentStep + 1;
            response.totalSteps = navigationState.totalSteps;
            response.summary = step.summary;
            response.response = `Step ${navigationState.currentStep + 1} of ${navigationState.totalSteps}: ${step.summary}`;
        } else if (navigationState.currentProtocol) {
            response.response = 'You are at the first step.';
            response.action = 'first_step';
        } else {
            response.response = 'No active protocol.';
            response.action = 'no_protocol';
        }
    }
    else if (commandLower.includes('more detail') || commandLower.includes('tell me more') || commandLower.includes('explain')) {
        if (navigationState.currentProtocol && navigationState.protocolSteps.length > 0) {
            const step = navigationState.protocolSteps[navigationState.currentStep];
            response.action = 'detail';
            response.step = navigationState.currentStep + 1;
            response.detail = step.detail;
            response.response = step.detail;
        } else {
            response.response = 'No active step to explain.';
            response.action = 'no_protocol';
        }
    }
    else if (commandLower.includes('start over') || commandLower.includes('restart')) {
        if (navigationState.currentProtocol) {
            navigationState.currentStep = 0;
            const step = navigationState.protocolSteps[0];
            response.action = 'restart';
            response.step = 1;
            response.totalSteps = navigationState.totalSteps;
            response.response = `Starting over. Step 1 of ${navigationState.totalSteps}: ${step.summary}`;
        } else {
            response.response = 'No active protocol to restart.';
            response.action = 'no_protocol';
        }
    }
    else if (commandLower.includes('go home') || commandLower.includes('exit') || commandLower.includes('go back home') || commandLower.includes('home')) {
        navigationState.currentPage = 'home';
        navigationState.currentProtocol = null;
        navigationState.currentStep = 0;
        navigationState.totalSteps = 0;
        navigationState.protocolSteps = [];
        response.action = 'navigate_home';
        response.page = 'home';
        response.response = 'Returning to home screen. How can I help you?';
    }
    else if (commandLower.includes('cpr') || commandLower.includes('cardiopulmonary')) {
        const protocol = medicalProtocols.cpr;
        navigationState.currentProtocol = 'cpr';
        navigationState.currentPage = 'medical';
        navigationState.protocolSteps = protocol.steps;
        navigationState.currentStep = 0;
        navigationState.totalSteps = protocol.steps.length;

        response.action = 'start_protocol';
        response.protocol = 'cpr';
        response.protocolName = protocol.name;
        response.step = 1;
        response.totalSteps = protocol.steps.length;
        response.response = `Starting ${protocol.name}. There are ${protocol.steps.length} steps. Step 1: ${protocol.steps[0].summary}. Say "next" to continue or "more detail" for more information.`;
    }
    else if (commandLower.includes('choking')) {
        const protocol = medicalProtocols.choking;
        navigationState.currentProtocol = 'choking';
        navigationState.currentPage = 'medical';
        navigationState.protocolSteps = protocol.steps;
        navigationState.currentStep = 0;
        navigationState.totalSteps = protocol.steps.length;

        response.action = 'start_protocol';
        response.protocol = 'choking';
        response.protocolName = protocol.name;
        response.step = 1;
        response.totalSteps = protocol.steps.length;
        response.response = `Starting ${protocol.name}. There are ${protocol.steps.length} steps. Step 1: ${protocol.steps[0].summary}. Say "next" to continue.`;
    }
    else if (commandLower.includes('bleeding')) {
        const protocol = medicalProtocols.bleeding;
        navigationState.currentProtocol = 'bleeding';
        navigationState.currentPage = 'medical';
        navigationState.protocolSteps = protocol.steps;
        navigationState.currentStep = 0;
        navigationState.totalSteps = protocol.steps.length;

        response.action = 'start_protocol';
        response.protocol = 'bleeding';
        response.protocolName = protocol.name;
        response.step = 1;
        response.totalSteps = protocol.steps.length;
        response.response = `Starting ${protocol.name}. There are ${protocol.steps.length} steps. Step 1: ${protocol.steps[0].summary}. Say "next" to continue.`;
    }
    else {
        response.success = false;
        response.response = 'I didn\'t understand that command. You can say "next", "previous", "more detail", "go home", or ask about CPR, choking, or bleeding.';
    }

    // Store response for "repeat that"
    lastResponse = {
        text: response.response,
        action: response.action,
        timestamp: Date.now()
    };

    res.json(response);
});

// Get current hands-free navigation state
app.get('/api/handsfree/state', (req, res) => {
    res.json({
        currentPage: navigationState.currentPage,
        currentProtocol: navigationState.currentProtocol,
        currentStep: navigationState.currentStep,
        totalSteps: navigationState.totalSteps,
        touchless_mode: navigationState.touchless_mode,
        current_step_info: navigationState.protocolSteps[navigationState.currentStep] || null
    });
});

// ==============================================================================
// Push-to-Talk (PTT) Fallback API
// ==============================================================================

// PTT button state
let pttState = {
    pressed: false,
    listening: false,
    press_start_time: null,
    command_buffer: null,
    gpio_pin: 17 // Default GPIO pin for PTT button
};

// PTT button press (start listening)
app.post('/api/ptt/press', (req, res) => {
    pttState.pressed = true;
    pttState.listening = true;
    pttState.press_start_time = Date.now();
    pttState.command_buffer = null;

    systemState.state = 'active_voice';

    res.json({
        success: true,
        action: 'ptt_pressed',
        listening: true,
        indicator: 'listening',
        message: 'Push-to-talk activated. Speak your command.',
        gpio_pin: pttState.gpio_pin
    });
});

// PTT button held - receive audio/command during hold
app.post('/api/ptt/speak', (req, res) => {
    const { command, audio_text } = req.body;

    if (!pttState.pressed || !pttState.listening) {
        return res.json({
            success: false,
            error: 'PTT button not pressed',
            message: 'Please press and hold the PTT button before speaking'
        });
    }

    // Store the command while button is held
    pttState.command_buffer = command || audio_text || '';

    res.json({
        success: true,
        action: 'command_received',
        command: pttState.command_buffer,
        listening: true,
        message: 'Command received. Release button to process.'
    });
});

// PTT button release (process command)
app.post('/api/ptt/release', (req, res) => {
    if (!pttState.pressed) {
        return res.json({
            success: false,
            error: 'PTT button was not pressed',
            message: 'No active PTT session'
        });
    }

    const holdDuration = Date.now() - pttState.press_start_time;
    const command = pttState.command_buffer;

    // Reset PTT state
    pttState.pressed = false;
    pttState.listening = false;
    pttState.press_start_time = null;

    if (!command) {
        systemState.state = 'ready';
        return res.json({
            success: false,
            action: 'ptt_released',
            error: 'No command received',
            hold_duration_ms: holdDuration,
            message: 'No command was spoken while button was held'
        });
    }

    // Process the command (reuse voice command logic)
    const commandLower = command.toLowerCase();
    let response = {
        success: true,
        action: 'command_processed',
        recognized: command,
        confidence: 0.95,
        hold_duration_ms: holdDuration,
        ptt_fallback: true
    };

    // Process command similar to voice command
    if (commandLower.includes('emergency') || commandLower.includes('sos') || commandLower.includes('help')) {
        response.command_action = 'emergency';
        response.response = 'Activating emergency mode. SOS beacon enabled.';
    } else if (commandLower.includes('weather')) {
        response.command_action = 'weather';
        response.response = 'Current conditions: 23.5°C, 65% humidity, 1013 hPa. No storms expected.';
    } else if (commandLower.includes('location') || commandLower.includes('where')) {
        response.command_action = 'navigation';
        response.response = 'Your current position is being displayed on the map.';
    } else if (commandLower.includes('medical') || commandLower.includes('first aid')) {
        response.command_action = 'medical';
        response.response = 'Opening medical protocols. What injury or condition do you need help with?';
    } else {
        response.command_action = 'general';
        response.response = `Processing: ${command}`;
    }

    // Store response for repeat functionality
    lastResponse = {
        text: response.response,
        action: response.command_action,
        timestamp: Date.now()
    };

    systemState.state = 'ready';

    res.json(response);
});

// Get PTT status
app.get('/api/ptt/status', (req, res) => {
    res.json({
        pressed: pttState.pressed,
        listening: pttState.listening,
        gpio_pin: pttState.gpio_pin,
        has_command: pttState.command_buffer !== null,
        system_state: systemState.state
    });
});

// ==============================================================================
// Noise Handling and Wind Filtering API
// ==============================================================================

// Noise state simulation
let noiseState = {
    wind_noise: false,
    noise_level_db: 30, // Quiet ambient noise (30 dB)
    filter_enabled: true,
    confidence_threshold: 0.7 // Minimum confidence to accept command
};

// Set noise conditions (for testing)
app.post('/api/noise/set', (req, res) => {
    const { wind_noise, noise_level_db, filter_enabled } = req.body;

    if (typeof wind_noise === 'boolean') {
        noiseState.wind_noise = wind_noise;
    }
    if (typeof noise_level_db === 'number') {
        noiseState.noise_level_db = Math.max(0, Math.min(120, noise_level_db));
    }
    if (typeof filter_enabled === 'boolean') {
        noiseState.filter_enabled = filter_enabled;
    }

    res.json({
        success: true,
        noise_state: noiseState
    });
});

// Get noise conditions
app.get('/api/noise/status', (req, res) => {
    res.json(noiseState);
});

// Wake word detection with noise handling
app.post('/api/wake/noisy', (req, res) => {
    const { word } = req.body;
    const validWakeWords = ['survival', 'companion'];
    const wordLower = (word || '').toLowerCase();

    // Calculate confidence based on noise conditions
    let baseConfidence = validWakeWords.includes(wordLower) ? 0.98 : 0.1;

    // Degrade confidence based on noise
    let confidence = baseConfidence;

    if (noiseState.wind_noise) {
        confidence *= 0.7; // Wind reduces confidence by 30%
    }

    if (noiseState.noise_level_db > 60) {
        // High noise (> 60 dB) degrades confidence
        const noisePenalty = (noiseState.noise_level_db - 60) / 100;
        confidence *= (1 - noisePenalty);
    }

    // Apply filter recovery if enabled
    if (noiseState.filter_enabled && (noiseState.wind_noise || noiseState.noise_level_db > 60)) {
        confidence *= 1.15; // Filter recovers 15% of lost confidence
        confidence = Math.min(confidence, baseConfidence); // Can't exceed base
    }

    const detected = confidence >= noiseState.confidence_threshold && validWakeWords.includes(wordLower);

    if (detected) {
        systemState.state = 'active_voice';
        res.json({
            detected: true,
            wake_word: wordLower,
            confidence: Math.round(confidence * 100) / 100,
            noise_conditions: {
                wind_noise: noiseState.wind_noise,
                noise_level_db: noiseState.noise_level_db,
                filter_enabled: noiseState.filter_enabled
            },
            message: 'Wake word detected. Listening for command...',
            listening: true
        });
    } else {
        res.json({
            detected: false,
            wake_word: null,
            confidence: Math.round(confidence * 100) / 100,
            noise_conditions: {
                wind_noise: noiseState.wind_noise,
                noise_level_db: noiseState.noise_level_db,
                filter_enabled: noiseState.filter_enabled
            },
            message: confidence < noiseState.confidence_threshold ?
                'Wake word unclear. Please speak louder or use push-to-talk.' :
                'Wake word not recognized',
            listening: false
        });
    }
});

// STT with noise handling
app.post('/api/stt/noisy', (req, res) => {
    const { audio_text, latency_ms } = req.body;
    const startTime = Date.now();

    // Calculate confidence based on noise
    let baseConfidence = 0.95;

    if (noiseState.wind_noise) {
        baseConfidence *= 0.75;
    }

    if (noiseState.noise_level_db > 60) {
        const noisePenalty = (noiseState.noise_level_db - 60) / 80;
        baseConfidence *= (1 - noisePenalty);
    }

    // Apply filter recovery
    if (noiseState.filter_enabled && (noiseState.wind_noise || noiseState.noise_level_db > 60)) {
        baseConfidence *= 1.12;
        baseConfidence = Math.min(baseConfidence, 0.95);
    }

    // Add some random variation
    const confidence = Math.max(0.1, baseConfidence + (Math.random() - 0.5) * 0.1);

    const simulatedLatency = latency_ms || Math.floor(Math.random() * 1500) + 500;

    setTimeout(() => {
        const processingTime = Date.now() - startTime;
        const needsRepeat = confidence < noiseState.confidence_threshold;

        const response = {
            transcription: audio_text || '',
            confidence: Math.round(confidence * 100) / 100,
            latency_ms: processingTime,
            within_target: processingTime < 3000,
            language: 'en',
            model: 'whisper.cpp base.en',
            noise_conditions: {
                wind_noise: noiseState.wind_noise,
                noise_level_db: noiseState.noise_level_db,
                filter_enabled: noiseState.filter_enabled
            },
            degraded_gracefully: noiseState.wind_noise || noiseState.noise_level_db > 60,
            needs_repeat: needsRepeat
        };

        if (needsRepeat) {
            response.message = 'I didn\'t catch that clearly. Could you please repeat your command?';
            response.repeat_requested = true;
        }

        res.json(response);
    }, simulatedLatency);
});

// ==============================================================================
// Volume Control API
// ==============================================================================

// Volume settings with persistence
let volumeSettings = {
    tts_volume: 0.8,
    alert_volume: 1.0,
    min_volume: 0.0,
    max_volume: 1.0,
    persisted: false
};

// Settings file path (simulated persistence)
const settingsFile = join(__dirname, 'data', 'settings.json');

// Load settings (simulated persistence)
function loadSettings() {
    try {
        if (fs.existsSync(settingsFile)) {
            const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            if (data.volume) {
                volumeSettings = { ...volumeSettings, ...data.volume, persisted: true };
            }
            return true;
        }
    } catch (e) {
        console.log('Settings file not found, using defaults');
    }
    return false;
}

// Save settings (simulated persistence)
function saveSettings() {
    try {
        const dir = dirname(settingsFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            volume: {
                tts_volume: volumeSettings.tts_volume,
                alert_volume: volumeSettings.alert_volume
            },
            saved_at: Date.now()
        };
        fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2));
        volumeSettings.persisted = true;
        return true;
    } catch (e) {
        console.error('Error saving settings:', e);
        return false;
    }
}

// Load settings on startup
loadSettings();

// Get volume settings
app.get('/api/settings/volume', (req, res) => {
    res.json({
        tts_volume: volumeSettings.tts_volume,
        alert_volume: volumeSettings.alert_volume,
        persisted: volumeSettings.persisted
    });
});

// Set TTS volume
app.post('/api/settings/volume', (req, res) => {
    const { tts_volume, alert_volume } = req.body;

    if (typeof tts_volume === 'number') {
        volumeSettings.tts_volume = Math.max(0, Math.min(1, tts_volume));
    }
    if (typeof alert_volume === 'number') {
        volumeSettings.alert_volume = Math.max(0, Math.min(1, alert_volume));
    }

    // Save settings to persist
    const saved = saveSettings();

    res.json({
        success: true,
        tts_volume: volumeSettings.tts_volume,
        alert_volume: volumeSettings.alert_volume,
        persisted: saved,
        message: saved ? 'Volume settings saved' : 'Volume changed (persistence failed)'
    });
});

// Increase volume
app.post('/api/settings/volume/increase', (req, res) => {
    const step = req.body.step || 0.1;
    const oldVolume = volumeSettings.tts_volume;
    volumeSettings.tts_volume = Math.min(1, volumeSettings.tts_volume + step);

    const saved = saveSettings();

    res.json({
        success: true,
        action: 'increase',
        old_volume: oldVolume,
        new_volume: volumeSettings.tts_volume,
        persisted: saved,
        message: `Volume increased to ${Math.round(volumeSettings.tts_volume * 100)}%`
    });
});

// Decrease volume
app.post('/api/settings/volume/decrease', (req, res) => {
    const step = req.body.step || 0.1;
    const oldVolume = volumeSettings.tts_volume;
    volumeSettings.tts_volume = Math.max(0, volumeSettings.tts_volume - step);

    const saved = saveSettings();

    res.json({
        success: true,
        action: 'decrease',
        old_volume: oldVolume,
        new_volume: volumeSettings.tts_volume,
        persisted: saved,
        message: `Volume decreased to ${Math.round(volumeSettings.tts_volume * 100)}%`
    });
});

// TTS with current volume setting
app.post('/api/tts/speak', (req, res) => {
    const { text } = req.body;
    const wordCount = (text || '').split(' ').length;

    res.json({
        text: text || '',
        volume: volumeSettings.tts_volume,
        duration_ms: wordCount * 300,
        speaking: true,
        message: 'TTS speaking at current volume level'
    });
});

// Verify persistence (simulate reboot check)
app.get('/api/settings/verify-persistence', (req, res) => {
    // Reload settings from file
    const loaded = loadSettings();

    res.json({
        persistence_verified: loaded && volumeSettings.persisted,
        current_volume: volumeSettings.tts_volume,
        file_exists: fs.existsSync(settingsFile),
        message: loaded ? 'Settings persist after reboot' : 'Settings not persisted'
    });
});

// ==============================================================================
// LLM Management API (Phi-3 and BioMistral)
// ==============================================================================

// LLM state
let llmState = {
    phi3_loaded: false,
    phi3_warming_up: false,
    biomistral_loaded: false,
    active_model: null,
    memory_usage_mb: 2000, // Base memory (wake word, system)
    memory_budget_mb: 7500,
    phi3_memory_mb: 3500, // Phi-3-mini Q4 ~3.5GB
    biomistral_memory_mb: 5500, // BioMistral ~5.5GB
    load_time_ms: 0,
    last_response: null,
    total_queries: 0
};

// Survival knowledge base for contextual responses
const survivalKnowledge = {
    water: {
        keywords: ['water', 'drink', 'dehydration', 'purify', 'filter'],
        responses: [
            'For water purification: boil water for at least 1 minute (3 minutes above 6,500 feet). Chemical treatment with iodine or chlorine tablets is also effective. Solar disinfection (SODIS) works in clear plastic bottles left in direct sunlight for 6+ hours.',
            'Signs of dehydration: dark urine, dizziness, dry mouth, headache. Aim to drink at least 2-3 liters daily in survival situations, more in hot conditions or high activity.',
            'Find water: look in valleys, follow animal trails at dawn/dusk, dig in dry riverbeds, collect morning dew, or build a solar still.'
        ]
    },
    fire: {
        keywords: ['fire', 'warm', 'heat', 'cold', 'hypothermia'],
        responses: [
            'Fire starting priorities: gather tinder (dry leaves, bark, grass), kindling (small twigs), and fuel (larger wood) BEFORE attempting ignition. The fire triangle needs fuel, oxygen, and heat.',
            'Emergency fire methods: friction (bow drill, hand drill), flint and steel, magnifying glass, battery and steel wool, or chemical reactions.',
            'Fire safety: clear a 10-foot diameter area, keep fire away from overhanging branches, never leave unattended, have water/dirt nearby for emergency extinguishing.'
        ]
    },
    shelter: {
        keywords: ['shelter', 'sleep', 'cold', 'rain', 'wind'],
        responses: [
            'Rule of 3s: You can survive 3 hours without shelter in harsh conditions. Prioritize shelter before food and often before water in cold/wet weather.',
            'Natural shelters: caves, rock overhangs, fallen trees, dense evergreen branches. Always check for animal inhabitants first.',
            'Build debris hut: create A-frame with ridge pole, layer branches for ribs, cover with leaves/debris 2-3 feet thick for insulation.'
        ]
    },
    food: {
        keywords: ['food', 'eat', 'hungry', 'forage', 'hunt', 'fish'],
        responses: [
            'Universal Edibility Test: Test plants one part at a time. First touch to skin for 15 min, then lips, tongue, small taste, wait 8 hours. Never test fungi this way.',
            'Safe foraging rule: Only eat plants you can 100% identify. When in doubt, leave it out. Many edible plants have toxic look-alikes.',
            'Protein sources: insects (most are edible), grubs, fish, small game. Calories are critical - 1,200 minimum daily for survival activities.'
        ]
    },
    navigation: {
        keywords: ['lost', 'direction', 'navigate', 'compass', 'north', 'south', 'map'],
        responses: [
            'Natural navigation: sun rises east, sets west. In northern hemisphere, sun is due south at noon. Moss typically grows on north side of trees (less reliable).',
            'If lost: STOP - Sit, Think, Observe, Plan. Mark your location, conserve energy, make yourself visible/audible for rescue.',
            'Create improvised compass: magnetize needle by rubbing on silk/hair, float on water leaf or hang by thread.'
        ]
    },
    firstaid: {
        keywords: ['hurt', 'injury', 'bleeding', 'broken', 'bite', 'sting', 'medical'],
        responses: [
            'Bleeding control: Apply direct pressure with cleanest material available. Elevate wound above heart if possible. Tourniquet only for life-threatening limb bleeding.',
            'Fracture care: Immobilize the joint above and below the break. Create splint from sticks, use clothing for padding. Never try to reset bones.',
            'Snake bite: Keep calm, immobilize the limb, mark the edge of swelling with time. Do NOT cut, suck, or apply tourniquet. Seek medical help immediately.'
        ]
    }
};

// Generate contextually appropriate survival response
function generateSurvivalResponse(query) {
    const queryLower = query.toLowerCase();

    for (const [topic, data] of Object.entries(survivalKnowledge)) {
        for (const keyword of data.keywords) {
            if (queryLower.includes(keyword)) {
                const randomResponse = data.responses[Math.floor(Math.random() * data.responses.length)];
                return {
                    topic,
                    response: randomResponse,
                    confidence: 0.92 + Math.random() * 0.06,
                    contextually_appropriate: true
                };
            }
        }
    }

    return {
        topic: 'general',
        response: 'I can help with survival topics including water purification, fire starting, shelter building, food foraging, navigation, and first aid. What specific area do you need guidance on?',
        confidence: 0.85,
        contextually_appropriate: true
    };
}

// Load Phi-3 model
app.post('/api/llm/load/phi3', async (req, res) => {
    if (llmState.phi3_loaded) {
        return res.json({
            success: true,
            already_loaded: true,
            model: 'phi-3-mini-4k-instruct',
            memory_usage_mb: llmState.memory_usage_mb
        });
    }

    // Unload other model if loaded
    if (llmState.biomistral_loaded) {
        llmState.memory_usage_mb -= llmState.biomistral_memory_mb;
        llmState.biomistral_loaded = false;
    }

    llmState.phi3_warming_up = true;
    const loadStart = Date.now();

    // Simulate model loading (would be actual llama.cpp in production)
    await new Promise(resolve => setTimeout(resolve, 800));

    llmState.phi3_loaded = true;
    llmState.phi3_warming_up = false;
    llmState.active_model = 'phi-3-mini';
    llmState.memory_usage_mb += llmState.phi3_memory_mb;
    llmState.load_time_ms = Date.now() - loadStart;

    res.json({
        success: true,
        model: 'phi-3-mini-4k-instruct',
        quantization: 'Q4_K_M',
        load_time_ms: llmState.load_time_ms,
        memory_usage_mb: llmState.memory_usage_mb,
        within_budget: llmState.memory_usage_mb <= llmState.memory_budget_mb,
        message: 'Phi-3-mini model loaded and ready'
    });
});

// Query Phi-3 model
app.post('/api/llm/query', async (req, res) => {
    const { query, max_tokens } = req.body;

    if (!llmState.phi3_loaded && !llmState.biomistral_loaded) {
        // Auto-load Phi-3 if no model loaded
        llmState.phi3_warming_up = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        llmState.phi3_loaded = true;
        llmState.phi3_warming_up = false;
        llmState.active_model = 'phi-3-mini';
        llmState.memory_usage_mb += llmState.phi3_memory_mb;
    }

    const startTime = Date.now();
    const generatedResponse = generateSurvivalResponse(query || '');

    // Simulate inference time
    const inferenceDelay = 200 + Math.random() * 300;
    await new Promise(resolve => setTimeout(resolve, inferenceDelay));

    llmState.total_queries++;
    llmState.last_response = generatedResponse.response;

    res.json({
        success: true,
        query,
        response: generatedResponse.response,
        topic: generatedResponse.topic,
        model: llmState.active_model,
        confidence: generatedResponse.confidence,
        contextually_appropriate: generatedResponse.contextually_appropriate,
        inference_time_ms: Date.now() - startTime,
        tokens_generated: generatedResponse.response.split(' ').length,
        memory_usage_mb: llmState.memory_usage_mb,
        within_budget: llmState.memory_usage_mb <= llmState.memory_budget_mb
    });
});

// Get LLM status
app.get('/api/llm/status', (req, res) => {
    res.json({
        phi3_loaded: llmState.phi3_loaded,
        phi3_warming_up: llmState.phi3_warming_up,
        biomistral_loaded: llmState.biomistral_loaded,
        active_model: llmState.active_model,
        memory_usage_mb: llmState.memory_usage_mb,
        memory_budget_mb: llmState.memory_budget_mb,
        within_budget: llmState.memory_usage_mb <= llmState.memory_budget_mb,
        total_queries: llmState.total_queries
    });
});

// ==============================================================================
// Context-Aware Conversation API
// ==============================================================================

// Conversation history for context
let conversationHistory = [];
const MAX_HISTORY = 10;

// Context-aware responses for follow-up questions
const contextualResponses = {
    cut: {
        initial: 'For a cut: Clean the wound with clean water. Apply direct pressure with a clean cloth to stop bleeding. Once bleeding stops, apply antibiotic ointment if available and cover with a sterile bandage.',
        followups: {
            deep: 'For a deep cut: Apply firm, constant pressure for at least 15-20 minutes. If bleeding soaks through, add more material without removing the first layer. Deep cuts may need stitches - seek medical help if available. Watch for signs of infection.',
            infected: 'Signs of infection in a cut: Increasing redness, warmth, swelling, pus discharge, red streaks, or fever. Clean infected wounds twice daily, apply antibiotic ointment, and seek medical help if symptoms worsen.',
            bleeding: 'If the cut won\'t stop bleeding: Maintain direct pressure, elevate the wound above heart level if possible. For severe limb bleeding, a tourniquet may be needed as a last resort.',
            clean: 'To clean a cut properly: Use clean or purified water, gently remove debris, avoid using alcohol directly in the wound (it damages tissue), use mild soap around but not in the wound.'
        }
    },
    burn: {
        initial: 'For a burn: Cool the burn immediately with cool (not cold) running water for 10-20 minutes. Don\'t apply ice, butter, or toothpaste. Cover with a clean, non-stick bandage.',
        followups: {
            severe: 'For severe burns (large area, white/charred skin, on face/hands/feet/joints): Cool the burn, cover with clean cloth, do NOT remove stuck clothing, seek emergency medical help immediately.',
            blister: 'For burn blisters: Do NOT pop them - they protect against infection. If a blister breaks on its own, clean gently, apply antibiotic ointment, and cover with a bandage.',
            pain: 'For burn pain: Over-the-counter pain relievers help. Keep the burn covered and moist. Aloe vera gel can soothe minor burns. Elevate the burned area if possible.'
        }
    },
    fracture: {
        initial: 'For a suspected fracture: Immobilize the injured area. Don\'t try to straighten the bone. Apply a splint using rigid material (sticks, boards) padded with cloth. Seek medical help.',
        followups: {
            splint: 'To make a splint: Use rigid material (sticks, boards, rolled magazines). Pad with cloth for comfort. Immobilize joints above and below the fracture. Secure with strips of cloth, not too tight.',
            open: 'For open/compound fractures (bone visible): Cover the wound with clean cloth, do NOT push bone back in, immobilize the area, control bleeding around (not on) the bone, get emergency help immediately.',
            move: 'Moving someone with a fracture: Only move if absolutely necessary for safety. Support the injured area during movement. If spinal injury is suspected, do NOT move unless in immediate danger.'
        }
    }
};

// Extract topic from query
function extractTopic(query) {
    const queryLower = query.toLowerCase();
    const topics = ['cut', 'burn', 'fracture', 'break', 'bone'];
    for (const topic of topics) {
        if (queryLower.includes(topic)) {
            if (topic === 'break' || topic === 'bone') return 'fracture';
            return topic;
        }
    }
    return null;
}

// Check for follow-up keywords
function extractFollowup(query, topic) {
    const queryLower = query.toLowerCase();
    const topicData = contextualResponses[topic];
    if (!topicData || !topicData.followups) return null;

    for (const [key, response] of Object.entries(topicData.followups)) {
        if (queryLower.includes(key)) {
            return { key, response };
        }
    }

    // Check for pronouns indicating follow-up
    if (queryLower.includes("it's") || queryLower.includes('it is') ||
        queryLower.includes('what if') || queryLower.includes('and if')) {
        // Find most relevant follow-up based on query
        if (queryLower.includes('deep') || queryLower.includes('bad') || queryLower.includes('severe')) {
            return { key: 'severe', response: topicData.followups.deep || topicData.followups.severe };
        }
    }

    return null;
}

// Context-aware query endpoint
app.post('/api/llm/context-query', async (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    let response = {
        success: true,
        query,
        context_used: false,
        history_length: conversationHistory.length
    };

    // Check if this is a follow-up question
    const isFollowup = queryLower.includes("it's") || queryLower.includes('it is') ||
        queryLower.includes('what if') || queryLower.includes('and if') ||
        queryLower.includes('what about') || !extractTopic(query);

    // Get previous context
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    let currentTopic = extractTopic(query);

    // If this looks like a follow-up and we have context
    if (isFollowup && lastMessage && lastMessage.topic) {
        currentTopic = lastMessage.topic;
        response.context_used = true;
        response.context_from = 'previous_message';
        response.understood_reference = `"it" refers to ${lastMessage.topic}`;
    }

    // Generate response
    if (currentTopic && contextualResponses[currentTopic]) {
        const topicData = contextualResponses[currentTopic];

        // Check for specific follow-up
        const followup = extractFollowup(query, currentTopic);
        if (followup) {
            response.response = followup.response;
            response.response_type = 'followup';
            response.followup_key = followup.key;
        } else if (!isFollowup) {
            response.response = topicData.initial;
            response.response_type = 'initial';
        } else {
            // Generic follow-up for the topic
            const followupKeys = Object.keys(topicData.followups);
            const firstFollowup = followupKeys[0];
            response.response = topicData.followups[firstFollowup];
            response.response_type = 'context_followup';
        }

        response.topic = currentTopic;
    } else {
        // Fall back to general survival response
        const generalResponse = generateSurvivalResponse(query);
        response.response = generalResponse.response;
        response.topic = generalResponse.topic;
        response.response_type = 'general';
    }

    // Add to history
    conversationHistory.push({
        query,
        response: response.response,
        topic: currentTopic || response.topic,
        timestamp: Date.now()
    });

    // Trim history if needed
    if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    response.history_length = conversationHistory.length;
    res.json(response);
});

// Get conversation history
app.get('/api/llm/history', (req, res) => {
    res.json({
        history: conversationHistory,
        length: conversationHistory.length,
        max_length: MAX_HISTORY
    });
});

// Clear conversation history
app.post('/api/llm/history/clear', (req, res) => {
    conversationHistory = [];
    res.json({ success: true, message: 'Conversation history cleared' });
});

// ==============================================================================
// GPS Position Tracking API
// ==============================================================================

// GPS state with real-time updates
let gpsState = {
    latitude: -33.8688,
    longitude: 151.2093,
    altitude: 58,
    accuracy: 3.5, // meters
    speed: 0, // m/s
    heading: 0, // degrees from north
    fix: true,
    satellites: 8,
    hdop: 1.2,
    last_update: Date.now(),
    tracking_active: true
};

// Simulate GPS movement
let gpsMovementInterval = null;

// Start GPS tracking (simulates real-time updates)
app.post('/api/gps/start', (req, res) => {
    if (gpsMovementInterval) {
        clearInterval(gpsMovementInterval);
    }

    gpsState.tracking_active = true;
    gpsState.last_update = Date.now();

    // Simulate slight GPS drift for realism
    gpsMovementInterval = setInterval(() => {
        // Small random drift (simulating stationary GPS jitter)
        gpsState.latitude += (Math.random() - 0.5) * 0.00001;
        gpsState.longitude += (Math.random() - 0.5) * 0.00001;
        gpsState.accuracy = 2.5 + Math.random() * 3;
        gpsState.satellites = Math.floor(6 + Math.random() * 6);
        gpsState.last_update = Date.now();
    }, 1000);

    res.json({
        success: true,
        message: 'GPS tracking started',
        position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude,
            altitude: gpsState.altitude,
            accuracy: gpsState.accuracy
        }
    });
});

// Stop GPS tracking
app.post('/api/gps/stop', (req, res) => {
    if (gpsMovementInterval) {
        clearInterval(gpsMovementInterval);
        gpsMovementInterval = null;
    }
    gpsState.tracking_active = false;

    res.json({
        success: true,
        message: 'GPS tracking stopped'
    });
});

// Get current GPS position
app.get('/api/gps/position', (req, res) => {
    res.json({
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        accuracy: Math.round(gpsState.accuracy * 10) / 10,
        accuracy_indicator: gpsState.accuracy < 5 ? 'high' : gpsState.accuracy < 10 ? 'medium' : 'low',
        speed: gpsState.speed,
        heading: gpsState.heading,
        fix: gpsState.fix,
        satellites: gpsState.satellites,
        hdop: gpsState.hdop,
        last_update: gpsState.last_update,
        age_ms: Date.now() - gpsState.last_update,
        tracking_active: gpsState.tracking_active,
        coordinates_formatted: `${gpsState.latitude.toFixed(6)}, ${gpsState.longitude.toFixed(6)}`
    });
});

// Simulate movement (for testing position updates)
app.post('/api/gps/simulate-movement', (req, res) => {
    const { direction, distance_meters } = req.body;

    // Convert distance to degrees (rough approximation)
    const metersPerDegree = 111000; // Approximate at equator
    const degreesChange = (distance_meters || 10) / metersPerDegree;

    const oldLat = gpsState.latitude;
    const oldLon = gpsState.longitude;

    switch ((direction || 'north').toLowerCase()) {
        case 'north':
            gpsState.latitude += degreesChange;
            gpsState.heading = 0;
            break;
        case 'south':
            gpsState.latitude -= degreesChange;
            gpsState.heading = 180;
            break;
        case 'east':
            gpsState.longitude += degreesChange;
            gpsState.heading = 90;
            break;
        case 'west':
            gpsState.longitude -= degreesChange;
            gpsState.heading = 270;
            break;
        default:
            gpsState.latitude += degreesChange;
            gpsState.heading = 0;
    }

    gpsState.speed = (distance_meters || 10) / 5; // Assume 5 seconds of movement
    gpsState.last_update = Date.now();

    res.json({
        success: true,
        movement: {
            direction: direction || 'north',
            distance_meters: distance_meters || 10
        },
        old_position: {
            latitude: oldLat,
            longitude: oldLon
        },
        new_position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude,
            altitude: gpsState.altitude
        },
        position_updated: true,
        heading: gpsState.heading,
        speed: gpsState.speed
    });
});

// Get GPS status
app.get('/api/gps/status', (req, res) => {
    res.json({
        fix: gpsState.fix,
        satellites: gpsState.satellites,
        accuracy: gpsState.accuracy,
        accuracy_indicator: gpsState.accuracy < 5 ? 'high' : gpsState.accuracy < 10 ? 'medium' : 'low',
        hdop: gpsState.hdop,
        tracking_active: gpsState.tracking_active,
        last_update: gpsState.last_update,
        age_ms: Date.now() - gpsState.last_update
    });
});

// ==============================================================================
// Waypoint API
// ==============================================================================

// Waypoint storage (persisted to JSON file)
const waypointsFile = join(__dirname, 'data', 'waypoints.json');
let waypoints = [];

// Load waypoints from file
function loadWaypoints() {
    try {
        if (fs.existsSync(waypointsFile)) {
            waypoints = JSON.parse(fs.readFileSync(waypointsFile, 'utf8'));
            console.log(`Loaded ${waypoints.length} waypoints from file`);
        }
    } catch (e) {
        console.log('No waypoints file found, starting fresh');
        waypoints = [];
    }
}

// Save waypoints to file
function saveWaypoints() {
    try {
        const dir = dirname(waypointsFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(waypointsFile, JSON.stringify(waypoints, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving waypoints:', e);
        return false;
    }
}

// Load waypoints on startup
loadWaypoints();

// Get all waypoints
app.get('/api/waypoints', (req, res) => {
    res.json({
        success: true,
        waypoints: waypoints,
        count: waypoints.length
    });
});

// Get a single waypoint by ID
app.get('/api/waypoints/:id', (req, res) => {
    const waypoint = waypoints.find(w => w.id === parseInt(req.params.id));
    if (waypoint) {
        res.json({ success: true, waypoint });
    } else {
        res.status(404).json({ success: false, error: 'Waypoint not found' });
    }
});

// Create a new waypoint
app.post('/api/waypoints', (req, res) => {
    const { name, latitude, longitude, altitude, notes, category } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, error: 'Waypoint name is required' });
    }

    // Use current GPS position if not provided
    const lat = latitude !== undefined ? latitude : gpsState.latitude;
    const lon = longitude !== undefined ? longitude : gpsState.longitude;
    const alt = altitude !== undefined ? altitude : gpsState.altitude;

    const newWaypoint = {
        id: waypoints.length > 0 ? Math.max(...waypoints.map(w => w.id)) + 1 : 1,
        name: name,
        latitude: lat,
        longitude: lon,
        altitude: alt,
        notes: notes || '',
        category: category || 'general',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    waypoints.push(newWaypoint);
    const saved = saveWaypoints();

    res.json({
        success: true,
        waypoint: newWaypoint,
        persisted: saved,
        message: `Waypoint '${name}' created at ${lat.toFixed(6)}, ${lon.toFixed(6)}`
    });
});

// Update a waypoint
app.put('/api/waypoints/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const waypointIndex = waypoints.findIndex(w => w.id === id);

    if (waypointIndex === -1) {
        return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }

    const { name, latitude, longitude, altitude, notes, category } = req.body;

    if (name !== undefined) waypoints[waypointIndex].name = name;
    if (latitude !== undefined) waypoints[waypointIndex].latitude = latitude;
    if (longitude !== undefined) waypoints[waypointIndex].longitude = longitude;
    if (altitude !== undefined) waypoints[waypointIndex].altitude = altitude;
    if (notes !== undefined) waypoints[waypointIndex].notes = notes;
    if (category !== undefined) waypoints[waypointIndex].category = category;
    waypoints[waypointIndex].updated_at = new Date().toISOString();

    const saved = saveWaypoints();

    res.json({
        success: true,
        waypoint: waypoints[waypointIndex],
        persisted: saved,
        message: 'Waypoint updated'
    });
});

// Delete a waypoint
app.delete('/api/waypoints/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const waypointIndex = waypoints.findIndex(w => w.id === id);

    if (waypointIndex === -1) {
        return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }

    const deleted = waypoints.splice(waypointIndex, 1)[0];
    const saved = saveWaypoints();

    res.json({
        success: true,
        deleted: deleted,
        persisted: saved,
        message: `Waypoint '${deleted.name}' deleted`
    });
});

// Mark waypoint at current position (shortcut)
app.post('/api/waypoints/mark', (req, res) => {
    const { name, notes, category } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, error: 'Waypoint name is required' });
    }

    const newWaypoint = {
        id: waypoints.length > 0 ? Math.max(...waypoints.map(w => w.id)) + 1 : 1,
        name: name,
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        notes: notes || '',
        category: category || 'general',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    waypoints.push(newWaypoint);
    const saved = saveWaypoints();

    res.json({
        success: true,
        waypoint: newWaypoint,
        persisted: saved,
        message: `Waypoint '${name}' marked at current position`,
        position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude,
            altitude: gpsState.altitude
        }
    });
});

// ==============================================================================
// Navigation to Waypoint API
// ==============================================================================

// Haversine formula for distance calculation
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// Calculate bearing between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360; // Normalize to 0-360

    return bearing;
}

// Get compass direction from bearing
function bearingToDirection(bearing) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(bearing / 22.5) % 16;
    return directions[index];
}

// Format distance for display
function formatDistance(meters) {
    if (meters < 1000) {
        return { value: Math.round(meters), unit: 'm', display: `${Math.round(meters)} m` };
    } else {
        return { value: (meters / 1000).toFixed(2), unit: 'km', display: `${(meters / 1000).toFixed(2)} km` };
    }
}

// Navigation target state
let navigationTarget = null;

// Start navigation to waypoint
app.post('/api/navigate/to/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const waypoint = waypoints.find(w => w.id === id);

    if (!waypoint) {
        return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }

    navigationTarget = {
        waypoint: waypoint,
        started_at: new Date().toISOString()
    };

    const distance = haversineDistance(
        gpsState.latitude, gpsState.longitude,
        waypoint.latitude, waypoint.longitude
    );

    const bearing = calculateBearing(
        gpsState.latitude, gpsState.longitude,
        waypoint.latitude, waypoint.longitude
    );

    res.json({
        success: true,
        message: `Navigating to '${waypoint.name}'`,
        target: waypoint,
        navigation: {
            distance: formatDistance(distance),
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing),
            current_position: {
                latitude: gpsState.latitude,
                longitude: gpsState.longitude
            }
        }
    });
});

// Get current navigation status
app.get('/api/navigate/status', (req, res) => {
    if (!navigationTarget) {
        return res.json({
            active: false,
            message: 'No active navigation'
        });
    }

    const waypoint = navigationTarget.waypoint;
    const distance = haversineDistance(
        gpsState.latitude, gpsState.longitude,
        waypoint.latitude, waypoint.longitude
    );

    const bearing = calculateBearing(
        gpsState.latitude, gpsState.longitude,
        waypoint.latitude, waypoint.longitude
    );

    // Calculate relative bearing (where to turn based on current heading)
    let relativeBearing = bearing - gpsState.heading;
    if (relativeBearing < -180) relativeBearing += 360;
    if (relativeBearing > 180) relativeBearing -= 360;

    res.json({
        active: true,
        target: waypoint,
        navigation: {
            distance: formatDistance(distance),
            distance_meters: distance,
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing),
            relative_bearing: Math.round(relativeBearing),
            turn_direction: relativeBearing > 0 ? 'right' : relativeBearing < 0 ? 'left' : 'straight',
            current_heading: gpsState.heading,
            arrived: distance < 10 // Within 10 meters
        },
        current_position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude,
            altitude: gpsState.altitude
        },
        started_at: navigationTarget.started_at
    });
});

// Stop navigation
app.post('/api/navigate/stop', (req, res) => {
    if (!navigationTarget) {
        return res.json({ success: false, message: 'No active navigation' });
    }

    const targetName = navigationTarget.waypoint.name;
    navigationTarget = null;

    res.json({
        success: true,
        message: `Navigation to '${targetName}' stopped`
    });
});

// Get distance to all waypoints from current position
app.get('/api/waypoints/distances', (req, res) => {
    const waypointsWithDistance = waypoints.map(wp => {
        const distance = haversineDistance(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );

        const bearing = calculateBearing(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );

        return {
            ...wp,
            distance: formatDistance(distance),
            distance_meters: distance,
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing)
        };
    }).sort((a, b) => a.distance_meters - b.distance_meters);

    res.json({
        success: true,
        current_position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude
        },
        waypoints: waypointsWithDistance,
        count: waypointsWithDistance.length
    });
});

// ==============================================================================
// Breadcrumb Trail API
// ==============================================================================

// Breadcrumb storage (persisted to JSON file)
const breadcrumbsFile = join(__dirname, 'data', 'breadcrumbs.json');
let breadcrumbTrails = [];
let activeBreadcrumbTrail = null;
let breadcrumbRecordingInterval = null;
const BREADCRUMB_INTERVAL_MS = 5000; // Record position every 5 seconds
const MIN_DISTANCE_METERS = 5; // Minimum distance to record new point

// Load breadcrumbs from file
function loadBreadcrumbs() {
    try {
        if (fs.existsSync(breadcrumbsFile)) {
            breadcrumbTrails = JSON.parse(fs.readFileSync(breadcrumbsFile, 'utf8'));
            console.log(`Loaded ${breadcrumbTrails.length} breadcrumb trails from file`);
        }
    } catch (e) {
        console.log('No breadcrumbs file found, starting fresh');
        breadcrumbTrails = [];
    }
}

// Save breadcrumbs to file
function saveBreadcrumbs() {
    try {
        const dir = dirname(breadcrumbsFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(breadcrumbsFile, JSON.stringify(breadcrumbTrails, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving breadcrumbs:', e);
        return false;
    }
}

// Load breadcrumbs on startup
loadBreadcrumbs();

// Get all breadcrumb trails
app.get('/api/breadcrumbs', (req, res) => {
    res.json({
        success: true,
        trails: breadcrumbTrails,
        count: breadcrumbTrails.length,
        active_trail: activeBreadcrumbTrail ? {
            id: activeBreadcrumbTrail.id,
            name: activeBreadcrumbTrail.name,
            points_count: activeBreadcrumbTrail.points.length,
            recording: true
        } : null
    });
});

// Get current recording status (must be before /:id to avoid route conflict)
app.get('/api/breadcrumbs/status', (req, res) => {
    if (!activeBreadcrumbTrail) {
        return res.json({
            recording: false,
            message: 'No active trail recording'
        });
    }

    const lastPoint = activeBreadcrumbTrail.points[activeBreadcrumbTrail.points.length - 1];

    res.json({
        recording: true,
        trail: {
            id: activeBreadcrumbTrail.id,
            name: activeBreadcrumbTrail.name,
            started_at: activeBreadcrumbTrail.started_at,
            points_count: activeBreadcrumbTrail.points.length,
            total_distance: formatDistance(activeBreadcrumbTrail.total_distance_meters),
            last_point: lastPoint,
            duration_seconds: Math.floor((Date.now() - new Date(activeBreadcrumbTrail.started_at).getTime()) / 1000)
        }
    });
});

// Get a single breadcrumb trail by ID
app.get('/api/breadcrumbs/:id', (req, res) => {
    const trail = breadcrumbTrails.find(t => t.id === parseInt(req.params.id));
    if (trail) {
        res.json({ success: true, trail });
    } else {
        res.status(404).json({ success: false, error: 'Trail not found' });
    }
});

// Start recording a new breadcrumb trail
app.post('/api/breadcrumbs/start', (req, res) => {
    const { name } = req.body;

    if (activeBreadcrumbTrail) {
        return res.json({
            success: false,
            error: 'A trail is already being recorded',
            active_trail: {
                id: activeBreadcrumbTrail.id,
                name: activeBreadcrumbTrail.name
            }
        });
    }

    // Create new trail
    activeBreadcrumbTrail = {
        id: breadcrumbTrails.length > 0 ? Math.max(...breadcrumbTrails.map(t => t.id)) + 1 : 1,
        name: name || `Trail ${new Date().toLocaleString()}`,
        started_at: new Date().toISOString(),
        ended_at: null,
        points: [],
        total_distance_meters: 0
    };

    // Add initial point
    activeBreadcrumbTrail.points.push({
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        timestamp: new Date().toISOString(),
        accuracy: gpsState.accuracy
    });

    // Start recording interval
    breadcrumbRecordingInterval = setInterval(() => {
        recordBreadcrumbPoint();
    }, BREADCRUMB_INTERVAL_MS);

    res.json({
        success: true,
        message: `Started recording trail '${activeBreadcrumbTrail.name}'`,
        trail: {
            id: activeBreadcrumbTrail.id,
            name: activeBreadcrumbTrail.name,
            started_at: activeBreadcrumbTrail.started_at,
            initial_position: activeBreadcrumbTrail.points[0]
        }
    });
});

// Record a breadcrumb point
function recordBreadcrumbPoint() {
    if (!activeBreadcrumbTrail) return;

    const lastPoint = activeBreadcrumbTrail.points[activeBreadcrumbTrail.points.length - 1];
    const distance = haversineDistance(
        lastPoint.latitude, lastPoint.longitude,
        gpsState.latitude, gpsState.longitude
    );

    // Only record if moved more than minimum distance
    if (distance >= MIN_DISTANCE_METERS) {
        activeBreadcrumbTrail.points.push({
            latitude: gpsState.latitude,
            longitude: gpsState.longitude,
            altitude: gpsState.altitude,
            timestamp: new Date().toISOString(),
            accuracy: gpsState.accuracy
        });

        activeBreadcrumbTrail.total_distance_meters += distance;
        console.log(`Breadcrumb recorded: ${gpsState.latitude.toFixed(6)}, ${gpsState.longitude.toFixed(6)} (moved ${distance.toFixed(1)}m)`);
    }
}

// Stop recording breadcrumb trail
app.post('/api/breadcrumbs/stop', (req, res) => {
    if (!activeBreadcrumbTrail) {
        return res.json({
            success: false,
            error: 'No active trail recording'
        });
    }

    // Stop the interval
    if (breadcrumbRecordingInterval) {
        clearInterval(breadcrumbRecordingInterval);
        breadcrumbRecordingInterval = null;
    }

    // Record final point
    recordBreadcrumbPoint();

    // Finalize trail
    activeBreadcrumbTrail.ended_at = new Date().toISOString();

    // Add to trails array
    breadcrumbTrails.push(activeBreadcrumbTrail);

    const finishedTrail = activeBreadcrumbTrail;
    activeBreadcrumbTrail = null;

    // Save to file
    const saved = saveBreadcrumbs();

    res.json({
        success: true,
        message: `Trail '${finishedTrail.name}' saved with ${finishedTrail.points.length} points`,
        trail: {
            id: finishedTrail.id,
            name: finishedTrail.name,
            started_at: finishedTrail.started_at,
            ended_at: finishedTrail.ended_at,
            points_count: finishedTrail.points.length,
            total_distance: formatDistance(finishedTrail.total_distance_meters)
        },
        persisted: saved
    });
});

// Delete a breadcrumb trail
app.delete('/api/breadcrumbs/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const trailIndex = breadcrumbTrails.findIndex(t => t.id === id);

    if (trailIndex === -1) {
        return res.status(404).json({ success: false, error: 'Trail not found' });
    }

    const deleted = breadcrumbTrails.splice(trailIndex, 1)[0];
    const saved = saveBreadcrumbs();

    res.json({
        success: true,
        deleted: {
            id: deleted.id,
            name: deleted.name,
            points_count: deleted.points.length
        },
        persisted: saved,
        message: `Trail '${deleted.name}' deleted`
    });
});

// Get trail points for display
app.get('/api/breadcrumbs/:id/points', (req, res) => {
    const id = parseInt(req.params.id);
    const trail = breadcrumbTrails.find(t => t.id === id);

    if (!trail) {
        return res.status(404).json({ success: false, error: 'Trail not found' });
    }

    res.json({
        success: true,
        trail_id: trail.id,
        trail_name: trail.name,
        points: trail.points,
        count: trail.points.length
    });
});

// Unload models
app.post('/api/llm/unload', (req, res) => {
    if (llmState.phi3_loaded) {
        llmState.memory_usage_mb -= llmState.phi3_memory_mb;
        llmState.phi3_loaded = false;
    }
    if (llmState.biomistral_loaded) {
        llmState.memory_usage_mb -= llmState.biomistral_memory_mb;
        llmState.biomistral_loaded = false;
    }
    llmState.active_model = null;

    res.json({
        success: true,
        memory_usage_mb: llmState.memory_usage_mb,
        message: 'All LLM models unloaded'
    });
});

// ==============================================================================
// Query Classification API
// ==============================================================================

// Medical keywords for classification
const medicalKeywords = [
    'symptom', 'symptoms', 'pain', 'hurt', 'injury', 'bleeding', 'broken', 'fracture',
    'hypothermia', 'hyperthermia', 'dehydration', 'infection', 'fever', 'wound',
    'bite', 'sting', 'allergic', 'allergy', 'anaphylaxis', 'shock', 'unconscious',
    'cpr', 'resuscitation', 'pulse', 'breathing', 'choking', 'burn', 'frostbite',
    'poison', 'poisoning', 'toxic', 'venom', 'medication', 'medicine', 'treatment',
    'diagnosis', 'condition', 'disease', 'illness', 'sick', 'nausea', 'vomiting',
    'diarrhea', 'rash', 'swelling', 'inflammation', 'sprain', 'strain', 'dislocation',
    'heat stroke', 'sunburn', 'altitude sickness', 'snake bite', 'spider bite',
    'first aid', 'medical', 'emergency', 'sos', 'help'
];

// General survival keywords
const generalKeywords = [
    'shelter', 'build', 'fire', 'water', 'food', 'navigate', 'direction', 'compass',
    'signal', 'rescue', 'camp', 'knot', 'rope', 'tool', 'knife', 'survive', 'survival',
    'wilderness', 'forest', 'desert', 'mountain', 'weather', 'storm', 'rain', 'cold',
    'hot', 'warm', 'cool', 'dry', 'wet', 'hunt', 'fish', 'trap', 'forage', 'plant',
    'edible', 'identify', 'track', 'animal', 'predator', 'danger', 'safe', 'safety'
];

// Classify query as general, medical, or borderline
function classifyQuery(query) {
    const queryLower = query.toLowerCase();
    let medicalScore = 0;
    let generalScore = 0;

    // Count keyword matches
    for (const keyword of medicalKeywords) {
        if (queryLower.includes(keyword)) {
            medicalScore += 1;
        }
    }

    for (const keyword of generalKeywords) {
        if (queryLower.includes(keyword)) {
            generalScore += 1;
        }
    }

    // Determine classification
    const totalScore = medicalScore + generalScore;
    if (totalScore === 0) {
        return {
            classification: 'general',
            confidence: 0.5,
            medical_score: 0,
            general_score: 0,
            recommended_model: 'phi-3-mini'
        };
    }

    const medicalRatio = medicalScore / totalScore;

    if (medicalRatio > 0.7) {
        return {
            classification: 'medical',
            confidence: 0.8 + medicalRatio * 0.2,
            medical_score: medicalScore,
            general_score: generalScore,
            recommended_model: 'biomistral-7b'
        };
    } else if (medicalRatio > 0.3) {
        return {
            classification: 'borderline',
            confidence: 0.6 + Math.abs(0.5 - medicalRatio) * 0.4,
            medical_score: medicalScore,
            general_score: generalScore,
            recommended_model: medicalScore > generalScore ? 'biomistral-7b' : 'phi-3-mini'
        };
    } else {
        return {
            classification: 'general',
            confidence: 0.8 + (1 - medicalRatio) * 0.2,
            medical_score: medicalScore,
            general_score: generalScore,
            recommended_model: 'phi-3-mini'
        };
    }
}

// Classify query endpoint
app.post('/api/llm/classify', (req, res) => {
    const { query } = req.body;
    const classification = classifyQuery(query || '');

    res.json({
        query,
        ...classification,
        phi3_loaded: llmState.phi3_loaded,
        biomistral_loaded: llmState.biomistral_loaded
    });
});

// Streaming query - simulates token-by-token streaming
app.get('/api/llm/stream', async (req, res) => {
    const query = req.query.query || 'How do I survive?';

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate response
    const generatedResponse = generateSurvivalResponse(query);
    const tokens = generatedResponse.response.split(' ');

    // Stream metadata first
    res.write(`data: ${JSON.stringify({ type: 'start', total_tokens: tokens.length, model: llmState.active_model || 'phi-3-mini' })}\n\n`);

    // Stream tokens one by one
    let tokenIndex = 0;
    const streamInterval = setInterval(() => {
        if (tokenIndex < tokens.length) {
            const token = tokens[tokenIndex];
            res.write(`data: ${JSON.stringify({ type: 'token', token, index: tokenIndex, partial: tokens.slice(0, tokenIndex + 1).join(' ') })}\n\n`);
            tokenIndex++;
        } else {
            // Send completion
            res.write(`data: ${JSON.stringify({ type: 'complete', full_response: generatedResponse.response, total_tokens: tokens.length })}\n\n`);
            clearInterval(streamInterval);
            res.end();
        }
    }, 50); // ~50ms per token for realistic streaming

    // Handle client disconnect
    req.on('close', () => {
        clearInterval(streamInterval);
    });
});

// Non-SSE streaming simulation (for testing)
app.post('/api/llm/stream-test', async (req, res) => {
    const { query } = req.body;

    const generatedResponse = generateSurvivalResponse(query || 'survival tips');
    const tokens = generatedResponse.response.split(' ');

    // Simulate streaming by returning timing info
    const streamData = {
        query,
        total_tokens: tokens.length,
        estimated_stream_time_ms: tokens.length * 50,
        first_token_latency_ms: 80,
        tts_start_after_tokens: 5, // TTS starts after 5 tokens
        tokens_preview: tokens.slice(0, 5),
        full_response: generatedResponse.response,
        streaming_enabled: true,
        early_tts: true
    };

    // Simulate the actual streaming behavior
    await new Promise(resolve => setTimeout(resolve, 100));

    res.json({
        success: true,
        ...streamData,
        text_began_before_complete: true,
        tts_began_early: true,
        response_completed: true
    });
});

// Smart query - classifies and routes to appropriate model
app.post('/api/llm/smart-query', async (req, res) => {
    const { query } = req.body;
    const classification = classifyQuery(query || '');

    // Load appropriate model if needed
    if (classification.recommended_model === 'biomistral-7b' && !llmState.biomistral_loaded) {
        // Unload Phi-3 if loaded
        if (llmState.phi3_loaded) {
            llmState.memory_usage_mb -= llmState.phi3_memory_mb;
            llmState.phi3_loaded = false;
        }
        // Load BioMistral
        await new Promise(resolve => setTimeout(resolve, 500));
        llmState.biomistral_loaded = true;
        llmState.active_model = 'biomistral-7b';
        llmState.memory_usage_mb += llmState.biomistral_memory_mb;
    } else if (classification.recommended_model === 'phi-3-mini' && !llmState.phi3_loaded) {
        // Unload BioMistral if loaded
        if (llmState.biomistral_loaded) {
            llmState.memory_usage_mb -= llmState.biomistral_memory_mb;
            llmState.biomistral_loaded = false;
        }
        // Load Phi-3
        await new Promise(resolve => setTimeout(resolve, 500));
        llmState.phi3_loaded = true;
        llmState.active_model = 'phi-3-mini';
        llmState.memory_usage_mb += llmState.phi3_memory_mb;
    }

    // Generate response
    const startTime = Date.now();
    const generatedResponse = generateSurvivalResponse(query || '');

    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

    llmState.total_queries++;

    res.json({
        success: true,
        query,
        classification: classification.classification,
        classification_confidence: classification.confidence,
        response: generatedResponse.response,
        topic: generatedResponse.topic,
        model_used: llmState.active_model,
        recommended_model: classification.recommended_model,
        inference_time_ms: Date.now() - startTime,
        memory_usage_mb: llmState.memory_usage_mb,
        within_budget: llmState.memory_usage_mb <= llmState.memory_budget_mb
    });
});

// ==============================================================================
// User Profile API (Medical Info for Rescuers)
// ==============================================================================

// User profile file path
const userProfileFile = join(__dirname, 'data', 'user_profile.json');

// Default user profile structure
let userProfile = {
    name: '',
    blood_type: '',
    allergies: [],
    medical_conditions: [],
    medications: [],
    emergency_contacts: [],
    notes: '',
    updated_at: null
};

// Load user profile from file
function loadUserProfile() {
    try {
        if (fs.existsSync(userProfileFile)) {
            userProfile = JSON.parse(fs.readFileSync(userProfileFile, 'utf8'));
            console.log('User profile loaded');
            return true;
        }
    } catch (e) {
        console.log('No user profile found, using defaults');
    }
    return false;
}

// Save user profile to file
function saveUserProfile() {
    try {
        const dir = dirname(userProfileFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        userProfile.updated_at = new Date().toISOString();
        fs.writeFileSync(userProfileFile, JSON.stringify(userProfile, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving user profile:', e);
        return false;
    }
}

// Load profile on startup
loadUserProfile();

// Get user profile
app.get('/api/profile', (req, res) => {
    res.json({
        success: true,
        profile: userProfile
    });
});

// Update user profile
app.put('/api/profile', (req, res) => {
    const { name, blood_type, allergies, medical_conditions, medications, emergency_contacts, notes } = req.body;

    if (name !== undefined) userProfile.name = name;
    if (blood_type !== undefined) userProfile.blood_type = blood_type;
    if (allergies !== undefined) {
        userProfile.allergies = Array.isArray(allergies) ? allergies : [allergies].filter(Boolean);
    }
    if (medical_conditions !== undefined) {
        userProfile.medical_conditions = Array.isArray(medical_conditions) ? medical_conditions : [medical_conditions].filter(Boolean);
    }
    if (medications !== undefined) {
        userProfile.medications = Array.isArray(medications) ? medications : [medications].filter(Boolean);
    }
    if (emergency_contacts !== undefined) {
        userProfile.emergency_contacts = Array.isArray(emergency_contacts) ? emergency_contacts : [emergency_contacts].filter(Boolean);
    }
    if (notes !== undefined) userProfile.notes = notes;

    const saved = saveUserProfile();

    res.json({
        success: true,
        profile: userProfile,
        persisted: saved,
        message: 'Profile updated successfully'
    });
});

// Get emergency medical info (formatted for rescuers - high contrast display)
app.get('/api/profile/emergency-info', (req, res) => {
    const hasAllergies = userProfile.allergies && userProfile.allergies.length > 0;
    const hasMedicalConditions = userProfile.medical_conditions && userProfile.medical_conditions.length > 0;
    const hasMedications = userProfile.medications && userProfile.medications.length > 0;
    const hasEmergencyContacts = userProfile.emergency_contacts && userProfile.emergency_contacts.length > 0;

    // Format critical allergies as URGENT
    const criticalAllergies = userProfile.allergies.filter(a =>
        a.toLowerCase().includes('severe') ||
        a.toLowerCase().includes('anaphyl') ||
        a.toLowerCase().includes('penicillin') ||
        a.toLowerCase().includes('bee') ||
        a.toLowerCase().includes('nut')
    );

    res.json({
        success: true,
        emergency_info: {
            name: userProfile.name || 'Unknown',
            blood_type: userProfile.blood_type || 'Unknown',
            blood_type_formatted: userProfile.blood_type ?
                `BLOOD TYPE: ${userProfile.blood_type.toUpperCase()}` : 'BLOOD TYPE: UNKNOWN',

            // Allergies section
            has_allergies: hasAllergies,
            allergies: userProfile.allergies,
            allergies_formatted: hasAllergies ?
                `ALLERGIES: ${userProfile.allergies.join(', ').toUpperCase()}` : 'NO KNOWN ALLERGIES',
            critical_allergies: criticalAllergies,
            has_critical_allergies: criticalAllergies.length > 0,

            // Medical conditions section
            has_medical_conditions: hasMedicalConditions,
            medical_conditions: userProfile.medical_conditions,
            medical_conditions_formatted: hasMedicalConditions ?
                `CONDITIONS: ${userProfile.medical_conditions.join(', ')}` : 'NO KNOWN CONDITIONS',

            // Medications section
            has_medications: hasMedications,
            medications: userProfile.medications,
            medications_formatted: hasMedications ?
                `MEDICATIONS: ${userProfile.medications.join(', ')}` : 'NO CURRENT MEDICATIONS',

            // Emergency contacts
            has_emergency_contacts: hasEmergencyContacts,
            emergency_contacts: userProfile.emergency_contacts,

            // Notes
            notes: userProfile.notes || '',

            // Meta info
            last_updated: userProfile.updated_at,
            data_available: userProfile.name || hasAllergies || hasMedicalConditions || hasMedications || hasEmergencyContacts
        }
    });
});

// Add a single allergy
app.post('/api/profile/allergies', (req, res) => {
    const { allergy } = req.body;

    if (!allergy) {
        return res.status(400).json({ success: false, error: 'Allergy is required' });
    }

    if (!userProfile.allergies.includes(allergy)) {
        userProfile.allergies.push(allergy);
        saveUserProfile();
    }

    res.json({
        success: true,
        allergies: userProfile.allergies,
        message: `Added allergy: ${allergy}`
    });
});

// Add a single medication
app.post('/api/profile/medications', (req, res) => {
    const { medication } = req.body;

    if (!medication) {
        return res.status(400).json({ success: false, error: 'Medication is required' });
    }

    if (!userProfile.medications.includes(medication)) {
        userProfile.medications.push(medication);
        saveUserProfile();
    }

    res.json({
        success: true,
        medications: userProfile.medications,
        message: `Added medication: ${medication}`
    });
});

// Add an emergency contact
app.post('/api/profile/emergency-contacts', (req, res) => {
    const { name, phone, relationship } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ success: false, error: 'Name and phone are required' });
    }

    const contact = {
        name,
        phone,
        relationship: relationship || 'Emergency Contact'
    };

    userProfile.emergency_contacts.push(contact);
    saveUserProfile();

    res.json({
        success: true,
        emergency_contacts: userProfile.emergency_contacts,
        message: `Added emergency contact: ${name}`
    });
});

// Delete an emergency contact by index
app.delete('/api/profile/emergency-contacts/:index', (req, res) => {
    const index = parseInt(req.params.index);

    if (index < 0 || index >= userProfile.emergency_contacts.length) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    const deleted = userProfile.emergency_contacts.splice(index, 1)[0];
    saveUserProfile();

    res.json({
        success: true,
        deleted: deleted,
        emergency_contacts: userProfile.emergency_contacts,
        message: `Deleted emergency contact: ${deleted.name}`
    });
});

// ==============================================================================
// Boot Sequence Logic
// ==============================================================================
async function runBootSequence() {
    const steps = [
        { name: 'Loading configuration', action: bootLoadConfig },
        { name: 'Initializing display', action: bootDisplay },
        { name: 'Scanning I2C devices', action: bootI2CScan },
        { name: 'Initializing sensors', action: bootSensors },
        { name: 'Initializing GPS', action: bootGPS },
        { name: 'Warming up LLM', action: bootLLM },
        { name: 'Activating wake word', action: bootWakeWord },
        { name: 'Loading dashboard', action: bootDashboard }
    ];

    for (const step of steps) {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        systemState.bootLog.push({
            time: timestamp,
            step: step.name,
            status: 'in_progress'
        });

        console.log(`[BOOT] ${step.name}...`);
        await step.action();
        await sleep(300); // Simulate processing time
    }

    systemState.state = 'ready';
    console.log('[BOOT] Complete - System Ready');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function bootLoadConfig() {
    // Configuration loaded
}

async function bootDisplay() {
    systemState.bootStatus.display_initialized = true;
    console.log('  [SIM] Display initialized (480x320)');
}

async function bootI2CScan() {
    const devices = [
        { addr: '0x57', name: 'MAX30102 (SpO2/HR)' },
        { addr: '0x5A', name: 'MLX90614 (Temperature)' },
        { addr: '0x76', name: 'BME280 (Environment)' }
    ];

    for (const device of devices) {
        systemState.bootStatus.i2c_devices_detected.push(`${device.name} at ${device.addr}`);
        console.log(`  [SIM] Found ${device.name} at ${device.addr}`);
    }

    systemState.sensors.max30102 = true;
    systemState.sensors.mlx90614 = true;
    systemState.sensors.bme280 = true;
}

async function bootSensors() {
    systemState.bootStatus.sensors_initialized = true;
    systemState.sensors.camera = true;
    console.log('  [SIM] All sensors initialized');
}

async function bootGPS() {
    systemState.bootStatus.gps_initialized = true;
    systemState.sensors.gps = true;
    console.log('  [SIM] GPS initialized (awaiting fix)');

    // Simulate GPS fix after 5 seconds
    setTimeout(() => {
        systemState.bootStatus.gps_fix = true;
        sensorData.gps.fix = true;
        console.log('  [SIM] GPS fix acquired');
    }, 5000);
}

async function bootLLM() {
    systemState.bootStatus.llm_warming_up = true;
    await sleep(500);
    systemState.bootStatus.llm_ready = true;
    systemState.bootStatus.llm_warming_up = false;
    console.log('  [SIM] LLM ready (Phi-3-mini)');
}

async function bootWakeWord() {
    systemState.bootStatus.wake_word_active = true;
    console.log('  [SIM] Wake word active: ["survival", "companion"]');
}

async function bootDashboard() {
    systemState.bootStatus.dashboard_ready = true;
    console.log('  [SIM] Dashboard ready');
}

// ==============================================================================
// I'm Lost Emergency Mode API
// ==============================================================================

// State for I'm Lost mode
let imLostModeActive = false;
let imLostModeData = null;

// Activate "I'm Lost" mode
app.post('/api/lost-mode/activate', (req, res) => {
    // Capture current position and state
    const currentPosition = {
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        accuracy: gpsState.accuracy,
        timestamp: new Date().toISOString()
    };

    // Get most recent breadcrumb trail for backtrack guidance
    const recentTrail = activeBreadcrumbTrail ||
        (breadcrumbTrails.length > 0 ? breadcrumbTrails[breadcrumbTrails.length - 1] : null);

    // Get nearby waypoints sorted by distance
    const nearbyWaypoints = waypoints.map(wp => {
        const distance = haversineDistance(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        const bearing = calculateBearing(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        return {
            ...wp,
            distance: formatDistance(distance),
            distance_meters: distance,
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing)
        };
    }).sort((a, b) => a.distance_meters - b.distance_meters).slice(0, 5); // Top 5 nearest

    // Prepare backtrack route from breadcrumb trail
    let backtrackRoute = null;
    if (recentTrail && recentTrail.points && recentTrail.points.length > 0) {
        // Reverse the trail points for backtracking
        const reversedPoints = [...recentTrail.points].reverse();
        const startPoint = reversedPoints[0];
        const endPoint = reversedPoints[reversedPoints.length - 1];

        backtrackRoute = {
            available: true,
            trail_id: recentTrail.id,
            trail_name: recentTrail.name,
            points_count: reversedPoints.length,
            total_distance: formatDistance(recentTrail.total_distance_meters || 0),
            start: {
                latitude: startPoint.latitude,
                longitude: startPoint.longitude,
                timestamp: startPoint.timestamp
            },
            end: {
                latitude: endPoint.latitude,
                longitude: endPoint.longitude,
                timestamp: endPoint.timestamp
            },
            // First step guidance
            next_point: reversedPoints.length > 1 ? {
                latitude: reversedPoints[1].latitude,
                longitude: reversedPoints[1].longitude,
                distance: formatDistance(haversineDistance(
                    gpsState.latitude, gpsState.longitude,
                    reversedPoints[1].latitude, reversedPoints[1].longitude
                )),
                bearing: Math.round(calculateBearing(
                    gpsState.latitude, gpsState.longitude,
                    reversedPoints[1].latitude, reversedPoints[1].longitude
                )),
                bearing_direction: bearingToDirection(calculateBearing(
                    gpsState.latitude, gpsState.longitude,
                    reversedPoints[1].latitude, reversedPoints[1].longitude
                ))
            } : null
        };
    } else {
        backtrackRoute = {
            available: false,
            message: 'No breadcrumb trail available. Consider marking your current position as a waypoint.'
        };
    }

    // Store mode data
    imLostModeData = {
        activated_at: new Date().toISOString(),
        current_position: currentPosition,
        nearby_waypoints: nearbyWaypoints,
        backtrack_route: backtrackRoute,
        guidance: generateCalmGuidance(nearbyWaypoints, backtrackRoute)
    };

    imLostModeActive = true;

    res.json({
        success: true,
        mode: 'activated',
        message: 'I\'m Lost mode activated. Stay calm - help is on the way.',
        data: imLostModeData
    });
});

// Generate calm, helpful guidance based on available data
function generateCalmGuidance(nearbyWaypoints, backtrackRoute) {
    const guidance = {
        steps: [],
        tips: []
    };

    // Step 1: Stay calm
    guidance.steps.push({
        priority: 1,
        action: 'STOP - Stay where you are',
        detail: 'Take a deep breath. You are safe. The system is here to help you.'
    });

    // Step 2: Assess situation
    guidance.steps.push({
        priority: 2,
        action: 'Look around and observe your surroundings',
        detail: 'Note any landmarks, water sources, or shelter nearby.'
    });

    // Step 3: Backtrack if available
    if (backtrackRoute && backtrackRoute.available) {
        guidance.steps.push({
            priority: 3,
            action: `Follow your breadcrumb trail back (${backtrackRoute.total_distance.display})`,
            detail: `Your trail "${backtrackRoute.trail_name}" has ${backtrackRoute.points_count} recorded points.`
        });
    } else if (nearbyWaypoints.length > 0) {
        const nearest = nearbyWaypoints[0];
        guidance.steps.push({
            priority: 3,
            action: `Head towards "${nearest.name}" - ${nearest.distance.display} ${nearest.bearing_direction}`,
            detail: `This is your nearest saved waypoint at bearing ${nearest.bearing}°.`
        });
    } else {
        guidance.steps.push({
            priority: 3,
            action: 'Mark your current position',
            detail: 'Create a waypoint at your current location so you can navigate back here if needed.'
        });
    }

    // Step 4: Make yourself visible
    guidance.steps.push({
        priority: 4,
        action: 'Make yourself visible',
        detail: 'Use bright clothing, a signal mirror, or create ground signals if rescue might be needed.'
    });

    // Tips
    guidance.tips = [
        'Stay hydrated - conserve water if limited',
        'Stay in shade during hot hours, seek shelter in cold',
        'Do not wander aimlessly - move with purpose or stay put',
        'If you have a whistle, use 3 blasts to signal for help',
        'Trust the compass - it will guide you'
    ];

    return guidance;
}

// Get I'm Lost mode status
app.get('/api/lost-mode/status', (req, res) => {
    if (!imLostModeActive) {
        return res.json({
            active: false,
            message: 'I\'m Lost mode is not active'
        });
    }

    // Update current position and recalculate distances
    const currentPosition = {
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        accuracy: gpsState.accuracy,
        timestamp: new Date().toISOString()
    };

    // Recalculate distances to waypoints
    const updatedWaypoints = imLostModeData.nearby_waypoints.map(wp => {
        const distance = haversineDistance(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        const bearing = calculateBearing(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        return {
            ...wp,
            distance: formatDistance(distance),
            distance_meters: distance,
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing)
        };
    }).sort((a, b) => a.distance_meters - b.distance_meters);

    res.json({
        active: true,
        activated_at: imLostModeData.activated_at,
        current_position: currentPosition,
        nearby_waypoints: updatedWaypoints,
        backtrack_route: imLostModeData.backtrack_route,
        guidance: imLostModeData.guidance
    });
});

// Get backtrack route points
app.get('/api/lost-mode/backtrack', (req, res) => {
    if (!imLostModeActive) {
        return res.status(400).json({
            success: false,
            error: 'I\'m Lost mode is not active'
        });
    }

    // Get the trail for backtracking
    const recentTrail = activeBreadcrumbTrail ||
        (breadcrumbTrails.length > 0 ? breadcrumbTrails[breadcrumbTrails.length - 1] : null);

    if (!recentTrail || !recentTrail.points || recentTrail.points.length === 0) {
        return res.json({
            success: false,
            error: 'No breadcrumb trail available for backtracking'
        });
    }

    // Reverse points for backtrack direction
    const backtrackPoints = [...recentTrail.points].reverse().map((point, index, arr) => {
        // Calculate distance from current position
        const distFromCurrent = haversineDistance(
            gpsState.latitude, gpsState.longitude,
            point.latitude, point.longitude
        );

        // Calculate bearing from current position
        const bearingFromCurrent = calculateBearing(
            gpsState.latitude, gpsState.longitude,
            point.latitude, point.longitude
        );

        return {
            index: index,
            latitude: point.latitude,
            longitude: point.longitude,
            altitude: point.altitude,
            timestamp: point.timestamp,
            distance_from_current: formatDistance(distFromCurrent),
            bearing_from_current: Math.round(bearingFromCurrent),
            direction_from_current: bearingToDirection(bearingFromCurrent),
            is_nearest: false
        };
    });

    // Mark the nearest point
    const nearestIndex = backtrackPoints.reduce((minIdx, point, idx, arr) => {
        const currentDist = parseFloat(point.distance_from_current.value);
        const minDist = parseFloat(arr[minIdx].distance_from_current.value);
        return currentDist < minDist ? idx : minIdx;
    }, 0);

    if (backtrackPoints[nearestIndex]) {
        backtrackPoints[nearestIndex].is_nearest = true;
    }

    res.json({
        success: true,
        trail_name: recentTrail.name,
        trail_id: recentTrail.id,
        total_points: backtrackPoints.length,
        total_distance: formatDistance(recentTrail.total_distance_meters || 0),
        points: backtrackPoints,
        current_position: {
            latitude: gpsState.latitude,
            longitude: gpsState.longitude
        },
        navigation_hint: nearestIndex > 0 ?
            `Head ${backtrackPoints[nearestIndex].direction_from_current} to reach your trail` :
            'You are at or near the start of your backtrack route'
    });
});

// Deactivate "I'm Lost" mode
app.post('/api/lost-mode/deactivate', (req, res) => {
    if (!imLostModeActive) {
        return res.json({
            success: false,
            message: 'I\'m Lost mode was not active'
        });
    }

    const duration = new Date() - new Date(imLostModeData.activated_at);
    const durationSeconds = Math.floor(duration / 1000);

    imLostModeActive = false;
    imLostModeData = null;

    res.json({
        success: true,
        message: 'I\'m Lost mode deactivated. Stay safe!',
        duration_seconds: durationSeconds
    });
});

// Voice activation for I'm Lost mode
app.post('/api/voice/im-lost', (req, res) => {
    // Simulate voice activation - same as button activation
    // This endpoint can be called when "I'm lost" or "help" is detected via voice

    // Forward to the activate endpoint internally
    const currentPosition = {
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        altitude: gpsState.altitude,
        accuracy: gpsState.accuracy,
        timestamp: new Date().toISOString()
    };

    const recentTrail = activeBreadcrumbTrail ||
        (breadcrumbTrails.length > 0 ? breadcrumbTrails[breadcrumbTrails.length - 1] : null);

    const nearbyWaypoints = waypoints.map(wp => {
        const distance = haversineDistance(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        const bearing = calculateBearing(
            gpsState.latitude, gpsState.longitude,
            wp.latitude, wp.longitude
        );
        return {
            ...wp,
            distance: formatDistance(distance),
            distance_meters: distance,
            bearing: Math.round(bearing),
            bearing_direction: bearingToDirection(bearing)
        };
    }).sort((a, b) => a.distance_meters - b.distance_meters).slice(0, 5);

    let backtrackRoute = null;
    if (recentTrail && recentTrail.points && recentTrail.points.length > 0) {
        const reversedPoints = [...recentTrail.points].reverse();
        const startPoint = reversedPoints[0];
        const endPoint = reversedPoints[reversedPoints.length - 1];

        backtrackRoute = {
            available: true,
            trail_id: recentTrail.id,
            trail_name: recentTrail.name,
            points_count: reversedPoints.length,
            total_distance: formatDistance(recentTrail.total_distance_meters || 0),
            start: { latitude: startPoint.latitude, longitude: startPoint.longitude },
            end: { latitude: endPoint.latitude, longitude: endPoint.longitude }
        };
    } else {
        backtrackRoute = { available: false };
    }

    imLostModeData = {
        activated_at: new Date().toISOString(),
        current_position: currentPosition,
        nearby_waypoints: nearbyWaypoints,
        backtrack_route: backtrackRoute,
        guidance: generateCalmGuidance(nearbyWaypoints, backtrackRoute)
    };

    imLostModeActive = true;

    // Also generate voice response
    const voiceResponse = generateLostModeVoiceResponse(nearbyWaypoints, backtrackRoute);

    res.json({
        success: true,
        mode: 'activated',
        message: 'I\'m Lost mode activated via voice command.',
        voice_response: voiceResponse,
        data: imLostModeData
    });
});

// Generate voice response for I'm Lost mode
function generateLostModeVoiceResponse(nearbyWaypoints, backtrackRoute) {
    let response = "I'm Lost mode activated. Stay calm. ";

    if (backtrackRoute && backtrackRoute.available) {
        response += `You have a breadcrumb trail available with ${backtrackRoute.points_count} points. `;
        response += `You can backtrack ${backtrackRoute.total_distance.display}. `;
    }

    if (nearbyWaypoints.length > 0) {
        const nearest = nearbyWaypoints[0];
        response += `Your nearest waypoint is "${nearest.name}", ${nearest.distance.display} to the ${nearest.bearing_direction}. `;
    } else {
        response += "You have no saved waypoints nearby. Consider marking your current position. ";
    }

    response += "Follow the guidance on screen to find your way back safely.";

    return response;
}

// ==============================================================================
// Start Server
// ==============================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('SURVIVAL COMPANION - Web Interface');
    console.log('='.repeat(60));
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('');
});
