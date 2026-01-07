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
import yaml from 'js-yaml';
import crypto from 'crypto';

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

app.get('/survival', (req, res) => {
    try {
        const html = renderTemplate('survival.html');
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
// Sensor Health Check System
// ==============================================================================

// Sensor health state - tracks individual sensor status
const sensorHealthState = {
    gps: {
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        errorCount: 0,
        errorMessage: null
    },
    bme280: {
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        errorCount: 0,
        errorMessage: null
    },
    max30102: {
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        errorCount: 0,
        errorMessage: null
    },
    mlx90614: {
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        errorCount: 0,
        errorMessage: null
    },
    camera: {
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        errorCount: 0,
        errorMessage: null
    }
};

// Check individual sensor health
function checkSensorHealth(sensorName) {
    const now = Date.now();
    const health = sensorHealthState[sensorName];

    if (!health) {
        return { status: 'unknown', error: 'Sensor not found' };
    }

    // Get sensor initialization status from system state
    const isInitialized = systemState.sensors[sensorName] ||
                         (sensorName === 'bme280' && systemState.sensors.bme280);

    health.lastCheck = now;

    if (isInitialized) {
        health.status = 'ok';
        health.lastSuccess = now;
        health.errorCount = 0;
        health.errorMessage = null;
    } else {
        health.status = 'error';
        health.errorCount++;
        health.errorMessage = `${sensorName.toUpperCase()} not initialized or not responding`;
    }

    return health;
}

// Get overall system health summary
function getSystemHealthSummary() {
    const sensors = Object.keys(sensorHealthState);
    let okCount = 0;
    let warningCount = 0;
    let errorCount = 0;

    sensors.forEach(sensor => {
        checkSensorHealth(sensor);
        switch (sensorHealthState[sensor].status) {
            case 'ok': okCount++; break;
            case 'warning': warningCount++; break;
            case 'error': errorCount++; break;
        }
    });

    const totalSensors = sensors.length;
    const healthPercentage = Math.round((okCount / totalSensors) * 100);

    let overallStatus = 'ok';
    if (errorCount > 0) {
        overallStatus = errorCount >= totalSensors / 2 ? 'critical' : 'degraded';
    } else if (warningCount > 0) {
        overallStatus = 'warning';
    }

    return {
        overall_status: overallStatus,
        health_percentage: healthPercentage,
        sensors_ok: okCount,
        sensors_warning: warningCount,
        sensors_error: errorCount,
        total_sensors: totalSensors,
        degraded_functionality: errorCount > 0,
        critical_sensors_missing: []
    };
}

// Get comprehensive sensor health report
app.get('/api/sensors/health', (req, res) => {
    const summary = getSystemHealthSummary();

    // Build detailed sensor report
    const sensorDetails = {};
    const criticalMissing = [];

    for (const [name, health] of Object.entries(sensorHealthState)) {
        const sensorInfo = {
            name: name.toUpperCase(),
            status: health.status,
            last_check: health.lastCheck ? new Date(health.lastCheck).toISOString() : null,
            last_success: health.lastSuccess ? new Date(health.lastSuccess).toISOString() : null,
            error_count: health.errorCount,
            error_message: health.errorMessage,
            features_affected: getSensorFeatures(name)
        };

        sensorDetails[name] = sensorInfo;

        // Track critical missing sensors
        if (health.status === 'error' && isCriticalSensor(name)) {
            criticalMissing.push(name.toUpperCase());
        }
    }

    summary.critical_sensors_missing = criticalMissing;

    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        summary,
        sensors: sensorDetails,
        degraded_features: getDegradedFeatures()
    });
});

// Get status of specific sensor
app.get('/api/sensors/health/:sensorName', (req, res) => {
    const sensorName = req.params.sensorName.toLowerCase();

    if (!sensorHealthState[sensorName]) {
        return res.status(404).json({
            success: false,
            error: 'Sensor not found',
            available_sensors: Object.keys(sensorHealthState)
        });
    }

    const health = checkSensorHealth(sensorName);

    res.json({
        success: true,
        sensor: sensorName.toUpperCase(),
        status: health.status,
        last_check: health.lastCheck ? new Date(health.lastCheck).toISOString() : null,
        last_success: health.lastSuccess ? new Date(health.lastSuccess).toISOString() : null,
        error_count: health.errorCount,
        error_message: health.errorMessage,
        features_affected: getSensorFeatures(sensorName)
    });
});

// Simulate sensor failure for testing
app.post('/api/sensors/simulate-failure', (req, res) => {
    const { sensor, recover } = req.body;

    if (!sensor) {
        return res.status(400).json({
            success: false,
            error: 'Sensor name required'
        });
    }

    const sensorName = sensor.toLowerCase();

    if (!systemState.sensors.hasOwnProperty(sensorName)) {
        return res.status(404).json({
            success: false,
            error: 'Invalid sensor name',
            available: Object.keys(systemState.sensors)
        });
    }

    if (recover) {
        // Recover sensor
        systemState.sensors[sensorName] = true;
        sensorHealthState[sensorName].status = 'ok';
        sensorHealthState[sensorName].errorCount = 0;
        sensorHealthState[sensorName].errorMessage = null;
        sensorHealthState[sensorName].lastSuccess = Date.now();

        console.log(`[SENSOR] ${sensorName.toUpperCase()} recovered`);

        res.json({
            success: true,
            message: `${sensorName.toUpperCase()} has been recovered`,
            sensor: sensorName.toUpperCase(),
            status: 'ok'
        });
    } else {
        // Fail sensor
        systemState.sensors[sensorName] = false;
        sensorHealthState[sensorName].status = 'error';
        sensorHealthState[sensorName].errorCount++;
        sensorHealthState[sensorName].errorMessage = `Simulated failure for testing`;

        console.log(`[SENSOR] ${sensorName.toUpperCase()} FAILED (simulated)`);

        res.json({
            success: true,
            message: `${sensorName.toUpperCase()} has been marked as failed`,
            sensor: sensorName.toUpperCase(),
            status: 'error',
            degraded_features: getSensorFeatures(sensorName)
        });
    }
});

// Helper: Get features affected by a sensor
function getSensorFeatures(sensorName) {
    const featureMap = {
        gps: ['Navigation', 'Waypoints', 'Breadcrumb trails', 'I\'m Lost mode', 'SOS location'],
        bme280: ['Temperature reading', 'Pressure tracking', 'Storm prediction', 'Altitude estimation'],
        max30102: ['Heart rate monitoring', 'SpO2 measurement', 'Baseline vitals'],
        mlx90614: ['Body temperature', 'Fever detection', 'Vital signs'],
        camera: ['Plant identification', 'Visual hazard detection', 'Wound assessment']
    };

    return featureMap[sensorName] || [];
}

// Helper: Check if sensor is critical
function isCriticalSensor(sensorName) {
    const criticalSensors = ['gps', 'bme280'];
    return criticalSensors.includes(sensorName);
}

// Helper: Get list of features with degraded functionality
function getDegradedFeatures() {
    const degraded = [];

    for (const [name, health] of Object.entries(sensorHealthState)) {
        if (health.status === 'error') {
            const features = getSensorFeatures(name);
            features.forEach(feature => {
                if (!degraded.includes(feature)) {
                    degraded.push(feature);
                }
            });
        }
    }

    return degraded;
}

// ==============================================================================
// Error Recovery and Logging System
// ==============================================================================

// Error log storage
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 100;

// Recovery attempt tracking
const recoveryState = {
    active_issues: [],
    recovery_attempts: [],
    last_recovery_at: null,
    system_health: 'healthy'
};

// Error types and their recovery strategies
const ERROR_TYPES = {
    sensor_failure: {
        severity: 'warning',
        recoverable: true,
        recovery_action: 'restart_sensor',
        max_attempts: 3
    },
    gps_lost: {
        severity: 'warning',
        recoverable: true,
        recovery_action: 'retry_gps',
        max_attempts: 5
    },
    llm_error: {
        severity: 'error',
        recoverable: true,
        recovery_action: 'reload_llm',
        max_attempts: 2
    },
    memory_pressure: {
        severity: 'critical',
        recoverable: true,
        recovery_action: 'clear_cache',
        max_attempts: 1
    },
    network_error: {
        severity: 'warning',
        recoverable: true,
        recovery_action: 'retry_connection',
        max_attempts: 3
    },
    file_error: {
        severity: 'error',
        recoverable: true,
        recovery_action: 'retry_io',
        max_attempts: 2
    },
    unknown: {
        severity: 'error',
        recoverable: false,
        recovery_action: 'log_only',
        max_attempts: 0
    }
};

// Log an error and trigger recovery if applicable
function logError(errorType, message, details = {}) {
    const now = new Date();
    const errorInfo = ERROR_TYPES[errorType] || ERROR_TYPES.unknown;

    const errorEntry = {
        id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: now.toISOString(),
        type: errorType,
        severity: errorInfo.severity,
        message: message,
        details: details,
        recoverable: errorInfo.recoverable,
        recovered: false,
        recovery_attempts: 0
    };

    // Add to error log
    errorLog.unshift(errorEntry);

    // Trim log if too large
    if (errorLog.length > MAX_ERROR_LOG_SIZE) {
        errorLog.pop();
    }

    // Log to console
    console.log(`[ERROR] ${errorInfo.severity.toUpperCase()}: ${message}`);

    // Update system health
    updateSystemHealth();

    // Attempt recovery if applicable
    if (errorInfo.recoverable) {
        attemptRecovery(errorEntry, errorInfo);
    }

    return errorEntry;
}

// Attempt to recover from an error
function attemptRecovery(errorEntry, errorInfo) {
    const recoveryAttempt = {
        error_id: errorEntry.id,
        error_type: errorEntry.type,
        action: errorInfo.recovery_action,
        started_at: new Date().toISOString(),
        success: false,
        message: null
    };

    // Check if max attempts exceeded
    const previousAttempts = recoveryState.recovery_attempts.filter(
        a => a.error_id === errorEntry.id
    ).length;

    if (previousAttempts >= errorInfo.max_attempts) {
        recoveryAttempt.success = false;
        recoveryAttempt.message = `Max recovery attempts (${errorInfo.max_attempts}) exceeded`;
        console.log(`[RECOVERY] Max attempts exceeded for ${errorEntry.type}`);

        // Add to active issues
        if (!recoveryState.active_issues.find(i => i.id === errorEntry.id)) {
            recoveryState.active_issues.push({
                id: errorEntry.id,
                type: errorEntry.type,
                message: errorEntry.message,
                since: errorEntry.timestamp
            });
        }
    } else {
        // Perform recovery action
        const result = performRecoveryAction(errorInfo.recovery_action, errorEntry);
        recoveryAttempt.success = result.success;
        recoveryAttempt.message = result.message;

        if (result.success) {
            errorEntry.recovered = true;
            errorEntry.recovery_attempts = previousAttempts + 1;
            console.log(`[RECOVERY] Successfully recovered from ${errorEntry.type}`);

            // Remove from active issues if present
            recoveryState.active_issues = recoveryState.active_issues.filter(
                i => i.id !== errorEntry.id
            );
        }
    }

    recoveryAttempt.completed_at = new Date().toISOString();
    recoveryState.recovery_attempts.unshift(recoveryAttempt);
    recoveryState.last_recovery_at = new Date().toISOString();

    // Trim recovery attempts
    if (recoveryState.recovery_attempts.length > 50) {
        recoveryState.recovery_attempts.pop();
    }

    return recoveryAttempt;
}

// Perform a specific recovery action
function performRecoveryAction(action, errorEntry) {
    switch (action) {
        case 'restart_sensor':
            const sensorName = errorEntry.details.sensor || 'unknown';
            // Simulate sensor restart
            if (systemState.sensors[sensorName] !== undefined) {
                systemState.sensors[sensorName] = true;
                if (sensorHealthState[sensorName]) {
                    sensorHealthState[sensorName].status = 'ok';
                    sensorHealthState[sensorName].errorCount = 0;
                    sensorHealthState[sensorName].errorMessage = null;
                }
                return { success: true, message: `Sensor ${sensorName} restarted` };
            }
            return { success: false, message: 'Unknown sensor' };

        case 'retry_gps':
            // Simulate GPS retry
            systemState.sensors.gps = true;
            systemState.bootStatus.gps_fix = true;
            return { success: true, message: 'GPS connection reestablished' };

        case 'reload_llm':
            // Simulate LLM reload
            systemState.bootStatus.llm_ready = true;
            return { success: true, message: 'LLM model reloaded' };

        case 'clear_cache':
            // Simulate cache clearing
            return { success: true, message: 'Cache cleared, memory freed' };

        case 'retry_connection':
            // Simulate network retry
            return { success: true, message: 'Connection restored' };

        case 'retry_io':
            // Simulate IO retry
            return { success: true, message: 'File operation succeeded on retry' };

        case 'log_only':
        default:
            return { success: false, message: 'No automatic recovery available' };
    }
}

// Update overall system health based on active issues
function updateSystemHealth() {
    const criticalIssues = recoveryState.active_issues.filter(
        i => ERROR_TYPES[i.type]?.severity === 'critical'
    ).length;
    const errorIssues = recoveryState.active_issues.filter(
        i => ERROR_TYPES[i.type]?.severity === 'error'
    ).length;

    if (criticalIssues > 0) {
        recoveryState.system_health = 'critical';
    } else if (errorIssues > 0) {
        recoveryState.system_health = 'degraded';
    } else if (recoveryState.active_issues.length > 0) {
        recoveryState.system_health = 'warning';
    } else {
        recoveryState.system_health = 'healthy';
    }
}

// Get error log
app.get('/api/errors', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const severity = req.query.severity;
    const type = req.query.type;

    let filtered = errorLog;

    if (severity) {
        filtered = filtered.filter(e => e.severity === severity);
    }

    if (type) {
        filtered = filtered.filter(e => e.type === type);
    }

    res.json({
        success: true,
        total: errorLog.length,
        errors: filtered.slice(0, limit)
    });
});

// Get recovery status
app.get('/api/recovery/status', (req, res) => {
    res.json({
        success: true,
        system_health: recoveryState.system_health,
        active_issues: recoveryState.active_issues,
        recent_recoveries: recoveryState.recovery_attempts.slice(0, 10),
        last_recovery_at: recoveryState.last_recovery_at,
        stats: {
            total_errors_logged: errorLog.length,
            active_issues_count: recoveryState.active_issues.length,
            successful_recoveries: recoveryState.recovery_attempts.filter(r => r.success).length,
            failed_recoveries: recoveryState.recovery_attempts.filter(r => !r.success).length
        }
    });
});

// Trigger a test error (for testing)
app.post('/api/errors/trigger', (req, res) => {
    const { type, message, details } = req.body;

    if (!type || !ERROR_TYPES[type]) {
        return res.status(400).json({
            success: false,
            error: 'Invalid error type',
            available_types: Object.keys(ERROR_TYPES)
        });
    }

    const errorEntry = logError(type, message || `Test ${type} error`, details || {});

    res.json({
        success: true,
        error_entry: errorEntry,
        system_health: recoveryState.system_health,
        recovered: errorEntry.recovered
    });
});

// Manually attempt recovery for an active issue
app.post('/api/recovery/attempt', (req, res) => {
    const { error_id } = req.body;

    if (!error_id) {
        return res.status(400).json({
            success: false,
            error: 'error_id required'
        });
    }

    // Find the error entry
    const errorEntry = errorLog.find(e => e.id === error_id);

    if (!errorEntry) {
        return res.status(404).json({
            success: false,
            error: 'Error not found'
        });
    }

    const errorInfo = ERROR_TYPES[errorEntry.type] || ERROR_TYPES.unknown;

    if (!errorInfo.recoverable) {
        return res.json({
            success: false,
            message: 'This error type is not recoverable',
            error_entry: errorEntry
        });
    }

    // Reset attempt counter to allow manual retry
    const result = performRecoveryAction(errorInfo.recovery_action, errorEntry);

    if (result.success) {
        errorEntry.recovered = true;
        recoveryState.active_issues = recoveryState.active_issues.filter(
            i => i.id !== error_id
        );
        updateSystemHealth();
    }

    res.json({
        success: result.success,
        message: result.message,
        error_entry: errorEntry,
        system_health: recoveryState.system_health
    });
});

// Clear resolved errors from log
app.post('/api/errors/clear-resolved', (req, res) => {
    const unresolvedCount = errorLog.filter(e => !e.recovered).length;
    const clearedCount = errorLog.length - unresolvedCount;

    // Keep only unresolved errors
    errorLog.length = 0;
    errorLog.push(...errorLog.filter(e => !e.recovered));

    res.json({
        success: true,
        cleared: clearedCount,
        remaining: errorLog.length
    });
});

// ==============================================================================
// Configuration Persistence (YAML)
// ==============================================================================

const CONFIG_PATH = join(__dirname, 'config', 'survival_config.yaml');
const USER_SETTINGS_PATH = join(__dirname, 'data', 'user_settings.yaml');

// Default user settings (merged with config)
const defaultUserSettings = {
    display: {
        night_mode: false,
        font_size: 'medium',
        screen_timeout: 60
    },
    voice: {
        volume: 80,
        voice_feedback: true
    },
    power: {
        low_power_warning: true,
        critical_warning: true,
        auto_low_power: true
    },
    navigation: {
        breadcrumb_interval: 10,
        default_zoom: 15,
        gps_accuracy_mode: 'balanced'
    },
    notifications: {
        storm_alerts: true,
        health_alerts: true,
        sensor_warnings: true
    }
};

// Current user settings (loaded from file or defaults)
let userSettings = { ...defaultUserSettings };

// Load main system configuration
function loadSystemConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const content = fs.readFileSync(CONFIG_PATH, 'utf8');
            return yaml.load(content);
        }
    } catch (error) {
        console.log('[CONFIG] Error loading system config:', error.message);
    }
    return null;
}

// Load user settings from YAML
function loadUserSettings() {
    try {
        if (fs.existsSync(USER_SETTINGS_PATH)) {
            const content = fs.readFileSync(USER_SETTINGS_PATH, 'utf8');
            const loaded = yaml.load(content);
            // Deep merge with defaults
            userSettings = deepMerge(defaultUserSettings, loaded);
            console.log('User settings loaded from file');
            return true;
        }
    } catch (error) {
        console.log('[CONFIG] Error loading user settings:', error.message);
    }
    userSettings = { ...defaultUserSettings };
    return false;
}

// Save user settings to YAML
function saveUserSettings() {
    try {
        // Ensure data directory exists
        const dataDir = join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const header = `# ==============================================================================
# Survival Companion - User Settings
# Generated: ${new Date().toISOString()}
# ==============================================================================\n\n`;

        const content = header + yaml.dump(userSettings, {
            indent: 2,
            lineWidth: 80,
            noRefs: true
        });

        fs.writeFileSync(USER_SETTINGS_PATH, content);
        console.log('[CONFIG] User settings saved');
        return true;
    } catch (error) {
        console.log('[CONFIG] Error saving user settings:', error.message);
        return false;
    }
}

// Deep merge objects
function deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
}

// Initialize user settings on startup
loadUserSettings();

// Get all configuration (system + user)
app.get('/api/config', (req, res) => {
    const systemConfig = loadSystemConfig();

    res.json({
        success: true,
        system: systemConfig,
        user_settings: userSettings,
        config_path: CONFIG_PATH,
        settings_path: USER_SETTINGS_PATH
    });
});

// Get just user settings
app.get('/api/config/settings', (req, res) => {
    res.json({
        success: true,
        settings: userSettings,
        defaults: defaultUserSettings
    });
});

// Get specific setting category
app.get('/api/config/settings/:category', (req, res) => {
    const category = req.params.category;

    if (!userSettings[category]) {
        return res.status(404).json({
            success: false,
            error: 'Category not found',
            available: Object.keys(userSettings)
        });
    }

    res.json({
        success: true,
        category: category,
        settings: userSettings[category],
        defaults: defaultUserSettings[category]
    });
});

// Update user settings
app.put('/api/config/settings', (req, res) => {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Settings object required'
        });
    }

    // Merge updates with current settings
    userSettings = deepMerge(userSettings, updates);

    // Save to file
    const saved = saveUserSettings();

    res.json({
        success: saved,
        message: saved ? 'Settings saved successfully' : 'Failed to save settings',
        settings: userSettings
    });
});

// Update specific setting category
app.put('/api/config/settings/:category', (req, res) => {
    const category = req.params.category;
    const updates = req.body;

    if (!defaultUserSettings[category]) {
        return res.status(404).json({
            success: false,
            error: 'Invalid category',
            available: Object.keys(defaultUserSettings)
        });
    }

    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Settings object required'
        });
    }

    // Update category
    userSettings[category] = deepMerge(userSettings[category] || {}, updates);

    // Save to file
    const saved = saveUserSettings();

    res.json({
        success: saved,
        category: category,
        settings: userSettings[category]
    });
});

// Reset settings to defaults
app.post('/api/config/settings/reset', (req, res) => {
    const { category } = req.body;

    if (category) {
        // Reset specific category
        if (!defaultUserSettings[category]) {
            return res.status(404).json({
                success: false,
                error: 'Invalid category'
            });
        }
        userSettings[category] = { ...defaultUserSettings[category] };
    } else {
        // Reset all
        userSettings = { ...defaultUserSettings };
    }

    const saved = saveUserSettings();

    res.json({
        success: saved,
        message: category ? `Category '${category}' reset to defaults` : 'All settings reset to defaults',
        settings: userSettings
    });
});

// Validate configuration file
app.get('/api/config/validate', (req, res) => {
    const results = {
        system_config: { valid: false, error: null },
        user_settings: { valid: false, error: null }
    };

    // Check system config
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const content = fs.readFileSync(CONFIG_PATH, 'utf8');
            yaml.load(content);
            results.system_config.valid = true;
        } else {
            results.system_config.error = 'File not found';
        }
    } catch (error) {
        results.system_config.error = error.message;
    }

    // Check user settings
    try {
        if (fs.existsSync(USER_SETTINGS_PATH)) {
            const content = fs.readFileSync(USER_SETTINGS_PATH, 'utf8');
            yaml.load(content);
            results.user_settings.valid = true;
        } else {
            results.user_settings.error = 'File not found (will use defaults)';
            results.user_settings.valid = true; // This is OK
        }
    } catch (error) {
        results.user_settings.error = error.message;
    }

    res.json({
        success: results.system_config.valid,
        validation: results
    });
});

// Export settings (for backup)
app.get('/api/config/export', (req, res) => {
    const exportData = {
        exported_at: new Date().toISOString(),
        version: '1.0.0',
        settings: userSettings
    };

    const yamlContent = yaml.dump(exportData, {
        indent: 2,
        lineWidth: 80
    });

    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', 'attachment; filename=survival_settings_backup.yaml');
    res.send(yamlContent);
});

// Import settings (from backup)
app.post('/api/config/import', (req, res) => {
    const { yaml_content } = req.body;

    if (!yaml_content) {
        return res.status(400).json({
            success: false,
            error: 'yaml_content required'
        });
    }

    try {
        const imported = yaml.load(yaml_content);

        if (imported.settings) {
            userSettings = deepMerge(defaultUserSettings, imported.settings);
            const saved = saveUserSettings();

            res.json({
                success: saved,
                message: 'Settings imported successfully',
                imported_from: imported.exported_at,
                settings: userSettings
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid backup format - missing settings'
            });
        }
    } catch (error) {
        res.status(400).json({
            success: false,
            error: 'Invalid YAML: ' + error.message
        });
    }
});

// ==============================================================================
// Model File Verification System
// ==============================================================================

const MODELS_PATH = join(__dirname, 'personas', 'survival', 'models');
const CHECKSUMS_PATH = join(__dirname, 'data', 'model_checksums.json');

// Model registry - defines expected models with expected checksums
const modelRegistry = {
    'phi-3-mini-4k-instruct-q4_k_m.gguf': {
        type: 'llm',
        description: 'Phi-3 Mini LLM for general queries',
        required: true,
        expected_size_mb: 2000  // Approximate expected size
    },
    'biomistral-7b-dare-q4_k_m.gguf': {
        type: 'llm',
        description: 'BioMistral medical LLM',
        required: true,
        expected_size_mb: 4000
    },
    'triage.hef': {
        type: 'hailo',
        description: 'Medical triage classifier',
        required: false,
        expected_size_mb: 50
    },
    'skin_cancer.hef': {
        type: 'hailo',
        description: 'Skin lesion analyzer',
        required: false,
        expected_size_mb: 50
    },
    'plant_classifier.hef': {
        type: 'hailo',
        description: 'Plant/mushroom identifier',
        required: false,
        expected_size_mb: 50
    },
    'wildlife_classifier.hef': {
        type: 'hailo',
        description: 'Wildlife identifier',
        required: false,
        expected_size_mb: 50
    },
    'wound_assessor.hef': {
        type: 'hailo',
        description: 'Wound severity assessor',
        required: false,
        expected_size_mb: 50
    }
};

// Stored checksums (loaded from file or generated)
let storedChecksums = {};

// Load stored checksums
function loadChecksums() {
    try {
        if (fs.existsSync(CHECKSUMS_PATH)) {
            const content = fs.readFileSync(CHECKSUMS_PATH, 'utf8');
            storedChecksums = JSON.parse(content);
            console.log('[MODEL] Checksums loaded');
            return true;
        }
    } catch (error) {
        console.log('[MODEL] Error loading checksums:', error.message);
    }
    return false;
}

// Save checksums
function saveChecksums() {
    try {
        const dataDir = join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const data = {
            generated_at: new Date().toISOString(),
            checksums: storedChecksums
        };

        fs.writeFileSync(CHECKSUMS_PATH, JSON.stringify(data, null, 2));
        console.log('[MODEL] Checksums saved');
        return true;
    } catch (error) {
        console.log('[MODEL] Error saving checksums:', error.message);
        return false;
    }
}

// Calculate file checksum (SHA256)
function calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
        try {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

// Verify a single model file
async function verifyModel(modelName) {
    const filePath = join(MODELS_PATH, modelName);
    const placeholderPath = join(MODELS_PATH, modelName + '.placeholder');
    const registry = modelRegistry[modelName] || {};

    const result = {
        model: modelName,
        type: registry.type || 'unknown',
        description: registry.description || 'Unknown model',
        required: registry.required || false,
        status: 'unknown',
        file_exists: false,
        is_placeholder: false,
        size_bytes: 0,
        size_mb: 0,
        checksum: null,
        checksum_valid: null,
        error: null
    };

    // Check if real file exists
    if (fs.existsSync(filePath)) {
        result.file_exists = true;
        result.is_placeholder = false;

        try {
            const stats = fs.statSync(filePath);
            result.size_bytes = stats.size;
            result.size_mb = Math.round(stats.size / (1024 * 1024) * 10) / 10;

            // Calculate checksum
            result.checksum = await calculateChecksum(filePath);

            // Verify against stored checksum
            if (storedChecksums[modelName]) {
                result.checksum_valid = result.checksum === storedChecksums[modelName];
                result.status = result.checksum_valid ? 'verified' : 'corrupted';

                if (!result.checksum_valid) {
                    result.error = 'Checksum mismatch - file may be corrupted';
                }
            } else {
                // No stored checksum - save current one
                storedChecksums[modelName] = result.checksum;
                result.status = 'new';
                saveChecksums();
            }
        } catch (error) {
            result.status = 'error';
            result.error = error.message;
        }
    } else if (fs.existsSync(placeholderPath)) {
        // Placeholder exists
        result.file_exists = false;
        result.is_placeholder = true;
        result.status = 'placeholder';
        result.error = 'Model file not installed (placeholder present)';
    } else {
        // No file at all
        result.file_exists = false;
        result.status = 'missing';
        result.error = 'Model file not found';
    }

    return result;
}

// Verify all models
async function verifyAllModels() {
    const results = {
        verified: 0,
        corrupted: 0,
        missing: 0,
        placeholders: 0,
        errors: 0,
        models: {}
    };

    for (const modelName of Object.keys(modelRegistry)) {
        const result = await verifyModel(modelName);
        results.models[modelName] = result;

        switch (result.status) {
            case 'verified':
            case 'new':
                results.verified++;
                break;
            case 'corrupted':
                results.corrupted++;
                break;
            case 'missing':
                results.missing++;
                break;
            case 'placeholder':
                results.placeholders++;
                break;
            case 'error':
                results.errors++;
                break;
        }
    }

    return results;
}

// Load checksums on startup
loadChecksums();

// Get model verification status
app.get('/api/models/status', async (req, res) => {
    try {
        const results = await verifyAllModels();

        const allValid = results.corrupted === 0 && results.errors === 0;
        const requiredMissing = Object.entries(results.models)
            .filter(([name, info]) => modelRegistry[name]?.required && !info.file_exists)
            .map(([name]) => name);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            overall_status: allValid ? (results.placeholders === Object.keys(modelRegistry).length ? 'development' : 'healthy') : 'issues_detected',
            summary: {
                total: Object.keys(modelRegistry).length,
                verified: results.verified,
                corrupted: results.corrupted,
                missing: results.missing,
                placeholders: results.placeholders,
                errors: results.errors
            },
            required_models_missing: requiredMissing,
            models: results.models
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Verify specific model
app.get('/api/models/verify/:modelName', async (req, res) => {
    const modelName = req.params.modelName;

    if (!modelRegistry[modelName]) {
        return res.status(404).json({
            success: false,
            error: 'Unknown model',
            available: Object.keys(modelRegistry)
        });
    }

    try {
        const result = await verifyModel(modelName);
        res.json({
            success: true,
            verification: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Simulate model corruption (for testing)
app.post('/api/models/simulate-corruption', (req, res) => {
    const { model } = req.body;

    if (!model || !modelRegistry[model]) {
        return res.status(400).json({
            success: false,
            error: 'Valid model name required',
            available: Object.keys(modelRegistry)
        });
    }

    // Corrupt the stored checksum
    const previousChecksum = storedChecksums[model];
    storedChecksums[model] = 'corrupted_' + Date.now();
    saveChecksums();

    res.json({
        success: true,
        message: `Simulated corruption for ${model}`,
        previous_checksum: previousChecksum,
        corrupted_checksum: storedChecksums[model]
    });
});

// Fix simulated corruption (restore correct checksum)
app.post('/api/models/fix-corruption', async (req, res) => {
    const { model } = req.body;

    if (!model || !modelRegistry[model]) {
        return res.status(400).json({
            success: false,
            error: 'Valid model name required'
        });
    }

    const filePath = join(MODELS_PATH, model);

    if (fs.existsSync(filePath)) {
        try {
            const newChecksum = await calculateChecksum(filePath);
            storedChecksums[model] = newChecksum;
            saveChecksums();

            res.json({
                success: true,
                message: `Checksum recalculated for ${model}`,
                new_checksum: newChecksum
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    } else {
        // Remove stored checksum for missing file
        delete storedChecksums[model];
        saveChecksums();

        res.json({
            success: true,
            message: `Checksum cleared for missing model ${model}`
        });
    }
});

// Get model registry (list of expected models)
app.get('/api/models/registry', (req, res) => {
    res.json({
        success: true,
        models_path: MODELS_PATH,
        registry: modelRegistry
    });
});

// ==============================================================================
// Memory Usage Monitoring System
// ==============================================================================

// Memory thresholds (in bytes)
const MEMORY_CONFIG = {
    max_heap_mb: 7500,  // Max heap usage (leave buffer from 8GB total)
    warning_threshold: 0.75,  // 75% of max
    critical_threshold: 0.90,  // 90% of max
    sample_interval_ms: 5000,  // Sample every 5 seconds
    history_duration_ms: 3600000  // Keep 1 hour of history
};

// Memory history for trend analysis
const memoryHistory = [];
let memoryMonitorInterval = null;
let peakMemoryUsage = 0;
let memoryAlertActive = false;

// Simulated model memory tracking
const loadedModels = {
    'phi-3-mini': { loaded: false, memory_mb: 0, max_memory_mb: 2000 },
    'biomistral': { loaded: false, memory_mb: 0, max_memory_mb: 4000 },
    'vision_models': { loaded: false, memory_mb: 0, max_memory_mb: 500 }
};

// Get current memory usage
function getMemoryUsage() {
    const usage = process.memoryUsage();
    const heapUsedMb = Math.round(usage.heapUsed / (1024 * 1024) * 10) / 10;
    const heapTotalMb = Math.round(usage.heapTotal / (1024 * 1024) * 10) / 10;
    const rssMb = Math.round(usage.rss / (1024 * 1024) * 10) / 10;
    const externalMb = Math.round(usage.external / (1024 * 1024) * 10) / 10;

    // Calculate model memory (simulated)
    let modelMemoryMb = 0;
    for (const model of Object.values(loadedModels)) {
        modelMemoryMb += model.memory_mb;
    }

    const totalUsedMb = heapUsedMb + modelMemoryMb;
    const percentUsed = Math.round((totalUsedMb / MEMORY_CONFIG.max_heap_mb) * 100 * 10) / 10;

    // Update peak
    if (totalUsedMb > peakMemoryUsage) {
        peakMemoryUsage = totalUsedMb;
    }

    return {
        heap_used_mb: heapUsedMb,
        heap_total_mb: heapTotalMb,
        rss_mb: rssMb,
        external_mb: externalMb,
        model_memory_mb: modelMemoryMb,
        total_used_mb: totalUsedMb,
        max_allowed_mb: MEMORY_CONFIG.max_heap_mb,
        percent_used: percentUsed,
        peak_mb: peakMemoryUsage,
        status: getMemoryStatus(percentUsed)
    };
}

// Determine memory status based on usage
function getMemoryStatus(percentUsed) {
    if (percentUsed >= MEMORY_CONFIG.critical_threshold * 100) {
        return 'critical';
    } else if (percentUsed >= MEMORY_CONFIG.warning_threshold * 100) {
        return 'warning';
    }
    return 'normal';
}

// Record memory sample
function recordMemorySample() {
    const now = Date.now();
    const usage = getMemoryUsage();

    memoryHistory.push({
        timestamp: now,
        ...usage
    });

    // Trim history older than duration
    const cutoff = now - MEMORY_CONFIG.history_duration_ms;
    while (memoryHistory.length > 0 && memoryHistory[0].timestamp < cutoff) {
        memoryHistory.shift();
    }

    // Check for alerts
    checkMemoryAlerts(usage);
}

// Check for memory alerts and trigger OOM prevention
function checkMemoryAlerts(usage) {
    if (usage.status === 'critical' && !memoryAlertActive) {
        memoryAlertActive = true;
        console.log(`[MEMORY] CRITICAL: ${usage.percent_used}% memory used - initiating OOM prevention`);
        performOOMPrevention();
    } else if (usage.status === 'warning' && !memoryAlertActive) {
        memoryAlertActive = true;
        console.log(`[MEMORY] WARNING: ${usage.percent_used}% memory used`);
    } else if (usage.status === 'normal' && memoryAlertActive) {
        memoryAlertActive = false;
        console.log(`[MEMORY] Memory returned to normal: ${usage.percent_used}%`);
    }
}

// OOM prevention - unload non-essential models
function performOOMPrevention() {
    console.log('[MEMORY] Performing OOM prevention measures...');

    // Unload vision models first (optional)
    if (loadedModels.vision_models.loaded) {
        loadedModels.vision_models.loaded = false;
        loadedModels.vision_models.memory_mb = 0;
        console.log('[MEMORY] Unloaded vision models');
    }

    // Force garbage collection if available
    if (global.gc) {
        global.gc();
        console.log('[MEMORY] Forced garbage collection');
    }

    return {
        actions_taken: ['unloaded_vision_models', 'garbage_collection_requested'],
        models_unloaded: ['vision_models']
    };
}

// Start memory monitoring
function startMemoryMonitoring() {
    if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
    }

    // Record initial sample
    recordMemorySample();

    // Start periodic recording
    memoryMonitorInterval = setInterval(recordMemorySample, MEMORY_CONFIG.sample_interval_ms);
    console.log('[MEMORY] Memory monitoring started');
}

// Initialize memory monitoring
startMemoryMonitoring();

// Get memory status
app.get('/api/memory/status', (req, res) => {
    const current = getMemoryUsage();

    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        current: current,
        config: {
            max_heap_mb: MEMORY_CONFIG.max_heap_mb,
            warning_threshold_percent: MEMORY_CONFIG.warning_threshold * 100,
            critical_threshold_percent: MEMORY_CONFIG.critical_threshold * 100
        },
        loaded_models: loadedModels,
        alert_active: memoryAlertActive
    });
});

// Get memory history
app.get('/api/memory/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 60;
    const samples = memoryHistory.slice(-limit);

    // Calculate trends
    let trend = 'stable';
    if (samples.length >= 2) {
        const first = samples[0].total_used_mb;
        const last = samples[samples.length - 1].total_used_mb;
        const change = last - first;

        if (change > 50) trend = 'increasing';
        else if (change < -50) trend = 'decreasing';
    }

    // Check for leaks (continuous increase over long period)
    let leakSuspected = false;
    if (samples.length >= 10) {
        const increases = samples.slice(1).filter((s, i) =>
            s.total_used_mb > samples[i].total_used_mb
        ).length;

        leakSuspected = increases / (samples.length - 1) > 0.8;
    }

    res.json({
        success: true,
        sample_count: samples.length,
        duration_seconds: samples.length * MEMORY_CONFIG.sample_interval_ms / 1000,
        trend: trend,
        leak_suspected: leakSuspected,
        peak_mb: peakMemoryUsage,
        samples: samples.map(s => ({
            timestamp: new Date(s.timestamp).toISOString(),
            total_used_mb: s.total_used_mb,
            percent_used: s.percent_used,
            status: s.status
        }))
    });
});

// Simulate model loading (for testing)
app.post('/api/memory/load-model', (req, res) => {
    const { model } = req.body;

    if (!model || !loadedModels[model]) {
        return res.status(400).json({
            success: false,
            error: 'Invalid model',
            available: Object.keys(loadedModels)
        });
    }

    if (loadedModels[model].loaded) {
        return res.json({
            success: true,
            message: `${model} already loaded`,
            model: loadedModels[model],
            current_memory: getMemoryUsage()
        });
    }

    // Simulate loading
    loadedModels[model].loaded = true;
    loadedModels[model].memory_mb = loadedModels[model].max_memory_mb;

    console.log(`[MEMORY] Model ${model} loaded (${loadedModels[model].memory_mb}MB)`);

    const currentMemory = getMemoryUsage();

    // Check if we need OOM prevention after loading
    if (currentMemory.status === 'critical') {
        performOOMPrevention();
    }

    res.json({
        success: true,
        message: `${model} loaded`,
        model: loadedModels[model],
        current_memory: currentMemory
    });
});

// Simulate model unloading (for testing)
app.post('/api/memory/unload-model', (req, res) => {
    const { model } = req.body;

    if (!model || !loadedModels[model]) {
        return res.status(400).json({
            success: false,
            error: 'Invalid model'
        });
    }

    if (!loadedModels[model].loaded) {
        return res.json({
            success: true,
            message: `${model} not loaded`,
            model: loadedModels[model]
        });
    }

    // Simulate unloading
    loadedModels[model].loaded = false;
    loadedModels[model].memory_mb = 0;

    console.log(`[MEMORY] Model ${model} unloaded`);

    res.json({
        success: true,
        message: `${model} unloaded`,
        model: loadedModels[model],
        current_memory: getMemoryUsage()
    });
});

// Force OOM prevention (for testing)
app.post('/api/memory/force-oom-prevention', (req, res) => {
    const actions = performOOMPrevention();

    res.json({
        success: true,
        ...actions,
        current_memory: getMemoryUsage()
    });
});

// Reset peak memory tracking
app.post('/api/memory/reset-peak', (req, res) => {
    const previousPeak = peakMemoryUsage;
    peakMemoryUsage = getMemoryUsage().total_used_mb;

    res.json({
        success: true,
        previous_peak_mb: previousPeak,
        new_peak_mb: peakMemoryUsage
    });
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
        keywords: ['snake', 'bite', 'snake bite', 'venom', 'venomous', 'serpent', 'rattlesnake', 'cobra', 'viper', 'coral snake'],
        summary: 'Emergency response for venomous and non-venomous snake bites with regional venom information',
        steps: [
            { step: 1, summary: 'Move away from snake', detail: 'Get the person and yourself to a safe distance. Do not try to capture or kill the snake - note its appearance if possible (color patterns, head shape, size).' },
            { step: 2, summary: 'Keep calm and still', detail: 'Have the person lie down and remain as STILL as possible. Movement spreads venom faster through the body. Panic increases heart rate and venom spread.' },
            { step: 3, summary: 'Remove constricting items', detail: 'QUICKLY remove jewelry, watches, rings, and tight clothing near the bite BEFORE swelling starts. Swelling can be severe.' },
            { step: 4, summary: 'Position the limb', detail: 'Keep the bitten area BELOW heart level if possible. Do NOT elevate - this speeds venom to the heart.' },
            { step: 5, summary: 'Immobilize the limb', detail: 'Splint the limb to prevent ALL movement. Use bandages, sticks, or clothing. Movement pumps venom through lymph system.' },
            { step: 6, summary: 'Clean gently if possible', detail: 'If clean water available, GENTLY rinse around bite. Do NOT scrub, apply pressure, or try to squeeze out venom.' },
            { step: 7, summary: 'Mark the swelling', detail: 'With pen or marker, circle the edge of any swelling and write the time. This helps track venom spread.' },
            { step: 8, summary: 'ACTIVATE EMERGENCY SOS', detail: 'ACTIVATE SOS BEACON IMMEDIATELY. Time is critical - antivenom may be needed within hours. Note time of bite for medical team.' },
            { step: 9, summary: 'Monitor and prepare', detail: 'Watch for: breathing difficulty, severe swelling, changes in consciousness, nausea/vomiting. Be ready for CPR. Keep person warm.' }
        ],
        regional_venom_info: {
            note: 'Snake identification helps medical teams prepare correct antivenom. Try to remember or photograph the snake safely.',
            north_america: {
                common_venomous: ['Rattlesnakes (pit vipers)', 'Copperheads', 'Cottonmouth/Water Moccasin', 'Coral Snakes'],
                identification_tips: [
                    'Pit vipers: triangular head, vertical pupils, heat-sensing pit between eye and nostril',
                    'Rattlesnakes: rattle on tail (may be silent in young snakes)',
                    'Coral snakes: red and yellow bands touch ("Red on yellow, kill a fellow")',
                    'Harmless king snakes: red and black bands touch ("Red on black, friend of Jack")'
                ],
                venom_types: {
                    pit_vipers: 'Hemotoxic - destroys blood cells and tissues. Causes severe swelling, pain, tissue damage.',
                    coral_snakes: 'Neurotoxic - affects nervous system. May have delayed symptoms (hours). Causes paralysis, breathing failure.'
                }
            },
            australia: {
                common_venomous: ['Eastern Brown Snake', 'Inland Taipan', 'Tiger Snake', 'Death Adder', 'Red-bellied Black Snake'],
                identification_tips: [
                    'Most Australian venomous snakes have round pupils (not reliable ID)',
                    'Brown snakes are most dangerous - can be various colors despite name',
                    'Do NOT attempt to identify - treat ALL Australian snake bites as life-threatening'
                ],
                venom_types: {
                    most_species: 'Neurotoxic and/or procoagulant - affects blood clotting and nervous system. Can cause collapse within minutes.'
                },
                special_note: 'Apply pressure immobilization bandage for Australian snakes - wrap firmly from bite toward heart.'
            },
            general: {
                venom_effects: {
                    hemotoxic: 'Blood and tissue damage: severe swelling, pain, bruising, bleeding, tissue death',
                    neurotoxic: 'Nerve damage: drooping eyelids, difficulty speaking/swallowing, paralysis, breathing failure',
                    cytotoxic: 'Cell damage: severe local tissue destruction, necrosis'
                },
                delayed_symptoms: 'Some snake venoms (especially neurotoxic) may show delayed effects. Continue monitoring for 12-24 hours.'
            }
        },
        warnings: [
            'ASSUME ALL SNAKE BITES ARE VENOMOUS until proven otherwise',
            'Do NOT cut the wound or try to suck out venom - this does NOT work and causes infection',
            'Do NOT apply a tourniquet - this traps venom and causes tissue death',
            'Do NOT apply ice or cold - increases tissue damage',
            'Do NOT give alcohol or caffeine - speeds venom spread',
            'Do NOT try to catch or kill the snake - risk of second bite',
            'Do NOT waste time - EVACUATE IMMEDIATELY',
            'TIME IS CRITICAL - antivenom is most effective within 4-6 hours'
        ],
        contraindications: ['No cutting the wound', 'No suction devices', 'No tourniquets', 'No ice/cold', 'No alcohol', 'No attempting to catch snake'],
        when_to_seek_help: 'ALL snake bites require IMMEDIATE emergency medical evacuation. Activate SOS immediately. Even "dry bites" (no venom) need evaluation. Antivenom is time-sensitive and must be given in hospital. Do NOT wait for symptoms - they may be delayed but still fatal.'
    },
    // HYPOTHERMIA
    {
        id: 3,
        category: 'environmental',
        name: 'Hypothermia Treatment',
        severity: 'critical',
        keywords: ['cold', 'hypothermia', 'freezing', 'shivering', 'cold exposure', 'frostbite', 'confusion', 'slurred speech'],
        summary: 'Recognition and treatment of cold-related emergencies with symptom staging',
        steps: [
            { step: 1, summary: 'Recognize symptoms', detail: 'Mild: shivering, cold skin, alert. Moderate: violent shivering, confusion, slurred speech, stumbling. Severe: no shivering, very confused or unconscious, weak pulse, shallow breathing.' },
            { step: 2, summary: 'Move to shelter', detail: 'Get the person out of the cold and wind into a dry, warm shelter if possible. Protect from further heat loss.' },
            { step: 3, summary: 'Remove wet clothing', detail: 'GENTLY remove any wet clothing and replace with dry layers or blankets. Cut clothing off if needed to minimize movement.' },
            { step: 4, summary: 'Insulate from ground', detail: 'Place insulating material (foam pad, branches, dry leaves, backpack) between person and ground. Ground steals heat rapidly.' },
            { step: 5, summary: 'Warm the core first', detail: 'Apply warm (not hot) compresses to neck, armpits, and groin - where major blood vessels are close to surface. Use body heat from another person if needed (skin to skin).' },
            { step: 6, summary: 'Give warm fluids', detail: 'If person is conscious and can swallow, give warm, sweet liquids. NOT alcohol or caffeine. Do NOT give fluids if confused or unable to swallow.' },
            { step: 7, summary: 'Handle very gently', detail: 'Move the person very gently - rough handling or sudden movement can cause cardiac arrest in severe hypothermia.' },
            { step: 8, summary: 'Monitor continuously', detail: 'Watch breathing and pulse closely. Be prepared for CPR. Hypothermic hearts are very fragile.' }
        ],
        symptom_stages: {
            mild: {
                body_temp: '32-35°C (90-95°F)',
                symptoms: [
                    'Shivering - body trying to generate heat',
                    'Cold, pale skin',
                    'Numbness in extremities',
                    'Person is alert and responsive',
                    'Fatigue and weakness',
                    'Slight difficulty with coordination'
                ],
                treatment: 'Can usually be treated in field. Get to shelter, remove wet clothes, add dry layers, give warm drinks, keep person moving if able.'
            },
            moderate: {
                body_temp: '28-32°C (82-90°F)',
                symptoms: [
                    'Violent, uncontrollable shivering',
                    'Confusion and poor judgment',
                    'Slurred speech',
                    'Stumbling, poor coordination',
                    'Drowsiness',
                    'Memory problems',
                    'Muscle stiffness'
                ],
                treatment: 'Requires more aggressive warming. Handle gently. Apply warm compresses to core areas. DO NOT let person walk. Seek medical help.'
            },
            severe: {
                body_temp: 'Below 28°C (82°F)',
                symptoms: [
                    'Shivering STOPS - very dangerous sign',
                    'Severe confusion or unconsciousness',
                    'Weak or irregular pulse',
                    'Very slow, shallow breathing',
                    'Blue skin (cyanosis)',
                    'Muscle rigidity',
                    'Person may appear dead'
                ],
                treatment: 'MEDICAL EMERGENCY - Activate SOS. Handle EXTREMELY gently. Do not attempt rapid rewarming. Keep horizontal. Be ready for CPR. Even if person appears dead, continue CPR until help arrives - people have survived after appearing dead from hypothermia.'
            }
        },
        warnings: [
            'Do NOT rub or massage limbs - this can cause cardiac arrest by sending cold blood to the heart',
            'Do NOT apply direct heat to skin (heating pads, hot water bottles directly on skin) - can cause burns and shock',
            'Do NOT give alcohol - it causes blood vessels to dilate and INCREASES heat loss',
            'Handle VERY gently - sudden movements can trigger fatal heart arrhythmias',
            'In severe hypothermia, person may appear dead - continue care and seek help',
            'Do NOT let a hypothermic person walk or exert themselves - can cause heart failure',
            'When shivering STOPS but person is still cold, this indicates SEVERE hypothermia'
        ],
        contraindications: ['No alcohol', 'No direct heat application', 'No massage or rubbing limbs', 'No rough handling', 'No exertion/walking in moderate-severe cases'],
        when_to_seek_help: 'Seek immediate help for: moderate hypothermia (confusion, slurred speech, violent shivering), severe hypothermia (shivering stopped, unconscious, weak pulse), any loss of consciousness, symptoms not improving with warming, or if unable to provide adequate shelter and warming.'
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
        keywords: ['burn', 'burns', 'fire', 'scald', 'hot', 'blister', 'thermal', 'first degree', 'second degree', 'third degree', 'sunburn'],
        summary: 'First aid for first, second, and third degree burns with severity-specific guidance',
        steps: [
            { step: 1, summary: 'Stop the burning', detail: 'Remove person from heat source. If clothing is on fire: Stop, Drop, Roll. Remove smoldering clothing UNLESS stuck to skin - do NOT pull stuck clothing.' },
            { step: 2, summary: 'Assess burn severity', detail: '1st degree: Red, painful, dry (like sunburn). 2nd degree: Blisters, very painful, moist. 3rd degree: White, brown, or charred; may be painless (nerves destroyed); leathery texture.' },
            { step: 3, summary: 'Cool the burn', detail: 'Run COOL (not cold) water over burn for 10-20 minutes. Do NOT use ice - it can cause frostbite on damaged tissue. This is the most important treatment step.' },
            { step: 4, summary: 'Remove constrictive items', detail: 'Quickly remove jewelry, watches, belts, and tight clothing from burned area BEFORE swelling starts.' },
            { step: 5, summary: 'Cover the burn', detail: 'Cover loosely with clean, dry, non-fluffy bandage or cling film. Do NOT wrap tightly - burns swell.' },
            { step: 6, summary: 'Treat for shock if severe', detail: 'For large burns: keep person warm (cover unburned areas), lay flat with legs elevated, give small sips of water if conscious.' }
        ],
        burn_severity_guide: {
            first_degree: {
                appearance: 'Red, dry skin like sunburn. No blisters. Painful to touch.',
                treatment: [
                    'Cool with running water for 10-20 minutes',
                    'Apply aloe vera or moisturizing lotion after cooling',
                    'Take over-the-counter pain reliever if needed',
                    'Keep burn clean and moisturized',
                    'Usually heals in 3-5 days without scarring'
                ],
                seek_help: 'Usually can be treated at home. Seek help if: covers large area, on face, or person is very young/elderly.'
            },
            second_degree: {
                appearance: 'Red, blistered, very painful, moist/weepy skin. Swelling present.',
                treatment: [
                    'Cool with running water for 15-20 minutes',
                    'Do NOT pop or break blisters - they protect healing skin',
                    'Cover loosely with non-stick bandage',
                    'Change dressing daily',
                    'Pain relievers may be needed',
                    'Heals in 2-3 weeks, may scar'
                ],
                seek_help: 'Seek help if: larger than 3 inches, on face/hands/feet/groin/joints, blisters pop, or signs of infection.'
            },
            third_degree: {
                appearance: 'White, brown, or black/charred. Leathery texture. May be painless because nerves are destroyed.',
                treatment: [
                    'CALL FOR EMERGENCY HELP IMMEDIATELY - Activate SOS',
                    'Do NOT remove any clothing stuck to the burn',
                    'Do NOT apply water to large 3rd degree burns - can cause shock',
                    'Cover loosely with clean, dry bandage or sheet',
                    'Elevate burned area above heart if possible',
                    'Monitor for shock - keep person warm',
                    'Do NOT give anything by mouth'
                ],
                seek_help: 'ALL third degree burns require emergency medical care. Skin grafting usually needed. Life-threatening if large area affected.'
            }
        },
        warnings: [
            'Do NOT apply ice or ice water - causes frostbite on damaged tissue',
            'Do NOT apply butter, oil, toothpaste, or other folk remedies',
            'Do NOT break or pop blisters - increases infection risk',
            'Do NOT remove clothing stuck to burn - causes more damage',
            'Do NOT use fluffy cotton or towels - fibers stick to burn',
            'Chemical burns: brush off dry chemicals FIRST, then flush with water 20+ minutes',
            'Electrical burns may have internal damage not visible - always seek help'
        ],
        contraindications: ['No ice', 'No butter/oils/toothpaste', 'No breaking blisters', 'No tight bandages', 'No fluffy materials on burn'],
        when_to_seek_help: 'Seek immediate help for: ALL 3rd degree burns, burns larger than palm of hand, burns on face/hands/feet/genitals/joints, burns that go all the way around a limb, electrical or chemical burns, burns with smoke inhalation/breathing difficulty, burns in children under 5 or elderly over 60.'
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
        keywords: ['cut', 'wound', 'bleeding', 'laceration', 'scrape', 'abrasion', 'infection', 'cleaning', 'bandage', 'bandaging'],
        summary: 'Cleaning and bandaging minor wounds to prevent infection',
        steps: [
            { step: 1, summary: 'Wash your hands', detail: 'Clean your hands thoroughly before treating wound to prevent infection.' },
            { step: 2, summary: 'Stop bleeding', detail: 'Apply gentle pressure with clean cloth for 5-10 minutes. Most minor cuts stop bleeding on their own.' },
            { step: 3, summary: 'Clean the wound', detail: 'Rinse with clean water. Remove any debris gently. Do not use hydrogen peroxide or iodine on open wounds.' },
            { step: 4, summary: 'Apply antibiotic', detail: 'If available, apply thin layer of antibiotic ointment to prevent infection.' },
            { step: 5, summary: 'Cover wound', detail: 'Apply clean bandage. Change daily or when wet/dirty.' },
            { step: 6, summary: 'Monitor for infection', detail: 'Watch for infection signs over next 3-5 days: increasing pain, redness spreading beyond wound edges, swelling, warmth around wound, pus or discharge, fever, red streaks leading away from wound toward heart.' }
        ],
        warnings: [
            'Deep cuts may need stitches - seek help if wound edges gap or do not stay together',
            'Animal bites ALWAYS need medical evaluation - high infection risk and possible rabies',
            'Puncture wounds are prone to infection - they seal over before healing inside',
            'Watch for tetanus risk with dirty wounds, rusty objects, or soil contamination',
            'Wounds with embedded debris need professional cleaning'
        ],
        infection_signs: [
            'Increasing pain after first 24 hours (should be improving, not worsening)',
            'Redness spreading beyond wound edges',
            'Swelling increasing after day 2',
            'Warmth or heat around the wound',
            'Pus or cloudy discharge',
            'Fever (temperature above 38°C/100.4°F)',
            'Red streaks leading away from wound toward heart',
            'Foul odor from wound',
            'Wound reopening or not healing'
        ],
        contraindications: ['No hydrogen peroxide on open wounds', 'No iodine directly in wound', 'No alcohol directly in wound'],
        when_to_seek_help: 'Seek help if: bleeding does not stop after 10 minutes of pressure, wound is deep or gaping, wound edges do not stay together, caused by dirty/rusty object or bite, any signs of infection appear, you cannot clean wound properly, or wound does not show improvement in 3-5 days.'
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

// ==============================================================================
// Shelter Construction Database
// ==============================================================================

const shelterDatabase = {
    debris_hut: {
        id: 'debris_hut',
        name: 'Debris Hut (A-Frame)',
        difficulty: 'beginner',
        time_to_build: '2-4 hours',
        capacity: '1-2 people',
        climate_suitability: ['temperate', 'cold', 'rainy'],
        description: 'Classic survival shelter using natural materials. Excellent insulation when properly built.',
        location_selection: {
            guidelines: [
                'Choose flat, dry ground slightly elevated to avoid water pooling',
                'Avoid low areas where cold air collects',
                'Look for natural windbreaks (hills, large rocks, dense trees)',
                'Avoid dead standing trees (widowmakers) that could fall',
                'Check above for unstable branches or overhanging hazards',
                'Stay at least 50 feet from water sources to avoid insects and flooding',
                'Consider sun exposure - south-facing in cold climates for warmth'
            ],
            avoid: ['Valley bottoms (cold air sinks)', 'Flood zones', 'Under dead trees', 'Animal trails', 'Near insect nests']
        },
        materials: {
            required: [
                { item: 'Ridge pole', description: '9-12 feet long, sturdy branch about wrist thickness', quantity: 1 },
                { item: 'Support stump/rock', description: 'Elevated support 3-4 feet high for ridge pole', quantity: 1 },
                { item: 'Rib branches', description: '4-6 feet long branches for framework', quantity: '20-30' },
                { item: 'Debris (leaves, grass, ferns)', description: 'Dead leaves, pine needles, grass, ferns for insulation', quantity: 'Large pile' },
                { item: 'Small sticks', description: 'For holding debris in place', quantity: '50+' }
            ],
            optional: [
                { item: 'Cordage', description: 'Rope, paracord, or natural cordage for lashing' },
                { item: 'Tarp', description: 'Waterproof layer if available' },
                { item: 'Ground insulation', description: 'Extra leaves/grass for sleeping pad' }
            ]
        },
        steps: [
            { step: 1, summary: 'Find ridge pole', detail: 'Select a sturdy branch 9-12 feet long, about wrist thickness. It must support its own weight plus debris.' },
            { step: 2, summary: 'Create support', detail: 'Place one end of ridge pole on a stump, rock, or forked tree branch 3-4 feet off the ground. The other end rests on the ground.' },
            { step: 3, summary: 'Add rib branches', detail: 'Lean rib branches against ridge pole at 45-degree angles, spaced 6-8 inches apart. Create ribcage structure.' },
            { step: 4, summary: 'Add lattice layer', detail: 'Weave smaller sticks horizontally through ribs to create a lattice that holds debris in place.' },
            { step: 5, summary: 'Apply debris - first layer', detail: 'Start from the bottom, pile leaves/debris 1 foot thick. Work upward like shingling a roof.' },
            { step: 6, summary: 'Apply debris - final layers', detail: 'Build up to 2-3 feet of debris thickness. More = warmer. Pack it tight.' },
            { step: 7, summary: 'Add weight sticks', detail: 'Lay branches over debris to prevent wind from blowing it away.' },
            { step: 8, summary: 'Create ground insulation', detail: 'Fill interior with 6+ inches of dry leaves/debris as bedding. Never sleep on bare ground.' },
            { step: 9, summary: 'Create door plug', detail: 'Make a removable debris bundle to block entrance after you\'re inside.' },
            { step: 10, summary: 'Test and improve', detail: 'Crawl in, check for drafts and gaps. Fill any holes with more debris.' }
        ],
        tips: [
            'Shelter should be just big enough to fit you - smaller is warmer',
            'Entry should face away from prevailing wind',
            'In rain, make shelter steeper to shed water',
            'You can\'t have too much debris - pile it on',
            'Test before nightfall and improve as needed'
        ]
    },
    lean_to: {
        id: 'lean_to',
        name: 'Lean-To Shelter',
        difficulty: 'beginner',
        time_to_build: '1-2 hours',
        capacity: '1-3 people',
        climate_suitability: ['temperate', 'dry'],
        description: 'Simple one-sided shelter, quick to build. Best paired with fire for warmth.',
        location_selection: {
            guidelines: [
                'Find natural support (fallen tree, rock face, standing trees)',
                'Position back to prevailing wind',
                'Consider fire placement - shelter reflects heat',
                'Avoid flood zones and cold pockets'
            ],
            avoid: ['Windy exposed areas', 'Low wet ground', 'Under dead branches']
        },
        materials: {
            required: [
                { item: 'Horizontal support pole', description: '8-10 feet long, sturdy', quantity: 1 },
                { item: 'Angled support poles', description: 'If no natural support available', quantity: 2 },
                { item: 'Roofing poles', description: '6-8 feet long branches', quantity: '10-15' },
                { item: 'Covering material', description: 'Leaves, grass, bark, pine boughs', quantity: 'Large amount' }
            ],
            optional: [
                { item: 'Tarp or emergency blanket', description: 'For waterproofing' },
                { item: 'Cordage', description: 'For lashing if needed' }
            ]
        },
        steps: [
            { step: 1, summary: 'Establish horizontal support', detail: 'Lash or wedge horizontal pole between two trees, or prop against rock/stump at 4-5 feet height.' },
            { step: 2, summary: 'Add roof poles', detail: 'Lean poles from ground to horizontal support at 45-60 degrees. Space 6-8 inches apart.' },
            { step: 3, summary: 'Add cross supports', detail: 'Weave thin branches horizontally to create framework for covering.' },
            { step: 4, summary: 'Apply covering', detail: 'Layer leaves, bark, or pine boughs from bottom up, overlapping like shingles.' },
            { step: 5, summary: 'Add ground insulation', detail: 'Create thick bed of dry leaves/grass inside.' },
            { step: 6, summary: 'Build fire reflector', detail: 'Build fire 3-4 feet in front of opening. Place logs behind fire to reflect heat into shelter.' }
        ],
        tips: [
            'Open side should face fire, not wind',
            'Fire reflector wall doubles heat efficiency',
            'Add sides in cold weather for more protection',
            'Quick to build but less insulating than debris hut'
        ]
    },
    snow_cave: {
        id: 'snow_cave',
        name: 'Snow Cave / Quinzhee',
        difficulty: 'intermediate',
        time_to_build: '2-4 hours',
        capacity: '1-3 people',
        climate_suitability: ['cold', 'arctic', 'snowy'],
        description: 'Excellent winter shelter dug into packed snow. Temperature stays near freezing even in extreme cold.',
        location_selection: {
            guidelines: [
                'Find deep snowdrift on leeward side of hill or tree line',
                'Snow depth should be at least 5-6 feet',
                'Avoid avalanche zones on slopes',
                'Look for packed, consolidated snow (not fresh powder)',
                'Check snow stability by digging test hole'
            ],
            avoid: ['Avalanche paths', 'Cornices on ridges', 'Areas with shallow snow', 'South-facing slopes (sun melts)']
        },
        materials: {
            required: [
                { item: 'Digging tool', description: 'Shovel, pot, flat stick, snowshoe', quantity: 1 },
                { item: 'Deep snowdrift', description: 'Minimum 5-6 feet deep packed snow', quantity: 'Natural' }
            ],
            optional: [
                { item: 'Ventilation stick', description: 'For creating air holes' },
                { item: 'Ground pad', description: 'Insulation from ice floor' },
                { item: 'Marker', description: 'Flag or bright item to mark location' }
            ]
        },
        steps: [
            { step: 1, summary: 'Identify location', detail: 'Find a deep snowdrift. For quinzhee, pile snow 5+ feet high and let it settle 2-3 hours.' },
            { step: 2, summary: 'Dig entrance tunnel', detail: 'Dig horizontal or slightly upward-sloping entrance tunnel. Entrance lower than sleeping platform.' },
            { step: 3, summary: 'Excavate main chamber', detail: 'Hollow out dome-shaped chamber. Smooth walls to prevent dripping. Ceiling should be arched.' },
            { step: 4, summary: 'Create sleeping platform', detail: 'Sleeping area MUST be higher than entrance to trap warm air.' },
            { step: 5, summary: 'Poke ventilation hole', detail: 'CRITICAL: Make small hole in roof for fresh air. CO2 from breathing can be deadly without ventilation.' },
            { step: 6, summary: 'Smooth interior walls', detail: 'Smooth ceiling to prevent drip points. Any bumps will cause water to drip on you.' },
            { step: 7, summary: 'Create door block', detail: 'Pack snow block to partially cover entrance, reducing heat loss while allowing air flow.' },
            { step: 8, summary: 'Mark location', detail: 'Mark outside with skis, poles, or bright item so you can be found and others don\'t walk over it.' }
        ],
        tips: [
            'Interior temp stays 25-32°F even when -40°F outside',
            'ALWAYS maintain ventilation hole - carbon dioxide kills',
            'Keep digging tool inside in case entrance collapses',
            'Brush snow off clothes before entering to stay dry',
            'A candle can raise interior temp 10+ degrees'
        ],
        warnings: [
            'NEVER block ventilation hole - carbon dioxide poisoning is deadly',
            'Avoid building in avalanche zones',
            'Mark location clearly to prevent someone walking over roof',
            'Keep entrance clear of drifting snow'
        ]
    },
    tarp_shelter: {
        id: 'tarp_shelter',
        name: 'Tarp/Poncho Shelter',
        difficulty: 'beginner',
        time_to_build: '15-30 minutes',
        capacity: '1-2 people',
        climate_suitability: ['all'],
        description: 'Quick and versatile shelter using a tarp or poncho. Many configuration options.',
        materials: {
            required: [
                { item: 'Tarp or poncho', description: '8x10 feet minimum', quantity: 1 },
                { item: 'Cordage', description: 'Rope, paracord, or line', quantity: '50+ feet' },
                { item: 'Stakes or anchors', description: 'Stakes, rocks, or logs to secure', quantity: '4-8' }
            ],
            optional: [
                { item: 'Ridge line', description: 'For A-frame configuration' },
                { item: 'Trekking poles', description: 'For support structure' }
            ]
        },
        configurations: [
            { name: 'A-Frame', description: 'Ridge line between trees, tarp draped over, sides staked down. Good rain protection.' },
            { name: 'Lean-To', description: 'One edge high, other staked to ground. Quick setup, pairs with fire.' },
            { name: 'Tube Tent', description: 'Ridge line through tarp, ends open. Fast to deploy.' },
            { name: 'Diamond Fly', description: 'Corner up with stick/pole, edges staked. Good coverage.' }
        ],
        steps: [
            { step: 1, summary: 'Choose configuration', detail: 'Select based on weather conditions - A-frame for rain, lean-to for fire reflection.' },
            { step: 2, summary: 'Set ridge line', detail: 'For A-frame: tie tight line between two trees at desired height.' },
            { step: 3, summary: 'Position tarp', detail: 'Drape tarp over ridge line or attach corners for chosen configuration.' },
            { step: 4, summary: 'Stake corners', detail: 'Pull tarp taut and secure corners with stakes, rocks, or logs.' },
            { step: 5, summary: 'Adjust tension', detail: 'Tighten all lines to prevent sagging and flapping in wind.' },
            { step: 6, summary: 'Add ground insulation', detail: 'Place leaves, pine boughs, or pad inside for ground insulation.' }
        ],
        tips: [
            'Practice different configurations before you need them',
            'Pitch tarp at angle to shed rain effectively',
            'Face opening away from wind',
            'Silver emergency blankets work in a pinch'
        ]
    }
};

// Get shelter by type
app.get('/api/shelter/:type', (req, res) => {
    const type = req.params.type.toLowerCase().replace(/-/g, '_');
    const shelter = shelterDatabase[type];

    if (!shelter) {
        return res.status(404).json({
            success: false,
            error: `Shelter type '${type}' not found`,
            available_types: Object.keys(shelterDatabase)
        });
    }

    res.json({
        success: true,
        shelter: shelter
    });
});

// List all shelter types
app.get('/api/shelters', (req, res) => {
    const { climate, difficulty } = req.query;

    let shelters = Object.values(shelterDatabase);

    if (climate) {
        shelters = shelters.filter(s => s.climate_suitability.includes(climate.toLowerCase()));
    }

    if (difficulty) {
        shelters = shelters.filter(s => s.difficulty === difficulty.toLowerCase());
    }

    const summary = shelters.map(s => ({
        id: s.id,
        name: s.name,
        difficulty: s.difficulty,
        time_to_build: s.time_to_build,
        capacity: s.capacity,
        climate_suitability: s.climate_suitability,
        description: s.description
    }));

    res.json({
        success: true,
        count: summary.length,
        shelters: summary
    });
});

// Search shelters by query
app.post('/api/shelters/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    // Check for specific shelter types
    const shelterMatches = [];
    for (const [key, shelter] of Object.entries(shelterDatabase)) {
        const nameMatch = shelter.name.toLowerCase().includes(queryLower);
        const descMatch = shelter.description.toLowerCase().includes(queryLower);
        const idMatch = key.includes(queryLower);

        if (nameMatch || descMatch || idMatch) {
            shelterMatches.push(shelter);
        }
    }

    // Keyword matching
    const keywords = {
        debris: 'debris_hut',
        'a-frame': 'debris_hut',
        'a frame': 'debris_hut',
        hut: 'debris_hut',
        'lean to': 'lean_to',
        'lean-to': 'lean_to',
        leanto: 'lean_to',
        snow: 'snow_cave',
        cave: 'snow_cave',
        quinzhee: 'snow_cave',
        igloo: 'snow_cave',
        tarp: 'tarp_shelter',
        poncho: 'tarp_shelter',
        quick: 'tarp_shelter'
    };

    for (const [keyword, shelterKey] of Object.entries(keywords)) {
        if (queryLower.includes(keyword) && !shelterMatches.find(s => s.id === shelterKey)) {
            shelterMatches.push(shelterDatabase[shelterKey]);
        }
    }

    if (shelterMatches.length === 0) {
        // Return all shelters as suggestions
        return res.json({
            success: true,
            found: false,
            message: `No specific match for "${query}". Here are all available shelters:`,
            shelters: Object.values(shelterDatabase).map(s => ({
                id: s.id,
                name: s.name,
                description: s.description
            }))
        });
    }

    const primary = shelterMatches[0];

    res.json({
        success: true,
        found: true,
        query: query,
        shelter: primary,
        other_options: shelterMatches.slice(1).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description
        }))
    });
});

// ==============================================================================
// Fire Starting Database
// ==============================================================================

const fireDatabase = {
    methods: {
        friction: {
            id: 'friction',
            name: 'Friction Methods',
            category: 'primitive',
            difficulty: 'advanced',
            description: 'Creating fire through friction-generated heat. Requires skill and practice.',
            techniques: [
                {
                    name: 'Bow Drill',
                    difficulty: 'intermediate',
                    description: 'Most reliable friction method. Uses a bow to spin a spindle against a fireboard.',
                    materials: ['Fireboard (dry, soft wood like cedar, willow)', 'Spindle (straight, dry stick ~8 inches)', 'Bow (curved branch with cordage)', 'Handhold (hard wood or rock with depression)', 'Tinder bundle'],
                    steps: [
                        'Carve notch in fireboard to collect ember dust',
                        'Place tinder under notch to catch ember',
                        'Wrap bow string around spindle once',
                        'Hold handhold on top of spindle, fireboard steady with foot',
                        'Bow back and forth with increasing speed and pressure',
                        'Continue until ember forms in notch',
                        'Transfer ember to tinder bundle, blow gently into flame'
                    ],
                    tips: ['Keep everything DRY', 'Apply downward pressure', 'Long smooth strokes work best', 'Practice before you need it']
                },
                {
                    name: 'Hand Drill',
                    difficulty: 'advanced',
                    description: 'Simplest friction method but requires most skill and callused hands.',
                    materials: ['Spindle (straight, dry, ~18 inches)', 'Fireboard (soft dry wood)', 'Tinder bundle'],
                    steps: [
                        'Carve notch in fireboard',
                        'Place spindle in depression in fireboard',
                        'Spin spindle between palms while pressing down',
                        'Hands will naturally move down - quickly reset to top',
                        'Maintain consistent pressure and speed',
                        'Continue until ember forms'
                    ],
                    tips: ['Requires lots of practice', 'Works best in dry conditions', 'Can cause blisters - build calluses']
                },
                {
                    name: 'Fire Plough',
                    difficulty: 'advanced',
                    description: 'Rubbing a stick back and forth in a groove.',
                    materials: ['Fireboard with groove', 'Hardwood plough stick', 'Tinder'],
                    steps: [
                        'Carve groove in soft wood fireboard',
                        'Rub hard stick back and forth in groove quickly',
                        'Push dust to end of groove',
                        'Continue until dust ignites'
                    ]
                }
            ]
        },
        spark: {
            id: 'spark',
            name: 'Spark Methods',
            category: 'modern',
            difficulty: 'beginner',
            description: 'Creating sparks to ignite tinder. More reliable than friction.',
            techniques: [
                {
                    name: 'Ferro Rod / Fire Steel',
                    difficulty: 'beginner',
                    description: 'Scraping ferrocerium rod creates hot sparks (~3000°F).',
                    materials: ['Ferro rod', 'Striker or knife spine', 'Dry tinder'],
                    steps: [
                        'Prepare tinder bundle or char cloth',
                        'Hold ferro rod close to tinder',
                        'Scrape striker DOWN the rod (not up) to throw sparks into tinder',
                        'Use firm, fast strokes',
                        'Once tinder catches, blow gently to flame'
                    ],
                    tips: ['Works when wet - dry rod before use', 'Char cloth catches sparks easiest', 'Practice in controlled setting']
                },
                {
                    name: 'Flint and Steel',
                    difficulty: 'intermediate',
                    description: 'Traditional method striking steel against flint.',
                    materials: ['Hard flint or quartz', 'High-carbon steel', 'Char cloth', 'Tinder bundle'],
                    steps: [
                        'Hold char cloth against flint',
                        'Strike steel DOWN along flint edge',
                        'Sparks should land on char cloth',
                        'Once char cloth catches, transfer to tinder',
                        'Blow into flame'
                    ]
                },
                {
                    name: 'Battery and Steel Wool',
                    difficulty: 'beginner',
                    description: 'Electrical method using battery to ignite steel wool.',
                    materials: ['9V battery (or 2 AA)', 'Fine steel wool (#0000)', 'Tinder'],
                    steps: [
                        'Stretch steel wool into a loose bundle',
                        'Touch both battery terminals to steel wool',
                        'Steel wool will glow and ignite',
                        'Quickly add to tinder bundle',
                        'Blow into flame'
                    ],
                    tips: ['Works with wet steel wool', 'Fine grade steel wool works best', 'Keep battery away from steel wool until ready']
                }
            ]
        },
        solar: {
            id: 'solar',
            name: 'Solar Methods',
            category: 'environmental',
            difficulty: 'intermediate',
            description: 'Using sunlight focused through a lens to ignite tinder.',
            techniques: [
                {
                    name: 'Magnifying Lens',
                    difficulty: 'beginner',
                    description: 'Focusing sunlight through magnifying glass, eyeglasses, or clear container.',
                    materials: ['Magnifying glass, binocular lens, or reading glasses', 'Dark-colored tinder (charred material works best)', 'Bright sunlight'],
                    steps: [
                        'Wait for bright, direct sunlight',
                        'Place dark tinder on stable surface',
                        'Hold lens between sun and tinder',
                        'Adjust distance to create smallest, brightest point of light',
                        'Keep focal point steady on tinder',
                        'Continue until smoke appears, then flame'
                    ],
                    tips: ['Black/charred materials ignite fastest', 'Steady hands essential', 'Only works with direct sunlight']
                },
                {
                    name: 'Water-Filled Container',
                    difficulty: 'intermediate',
                    description: 'Clear bottle or balloon filled with water acts as lens.',
                    materials: ['Clear plastic bottle or balloon', 'Clean water', 'Dark tinder', 'Bright sunlight'],
                    steps: [
                        'Fill clear container with water',
                        'Shape spherical (balloon) or use curved bottle bottom',
                        'Hold container to focus sunlight to a point',
                        'Direct focal point onto dark tinder'
                    ]
                },
                {
                    name: 'Ice Lens',
                    difficulty: 'advanced',
                    description: 'Shaping clear ice into a lens to focus sunlight.',
                    materials: ['Clear ice (2-3 inches thick)', 'Knife or warmth to shape', 'Dark tinder'],
                    steps: [
                        'Find or make clear ice (freeze clean water slowly)',
                        'Shape ice into lens using knife or body heat',
                        'Polish surfaces smooth',
                        'Use like magnifying glass to focus sunlight'
                    ]
                }
            ]
        },
        chemical: {
            id: 'chemical',
            name: 'Chemical Methods',
            category: 'survival_kit',
            difficulty: 'beginner',
            description: 'Using chemical reactions to create fire.',
            techniques: [
                {
                    name: 'Waterproof Matches',
                    difficulty: 'beginner',
                    description: 'Standard matches treated to resist moisture.',
                    tips: ['Strike on dry surface', 'Shield from wind', 'Keep in waterproof container']
                },
                {
                    name: 'Lighter',
                    difficulty: 'beginner',
                    description: 'Most reliable modern fire method.',
                    tips: ['Keep dry', 'Store multiple', 'Works at altitude', 'Butane doesn\'t work well in extreme cold']
                },
                {
                    name: 'Potassium Permanganate + Glycerin',
                    difficulty: 'intermediate',
                    description: 'Chemical reaction produces fire after 30-60 seconds.',
                    materials: ['Potassium permanganate crystals', 'Glycerin'],
                    steps: [
                        'Create small pile of potassium permanganate',
                        'Add drops of glycerin to center',
                        'Stand back - reaction takes 30-60 seconds',
                        'Flames appear when chemicals react'
                    ],
                    warnings: ['Chemical reaction - keep face away', 'Do not inhale fumes']
                }
            ]
        }
    },
    materials: {
        tinder: {
            description: 'Fine, dry materials that catch spark or ember. Must be bone dry.',
            natural: ['Dry grass', 'Cattail fluff', 'Birch bark', 'Cedar bark (shredded)', 'Dry leaves', 'Pine needles', 'Dandelion fluff', 'Milkweed fluff', 'Bird down/feathers'],
            processed: ['Char cloth', 'Dryer lint', 'Cotton balls (with petroleum jelly)', 'Fine steel wool', 'Newspaper (shredded)'],
            tips: ['Tinder must be BONE DRY', 'Collect more than you think you need', 'Process materials into fine fibers', 'Keep tinder in waterproof container']
        },
        kindling: {
            description: 'Small sticks that catch fire from tinder flame. Builds heat for larger fuel.',
            sizes: ['Pencil-thin twigs (first stage)', 'Finger-thick sticks (second stage)', 'Thumb-thick sticks (third stage)'],
            sources: ['Dead standing branches', 'Inside bark of dead trees', 'Resinous (pitch) wood'],
            tips: ['Dead branches attached to tree are drier than ground wood', 'Sort by size before starting fire', 'Split wood burns easier than round']
        },
        fuel: {
            description: 'Larger wood that sustains the fire once established.',
            types: ['Hardwood (oak, maple) - burns longer, hotter', 'Softwood (pine, cedar) - ignites easier, burns faster', 'Resinous wood - very hot but smoky'],
            tips: ['Have wood supply ready before starting', 'Keep fuel dry (stack off ground, cover)', 'Split large pieces for better burning']
        }
    },
    safety: [
        'Clear 10-foot diameter area of leaves, grass, and debris',
        'Check overhead for low branches, hanging materials',
        'Never leave fire unattended',
        'Have water, dirt, or sand ready to extinguish',
        'Build fire away from shelters, tents, trees',
        'Never burn in enclosed space - carbon monoxide kills',
        'Create fire ring with rocks if possible',
        'Fully extinguish before sleeping or leaving - drown, stir, drown again',
        'In windy conditions, dig fire pit or build wind break'
    ],
    fire_lays: [
        { name: 'Teepee', description: 'Kindling arranged in cone shape over tinder. Good for quick hot fire.', best_for: 'Quick fire, boiling water' },
        { name: 'Log Cabin', description: 'Stacked square with tinder in center. Burns longer, good base for cooking.', best_for: 'Cooking, long-lasting fire' },
        { name: 'Lean-To', description: 'Kindling leaned against support with tinder underneath. Good in wind.', best_for: 'Windy conditions' },
        { name: 'Star/Radial', description: 'Logs arranged like wheel spokes, pushed in as they burn. Fuel efficient.', best_for: 'Long fires, overnight' },
        { name: 'Platform', description: 'Fire built on platform of green logs. Use when ground is wet or snowy.', best_for: 'Wet/snowy conditions' }
    ]
};

// Get fire starting guide
app.get('/api/fire', (req, res) => {
    res.json({
        success: true,
        guide: fireDatabase
    });
});

// Get specific fire method
app.get('/api/fire/method/:method', (req, res) => {
    const method = req.params.method.toLowerCase();
    const methodData = fireDatabase.methods[method];

    if (!methodData) {
        return res.status(404).json({
            success: false,
            error: `Method '${method}' not found`,
            available_methods: Object.keys(fireDatabase.methods)
        });
    }

    res.json({
        success: true,
        method: methodData
    });
});

// Search fire starting info
app.post('/api/fire/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    // Determine what kind of info they want
    const response = {
        success: true,
        query: query,
        results: []
    };

    // Check for method keywords
    const methodKeywords = {
        friction: ['friction', 'bow drill', 'hand drill', 'rub', 'primitive'],
        spark: ['spark', 'ferro', 'flint', 'steel', 'battery', 'steel wool'],
        solar: ['solar', 'magnif', 'lens', 'sun', 'glass'],
        chemical: ['match', 'lighter', 'potassium', 'chemical']
    };

    for (const [method, keywords] of Object.entries(methodKeywords)) {
        if (keywords.some(k => queryLower.includes(k))) {
            response.results.push({
                type: 'method',
                data: fireDatabase.methods[method]
            });
        }
    }

    // Check for material keywords
    if (queryLower.includes('tinder') || queryLower.includes('material') || queryLower.includes('what to burn')) {
        response.results.push({
            type: 'materials',
            data: fireDatabase.materials
        });
    }

    // Check for safety
    if (queryLower.includes('safe') || queryLower.includes('danger')) {
        response.results.push({
            type: 'safety',
            data: fireDatabase.safety
        });
    }

    // Check for fire lay
    if (queryLower.includes('lay') || queryLower.includes('arrange') || queryLower.includes('stack')) {
        response.results.push({
            type: 'fire_lays',
            data: fireDatabase.fire_lays
        });
    }

    // Default: return overview of all methods
    if (response.results.length === 0) {
        response.results.push({
            type: 'overview',
            methods: Object.values(fireDatabase.methods).map(m => ({
                id: m.id,
                name: m.name,
                difficulty: m.difficulty,
                description: m.description,
                techniques_count: m.techniques.length
            })),
            safety_tips: fireDatabase.safety,
            materials_summary: {
                tinder: fireDatabase.materials.tinder.natural.slice(0, 5),
                kindling: fireDatabase.materials.kindling.sizes,
                fuel: fireDatabase.materials.fuel.types
            },
            fire_lays: fireDatabase.fire_lays
        });
    }

    res.json(response);
});

// ==============================================================================
// Water Purification Database
// ==============================================================================

const waterDatabase = {
    methods: {
        boiling: {
            id: 'boiling',
            name: 'Boiling',
            category: 'heat',
            difficulty: 'beginner',
            effectiveness: 'Kills bacteria, viruses, and parasites. Does NOT remove chemical contaminants.',
            description: 'Most reliable method to make water biologically safe. Works anywhere with fire/heat.',
            steps: [
                'Collect water in heat-safe container (metal pot, can)',
                'Bring water to a ROLLING BOIL - not just simmering',
                'Maintain rolling boil for 1 MINUTE at sea level',
                'At elevations above 6,500 feet (2,000m), boil for 3 MINUTES',
                'Let water cool before drinking',
                'Store in clean container'
            ],
            tips: [
                'Rolling boil = vigorous bubbles breaking surface',
                'Clear water before boiling if possible (strain through cloth)',
                'Boiling improves taste when water cools',
                'Metal containers work best - plastic can melt',
                'Hot rocks can boil water in non-metal containers'
            ],
            warnings: [
                'Boiling does NOT remove chemical pollutants',
                'Does NOT remove heavy metals or toxins',
                'Do not boil water from industrial areas'
            ],
            time_required: '10-20 minutes (including heat-up and cool-down)'
        },
        filtration: {
            id: 'filtration',
            name: 'Filtration Methods',
            category: 'physical',
            difficulty: 'intermediate',
            effectiveness: 'Removes particles, some bacteria, and parasites. Quality depends on filter type.',
            description: 'Physical removal of contaminants through various filter media.',
            techniques: [
                {
                    name: 'Commercial Filter (Sawyer, LifeStraw)',
                    effectiveness: 'Removes 99.99% bacteria, 99.9% protozoa. Some remove viruses.',
                    how_it_works: 'Hollow fiber membrane with microscopic pores',
                    steps: [
                        'Fill dirty water container',
                        'Connect filter according to instructions',
                        'Squeeze or suck water through filter',
                        'Clean/backflush filter regularly'
                    ],
                    tips: ['Backflush after each use', 'Do not allow to freeze', 'Replace as directed']
                },
                {
                    name: 'Improvised Sand/Charcoal Filter',
                    effectiveness: 'Removes particles and improves taste. LIMITED pathogen removal.',
                    how_it_works: 'Layers of material trap progressively smaller particles',
                    materials: ['Container with hole in bottom', 'Gravel (bottom layer)', 'Sand (middle layer)', 'Charcoal (top layer)', 'Cloth/grass (top filter)'],
                    steps: [
                        'Cut/punch hole in bottom of container',
                        'Add 2 inches of gravel at bottom',
                        'Add 2 inches of sand above gravel',
                        'Add 2 inches of crushed charcoal above sand',
                        'Cover top with cloth or grass',
                        'Pour water through slowly, collect filtered water',
                        'STILL BOIL or treat filtered water'
                    ],
                    warning: 'Improvised filters improve clarity but DO NOT guarantee pathogen removal. Always combine with boiling or chemical treatment.'
                },
                {
                    name: 'Cloth/Bandana Pre-Filter',
                    effectiveness: 'Removes large particles only. NOT purification.',
                    steps: [
                        'Fold cloth into multiple layers',
                        'Pour water through cloth into container',
                        'Repeat if water still cloudy',
                        'MUST treat filtered water'
                    ],
                    tip: 'Use as pre-filter to extend life of commercial filters'
                }
            ]
        },
        chemical: {
            id: 'chemical',
            name: 'Chemical Treatment',
            category: 'chemical',
            difficulty: 'beginner',
            effectiveness: 'Kills most bacteria and viruses. Some methods work on parasites.',
            description: 'Using chemicals to disinfect water. Lightweight backup to boiling.',
            techniques: [
                {
                    name: 'Iodine Tablets',
                    effectiveness: 'Effective against bacteria, viruses, and most parasites',
                    steps: [
                        'Add tablets per package directions (usually 2 tablets per liter)',
                        'Wait 30 minutes before drinking',
                        'Wait 4 hours if water is cold or cloudy',
                        'Use vitamin C tablet after to improve taste'
                    ],
                    warnings: [
                        'Not safe for pregnant women',
                        'Not safe for those with thyroid conditions',
                        'Do not use long-term (weeks)',
                        'Less effective against Cryptosporidium'
                    ]
                },
                {
                    name: 'Chlorine Dioxide Tablets (Aquamira, Potable Aqua)',
                    effectiveness: 'Highly effective against bacteria, viruses, AND Cryptosporidium',
                    steps: [
                        'Follow package directions exactly',
                        'Typically wait 15-30 minutes for bacteria/viruses',
                        'Wait 4 hours for Cryptosporidium'
                    ],
                    tips: ['Preferred over iodine for most situations', 'Safe for longer-term use']
                },
                {
                    name: 'Household Bleach (Sodium Hypochlorite)',
                    effectiveness: 'Kills most bacteria and viruses',
                    steps: [
                        'Use UNSCENTED household bleach (5-6% sodium hypochlorite)',
                        'Add 2 drops per liter of CLEAR water',
                        'Add 4 drops per liter if water is cloudy',
                        'Stir and wait 30 minutes',
                        'Should have slight chlorine smell - if not, repeat',
                        'If strong bleach taste, let stand uncovered for a few hours'
                    ],
                    warning: 'Use only unscented bleach. Check concentration - newer bleach may be 8.25%.'
                }
            ]
        },
        uv: {
            id: 'uv',
            name: 'UV Treatment',
            category: 'light',
            difficulty: 'intermediate',
            effectiveness: 'Kills bacteria, viruses, and parasites by disrupting DNA.',
            description: 'Using ultraviolet light to disinfect water.',
            techniques: [
                {
                    name: 'SteriPEN or UV Purifier',
                    effectiveness: '99.9% of bacteria, viruses, and protozoa',
                    steps: [
                        'Pre-filter water to remove particles',
                        'Fill clear container (not colored)',
                        'Insert UV light, stir as directed',
                        'Treatment time varies by volume (30-90 seconds)',
                        'Water is safe to drink immediately'
                    ],
                    tips: ['Requires batteries', 'Water must be clear for UV to work', 'Keep backup purification method']
                },
                {
                    name: 'SODIS (Solar Disinfection)',
                    effectiveness: 'Kills most bacteria and viruses in 6+ hours of sun',
                    steps: [
                        'Fill clear PET plastic bottle (not glass)',
                        'Pre-filter water to remove cloudiness',
                        'Remove labels from bottle',
                        'Lay bottle on reflective surface in direct sun',
                        'Leave 6 hours minimum in full sun',
                        'Leave 2 days if cloudy weather',
                        'Shake periodically'
                    ],
                    tips: [
                        'Works best between latitudes 35°N and 35°S',
                        'Clear bottles only - no colored plastic',
                        'Maximum 2-liter bottles (larger reduces effectiveness)',
                        'Does not work through window glass'
                    ],
                    limitations: 'Slower than other methods. Less effective in cold or cloudy conditions.'
                }
            ]
        }
    },
    sources: {
        best: {
            description: 'Prefer these water sources when available',
            sources: [
                { name: 'Running streams above human activity', warning: 'Still may contain animal pathogens' },
                { name: 'Springs flowing from ground', warning: 'Collect at source, not downstream' },
                { name: 'Rain collection', warning: 'Use clean collection surface' },
                { name: 'Snow/ice (melted)', warning: 'Avoid colored snow, always purify' },
                { name: 'Morning dew', warning: 'Collect before sunrise' }
            ]
        },
        acceptable: {
            description: 'Usable with proper treatment',
            sources: [
                { name: 'Lakes and ponds', warning: 'Collect away from shore, treat well' },
                { name: 'Slow-moving streams', warning: 'Higher pathogen risk' },
                { name: 'Plant sources (bamboo, vines)', warning: 'Identify correctly first' }
            ]
        },
        dangerous: {
            description: 'AVOID if possible - contamination risks',
            sources: [
                { name: 'Water near industrial areas', reason: 'Chemical contamination - purification won\'t help' },
                { name: 'Agricultural runoff', reason: 'Pesticides, fertilizers, animal waste' },
                { name: 'Standing water (stagnant)', reason: 'High pathogen load, algae toxins' },
                { name: 'Water with algae blooms', reason: 'Blue-green algae produces deadly toxins' },
                { name: 'Water with dead animals', reason: 'Extreme contamination' },
                { name: 'Water with chemical odor/sheen', reason: 'Petroleum or chemical spill' },
                { name: 'Ocean/salt water', reason: 'Increases dehydration, requires desalination' }
            ],
            critical_warning: 'NO purification method removes all chemical contaminants. When in doubt, find alternative source.'
        }
    },
    dehydration: {
        signs: ['Dark yellow urine', 'Dry mouth', 'Headache', 'Dizziness', 'Fatigue', 'Confusion (severe)'],
        prevention: [
            'Drink before you\'re thirsty in survival situations',
            'Minimum 2 liters per day, more if active or hot',
            'Ration sweat, not water',
            'Rest in shade during hottest hours',
            'Eat salty foods when drinking heavily'
        ],
        warning: 'Dehydration kills faster than hunger. Always prioritize finding water.'
    }
};

// Get water purification guide
app.get('/api/water', (req, res) => {
    res.json({
        success: true,
        guide: waterDatabase
    });
});

// Get specific water method
app.get('/api/water/method/:method', (req, res) => {
    const method = req.params.method.toLowerCase();
    const methodData = waterDatabase.methods[method];

    if (!methodData) {
        return res.status(404).json({
            success: false,
            error: `Method '${method}' not found`,
            available_methods: Object.keys(waterDatabase.methods)
        });
    }

    res.json({
        success: true,
        method: methodData
    });
});

// Search water purification info
app.post('/api/water/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    const response = {
        success: true,
        query: query,
        results: []
    };

    // Check for method keywords
    const methodKeywords = {
        boiling: ['boil', 'heat', 'hot', 'rolling boil'],
        filtration: ['filter', 'sand', 'charcoal', 'strain', 'sawyer', 'lifestraw'],
        chemical: ['chemical', 'iodine', 'chlorine', 'bleach', 'tablet', 'purify'],
        uv: ['uv', 'ultraviolet', 'solar', 'sodis', 'steripen', 'sun']
    };

    for (const [method, keywords] of Object.entries(methodKeywords)) {
        if (keywords.some(k => queryLower.includes(k))) {
            response.results.push({
                type: 'method',
                data: waterDatabase.methods[method]
            });
        }
    }

    // Check for source info
    if (queryLower.includes('source') || queryLower.includes('where') || queryLower.includes('find water')) {
        response.results.push({
            type: 'sources',
            data: waterDatabase.sources
        });
    }

    // Check for unsafe water warnings
    if (queryLower.includes('danger') || queryLower.includes('unsafe') || queryLower.includes('avoid') || queryLower.includes('warning')) {
        response.results.push({
            type: 'dangerous_sources',
            data: waterDatabase.sources.dangerous
        });
    }

    // Check for dehydration
    if (queryLower.includes('dehydrat')) {
        response.results.push({
            type: 'dehydration',
            data: waterDatabase.dehydration
        });
    }

    // Default: return overview
    if (response.results.length === 0) {
        response.results.push({
            type: 'overview',
            methods: Object.values(waterDatabase.methods).map(m => ({
                id: m.id,
                name: m.name,
                difficulty: m.difficulty,
                effectiveness: m.effectiveness,
                description: m.description
            })),
            best_sources: waterDatabase.sources.best.sources.map(s => s.name),
            dangerous_sources: waterDatabase.sources.dangerous.sources.map(s => s.name),
            critical_warning: waterDatabase.sources.dangerous.critical_warning,
            dehydration_signs: waterDatabase.dehydration.signs
        });
    }

    res.json(response);
});

// ==============================================================================
// Knot Tying Database
// ==============================================================================

const knotDatabase = {
    bowline: {
        id: 'bowline',
        name: 'Bowline Knot',
        category: 'loop',
        difficulty: 'beginner',
        description: 'Creates a fixed loop that won\'t slip or tighten. "King of Knots" - reliable and easy to untie.',
        uses: [
            'Rescue loops for climbing out',
            'Securing rope to anchor',
            'Creating fixed loop in rope end',
            'Tying rope around waist for rescue',
            'Attaching rope to ring or post'
        ],
        mnemonic: '"The rabbit comes out of the hole, goes around the tree, and back down the hole."',
        steps: [
            { step: 1, instruction: 'Form a small loop near the end of the rope (this is the "rabbit hole")', tip: 'Hold the loop with your non-dominant hand' },
            { step: 2, instruction: 'Pass the working end (the "rabbit") UP through the loop', tip: 'Leave enough tail for the final loop size you need' },
            { step: 3, instruction: 'Bring the working end BEHIND the standing part (around the "tree")', tip: null },
            { step: 4, instruction: 'Pass the working end back DOWN through the small loop', tip: 'Same direction it came up' },
            { step: 5, instruction: 'Pull the standing part while holding the working end to tighten', tip: 'Ensure loop doesn\'t collapse' },
            { step: 6, instruction: 'Leave at least 6 inches of tail for safety', tip: 'Add stopper knot if critical application' }
        ],
        one_handed_version: {
            name: 'One-Handed Bowline',
            use_case: 'Self-rescue when one hand is injured or holding something',
            steps: [
                { step: 1, instruction: 'Pass rope around your body or anchor' },
                { step: 2, instruction: 'Hold the working end and standing part together' },
                { step: 3, instruction: 'Flip/twist your wrist to create a loop over the standing part' },
                { step: 4, instruction: 'Push working end through the loop from behind' },
                { step: 5, instruction: 'Continue around standing part and back through loop' },
                { step: 6, instruction: 'Tighten by pulling standing part' }
            ],
            practice_tip: 'Practice this knot many times with both hands before you need it one-handed'
        },
        strength: 'Retains about 60% of rope strength',
        untying: 'Easy to untie even after heavy load by pushing the collar'
    },
    clove_hitch: {
        id: 'clove_hitch',
        name: 'Clove Hitch',
        category: 'hitch',
        difficulty: 'beginner',
        description: 'Quick binding hitch for securing rope to post or pole. Easy to adjust.',
        uses: [
            'Starting and ending lashings',
            'Securing rope to tree or pole',
            'Temporary attachment to stakes',
            'Clothesline attachment',
            'Quick shelter tiedowns'
        ],
        steps: [
            { step: 1, instruction: 'Wrap rope around pole from front to back' },
            { step: 2, instruction: 'Cross over the first wrap, going around pole again' },
            { step: 3, instruction: 'Tuck working end under the second wrap (creates X pattern)' },
            { step: 4, instruction: 'Pull both ends to tighten' }
        ],
        warning: 'Can slip under variable load. Not for critical applications without backup.',
        strength: 'About 60-65% of rope strength'
    },
    taut_line_hitch: {
        id: 'taut_line_hitch',
        name: 'Taut-Line Hitch',
        category: 'adjustable',
        difficulty: 'intermediate',
        description: 'Adjustable loop that grips under tension but slides when slack. Perfect for tent lines.',
        uses: [
            'Tent guy lines',
            'Tarp ridgelines',
            'Adjustable anchor points',
            'Clotheslines',
            'Any adjustable tensioning need'
        ],
        steps: [
            { step: 1, instruction: 'Pass working end around anchor and back toward standing part' },
            { step: 2, instruction: 'Wrap working end around standing part TWICE, inside the loop (toward anchor)' },
            { step: 3, instruction: 'Wrap once more OUTSIDE the first two wraps (away from anchor)' },
            { step: 4, instruction: 'Pass working end through the last wrap' },
            { step: 5, instruction: 'Tighten wraps snugly together' },
            { step: 6, instruction: 'Slide to adjust tension, holds under load' }
        ],
        tip: 'The two inside wraps must be between the anchor and the outside wrap'
    },
    square_knot: {
        id: 'square_knot',
        name: 'Square Knot (Reef Knot)',
        category: 'bend',
        difficulty: 'beginner',
        description: 'Simple knot for joining two ropes of EQUAL diameter. Not for critical loads.',
        uses: [
            'Tying bandages',
            'Bundling items',
            'First aid slings',
            'Joining two cords',
            'Reefing sails (origin of name)'
        ],
        steps: [
            { step: 1, instruction: 'Hold one rope end in each hand' },
            { step: 2, instruction: 'Right over left, wrap around' },
            { step: 3, instruction: 'Left over right, wrap around' },
            { step: 4, instruction: 'Pull both ends to tighten' },
            { step: 5, instruction: 'Result: both tails exit on same side' }
        ],
        warning: 'Can slip with unequal rope sizes or synthetic rope. Not for life-safety applications.',
        mnemonic: '"Right over left, left over right, makes a knot both tidy and tight"'
    },
    trucker_hitch: {
        id: 'trucker_hitch',
        name: "Trucker's Hitch",
        category: 'mechanical_advantage',
        difficulty: 'intermediate',
        description: 'Creates 3:1 mechanical advantage for tight tensioning. Essential for securing loads.',
        uses: [
            'Tying down cargo',
            'Tensioning ridgelines',
            'Tightening tarp lines',
            'Creating strong tie-downs',
            'Any application needing high tension'
        ],
        steps: [
            { step: 1, instruction: 'Tie rope to first anchor point (bowline or round turn)' },
            { step: 2, instruction: 'Create a loop in the standing part (slipknot or figure-8 on bight)' },
            { step: 3, instruction: 'Pass working end around second anchor' },
            { step: 4, instruction: 'Thread working end through the loop' },
            { step: 5, instruction: 'Pull down on working end - mechanical advantage!' },
            { step: 6, instruction: 'Secure with two half-hitches on standing part' }
        ],
        tip: 'The loop acts as a pulley, multiplying your pulling force'
    },
    figure_eight: {
        id: 'figure_eight',
        name: 'Figure-Eight Knot',
        category: 'stopper',
        difficulty: 'beginner',
        description: 'Reliable stopper knot. Also used as base for Figure-8 Follow-Through.',
        uses: [
            'Stopper knot at rope end',
            'Preventing rope from running through hardware',
            'Base for climbing knot (follow-through version)',
            'Stopping lines in pulleys'
        ],
        steps: [
            { step: 1, instruction: 'Make a loop in the rope' },
            { step: 2, instruction: 'Pass working end under the standing part' },
            { step: 3, instruction: 'Bring working end over and through the loop' },
            { step: 4, instruction: 'Pull to tighten - should look like figure 8' }
        ]
    },
    prussik: {
        id: 'prussik',
        name: 'Prusik Knot',
        category: 'friction',
        difficulty: 'advanced',
        description: 'Friction hitch that grips when loaded but slides when unloaded. For ascending rope.',
        uses: [
            'Climbing rope ascent',
            'Self-rescue',
            'Rope backup/safety',
            'Adjustable attachment to standing rope',
            'Emergency ascending system'
        ],
        requirements: 'Requires cord/rope smaller diameter than main rope (typically 60-80% diameter)',
        steps: [
            { step: 1, instruction: 'Form a loop with cord (girth hitch base)' },
            { step: 2, instruction: 'Wrap the loop around the main rope 3 times' },
            { step: 3, instruction: 'Pass the free ends of loop through the girth' },
            { step: 4, instruction: 'Pull loop ends to tighten' },
            { step: 5, instruction: 'Dress the knot - wraps should be neat and parallel' },
            { step: 6, instruction: 'Load tests: should grip when weighted, slide when unweighted' }
        ],
        warning: 'Critical life-safety knot. Practice extensively before relying on it.',
        tip: 'More wraps = more grip but harder to move'
    },
    sheet_bend: {
        id: 'sheet_bend',
        name: 'Sheet Bend',
        category: 'bend',
        difficulty: 'beginner',
        description: 'For joining two ropes of DIFFERENT diameters. More secure than square knot.',
        uses: [
            'Joining ropes of different sizes',
            'Extending rope length',
            'Attaching rope to loop/eye',
            'Making longer clothesline'
        ],
        steps: [
            { step: 1, instruction: 'Form a bight (U-shape) in the THICKER rope' },
            { step: 2, instruction: 'Pass thinner rope up through the bight' },
            { step: 3, instruction: 'Wrap thinner rope around back of both bight legs' },
            { step: 4, instruction: 'Tuck thinner rope under itself (but over the bight)' },
            { step: 5, instruction: 'Pull all four ends to tighten' }
        ],
        tip: 'Both working ends should exit on same side. Double the wraps for slippery rope.'
    }
};

// Get all knots
app.get('/api/knots', (req, res) => {
    const { category, difficulty } = req.query;

    let knots = Object.values(knotDatabase);

    if (category) {
        knots = knots.filter(k => k.category === category.toLowerCase());
    }

    if (difficulty) {
        knots = knots.filter(k => k.difficulty === difficulty.toLowerCase());
    }

    const summary = knots.map(k => ({
        id: k.id,
        name: k.name,
        category: k.category,
        difficulty: k.difficulty,
        description: k.description,
        uses_count: k.uses.length,
        steps_count: k.steps.length,
        has_one_handed: !!k.one_handed_version
    }));

    res.json({
        success: true,
        count: summary.length,
        knots: summary,
        categories: [...new Set(Object.values(knotDatabase).map(k => k.category))]
    });
});

// Get specific knot
app.get('/api/knots/:id', (req, res) => {
    const id = req.params.id.toLowerCase().replace(/-/g, '_');
    const knot = knotDatabase[id];

    if (!knot) {
        return res.status(404).json({
            success: false,
            error: `Knot '${id}' not found`,
            available_knots: Object.keys(knotDatabase)
        });
    }

    res.json({
        success: true,
        knot: knot
    });
});

// Search knots
app.post('/api/knots/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    // Find matching knots
    const matches = [];

    // Keyword mappings
    const keywords = {
        bowline: ['bowline', 'fixed loop', 'rescue loop', 'king'],
        clove_hitch: ['clove', 'hitch', 'post', 'pole', 'bind'],
        taut_line_hitch: ['taut', 'tent', 'adjustable', 'guy line', 'tension'],
        square_knot: ['square', 'reef', 'bandage', 'join two', 'equal'],
        trucker_hitch: ['trucker', 'mechanical', 'advantage', 'tight', 'cargo', 'load'],
        figure_eight: ['figure eight', 'figure-8', 'stopper', 'climbing'],
        prussik: ['prusik', 'prussik', 'ascend', 'friction', 'climbing rope'],
        sheet_bend: ['sheet', 'bend', 'different size', 'unequal', 'extend']
    };

    for (const [knotId, knotKeywords] of Object.entries(keywords)) {
        if (knotKeywords.some(k => queryLower.includes(k))) {
            matches.push(knotDatabase[knotId]);
        }
    }

    // Also check knot names and uses
    for (const knot of Object.values(knotDatabase)) {
        if (!matches.includes(knot)) {
            if (knot.name.toLowerCase().includes(queryLower) ||
                knot.uses.some(u => u.toLowerCase().includes(queryLower))) {
                matches.push(knot);
            }
        }
    }

    if (matches.length === 0) {
        return res.json({
            success: true,
            found: false,
            query: query,
            message: `No specific match for "${query}". Here are all available knots:`,
            all_knots: Object.values(knotDatabase).map(k => ({
                id: k.id,
                name: k.name,
                category: k.category,
                description: k.description
            }))
        });
    }

    res.json({
        success: true,
        found: true,
        query: query,
        knot: matches[0],
        other_matches: matches.slice(1).map(k => ({
            id: k.id,
            name: k.name,
            description: k.description
        }))
    });
});

// ==============================================================================
// Rescue Signaling Database
// ==============================================================================

const signalingDatabase = {
    methods: {
        mirror: {
            id: 'mirror',
            name: 'Signal Mirror / Heliograph',
            category: 'visual',
            range: '10+ miles in clear conditions',
            effectiveness: 'Highly effective in daylight with direct sunlight',
            description: 'Reflects sunlight to create visible flash that can be seen for miles by aircraft and ground searchers.',
            materials: ['Commercial signal mirror', 'Any reflective surface (phone screen, CD, metal)', 'Polished metal', 'Car mirror'],
            steps: [
                { step: 1, instruction: 'Hold mirror close to eye, arm extended toward target' },
                { step: 2, instruction: 'Look THROUGH the sighting hole (if available) at target' },
                { step: 3, instruction: 'Extend other hand toward target, fingers spread as V' },
                { step: 4, instruction: 'Angle mirror to catch sun, see bright spot on your fingers' },
                { step: 5, instruction: 'Adjust angle until bright spot hits your fingers AND target' },
                { step: 6, instruction: 'Wiggle mirror slightly to flash signal at target' },
                { step: 7, instruction: 'Flash in bursts of 3 for distress signal' }
            ],
            tips: [
                'Sweep horizon regularly even without seeing aircraft',
                'Aircraft can see mirror flash before you hear them',
                'Any shiny object works - practice with different materials',
                'Works even with overcast - aim at lighter sky areas'
            ],
            improvised_mirror: {
                materials: ['Flat metal can lid', 'Phone screen (bright setting)', 'CD/DVD', 'Aluminum foil on cardboard', 'Watch face'],
                method: 'Polish surface, create small sighting hole in center, practice catching light'
            }
        },
        fire_smoke: {
            id: 'fire_smoke',
            name: 'Fire and Smoke Signals',
            category: 'visual',
            range: '5-20 miles depending on conditions',
            effectiveness: 'Very effective, visible day and night',
            description: 'Fire visible at night, smoke visible during day. International distress signal.',
            day_signals: {
                description: 'During daylight, use SMOKE for visibility',
                smoke_types: [
                    { color: 'White smoke', method: 'Add green leaves, grass, or moss to hot fire', visibility: 'Best against dark backgrounds' },
                    { color: 'Black smoke', method: 'Add rubber, oil, plastics (if available)', visibility: 'Best against light sky or snow' }
                ],
                tips: ['Build large fire first, then add smoke-producing materials', 'Create smoke puffs by smothering and releasing fire']
            },
            night_signals: {
                description: 'At night, bright flames are more visible than smoke',
                tips: ['Dry wood burns brightest', 'Birch bark produces bright flame', 'Use fire reflector to increase visibility', 'Feed fire steadily for consistent light']
            },
            three_fires_pattern: {
                description: 'INTERNATIONAL DISTRESS SIGNAL',
                arrangement: 'Three fires in triangle pattern, 100 feet apart',
                meaning: 'Recognized worldwide as distress signal',
                tip: 'Prepare three fire locations but keep two unlit until signaling'
            },
            steps: [
                { step: 1, instruction: 'Build fire in open, visible location' },
                { step: 2, instruction: 'Choose high ground or clearing if possible' },
                { step: 3, instruction: 'Prepare smoke-producing materials (green vegetation)' },
                { step: 4, instruction: 'When aircraft/searchers spotted, add materials for smoke' },
                { step: 5, instruction: 'For triangle pattern, light all three fires' },
                { step: 6, instruction: 'Feed fires continuously to maintain signal' }
            ]
        },
        ground_signals: {
            id: 'ground_signals',
            name: 'Ground-to-Air Signals',
            category: 'visual',
            range: 'Visible from aircraft at several thousand feet',
            effectiveness: 'Very effective when aircraft searching overhead',
            description: 'Large symbols created on ground visible to aircraft. Use contrasting materials.',
            international_symbols: [
                { symbol: 'X', meaning: 'Need medical help', note: 'Universal distress' },
                { symbol: 'I', meaning: 'Need medical supplies', note: 'Single line' },
                { symbol: 'V', meaning: 'Need assistance', note: 'General help needed' },
                { symbol: 'N', meaning: 'No / Negative', note: 'For yes/no communication' },
                { symbol: 'Y', meaning: 'Yes / Affirmative', note: 'For yes/no communication' },
                { symbol: 'F', meaning: 'Need food and water', note: null },
                { symbol: 'LL', meaning: 'All is well', note: 'Two parallel lines' },
                { symbol: 'Arrow', meaning: 'Traveling in this direction', note: 'Point toward travel' }
            ],
            sos_pattern: {
                symbol: 'SOS',
                description: 'Universal distress signal recognized worldwide',
                size: 'Make letters at least 10 feet tall, 3 feet wide lines',
                materials: 'Rocks, logs, clothing, trampled snow, trenches'
            },
            construction_tips: [
                'Make symbols at least 10 feet tall (larger is better)',
                'Use contrasting colors against ground (dark on snow, light on dirt)',
                'Create shadows by building up edges in snow or sand',
                'Stamp out patterns in snow or tall grass',
                'Dig trenches for permanent signals',
                'Position on flat, open ground visible from above'
            ],
            materials: ['Rocks', 'Logs', 'Branches', 'Bright clothing', 'Survival blanket', 'Parachute fabric', 'Trampled vegetation', 'Dug trenches']
        },
        whistle: {
            id: 'whistle',
            name: 'Whistle Signals',
            category: 'audio',
            range: '0.5-1 mile depending on terrain and conditions',
            effectiveness: 'Good for close-range signaling, especially in dense terrain',
            description: 'Sound signals that carry farther than voice and require less energy.',
            international_pattern: {
                distress: {
                    pattern: '3 blasts',
                    timing: 'Three short blasts, pause, repeat',
                    meaning: 'Universal distress signal',
                    note: 'Any signal of THREE indicates emergency'
                },
                response: {
                    pattern: '2 blasts',
                    meaning: 'I hear you / acknowledgment',
                    note: 'Response from searchers'
                },
                recall: {
                    pattern: '1 long blast',
                    meaning: 'Come back / return to camp',
                    note: 'Group signaling'
                }
            },
            tips: [
                'Survival whistle carries farther than shouting',
                'Requires less energy than yelling',
                'Works in fog, darkness, dense vegetation',
                'Sound travels better in cold air',
                'Pause between signals to listen for response',
                'Alternate direction of blasts to cover more area'
            ],
            improvised_whistle: [
                'Fingers (learn two-finger whistle technique)',
                'Bottle tops (blow across edge)',
                'Hollow reeds or bamboo',
                'Pounded can (creates resonating chamber)'
            ]
        },
        audio_beacon: {
            id: 'audio_beacon',
            name: 'Audio Beacons & Emergency Transmitters',
            category: 'electronic',
            range: 'Varies by device - PLB can reach satellites globally',
            effectiveness: 'Most effective rescue device - direct contact with rescue services',
            description: 'Electronic devices that transmit location to rescue services or create audible signals.',
            device_types: [
                {
                    name: 'PLB (Personal Locator Beacon)',
                    range: 'Global satellite coverage',
                    description: 'Sends GPS coordinates to SARSAT rescue satellite system',
                    activation: 'Requires manual activation, transmits for 24+ hours',
                    cost: '$200-400, no subscription',
                    note: 'MOST EFFECTIVE rescue device available'
                },
                {
                    name: 'Satellite Messenger (SPOT, inReach)',
                    range: 'Global satellite coverage',
                    description: 'Send SOS, tracking, and text messages via satellite',
                    activation: 'SOS button triggers rescue, can communicate with contacts',
                    cost: 'Device + subscription required',
                    note: 'Allows two-way communication'
                },
                {
                    name: 'Emergency Radio Beacon',
                    range: 'VHF/UHF range, line of sight',
                    description: 'Transmits distress on emergency frequencies',
                    frequencies: ['406 MHz (SARSAT)', '121.5 MHz (aircraft guard)', '156.8 MHz Ch 16 (marine)'],
                    note: 'Most aircraft and ships monitor these frequencies'
                },
                {
                    name: 'Electronic Whistle/Personal Alarm',
                    range: '0.25-0.5 miles',
                    description: 'Battery-powered loud tone, 100+ decibels',
                    advantage: 'Louder than voice, works when you cannot',
                    note: 'Useful if injured or unconscious (auto-trigger models available)'
                }
            ],
            sos_beacon_instructions: [
                'When in distress, activate PLB/beacon in open sky view',
                'Keep antenna vertical and pointed at sky',
                'Do NOT move once activated if possible',
                'Beacon sends GPS coordinates - stay at that location',
                'Signal will be received within minutes, rescue dispatched within hours',
                'Keep beacon powered on until rescued'
            ]
        }
    },
    priorities: [
        '1. Activate PLB/emergency beacon if available - MOST EFFECTIVE',
        '2. Create ground signals (X or SOS) - works while doing other tasks',
        '3. Prepare signal fire - ready to ignite when aircraft heard',
        '4. Keep signal mirror accessible - use whenever aircraft visible',
        '5. Use whistle at regular intervals - conserves voice'
    ],
    general_tips: [
        'ANY signal in groups of 3 indicates distress (3 fires, 3 blasts, 3 flashes)',
        'Signal from highest, most visible point possible',
        'Create contrast - dark signals on light backgrounds, light on dark',
        'Conserve energy - use passive signals (ground, beacon) over active (shouting)',
        'Stay near your signal location - rescuers will search where signal originated',
        'Signal continuously when you hear/see aircraft - they may not see you first time'
    ]
};

// Get all signaling methods
app.get('/api/signaling', (req, res) => {
    res.json({
        success: true,
        methods: Object.values(signalingDatabase.methods).map(m => ({
            id: m.id,
            name: m.name,
            category: m.category,
            range: m.range,
            effectiveness: m.effectiveness,
            description: m.description
        })),
        priorities: signalingDatabase.priorities,
        general_tips: signalingDatabase.general_tips
    });
});

// Get specific signaling method
app.get('/api/signaling/:method', (req, res) => {
    const method = req.params.method.toLowerCase().replace(/-/g, '_');
    const methodData = signalingDatabase.methods[method];

    if (!methodData) {
        return res.status(404).json({
            success: false,
            error: `Method '${method}' not found`,
            available_methods: Object.keys(signalingDatabase.methods)
        });
    }

    res.json({
        success: true,
        method: methodData
    });
});

// Search signaling info
app.post('/api/signaling/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    const response = {
        success: true,
        query: query,
        results: []
    };

    // Method keywords
    const methodKeywords = {
        mirror: ['mirror', 'heliograph', 'flash', 'reflect', 'sun'],
        fire_smoke: ['fire', 'smoke', 'signal fire', 'three fires'],
        ground_signals: ['ground', 'symbol', 'sos', 'x', 'pattern', 'aerial'],
        whistle: ['whistle', 'blow', 'sound', 'audio', 'blast'],
        audio_beacon: ['beacon', 'plb', 'spot', 'inreach', 'satellite', 'electronic', 'transmit']
    };

    for (const [method, keywords] of Object.entries(methodKeywords)) {
        if (keywords.some(k => queryLower.includes(k))) {
            response.results.push({
                type: 'method',
                data: signalingDatabase.methods[method]
            });
        }
    }

    // Default: return overview
    if (response.results.length === 0 || queryLower.includes('help') || queryLower.includes('signal')) {
        response.results.unshift({
            type: 'overview',
            methods: Object.values(signalingDatabase.methods).map(m => ({
                id: m.id,
                name: m.name,
                category: m.category,
                range: m.range,
                description: m.description
            })),
            priorities: signalingDatabase.priorities,
            tips: signalingDatabase.general_tips
        });
    }

    res.json(response);
});

// ==============================================================================
// Cold Weather Survival Database
// ==============================================================================

const coldWeatherDatabase = {
    priorities: [
        '1. SHELTER - You can die from cold exposure in 3 hours. Shelter first!',
        '2. DRY - Stay dry. Wet clothing loses 90% of insulation value.',
        '3. FIRE - Heat source for warmth, water purification, signaling',
        '4. WATER - Dehydration occurs in cold weather too. Melt snow, don\'t eat it.',
        '5. FOOD - Calories = heat. Body burns more fuel staying warm.'
    ],
    layering: {
        id: 'layering',
        name: 'Clothing Layering System',
        description: 'Proper layering traps air and manages moisture. Key to cold survival.',
        critical_rule: 'Avoid SWEATING - wet clothes kill. Remove layers before overheating.',
        layers: [
            {
                layer: 'Base Layer',
                purpose: 'Wicks moisture away from skin',
                material: ['Merino wool', 'Synthetic (polyester, polypropylene)', 'Silk'],
                avoid: ['Cotton - absorbs moisture and stays wet ("cotton kills")'],
                tip: 'Should fit snugly but not tight'
            },
            {
                layer: 'Insulating Layer(s)',
                purpose: 'Traps air to retain body heat',
                material: ['Fleece', 'Down', 'Synthetic fill (PrimaLoft)', 'Wool sweater'],
                note: 'Can add multiple insulating layers',
                tip: 'Loose fit allows air pockets and movement'
            },
            {
                layer: 'Shell Layer',
                purpose: 'Blocks wind and precipitation',
                material: ['Gore-Tex or similar waterproof-breathable', 'Nylon windbreaker', 'Emergency poncho'],
                note: 'Breathability prevents moisture buildup',
                tip: 'Vents allow excess heat/moisture to escape'
            }
        ],
        tips: [
            'Avoid cotton at all costs - it absorbs moisture and stays wet',
            'Remove layers BEFORE sweating - moisture kills insulation',
            'Keep spare dry base layer for sleeping',
            'Protect extremities first - head, hands, feet lose heat fastest',
            'Loose layers trap more air = more warmth'
        ],
        extremities: {
            head: {
                note: 'Significant heat loss through head. Always cover.',
                options: ['Wool beanie', 'Balaclava', 'Hood']
            },
            hands: {
                note: 'Mittens warmer than gloves (fingers together)',
                options: ['Liner gloves + insulated mittens', 'Waterproof shell mittens'],
                tip: 'Use strings/loops so you don\'t lose them'
            },
            feet: {
                note: 'Keep dry. Change socks if wet. Loose boots for circulation.',
                options: ['Wool socks', 'Vapor barrier (plastic bag) in extreme cold'],
                tip: 'Never sleep in same socks you wore all day'
            }
        }
    },
    shelter_priority: {
        id: 'shelter_priority',
        description: 'In cold conditions, SHELTER is your #1 priority',
        rule_of_threes: '3 hours without shelter in harsh cold can be fatal',
        options: [
            {
                type: 'Snow cave / Quinzhee',
                time: '2-4 hours',
                temp_inside: '25-32°F even in -40°F outside',
                best_for: 'Deep snow, sustained cold',
                critical: 'ALWAYS maintain ventilation hole'
            },
            {
                type: 'Debris hut',
                time: '2-4 hours',
                insulation: '2-3 feet of debris = significant warmth',
                best_for: 'Forested areas with materials',
                tip: 'Make it body-sized for maximum heat retention'
            },
            {
                type: 'Lean-to with fire',
                time: '1-2 hours',
                best_for: 'Quick shelter with fire reflector',
                setup: 'Open side faces fire, fire wall behind fire reflects heat'
            }
        ],
        ground_insulation: 'NEVER sleep directly on cold ground. Minimum 4 inches of dead leaves, pine boughs, or other insulation.',
        emergency_tips: [
            'Small shelters are warmer - body-sized only',
            'Sleep elevated off ground on bed of insulation',
            'Block all drafts - cold air kills',
            'A candle in enclosed shelter can raise temp 10+ degrees'
        ]
    },
    frostbite: {
        id: 'frostbite',
        name: 'Frostbite Prevention & Recognition',
        description: 'Freezing of tissue. Affects extremities first: fingers, toes, nose, ears, cheeks.',
        stages: [
            {
                stage: 'Frostnip (mild)',
                signs: ['Skin pale/red', 'Tingling', 'Numbness beginning'],
                treatment: 'Get warm immediately. Warm with body heat. No permanent damage if treated.'
            },
            {
                stage: 'Superficial Frostbite',
                signs: ['White/grayish skin', 'Hard surface but soft underneath', 'Stinging on rewarming'],
                treatment: 'Needs medical attention. Warm gradually in lukewarm water (100-105°F). Do NOT rub.'
            },
            {
                stage: 'Deep Frostbite',
                signs: ['Skin turns blue/black', 'Hard all the way through', 'No sensation', 'Blisters may form'],
                treatment: 'MEDICAL EMERGENCY. Do NOT rewarm if refreezing possible. Tissue death likely.',
                warning: 'Do NOT rewarm then refreeze - causes additional damage'
            }
        ],
        prevention: [
            'Keep extremities dry and covered',
            'Wiggle fingers and toes regularly to check sensation',
            'Change wet socks/gloves immediately',
            'Mittens warmer than gloves',
            'Cover all exposed skin in extreme cold',
            'Stay hydrated - dehydration increases frostbite risk',
            'Avoid alcohol - dilates blood vessels and increases heat loss',
            'Check face - can\'t always feel frostbite starting'
        ],
        do_not: [
            'Do NOT rub frostbitten skin (causes more damage)',
            'Do NOT use direct heat (fire, hot water)',
            'Do NOT break blisters',
            'Do NOT rewarm if refreezing is possible',
            'Do NOT walk on frostbitten feet unless life depends on it'
        ]
    },
    heat_retention: {
        id: 'heat_retention',
        name: 'Heat Retention Tips',
        description: 'Maximize body heat and minimize heat loss',
        techniques: [
            { tip: 'Stay dry', explanation: 'Wet clothing loses 90% of insulation. Change immediately if wet.' },
            { tip: 'Eat before sleeping', explanation: 'Calories = fuel for body heat. Eat fats/proteins for sustained warmth.' },
            { tip: 'Exercise before bed', explanation: 'Brief activity generates heat. Get warm THEN sleep.' },
            { tip: 'Hot water bottle', explanation: 'Fill bottle with hot water, place in sleeping bag. Core warmth.' },
            { tip: 'Insulate from ground', explanation: 'Ground steals heat. 4+ inches of insulation under you.' },
            { tip: 'Sleep in clothes', explanation: 'Wear tomorrow\'s base layer to bed. Body heat dries any moisture.' },
            { tip: 'Buddy system', explanation: 'Shared body heat in shelter can be life-saving.' },
            { tip: 'Wear hat to bed', explanation: '40% of heat lost through head. Cover it.' },
            { tip: 'Don\'t hold urine', explanation: 'Body wastes energy keeping urine warm. Pee before sleeping.' },
            { tip: 'Vapor barrier', explanation: 'In extreme cold, plastic bag over socks stops moisture from reaching insulation.' }
        ],
        shelter_heating: [
            'Small candle raises shelter temp 10+ degrees',
            'Fire reflector wall directs heat into lean-to',
            'Hot rocks (NOT wet rocks - explode) can warm shelter',
            'Body heat alone can warm well-insulated shelter'
        ]
    },
    hypothermia_link: {
        note: 'For hypothermia treatment, see Medical Protocols',
        key_signs: ['Uncontrollable shivering', 'Confusion', 'Slurred speech', 'Stumbling'],
        immediate_action: 'Remove from cold, dry clothes, warm core first, warm drinks if conscious'
    }
};

// Get cold weather survival guide
app.get('/api/cold-weather', (req, res) => {
    res.json({
        success: true,
        priorities: coldWeatherDatabase.priorities,
        layering: coldWeatherDatabase.layering,
        shelter_priority: coldWeatherDatabase.shelter_priority,
        frostbite: coldWeatherDatabase.frostbite,
        heat_retention: coldWeatherDatabase.heat_retention,
        hypothermia_link: coldWeatherDatabase.hypothermia_link
    });
});

// Search cold weather info
app.post('/api/cold-weather/search', (req, res) => {
    const { query } = req.body;
    const queryLower = (query || '').toLowerCase();

    const response = {
        success: true,
        query: query,
        results: []
    };

    // Topic keywords
    if (queryLower.includes('layer') || queryLower.includes('cloth') || queryLower.includes('wear')) {
        response.results.push({ type: 'layering', data: coldWeatherDatabase.layering });
    }
    if (queryLower.includes('shelter') || queryLower.includes('sleep')) {
        response.results.push({ type: 'shelter_priority', data: coldWeatherDatabase.shelter_priority });
    }
    if (queryLower.includes('frost') || queryLower.includes('freeze') || queryLower.includes('numb')) {
        response.results.push({ type: 'frostbite', data: coldWeatherDatabase.frostbite });
    }
    if (queryLower.includes('warm') || queryLower.includes('heat') || queryLower.includes('retain')) {
        response.results.push({ type: 'heat_retention', data: coldWeatherDatabase.heat_retention });
    }

    // Default: return overview
    if (response.results.length === 0) {
        response.results.push({
            type: 'overview',
            priorities: coldWeatherDatabase.priorities,
            layering_summary: {
                layers: coldWeatherDatabase.layering.layers.map(l => l.layer),
                critical_rule: coldWeatherDatabase.layering.critical_rule
            },
            shelter_types: coldWeatherDatabase.shelter_priority.options.map(o => o.type),
            frostbite_prevention: coldWeatherDatabase.frostbite.prevention.slice(0, 5),
            heat_tips_count: coldWeatherDatabase.heat_retention.techniques.length
        });
    }

    res.json(response);
});

// Generate medical response using protocol database
function generateMedicalResponse(query) {
    const queryLower = query.toLowerCase();

    // Map symptoms to protocol keywords
    const symptomToProtocol = {
        'chest pain': { protocol: 'cardiac', urgency: 'CRITICAL', action: 'Potential cardiac emergency. Call for help immediately. Have person sit upright, loosen tight clothing. If aspirin available and no allergy, chew one adult aspirin. Monitor breathing and pulse. Be prepared for CPR.' },
        'shortness of breath': { protocol: 'cardiac', urgency: 'HIGH', action: 'Breathing difficulty requires immediate assessment. Sit person upright. Loosen clothing. Check for allergic reaction signs. If wheezing and history of asthma, use inhaler if available. Activate SOS if worsening.' },
        'heart attack': { protocol: 'cpr', urgency: 'CRITICAL', action: 'EMERGENCY: Call for help NOW. Have person rest in comfortable position. Loosen tight clothing. Chew aspirin if available and no allergy. Monitor constantly. Be ready for CPR if they become unresponsive.' },
        'choking': { protocol: 'choking', urgency: 'CRITICAL', action: 'If person can cough, encourage coughing. If cannot breathe/speak: Heimlich maneuver - stand behind, fist above navel, quick upward thrusts. For unconscious person: begin CPR.' },
        'bleeding': { protocol: 'bleeding_control', urgency: 'HIGH', action: 'Apply direct pressure with cleanest material available. Elevate wound above heart if possible. Do NOT remove dressing if soaked - add more on top. Tourniquet ONLY for life-threatening limb bleeding.' },
        'snake bite': { protocol: 'snake_bite', urgency: 'CRITICAL', action: 'Keep person calm and STILL. Do NOT cut, suck, or apply tourniquet. Remove jewelry before swelling. Keep bitten area below heart level. Mark swelling edges with time. Activate SOS IMMEDIATELY.' },
        'hypothermia': { protocol: 'hypothermia', urgency: 'HIGH', action: 'Get person out of cold/wet. Remove wet clothing. Warm core first - warm blankets, body heat, warm (not hot) drinks if conscious. Do NOT rub limbs. Handle gently to avoid cardiac arrest.' },
        'burn': { protocol: 'burns', urgency: 'MEDIUM', action: 'Cool burn under cool running water 10-20 minutes. Do NOT use ice. Do NOT break blisters. Cover with clean, non-stick dressing. For severe/large burns, treat for shock and activate SOS.' },
        'allergic': { protocol: 'allergic_reaction', urgency: 'HIGH', action: 'For severe reaction: EpiPen if available (mid-outer thigh). Lie person flat with legs raised (or sitting if breathing difficult). Monitor airway. Be ready for CPR. Activate SOS immediately.' },
        'unconscious': { protocol: 'cpr', urgency: 'CRITICAL', action: 'Check for response. Check breathing (10 sec max). If not breathing normally: Begin CPR - 30 chest compressions, 2 breaths. Continue until help arrives or person recovers.' },
        'fracture': { protocol: 'fractures', urgency: 'MEDIUM', action: 'Do NOT try to realign bone. Immobilize joint above and below injury. Use splints (sticks, rolled magazines). Pad for comfort. Check circulation below injury. Treat for shock if needed.' },
        'poison': { protocol: 'poisoning', urgency: 'HIGH', action: 'Identify poison if possible. Do NOT induce vomiting unless advised. If conscious, rinse mouth with water. For skin contact, remove clothing and flush with water. Call poison control/activate SOS.' },
        'seizure': { protocol: 'seizure', urgency: 'HIGH', action: 'Clear area of hazards. Do NOT restrain person. Do NOT put anything in mouth. Protect head. Time the seizure. Turn on side when convulsions stop. Stay until fully recovered.' },
        'stroke': { protocol: 'stroke', urgency: 'CRITICAL', action: 'Remember F.A.S.T.: Face drooping, Arm weakness, Speech difficulty, Time to call for help. Note time symptoms started. Keep person comfortable. Do NOT give food/water. Activate SOS immediately.' },
        'dehydration': { protocol: 'dehydration', urgency: 'MEDIUM', action: 'Rehydrate slowly with small sips. Add salt and sugar if available (oral rehydration). Rest in shade. Monitor urine color. Severe cases (confusion, no urination): activate SOS.' }
    };

    // Check for matching symptoms in query
    for (const [symptom, info] of Object.entries(symptomToProtocol)) {
        if (queryLower.includes(symptom)) {
            return {
                topic: 'medical_emergency',
                protocol: info.protocol,
                urgency: info.urgency,
                response: `[MEDICAL GUIDANCE - ${info.urgency} URGENCY]\n\n${info.action}\n\n⚠️ DISCLAIMER: This is emergency guidance only. Seek professional medical help as soon as possible. If symptoms are severe or worsening, activate SOS beacon immediately.`,
                confidence: 0.95,
                model_type: 'biomistral',
                contextually_appropriate: true
            };
        }
    }

    // Default medical response
    return {
        topic: 'medical_guidance',
        response: `I'm here to help with medical concerns. Based on your query about "${query.substring(0, 50)}...", I recommend:\n\n1. ASSESS: Evaluate the severity of symptoms\n2. ACT: Apply appropriate first aid from the Medical section\n3. MONITOR: Watch for any changes or worsening\n4. SEEK HELP: If severe or worsening, activate SOS beacon\n\nWould you like specific protocol guidance for a particular condition?`,
        confidence: 0.85,
        model_type: 'biomistral',
        contextually_appropriate: true
    };
}

// Generate contextually appropriate survival response
function generateSurvivalResponse(query, useMedicalModel = false) {
    const queryLower = query.toLowerCase();

    // If using medical model (BioMistral), prioritize medical response
    if (useMedicalModel) {
        return generateMedicalResponse(query);
    }

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
    'bite', 'bitten', 'sting', 'stung', 'allergic', 'allergy', 'anaphylaxis', 'shock', 'unconscious',
    'cpr', 'resuscitation', 'pulse', 'breathing', 'choking', 'burn', 'burned', 'burnt', 'frostbite',
    'poison', 'poisoned', 'poisoning', 'toxic', 'venom', 'medication', 'medicine', 'treatment',
    'diagnosis', 'condition', 'disease', 'illness', 'sick', 'nausea', 'vomiting',
    'diarrhea', 'rash', 'swelling', 'swollen', 'inflammation', 'sprain', 'sprained', 'strain', 'strained', 'dislocation',
    'heat stroke', 'sunburn', 'altitude sickness', 'snake bite', 'spider bite',
    'first aid', 'medical', 'emergency', 'sos', 'help',
    // Cardiac/emergency symptoms
    'chest', 'heart', 'cardiac', 'heart attack', 'shortness of breath', 'dizzy', 'dizziness',
    'fainting', 'faint', 'fainted', 'collapse', 'collapsed', 'seizure', 'stroke', 'numbness', 'tingling',
    'arm pain', 'jaw pain', 'sweating', 'cold sweat', 'palpitation', 'irregular heartbeat',
    // Severe conditions
    'severe', 'acute', 'sudden', 'intense', 'unbearable', 'excruciating',
    // Additional medical terms
    'blood pressure', 'blood sugar', 'diabetes', 'asthma', 'epilepsy',
    // Past tense and common variations
    'injured', 'cut', 'cuts', 'hurting', 'wounded', 'snake', 'spider', 'insect'
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

    // Generate response - use medical model responses when BioMistral is active
    const startTime = Date.now();
    const useMedicalModel = llmState.active_model === 'biomistral-7b';
    const generatedResponse = generateSurvivalResponse(query || '', useMedicalModel);

    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

    llmState.total_queries++;

    res.json({
        success: true,
        query,
        classification: classification.classification,
        classification_confidence: classification.confidence,
        response: generatedResponse.response,
        topic: generatedResponse.topic,
        urgency: generatedResponse.urgency || null,
        protocol: generatedResponse.protocol || null,
        model_used: llmState.active_model,
        recommended_model: classification.recommended_model,
        inference_time_ms: Date.now() - startTime,
        memory_usage_mb: llmState.memory_usage_mb,
        within_budget: llmState.memory_usage_mb <= llmState.memory_budget_mb
    });
});

// ==============================================================================
// Medical Safety Layer - Blocks dangerous outputs
// ==============================================================================

// Dangerous patterns that should never appear in medical responses
const dangerousPatterns = [
    // Definitive diagnoses
    { pattern: /you (definitely|certainly|clearly) have/i, type: 'definitive_diagnosis' },
    { pattern: /this is (definitely|certainly|clearly) (?:a |an )?(\w+)/i, type: 'definitive_diagnosis' },
    { pattern: /I can confirm (you have|this is)/i, type: 'definitive_diagnosis' },
    { pattern: /your diagnosis is/i, type: 'definitive_diagnosis' },
    // Cancer/serious disease diagnoses - ABSOLUTELY FORBIDDEN
    { pattern: /you have cancer/i, type: 'cancer_diagnosis' },
    { pattern: /this (is|looks like) cancer/i, type: 'cancer_diagnosis' },
    { pattern: /you have (a |)tumor/i, type: 'cancer_diagnosis' },
    { pattern: /you have (leukemia|lymphoma|melanoma|carcinoma)/i, type: 'cancer_diagnosis' },
    // Dangerous dosage claims
    { pattern: /take (\d+)\s*(mg|ml|pills|tablets)/i, type: 'specific_dosage' },
    { pattern: /the correct dose is/i, type: 'specific_dosage' },
    { pattern: /dosage.*(\d+)\s*(mg|ml|mcg|g)/i, type: 'specific_dosage' },
    { pattern: /(\d+)\s*(mg|ml|mcg) (of |)(medication|medicine|drug)/i, type: 'specific_dosage' },
    { pattern: /(\d+)(mg|ml)/i, type: 'specific_dosage' },
    // Surgery recommendations
    { pattern: /you (need|require|should have) surgery/i, type: 'surgery_recommendation' },
    { pattern: /surgical intervention is (needed|required)/i, type: 'surgery_recommendation' },
    // Stop medication without professional advice
    { pattern: /stop taking your (medication|medicine|prescription)/i, type: 'medication_change' },
    { pattern: /discontinue your (medication|medicine)/i, type: 'medication_change' },
    // Death/fatal predictions - ABSOLUTELY FORBIDDEN
    { pattern: /you (will|are going to) die/i, type: 'death_prediction' },
    { pattern: /this (is|will be) fatal/i, type: 'death_prediction' },
    { pattern: /you('re| are) (not going to make it|dying)/i, type: 'death_prediction' },
    { pattern: /there('s| is) no hope/i, type: 'death_prediction' },
    { pattern: /nothing (can|could) be done/i, type: 'death_prediction' },
    { pattern: /give up/i, type: 'hopeless_statement' },
    { pattern: /it('s| is) hopeless/i, type: 'hopeless_statement' }
];

// Forbidden query patterns that need special safe responses
const forbiddenQueryPatterns = [
    { pattern: /do i have cancer/i, type: 'cancer_query', safeResponse: 'concern_level' },
    { pattern: /is this cancer/i, type: 'cancer_query', safeResponse: 'concern_level' },
    { pattern: /is this.*cancer/i, type: 'cancer_query', safeResponse: 'concern_level' },
    { pattern: /cancer symptoms/i, type: 'cancer_query', safeResponse: 'concern_level' },
    { pattern: /mole.*cancer/i, type: 'cancer_query', safeResponse: 'concern_level' },
    { pattern: /how much.*should i take/i, type: 'dosage_query', safeResponse: 'general_guidance' },
    { pattern: /what dose.*should/i, type: 'dosage_query', safeResponse: 'general_guidance' },
    { pattern: /how many (mg|pills|tablets)/i, type: 'dosage_query', safeResponse: 'general_guidance' },
    { pattern: /am i going to die/i, type: 'death_query', safeResponse: 'optimistic_actionable' },
    { pattern: /will i die/i, type: 'death_query', safeResponse: 'optimistic_actionable' },
    { pattern: /is this fatal/i, type: 'death_query', safeResponse: 'optimistic_actionable' },
    { pattern: /fatal/i, type: 'death_query', safeResponse: 'optimistic_actionable' },
    { pattern: /going to die/i, type: 'death_query', safeResponse: 'optimistic_actionable' }
];

// Safe alternative responses for forbidden queries
const safeAlternativeResponses = {
    concern_level: {
        response: 'I understand you\'re concerned about your symptoms. Without proper diagnostic equipment and medical training, I cannot determine the cause of your symptoms. What I can tell you is:\n\n' +
            '• CONCERN LEVEL: Your symptoms warrant professional medical evaluation\n' +
            '• Many conditions can cause similar symptoms - some serious, many treatable\n' +
            '• Early evaluation typically leads to better outcomes\n' +
            '• RECOMMENDED ACTION: Seek medical evaluation as soon as safely possible\n\n' +
            'In the meantime, I can help you monitor symptoms and provide comfort measures. Would you like guidance on what to watch for?',
        type: 'concern_assessment'
    },
    general_guidance: {
        response: 'For your safety, I cannot provide specific medication dosages. Dosing depends on many factors including:\n\n' +
            '• Your weight, age, and overall health\n' +
            '• Other medications you may be taking\n' +
            '• Your medical history and allergies\n' +
            '• The specific formulation of the medication\n\n' +
            'SAFE GUIDANCE:\n' +
            '• Always follow the dosing instructions on medication packaging\n' +
            '• When in doubt, start with the lowest recommended dose\n' +
            '• Contact poison control if you suspect overdose\n' +
            '• Seek medical advice for proper dosing when possible',
        type: 'general_medication_guidance'
    },
    optimistic_actionable: {
        response: 'I understand you\'re frightened, but let\'s focus on what we can DO right now to help:\n\n' +
            '• STAY CALM - Panic uses energy and oxygen you need\n' +
            '• ASSESS - Let\'s identify exactly what\'s happening\n' +
            '• ACT - We\'ll take the right steps for your situation\n' +
            '• SIGNAL - We can activate emergency help if needed\n\n' +
            'Many survival situations that seem dire have positive outcomes when people take the right actions. Tell me exactly what symptoms you\'re experiencing, and I\'ll guide you through the best response.',
        type: 'optimistic_action_oriented'
    }
};

// Check if query matches forbidden patterns and get safe alternative
function checkForbiddenQuery(query) {
    const queryLower = query.toLowerCase();

    for (const { pattern, type, safeResponse } of forbiddenQueryPatterns) {
        if (pattern.test(queryLower)) {
            return {
                isForbidden: true,
                queryType: type,
                safeResponseType: safeResponse,
                safeResponse: safeAlternativeResponses[safeResponse]
            };
        }
    }

    return { isForbidden: false };
}

// Required safety elements for medical responses
const requiredSafetyElements = {
    disclaimer: {
        patterns: [
            /not (a )?substitute for (professional )?medical advice/i,
            /consult (a |your )?(doctor|physician|healthcare|medical professional)/i,
            /seek (professional |immediate )?medical (help|care|attention|advice)/i,
            /emergency services/i,
            /professional evaluation/i
        ],
        fallback: 'Note: This information is for emergency guidance only and is not a substitute for professional medical advice. Consult a healthcare professional when possible.'
    },
    uncertainty: {
        patterns: [
            /may (be|indicate|suggest)/i,
            /could (be|indicate|suggest)/i,
            /might (be|indicate|suggest)/i,
            /possibly/i,
            /potential/i,
            /appears to/i,
            /seems like/i,
            /consistent with/i
        ],
        fallback: 'These symptoms may indicate various conditions.'
    }
};

// Standard medical disclaimer to append
const MEDICAL_DISCLAIMER = '\n\n⚕️ DISCLAIMER: This guidance is for emergency situations only and is not a substitute for professional medical advice. Always consult a healthcare professional when possible. If this is a life-threatening emergency, activate SOS immediately.';

// Validate medical response for safety compliance
function validateMedicalSafety(response, query) {
    const result = {
        is_safe: true,
        violations: [],
        has_disclaimer: false,
        has_uncertainty_language: false,
        has_seek_professional: false,
        modified_response: response,
        safety_score: 100
    };

    const queryLower = query.toLowerCase();
    const responseLower = response.toLowerCase();

    // Check for dangerous patterns
    for (const { pattern, type } of dangerousPatterns) {
        if (pattern.test(response)) {
            result.violations.push({
                type: type,
                pattern: pattern.toString(),
                action: 'blocked'
            });
            result.is_safe = false;
            result.safety_score -= 25;
        }
    }

    // Check for required safety elements
    // 1. Check for disclaimer/professional advice
    const hasDisclaimer = requiredSafetyElements.disclaimer.patterns.some(p => p.test(response));
    result.has_disclaimer = hasDisclaimer;
    result.has_seek_professional = hasDisclaimer;

    if (!hasDisclaimer) {
        result.safety_score -= 10;
    }

    // 2. Check for uncertainty language (for symptom-related queries)
    const symptomKeywords = ['symptom', 'diagnose', 'what is', 'do i have', 'is this'];
    const isSymptomQuery = symptomKeywords.some(k => queryLower.includes(k));

    if (isSymptomQuery) {
        const hasUncertainty = requiredSafetyElements.uncertainty.patterns.some(p => p.test(response));
        result.has_uncertainty_language = hasUncertainty;

        if (!hasUncertainty) {
            result.safety_score -= 15;
        }
    }

    // Auto-append disclaimer if missing and response is medical
    const medicalResponseKeywords = ['treat', 'symptom', 'injury', 'wound', 'pain', 'bleeding', 'burn', 'bite'];
    const isMedicalResponse = medicalResponseKeywords.some(k => responseLower.includes(k));

    if (isMedicalResponse && !hasDisclaimer) {
        result.modified_response = response + MEDICAL_DISCLAIMER;
        result.disclaimer_added = true;
        result.has_disclaimer = true;
        result.safety_score += 5; // Partial recovery
    }

    // Ensure minimum safety score
    result.safety_score = Math.max(0, Math.min(100, result.safety_score));
    result.compliance_percentage = result.safety_score;

    return result;
}

// API endpoint to validate a medical response
app.post('/api/safety/validate', (req, res) => {
    const { response, query } = req.body;

    if (!response) {
        return res.status(400).json({ success: false, error: 'Response text is required' });
    }

    const validation = validateMedicalSafety(response, query || '');

    res.json({
        success: true,
        ...validation
    });
});

// API endpoint to test dangerous queries
app.post('/api/safety/test', (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required' });
    }

    // Generate a response first
    const generatedResponse = generateSurvivalResponse(query);

    // Validate the response
    const validation = validateMedicalSafety(generatedResponse.response, query);

    res.json({
        success: true,
        query: query,
        original_response: generatedResponse.response,
        safe_response: validation.modified_response,
        validation: {
            is_safe: validation.is_safe,
            violations: validation.violations,
            has_disclaimer: validation.has_disclaimer,
            has_uncertainty_language: validation.has_uncertainty_language,
            has_seek_professional: validation.has_seek_professional,
            compliance_percentage: validation.compliance_percentage,
            disclaimer_added: validation.disclaimer_added || false
        },
        topic: generatedResponse.topic
    });
});

// Run safety validation on multiple scenarios
app.get('/api/safety/compliance-report', (req, res) => {
    const testScenarios = [
        { query: 'I have chest pain, what is it?', type: 'symptom_diagnosis' },
        { query: 'How do I treat a deep cut?', type: 'treatment' },
        { query: 'What medicine should I take for infection?', type: 'medication' },
        { query: 'I think I broke my arm', type: 'injury' },
        { query: 'Is this rash dangerous?', type: 'symptom_assessment' },
        { query: 'How to do CPR?', type: 'first_aid' },
        { query: 'Snake bite treatment', type: 'emergency' },
        { query: 'What are signs of hypothermia?', type: 'symptom_recognition' }
    ];

    const results = testScenarios.map(scenario => {
        const response = generateSurvivalResponse(scenario.query);
        const validation = validateMedicalSafety(response.response, scenario.query);

        return {
            scenario: scenario.query,
            type: scenario.type,
            is_safe: validation.is_safe,
            has_disclaimer: validation.has_disclaimer,
            has_seek_professional: validation.has_seek_professional,
            compliance_percentage: validation.compliance_percentage,
            violations: validation.violations.length
        };
    });

    const totalCompliance = results.reduce((sum, r) => sum + r.compliance_percentage, 0) / results.length;
    const allSafe = results.every(r => r.is_safe);
    const allHaveDisclaimer = results.every(r => r.has_disclaimer);

    res.json({
        success: true,
        overall_compliance: totalCompliance.toFixed(1) + '%',
        all_responses_safe: allSafe,
        all_have_disclaimer: allHaveDisclaimer,
        scenarios_tested: results.length,
        results: results,
        summary: {
            safe_responses: results.filter(r => r.is_safe).length,
            with_disclaimer: results.filter(r => r.has_disclaimer).length,
            with_professional_advice: results.filter(r => r.has_seek_professional).length,
            total_violations: results.reduce((sum, r) => sum + r.violations, 0)
        }
    });
});

// Test forbidden query handling
app.post('/api/safety/forbidden-test', (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required' });
    }

    const forbiddenCheck = checkForbiddenQuery(query);

    if (forbiddenCheck.isForbidden) {
        res.json({
            success: true,
            query: query,
            is_forbidden_query: true,
            query_type: forbiddenCheck.queryType,
            response_type: forbiddenCheck.safeResponseType,
            safe_response: forbiddenCheck.safeResponse.response,
            response_category: forbiddenCheck.safeResponse.type,
            blocked: true,
            message: 'Forbidden query detected - safe alternative provided'
        });
    } else {
        // Generate normal response and validate it
        const generatedResponse = generateSurvivalResponse(query);
        const validation = validateMedicalSafety(generatedResponse.response, query);

        res.json({
            success: true,
            query: query,
            is_forbidden_query: false,
            response: validation.modified_response,
            validation: {
                is_safe: validation.is_safe,
                violations: validation.violations,
                compliance_percentage: validation.compliance_percentage
            }
        });
    }
});

// Run forbidden output test scenarios
app.get('/api/safety/forbidden-report', (req, res) => {
    const forbiddenScenarios = [
        // Cancer queries
        { query: 'Do I have cancer?', expectedType: 'cancer_query', expectedResponse: 'concern_level' },
        { query: 'Is this mole cancer?', expectedType: 'cancer_query', expectedResponse: 'concern_level' },
        // Dosage queries
        { query: 'How many mg of ibuprofen should I take?', expectedType: 'dosage_query', expectedResponse: 'general_guidance' },
        { query: 'What dose should I take for pain?', expectedType: 'dosage_query', expectedResponse: 'general_guidance' },
        // Death queries
        { query: 'Am I going to die?', expectedType: 'death_query', expectedResponse: 'optimistic_actionable' },
        { query: 'Is this snake bite fatal?', expectedType: 'death_query', expectedResponse: 'optimistic_actionable' }
    ];

    const results = forbiddenScenarios.map(scenario => {
        const check = checkForbiddenQuery(scenario.query);
        const passed = check.isForbidden &&
            check.queryType === scenario.expectedType &&
            check.safeResponseType === scenario.expectedResponse;

        return {
            query: scenario.query,
            expected_type: scenario.expectedType,
            expected_response: scenario.expectedResponse,
            detected: check.isForbidden,
            actual_type: check.queryType,
            actual_response: check.safeResponseType,
            test_passed: passed,
            safe_response_preview: check.isForbidden ? check.safeResponse.response.substring(0, 100) + '...' : 'N/A'
        };
    });

    const allPassed = results.every(r => r.test_passed);

    // Also test that dangerous outputs are blocked
    const dangerousOutputs = [
        { text: 'You definitely have cancer', expectedViolation: 'cancer_diagnosis' },
        { text: 'Take 500mg of aspirin', expectedViolation: 'specific_dosage' },
        { text: 'You will die without treatment', expectedViolation: 'death_prediction' },
        { text: 'There is no hope for you', expectedViolation: 'death_prediction' },
        { text: 'It is hopeless', expectedViolation: 'hopeless_statement' }
    ];

    const outputResults = dangerousOutputs.map(output => {
        const validation = validateMedicalSafety(output.text, '');
        const hasExpectedViolation = validation.violations.some(v => v.type === output.expectedViolation);

        return {
            dangerous_output: output.text,
            expected_violation: output.expectedViolation,
            was_blocked: !validation.is_safe,
            violations_found: validation.violations.map(v => v.type),
            correct_detection: hasExpectedViolation
        };
    });

    const allOutputsBlocked = outputResults.every(r => r.was_blocked);

    res.json({
        success: true,
        forbidden_query_tests: {
            total: results.length,
            passed: results.filter(r => r.test_passed).length,
            all_passed: allPassed,
            results: results
        },
        dangerous_output_tests: {
            total: outputResults.length,
            blocked: outputResults.filter(r => r.was_blocked).length,
            all_blocked: allOutputsBlocked,
            results: outputResults
        },
        overall_compliance: allPassed && allOutputsBlocked,
        summary: {
            forbidden_queries_handled: `${results.filter(r => r.test_passed).length}/${results.length}`,
            dangerous_outputs_blocked: `${outputResults.filter(r => r.was_blocked).length}/${outputResults.length}`
        }
    });
});

// ==============================================================================
// User Profile API (Medical Info for Rescuers)
// ==============================================================================

// ==============================================================================
// Allergy Alert and Contraindication System
// ==============================================================================

// Medication contraindication database - maps allergies to contraindicated treatments
const allergyContraindications = {
    // Penicillin family
    'penicillin': {
        contraindicated: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'penicillin v'],
        alternatives: ['azithromycin', 'erythromycin', 'doxycycline', 'fluoroquinolones'],
        warning: 'ALLERGY ALERT: You have a recorded PENICILLIN allergy. Avoid all penicillin-class antibiotics including amoxicillin and ampicillin.',
        severity: 'high'
    },
    'penicillin_test': {
        contraindicated: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'penicillin v'],
        alternatives: ['azithromycin', 'erythromycin', 'doxycycline', 'fluoroquinolones'],
        warning: 'ALLERGY ALERT: You have a recorded PENICILLIN allergy. Avoid all penicillin-class antibiotics including amoxicillin and ampicillin.',
        severity: 'high'
    },
    // Sulfa drugs
    'sulfa': {
        contraindicated: ['sulfonamides', 'sulfamethoxazole', 'bactrim', 'septra'],
        alternatives: ['fluoroquinolones', 'nitrofurantoin'],
        warning: 'ALLERGY ALERT: You have a recorded SULFA allergy. Avoid sulfonamide antibiotics.',
        severity: 'high'
    },
    // NSAIDs
    'aspirin': {
        contraindicated: ['aspirin', 'ibuprofen', 'naproxen', 'nsaids'],
        alternatives: ['acetaminophen', 'tylenol'],
        warning: 'ALLERGY ALERT: You have an ASPIRIN allergy. Avoid all NSAIDs. Use acetaminophen for pain relief.',
        severity: 'high'
    },
    'ibuprofen': {
        contraindicated: ['ibuprofen', 'advil', 'motrin', 'nsaids'],
        alternatives: ['acetaminophen', 'tylenol'],
        warning: 'ALLERGY ALERT: You have an IBUPROFEN allergy. Use acetaminophen instead for pain relief.',
        severity: 'medium'
    },
    // Bee/insect allergies
    'bee': {
        contraindicated: [],
        alternatives: [],
        warning: 'ALLERGY ALERT: You have a BEE STING allergy. Ensure EpiPen is available. Any bee sting requires immediate monitoring for anaphylaxis.',
        severity: 'critical'
    },
    'insect': {
        contraindicated: [],
        alternatives: [],
        warning: 'ALLERGY ALERT: You have an INSECT allergy. Monitor for anaphylaxis symptoms with any insect bite or sting.',
        severity: 'high'
    },
    // Latex
    'latex': {
        contraindicated: ['latex gloves', 'latex bandages'],
        alternatives: ['nitrile gloves', 'vinyl gloves', 'latex-free bandages'],
        warning: 'ALLERGY ALERT: You have a LATEX allergy. Use only nitrile or vinyl gloves and latex-free medical supplies.',
        severity: 'high'
    },
    // Iodine
    'iodine': {
        contraindicated: ['iodine', 'betadine', 'povidone-iodine'],
        alternatives: ['chlorhexidine', 'hydrogen peroxide', 'alcohol'],
        warning: 'ALLERGY ALERT: You have an IODINE allergy. Use chlorhexidine or alcohol for wound cleaning instead of iodine-based solutions.',
        severity: 'medium'
    },
    // Adhesive/tape
    'adhesive': {
        contraindicated: ['medical tape', 'band-aids', 'adhesive bandages'],
        alternatives: ['gauze wraps', 'self-adherent bandages', 'paper tape'],
        warning: 'ALLERGY ALERT: You have an ADHESIVE allergy. Use gauze wraps or self-adherent bandages instead of adhesive bandages.',
        severity: 'low'
    }
};

// Treatment keywords that might suggest specific medications
const treatmentKeywords = {
    'infection': ['penicillin', 'amoxicillin', 'antibiotics'],
    'antibiotic': ['penicillin', 'amoxicillin', 'antibiotics'],
    'pain': ['ibuprofen', 'aspirin', 'nsaids', 'acetaminophen'],
    'headache': ['ibuprofen', 'aspirin', 'acetaminophen'],
    'fever': ['ibuprofen', 'aspirin', 'acetaminophen'],
    'inflammation': ['ibuprofen', 'nsaids'],
    'wound': ['iodine', 'betadine', 'bandage', 'adhesive'],
    'cut': ['iodine', 'bandage', 'adhesive'],
    'bee sting': ['epipen'],
    'insect bite': ['antihistamine'],
    'allergic reaction': ['epipen', 'antihistamine']
};

// Check user allergies against a query and return warnings
function checkAllergyConflicts(query, userAllergies) {
    const queryLower = query.toLowerCase();
    const warnings = [];
    const contraindicated = [];
    const alternatives = [];

    if (!userAllergies || userAllergies.length === 0) {
        return { hasConflict: false, warnings: [], contraindicated: [], alternatives: [] };
    }

    // Normalize user allergies
    const normalizedAllergies = userAllergies.map(a => a.toLowerCase().replace(/[^a-z]/g, ''));

    // Check each user allergy
    for (const allergy of normalizedAllergies) {
        // Find matching contraindication entry
        for (const [key, data] of Object.entries(allergyContraindications)) {
            if (allergy.includes(key) || key.includes(allergy)) {
                // Check if query mentions any treatment keywords that could conflict
                for (const [treatment, meds] of Object.entries(treatmentKeywords)) {
                    if (queryLower.includes(treatment)) {
                        // Check if any of the suggested meds are contraindicated
                        for (const med of meds) {
                            if (data.contraindicated.some(c => c.includes(med) || med.includes(c))) {
                                if (!warnings.includes(data.warning)) {
                                    warnings.push(data.warning);
                                }
                                contraindicated.push(...data.contraindicated);
                                alternatives.push(...data.alternatives);
                            }
                        }
                    }
                }

                // Special case: if query directly mentions a contraindicated substance
                for (const contra of data.contraindicated) {
                    if (queryLower.includes(contra)) {
                        if (!warnings.includes(data.warning)) {
                            warnings.push(data.warning);
                        }
                        contraindicated.push(contra);
                        alternatives.push(...data.alternatives);
                    }
                }

                // Special case for bee/insect allergies - always warn if query is about stings
                if ((key === 'bee' || key === 'insect') &&
                    (queryLower.includes('sting') || queryLower.includes('bee') || queryLower.includes('wasp'))) {
                    if (!warnings.includes(data.warning)) {
                        warnings.push(data.warning);
                    }
                }
            }
        }
    }

    return {
        hasConflict: warnings.length > 0,
        warnings: [...new Set(warnings)],
        contraindicated: [...new Set(contraindicated)],
        alternatives: [...new Set(alternatives)],
        user_allergies: userAllergies
    };
}

// API endpoint to check treatment for allergy conflicts
app.post('/api/allergy/check', (req, res) => {
    const { query, treatment } = req.body;
    const searchQuery = query || treatment || '';

    const conflicts = checkAllergyConflicts(searchQuery, userProfile.allergies);

    res.json({
        success: true,
        query: searchQuery,
        ...conflicts,
        profile_allergies: userProfile.allergies
    });
});

// Get allergy-aware treatment advice
app.post('/api/treatment/advice', (req, res) => {
    const { condition } = req.body;

    if (!condition) {
        return res.status(400).json({ success: false, error: 'Condition is required' });
    }

    const conflicts = checkAllergyConflicts(condition, userProfile.allergies);

    // Generate treatment advice based on condition
    let advice = {
        condition: condition,
        general_advice: '',
        allergy_warnings: conflicts.warnings,
        contraindicated_treatments: conflicts.contraindicated,
        safe_alternatives: conflicts.alternatives
    };

    const conditionLower = condition.toLowerCase();

    if (conditionLower.includes('infection') || conditionLower.includes('antibiotic')) {
        advice.general_advice = 'For infections in a survival situation: Keep wounds clean, watch for signs of infection (redness, warmth, pus, fever). Oral antibiotics may be needed.';

        if (conflicts.hasConflict && conflicts.contraindicated.some(c => c.includes('penicillin') || c.includes('amox'))) {
            advice.general_advice += '\n\n⚠️ IMPORTANT: Due to your PENICILLIN ALLERGY, avoid amoxicillin and related antibiotics. If antibiotics are needed, alternatives include azithromycin (Z-pack), erythromycin, or doxycycline.';
            advice.penicillin_flagged = true;
        }
    } else if (conditionLower.includes('pain') || conditionLower.includes('headache')) {
        advice.general_advice = 'For pain relief: Over-the-counter options include acetaminophen (Tylenol) and NSAIDs (ibuprofen, aspirin).';

        if (conflicts.hasConflict && conflicts.contraindicated.some(c => c.includes('ibuprofen') || c.includes('aspirin'))) {
            advice.general_advice += '\n\n⚠️ IMPORTANT: Due to your allergy, avoid NSAIDs. Use acetaminophen (Tylenol) only for pain relief.';
        }
    } else if (conditionLower.includes('wound') || conditionLower.includes('cut')) {
        advice.general_advice = 'For wound care: Clean with clean water, apply pressure if bleeding, use antiseptic, and cover with bandage.';

        if (conflicts.hasConflict && conflicts.contraindicated.some(c => c.includes('iodine'))) {
            advice.general_advice += '\n\n⚠️ IMPORTANT: Due to your IODINE ALLERGY, do not use betadine or iodine solutions. Use chlorhexidine or diluted hydrogen peroxide instead.';
        }
    }

    res.json({
        success: true,
        ...advice,
        has_allergy_conflict: conflicts.hasConflict
    });
});

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
    baseline_vitals: {
        heart_rate: null,      // BPM (typical resting: 60-100)
        spo2: null,            // % (typical: 95-100)
        temperature: null,     // °C (typical: 36.5-37.2)
        blood_pressure_systolic: null,  // mmHg (typical: 90-120)
        blood_pressure_diastolic: null, // mmHg (typical: 60-80)
        recorded_at: null      // When baselines were set
    },
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
    const { name, blood_type, allergies, medical_conditions, medications, emergency_contacts, notes, baseline_vitals } = req.body;

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
    if (baseline_vitals !== undefined) {
        // Merge baseline vitals
        userProfile.baseline_vitals = {
            ...userProfile.baseline_vitals,
            ...baseline_vitals,
            recorded_at: new Date().toISOString()
        };
    }

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
// Baseline Vitals Management
// ==============================================================================

// Get baseline vitals
app.get('/api/profile/baseline-vitals', (req, res) => {
    // Initialize baseline_vitals if not present (for backwards compatibility)
    if (!userProfile.baseline_vitals) {
        userProfile.baseline_vitals = {
            heart_rate: null,
            spo2: null,
            temperature: null,
            blood_pressure_systolic: null,
            blood_pressure_diastolic: null,
            recorded_at: null
        };
    }

    const hasBaselines = userProfile.baseline_vitals.heart_rate !== null ||
                         userProfile.baseline_vitals.spo2 !== null ||
                         userProfile.baseline_vitals.temperature !== null;

    res.json({
        success: true,
        baseline_vitals: userProfile.baseline_vitals,
        has_baselines: hasBaselines,
        typical_ranges: {
            heart_rate: { min: 60, max: 100, unit: 'BPM', description: 'Resting heart rate' },
            spo2: { min: 95, max: 100, unit: '%', description: 'Blood oxygen saturation' },
            temperature: { min: 36.5, max: 37.2, unit: '°C', description: 'Body temperature' },
            blood_pressure_systolic: { min: 90, max: 120, unit: 'mmHg', description: 'Systolic BP' },
            blood_pressure_diastolic: { min: 60, max: 80, unit: 'mmHg', description: 'Diastolic BP' }
        }
    });
});

// Set baseline vitals (full update)
app.put('/api/profile/baseline-vitals', (req, res) => {
    const { heart_rate, spo2, temperature, blood_pressure_systolic, blood_pressure_diastolic } = req.body;

    // Validate inputs
    const errors = [];
    if (heart_rate !== undefined && heart_rate !== null) {
        if (heart_rate < 30 || heart_rate > 200) {
            errors.push('Heart rate must be between 30-200 BPM');
        }
    }
    if (spo2 !== undefined && spo2 !== null) {
        if (spo2 < 70 || spo2 > 100) {
            errors.push('SpO2 must be between 70-100%');
        }
    }
    if (temperature !== undefined && temperature !== null) {
        if (temperature < 32 || temperature > 42) {
            errors.push('Temperature must be between 32-42°C');
        }
    }
    if (blood_pressure_systolic !== undefined && blood_pressure_systolic !== null) {
        if (blood_pressure_systolic < 60 || blood_pressure_systolic > 250) {
            errors.push('Systolic BP must be between 60-250 mmHg');
        }
    }
    if (blood_pressure_diastolic !== undefined && blood_pressure_diastolic !== null) {
        if (blood_pressure_diastolic < 40 || blood_pressure_diastolic > 150) {
            errors.push('Diastolic BP must be between 40-150 mmHg');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ success: false, errors });
    }

    // Initialize if needed
    if (!userProfile.baseline_vitals) {
        userProfile.baseline_vitals = {};
    }

    // Update baselines
    if (heart_rate !== undefined) userProfile.baseline_vitals.heart_rate = heart_rate;
    if (spo2 !== undefined) userProfile.baseline_vitals.spo2 = spo2;
    if (temperature !== undefined) userProfile.baseline_vitals.temperature = temperature;
    if (blood_pressure_systolic !== undefined) userProfile.baseline_vitals.blood_pressure_systolic = blood_pressure_systolic;
    if (blood_pressure_diastolic !== undefined) userProfile.baseline_vitals.blood_pressure_diastolic = blood_pressure_diastolic;
    userProfile.baseline_vitals.recorded_at = new Date().toISOString();

    const saved = saveUserProfile();

    res.json({
        success: true,
        baseline_vitals: userProfile.baseline_vitals,
        persisted: saved,
        message: 'Baseline vitals updated successfully'
    });
});

// Set baseline from current sensor readings
app.post('/api/profile/baseline-vitals/capture', (req, res) => {
    // Get current sensor readings
    const currentVitals = {
        heart_rate: sensorData.heart_rate.value,
        spo2: sensorData.spo2.value,
        temperature: sensorData.body_temp.value
    };

    // Initialize if needed
    if (!userProfile.baseline_vitals) {
        userProfile.baseline_vitals = {};
    }

    // Set baselines from current readings
    userProfile.baseline_vitals.heart_rate = currentVitals.heart_rate;
    userProfile.baseline_vitals.spo2 = currentVitals.spo2;
    userProfile.baseline_vitals.temperature = currentVitals.temperature;
    userProfile.baseline_vitals.recorded_at = new Date().toISOString();

    const saved = saveUserProfile();

    res.json({
        success: true,
        baseline_vitals: userProfile.baseline_vitals,
        captured_from: currentVitals,
        persisted: saved,
        message: 'Baseline vitals captured from current readings'
    });
});

// Clear baseline vitals
app.delete('/api/profile/baseline-vitals', (req, res) => {
    userProfile.baseline_vitals = {
        heart_rate: null,
        spo2: null,
        temperature: null,
        blood_pressure_systolic: null,
        blood_pressure_diastolic: null,
        recorded_at: null
    };

    const saved = saveUserProfile();

    res.json({
        success: true,
        baseline_vitals: userProfile.baseline_vitals,
        persisted: saved,
        message: 'Baseline vitals cleared'
    });
});

// Compare current vitals to baselines
app.get('/api/vitals/compare', (req, res) => {
    // Initialize baseline_vitals if not present
    if (!userProfile.baseline_vitals) {
        userProfile.baseline_vitals = {
            heart_rate: null,
            spo2: null,
            temperature: null,
            blood_pressure_systolic: null,
            blood_pressure_diastolic: null,
            recorded_at: null
        };
    }

    const baselines = userProfile.baseline_vitals;
    const hasBaselines = baselines.heart_rate !== null ||
                         baselines.spo2 !== null ||
                         baselines.temperature !== null;

    if (!hasBaselines) {
        return res.json({
            success: true,
            has_baselines: false,
            message: 'No baseline vitals set. Please set baselines for comparison.',
            current: {
                heart_rate: sensorData.heart_rate.value,
                spo2: sensorData.spo2.value,
                temperature: sensorData.body_temp.value
            }
        });
    }

    // Get current readings with slight variation
    const currentHR = Math.round(72 + (Math.random() - 0.5) * 4);
    const currentSpO2 = 98;
    const currentTemp = 36.8 + (Math.random() - 0.5) * 0.2;

    // Calculate deviations
    const comparisons = [];
    const alerts = [];

    // Heart Rate comparison
    if (baselines.heart_rate !== null) {
        const hrDiff = currentHR - baselines.heart_rate;
        const hrPercent = ((hrDiff / baselines.heart_rate) * 100).toFixed(1);
        const hrStatus = Math.abs(hrDiff) <= 10 ? 'normal' :
                         Math.abs(hrDiff) <= 20 ? 'elevated' : 'concerning';

        comparisons.push({
            metric: 'heart_rate',
            label: 'Heart Rate',
            current: currentHR,
            baseline: baselines.heart_rate,
            difference: hrDiff,
            percent_change: parseFloat(hrPercent),
            status: hrStatus,
            unit: 'BPM',
            direction: hrDiff > 0 ? 'above' : hrDiff < 0 ? 'below' : 'at'
        });

        if (hrStatus === 'concerning') {
            alerts.push({
                type: 'warning',
                metric: 'heart_rate',
                message: `Heart rate is ${Math.abs(hrDiff)} BPM ${hrDiff > 0 ? 'above' : 'below'} your baseline`
            });
        }
    }

    // SpO2 comparison
    if (baselines.spo2 !== null) {
        const spo2Diff = currentSpO2 - baselines.spo2;
        const spo2Status = currentSpO2 >= 95 ? 'normal' :
                          currentSpO2 >= 90 ? 'low' : 'critical';

        comparisons.push({
            metric: 'spo2',
            label: 'Blood Oxygen',
            current: currentSpO2,
            baseline: baselines.spo2,
            difference: spo2Diff,
            percent_change: parseFloat(((spo2Diff / baselines.spo2) * 100).toFixed(1)),
            status: spo2Status,
            unit: '%',
            direction: spo2Diff > 0 ? 'above' : spo2Diff < 0 ? 'below' : 'at'
        });

        if (spo2Status === 'critical') {
            alerts.push({
                type: 'danger',
                metric: 'spo2',
                message: `CRITICAL: SpO2 at ${currentSpO2}% - seek medical attention immediately`
            });
        } else if (spo2Status === 'low') {
            alerts.push({
                type: 'warning',
                metric: 'spo2',
                message: `SpO2 is low at ${currentSpO2}% - monitor closely`
            });
        }
    }

    // Temperature comparison
    if (baselines.temperature !== null) {
        const tempDiff = currentTemp - baselines.temperature;
        const tempStatus = Math.abs(tempDiff) <= 0.5 ? 'normal' :
                          currentTemp >= 38 ? 'fever' :
                          currentTemp <= 35 ? 'hypothermia' : 'elevated';

        comparisons.push({
            metric: 'temperature',
            label: 'Body Temperature',
            current: parseFloat(currentTemp.toFixed(1)),
            baseline: baselines.temperature,
            difference: parseFloat(tempDiff.toFixed(1)),
            percent_change: parseFloat(((tempDiff / baselines.temperature) * 100).toFixed(1)),
            status: tempStatus,
            unit: '°C',
            direction: tempDiff > 0 ? 'above' : tempDiff < 0 ? 'below' : 'at'
        });

        if (tempStatus === 'fever') {
            alerts.push({
                type: 'warning',
                metric: 'temperature',
                message: `Elevated temperature: ${currentTemp.toFixed(1)}°C - possible fever`
            });
        } else if (tempStatus === 'hypothermia') {
            alerts.push({
                type: 'danger',
                metric: 'temperature',
                message: `CRITICAL: Body temperature ${currentTemp.toFixed(1)}°C - hypothermia risk`
            });
        }
    }

    // Overall status
    const overallStatus = alerts.some(a => a.type === 'danger') ? 'critical' :
                         alerts.some(a => a.type === 'warning') ? 'attention' : 'normal';

    res.json({
        success: true,
        has_baselines: true,
        timestamp: new Date().toISOString(),
        baseline_recorded_at: baselines.recorded_at,
        comparisons,
        alerts,
        overall_status: overallStatus,
        summary: overallStatus === 'normal' ? 'All vitals within normal range of your baselines' :
                 overallStatus === 'attention' ? 'Some vitals need attention - review alerts' :
                 'Critical vital signs detected - seek help immediately'
    });
});

// ==============================================================================
// Vitals History Tracking
// ==============================================================================

// In-memory vitals history (last 1 hour of readings, sampled every 30 seconds)
const vitalsHistory = {
    heart_rate: [],
    spo2: [],
    body_temp: [],
    max_samples: 120 // 1 hour at 30-second intervals
};

// Sample vitals periodically
function sampleVitals() {
    const timestamp = new Date().toISOString();
    const hr = Math.round(72 + (Math.random() - 0.5) * 8);
    const spo2 = Math.round(97 + Math.random() * 2);
    const bodyTemp = parseFloat((36.6 + (Math.random() - 0.5) * 0.4).toFixed(1));

    // Add samples
    vitalsHistory.heart_rate.push({ timestamp, value: hr });
    vitalsHistory.spo2.push({ timestamp, value: spo2 });
    vitalsHistory.body_temp.push({ timestamp, value: bodyTemp });

    // Trim to max samples
    if (vitalsHistory.heart_rate.length > vitalsHistory.max_samples) {
        vitalsHistory.heart_rate.shift();
        vitalsHistory.spo2.shift();
        vitalsHistory.body_temp.shift();
    }
}

// Initialize with some historical data
function initializeVitalsHistory() {
    const now = Date.now();
    // Generate last 30 minutes of data (60 samples at 30-second intervals)
    for (let i = 60; i >= 0; i--) {
        const timestamp = new Date(now - i * 30000).toISOString();
        const hr = Math.round(72 + (Math.random() - 0.5) * 8);
        const spo2 = Math.round(97 + Math.random() * 2);
        const bodyTemp = parseFloat((36.6 + (Math.random() - 0.5) * 0.4).toFixed(1));

        vitalsHistory.heart_rate.push({ timestamp, value: hr });
        vitalsHistory.spo2.push({ timestamp, value: spo2 });
        vitalsHistory.body_temp.push({ timestamp, value: bodyTemp });
    }
}

// Start sampling
initializeVitalsHistory();
setInterval(sampleVitals, 30000); // Sample every 30 seconds

// Get vitals history
app.get('/api/vitals/history', (req, res) => {
    const { minutes = 30, metric } = req.query;
    const minutesNum = parseInt(minutes) || 30;
    const cutoff = new Date(Date.now() - minutesNum * 60000);

    const filterByTime = (arr) => arr.filter(item => new Date(item.timestamp) >= cutoff);

    if (metric) {
        // Return single metric history
        if (vitalsHistory[metric]) {
            const data = filterByTime(vitalsHistory[metric]);
            const values = data.map(d => d.value);
            res.json({
                success: true,
                metric,
                data,
                stats: {
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    avg: parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)),
                    latest: values[values.length - 1]
                },
                time_range_minutes: minutesNum
            });
        } else {
            res.status(400).json({ error: 'Unknown metric', available: ['heart_rate', 'spo2', 'body_temp'] });
        }
    } else {
        // Return all metrics
        const hrData = filterByTime(vitalsHistory.heart_rate);
        const spo2Data = filterByTime(vitalsHistory.spo2);
        const tempData = filterByTime(vitalsHistory.body_temp);

        res.json({
            success: true,
            time_range_minutes: minutesNum,
            heart_rate: {
                data: hrData,
                stats: {
                    count: hrData.length,
                    min: Math.min(...hrData.map(d => d.value)),
                    max: Math.max(...hrData.map(d => d.value)),
                    avg: parseFloat((hrData.map(d => d.value).reduce((a, b) => a + b, 0) / hrData.length).toFixed(1)),
                    latest: hrData[hrData.length - 1]?.value,
                    unit: 'BPM'
                }
            },
            spo2: {
                data: spo2Data,
                stats: {
                    count: spo2Data.length,
                    min: Math.min(...spo2Data.map(d => d.value)),
                    max: Math.max(...spo2Data.map(d => d.value)),
                    avg: parseFloat((spo2Data.map(d => d.value).reduce((a, b) => a + b, 0) / spo2Data.length).toFixed(1)),
                    latest: spo2Data[spo2Data.length - 1]?.value,
                    unit: '%'
                }
            },
            body_temp: {
                data: tempData,
                stats: {
                    count: tempData.length,
                    min: Math.min(...tempData.map(d => d.value)),
                    max: Math.max(...tempData.map(d => d.value)),
                    avg: parseFloat((tempData.map(d => d.value).reduce((a, b) => a + b, 0) / tempData.length).toFixed(1)),
                    latest: tempData[tempData.length - 1]?.value,
                    unit: '°C'
                }
            }
        });
    }
});

// Get latest vitals with trend direction
app.get('/api/vitals/current', (req, res) => {
    const getTrend = (history) => {
        if (history.length < 5) return 'stable';
        const recent = history.slice(-5);
        const older = history.slice(-10, -5);
        if (older.length < 5) return 'stable';

        const recentAvg = recent.map(d => d.value).reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.map(d => d.value).reduce((a, b) => a + b, 0) / older.length;
        const diff = recentAvg - olderAvg;

        if (Math.abs(diff) < 2) return 'stable';
        return diff > 0 ? 'rising' : 'falling';
    };

    const hrHistory = vitalsHistory.heart_rate;
    const spo2History = vitalsHistory.spo2;
    const tempHistory = vitalsHistory.body_temp;

    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        heart_rate: {
            value: hrHistory[hrHistory.length - 1]?.value || 72,
            unit: 'BPM',
            trend: getTrend(hrHistory),
            status: (hrHistory[hrHistory.length - 1]?.value || 72) > 100 ? 'elevated' :
                    (hrHistory[hrHistory.length - 1]?.value || 72) < 60 ? 'low' : 'normal'
        },
        spo2: {
            value: spo2History[spo2History.length - 1]?.value || 98,
            unit: '%',
            trend: getTrend(spo2History),
            status: (spo2History[spo2History.length - 1]?.value || 98) < 95 ? 'low' :
                    (spo2History[spo2History.length - 1]?.value || 98) < 90 ? 'critical' : 'normal'
        },
        body_temp: {
            value: tempHistory[tempHistory.length - 1]?.value || 36.6,
            unit: '°C',
            trend: getTrend(tempHistory),
            status: (tempHistory[tempHistory.length - 1]?.value || 36.6) >= 38 ? 'fever' :
                    (tempHistory[tempHistory.length - 1]?.value || 36.6) <= 35 ? 'hypothermia' : 'normal'
        }
    });
});

// ==============================================================================
// SpO2 Altitude Compensation
// ==============================================================================

// Altitude-adjusted SpO2 normal ranges
// At sea level: 95-100% normal
// At altitude, lower values are expected due to reduced oxygen partial pressure
const altitudeSpO2Ranges = {
    sea_level: { altitude_max: 1500, normal_min: 95, concern_min: 90, description: 'Sea level to moderate altitude' },
    moderate: { altitude_max: 2500, normal_min: 92, concern_min: 87, description: 'Moderate altitude (1500-2500m)' },
    high: { altitude_max: 3500, normal_min: 88, concern_min: 82, description: 'High altitude (2500-3500m)' },
    very_high: { altitude_max: 5500, normal_min: 82, concern_min: 75, description: 'Very high altitude (3500-5500m)' },
    extreme: { altitude_max: 9000, normal_min: 75, concern_min: 65, description: 'Extreme altitude (5500m+)' }
};

function getAltitudeCategory(altitude) {
    if (altitude < 1500) return 'sea_level';
    if (altitude < 2500) return 'moderate';
    if (altitude < 3500) return 'high';
    if (altitude < 5500) return 'very_high';
    return 'extreme';
}

function getAltitudeAdjustedSpO2Status(spo2, altitude) {
    const category = getAltitudeCategory(altitude);
    const ranges = altitudeSpO2Ranges[category];

    if (spo2 >= ranges.normal_min) {
        return {
            status: 'normal',
            message: `SpO2 ${spo2}% is normal for ${ranges.description}`,
            altitude_context: `Normal range at this altitude: ${ranges.normal_min}-100%`
        };
    } else if (spo2 >= ranges.concern_min) {
        return {
            status: 'low',
            message: `SpO2 ${spo2}% is below normal for ${ranges.description}`,
            altitude_context: `Expected range: ${ranges.normal_min}-100%. Monitor closely.`
        };
    } else {
        return {
            status: 'critical',
            message: `SpO2 ${spo2}% is critically low even accounting for altitude`,
            altitude_context: `Critically low - seek lower altitude immediately or activate SOS`
        };
    }
}

// Get altitude-compensated SpO2 reading
app.get('/api/vitals/spo2/altitude-compensated', (req, res) => {
    const altitude = sensorData.gps.altitude || 0;
    const spo2Value = sensorData.spo2.value || 98;

    const category = getAltitudeCategory(altitude);
    const ranges = altitudeSpO2Ranges[category];
    const status = getAltitudeAdjustedSpO2Status(spo2Value, altitude);

    res.json({
        success: true,
        spo2: {
            raw_value: spo2Value,
            unit: '%'
        },
        altitude: {
            current: altitude,
            unit: 'm',
            category: category,
            description: ranges.description
        },
        altitude_adjusted: {
            status: status.status,
            message: status.message,
            context: status.altitude_context,
            normal_range_for_altitude: {
                min: ranges.normal_min,
                max: 100
            },
            concern_threshold: ranges.concern_min,
            sea_level_equivalent: {
                description: 'At sea level, this would be considered:',
                status: spo2Value >= 95 ? 'normal' : spo2Value >= 90 ? 'low' : 'critical'
            }
        },
        recommendations: altitude > 2500 && spo2Value < ranges.normal_min ? [
            'Descend to lower altitude if possible',
            'Rest and avoid exertion',
            'Hydrate well',
            'Monitor for altitude sickness symptoms',
            'Seek medical attention if symptoms worsen'
        ] : []
    });
});

// Simulate different altitudes for testing
app.post('/api/vitals/spo2/simulate-altitude', (req, res) => {
    const { altitude } = req.body;
    if (altitude === undefined || altitude < 0) {
        return res.status(400).json({ error: 'Valid altitude required (0-9000m)' });
    }

    // Temporarily modify GPS altitude
    const originalAltitude = sensorData.gps.altitude;
    sensorData.gps.altitude = Math.min(altitude, 9000);

    // Simulate SpO2 decrease at altitude
    // At sea level: ~98%, at 5000m: ~85%
    const altitudeDropFactor = Math.max(0, (altitude - 1500) / 100);
    const simulatedSpO2 = Math.max(70, Math.round(98 - altitudeDropFactor));
    const originalSpO2 = sensorData.spo2.value;
    sensorData.spo2.value = simulatedSpO2;

    const category = getAltitudeCategory(altitude);
    const ranges = altitudeSpO2Ranges[category];
    const status = getAltitudeAdjustedSpO2Status(simulatedSpO2, altitude);

    res.json({
        success: true,
        simulation: {
            altitude: altitude,
            simulated_spo2: simulatedSpO2,
            original_spo2: originalSpO2,
            original_altitude: originalAltitude
        },
        altitude_category: category,
        altitude_description: ranges.description,
        adjusted_status: status,
        normal_range_at_altitude: {
            min: ranges.normal_min,
            max: 100
        },
        message: `Simulated altitude of ${altitude}m with SpO2 of ${simulatedSpO2}%`
    });
});

// ==============================================================================
// Critical Vitals Alert System
// ==============================================================================

// Alert thresholds (configurable)
const vitalsAlertThresholds = {
    heart_rate: {
        critical_high: 150,
        warning_high: 120,
        warning_low: 50,
        critical_low: 40
    },
    spo2: {
        warning_low: 92,
        critical_low: 88
    },
    body_temp: {
        critical_high: 40.0,    // Hyperpyrexia
        warning_high: 38.0,     // Fever
        warning_low: 35.0,      // Hypothermia mild
        critical_low: 32.0      // Hypothermia severe
    }
};

// Active alerts storage
const activeVitalsAlerts = [];
const alertHistory = [];
let alertIdCounter = 1;

function checkVitalsForAlerts() {
    const now = new Date().toISOString();
    const hr = vitalsHistory.heart_rate[vitalsHistory.heart_rate.length - 1]?.value || 72;
    const spo2 = vitalsHistory.spo2[vitalsHistory.spo2.length - 1]?.value || 98;
    const temp = vitalsHistory.body_temp[vitalsHistory.body_temp.length - 1]?.value || 36.6;

    const newAlerts = [];

    // Heart Rate Alerts
    if (hr >= vitalsAlertThresholds.heart_rate.critical_high) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'critical',
            metric: 'heart_rate',
            value: hr,
            unit: 'BPM',
            threshold: vitalsAlertThresholds.heart_rate.critical_high,
            message: `CRITICAL: Heart rate extremely high at ${hr} BPM`,
            action: 'Stop all activity immediately. Rest in comfortable position. Monitor breathing. Activate SOS if symptoms worsen.',
            audio_alert: true,
            timestamp: now
        });
    } else if (hr >= vitalsAlertThresholds.heart_rate.warning_high) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'warning',
            metric: 'heart_rate',
            value: hr,
            unit: 'BPM',
            threshold: vitalsAlertThresholds.heart_rate.warning_high,
            message: `WARNING: Heart rate elevated at ${hr} BPM`,
            action: 'Reduce activity and rest. Stay hydrated. Monitor for changes.',
            audio_alert: false,
            timestamp: now
        });
    } else if (hr <= vitalsAlertThresholds.heart_rate.critical_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'critical',
            metric: 'heart_rate',
            value: hr,
            unit: 'BPM',
            threshold: vitalsAlertThresholds.heart_rate.critical_low,
            message: `CRITICAL: Heart rate dangerously low at ${hr} BPM`,
            action: 'Check responsiveness. Keep person warm. Be ready for CPR. Activate SOS immediately.',
            audio_alert: true,
            timestamp: now
        });
    } else if (hr <= vitalsAlertThresholds.heart_rate.warning_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'warning',
            metric: 'heart_rate',
            value: hr,
            unit: 'BPM',
            threshold: vitalsAlertThresholds.heart_rate.warning_low,
            message: `WARNING: Heart rate low at ${hr} BPM`,
            action: 'Check for other symptoms. Keep warm. Monitor closely.',
            audio_alert: false,
            timestamp: now
        });
    }

    // SpO2 Alerts
    if (spo2 <= vitalsAlertThresholds.spo2.critical_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'critical',
            metric: 'spo2',
            value: spo2,
            unit: '%',
            threshold: vitalsAlertThresholds.spo2.critical_low,
            message: `CRITICAL: Blood oxygen critically low at ${spo2}%`,
            action: 'EMERGENCY - Sit upright. Loosen clothing. Deep breaths. Activate SOS immediately. Descend if at altitude.',
            audio_alert: true,
            timestamp: now
        });
    } else if (spo2 <= vitalsAlertThresholds.spo2.warning_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'warning',
            metric: 'spo2',
            value: spo2,
            unit: '%',
            threshold: vitalsAlertThresholds.spo2.warning_low,
            message: `WARNING: Blood oxygen low at ${spo2}%`,
            action: 'Rest and take deep breaths. If at altitude, consider descending. Monitor closely.',
            audio_alert: false,
            timestamp: now
        });
    }

    // Body Temperature Alerts
    if (temp >= vitalsAlertThresholds.body_temp.critical_high) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'critical',
            metric: 'body_temp',
            value: temp,
            unit: '°C',
            threshold: vitalsAlertThresholds.body_temp.critical_high,
            message: `CRITICAL: Body temperature dangerously high at ${temp}°C`,
            action: 'HEAT EMERGENCY - Move to shade. Remove clothing. Apply cool water. Fan. Activate SOS.',
            audio_alert: true,
            timestamp: now
        });
    } else if (temp >= vitalsAlertThresholds.body_temp.warning_high) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'warning',
            metric: 'body_temp',
            value: temp,
            unit: '°C',
            threshold: vitalsAlertThresholds.body_temp.warning_high,
            message: `WARNING: Fever detected at ${temp}°C`,
            action: 'Rest, stay hydrated, monitor for other symptoms.',
            audio_alert: false,
            timestamp: now
        });
    } else if (temp <= vitalsAlertThresholds.body_temp.critical_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'critical',
            metric: 'body_temp',
            value: temp,
            unit: '°C',
            threshold: vitalsAlertThresholds.body_temp.critical_low,
            message: `CRITICAL: Severe hypothermia at ${temp}°C`,
            action: 'COLD EMERGENCY - Handle gently. Remove wet clothing. Warm core slowly. Do NOT rub limbs. Activate SOS.',
            audio_alert: true,
            timestamp: now
        });
    } else if (temp <= vitalsAlertThresholds.body_temp.warning_low) {
        newAlerts.push({
            id: alertIdCounter++,
            type: 'warning',
            metric: 'body_temp',
            value: temp,
            unit: '°C',
            threshold: vitalsAlertThresholds.body_temp.warning_low,
            message: `WARNING: Mild hypothermia detected at ${temp}°C`,
            action: 'Get to warmth. Remove wet clothing. Add layers. Drink warm fluids if conscious.',
            audio_alert: false,
            timestamp: now
        });
    }

    // Add to active alerts and history
    newAlerts.forEach(alert => {
        activeVitalsAlerts.push(alert);
        alertHistory.push(alert);
    });

    // Trim alert history to last 100 entries
    while (alertHistory.length > 100) {
        alertHistory.shift();
    }

    return newAlerts;
}

// Get active vitals alerts
app.get('/api/vitals/alerts', (req, res) => {
    res.json({
        success: true,
        active_alerts: activeVitalsAlerts,
        thresholds: vitalsAlertThresholds,
        alert_count: activeVitalsAlerts.length,
        has_critical: activeVitalsAlerts.some(a => a.type === 'critical'),
        has_warning: activeVitalsAlerts.some(a => a.type === 'warning')
    });
});

// Get alert history
app.get('/api/vitals/alerts/history', (req, res) => {
    const { limit = 20 } = req.query;
    res.json({
        success: true,
        alerts: alertHistory.slice(-parseInt(limit)),
        total_count: alertHistory.length
    });
});

// Acknowledge/dismiss an alert
app.post('/api/vitals/alerts/dismiss', (req, res) => {
    const { alert_id, dismiss_all } = req.body;

    if (dismiss_all) {
        const count = activeVitalsAlerts.length;
        activeVitalsAlerts.length = 0;
        return res.json({
            success: true,
            dismissed_count: count,
            message: 'All alerts dismissed'
        });
    }

    if (!alert_id) {
        return res.status(400).json({ error: 'alert_id required' });
    }

    const index = activeVitalsAlerts.findIndex(a => a.id === alert_id);
    if (index !== -1) {
        const dismissed = activeVitalsAlerts.splice(index, 1)[0];
        return res.json({
            success: true,
            dismissed_alert: dismissed,
            remaining_alerts: activeVitalsAlerts.length
        });
    }

    res.status(404).json({ error: 'Alert not found' });
});

// Update alert thresholds
app.put('/api/vitals/alerts/thresholds', (req, res) => {
    const { metric, thresholds } = req.body;

    if (!metric || !vitalsAlertThresholds[metric]) {
        return res.status(400).json({ error: 'Valid metric required', available: Object.keys(vitalsAlertThresholds) });
    }

    // Update thresholds
    Object.assign(vitalsAlertThresholds[metric], thresholds);

    res.json({
        success: true,
        metric,
        updated_thresholds: vitalsAlertThresholds[metric],
        message: `${metric} alert thresholds updated`
    });
});

// Simulate abnormal vital for testing
app.post('/api/vitals/alerts/simulate', (req, res) => {
    const { metric, value } = req.body;

    if (!metric || !['heart_rate', 'spo2', 'body_temp'].includes(metric)) {
        return res.status(400).json({ error: 'Valid metric required', available: ['heart_rate', 'spo2', 'body_temp'] });
    }

    // Add simulated reading to history
    const timestamp = new Date().toISOString();
    vitalsHistory[metric].push({ timestamp, value });

    // Trim history
    if (vitalsHistory[metric].length > vitalsHistory.max_samples) {
        vitalsHistory[metric].shift();
    }

    // Check for alerts
    const newAlerts = checkVitalsForAlerts();

    res.json({
        success: true,
        simulated: { metric, value },
        new_alerts: newAlerts,
        active_alerts: activeVitalsAlerts,
        message: `Simulated ${metric} value of ${value} - ${newAlerts.length} new alert(s) generated`
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
// Graceful Shutdown System
// ==============================================================================

let shutdownState = {
    initiated: false,
    confirmed: false,
    shutdownToken: null,
    dataSaved: false,
    shutdownLog: []
};

// Request shutdown (requires confirmation)
app.post('/api/shutdown/request', (req, res) => {
    if (shutdownState.initiated && !shutdownState.confirmed) {
        return res.json({
            success: true,
            awaiting_confirmation: true,
            token: shutdownState.shutdownToken,
            message: 'Shutdown already pending - awaiting confirmation'
        });
    }

    // Generate shutdown token
    shutdownState.shutdownToken = 'shutdown_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    shutdownState.initiated = true;
    shutdownState.confirmed = false;
    shutdownState.dataSaved = false;
    shutdownState.shutdownLog = [{
        time: new Date().toISOString(),
        event: 'Shutdown requested'
    }];

    console.log('[SHUTDOWN] Shutdown requested - awaiting confirmation');

    res.json({
        success: true,
        awaiting_confirmation: true,
        token: shutdownState.shutdownToken,
        message: 'Shutdown requested. Please confirm to proceed.',
        warning: 'All unsaved data will be saved before shutdown.'
    });
});

// Confirm and execute shutdown
app.post('/api/shutdown/confirm', (req, res) => {
    const { token } = req.body;

    if (!shutdownState.initiated) {
        return res.status(400).json({
            success: false,
            error: 'No shutdown pending. Please request shutdown first.'
        });
    }

    if (token !== shutdownState.shutdownToken) {
        return res.status(400).json({
            success: false,
            error: 'Invalid shutdown token'
        });
    }

    shutdownState.confirmed = true;
    shutdownState.shutdownLog.push({
        time: new Date().toISOString(),
        event: 'Shutdown confirmed'
    });

    console.log('[SHUTDOWN] Shutdown confirmed - saving data...');

    // Save all data
    const saveResults = [];

    // Save user profile
    try {
        saveUserProfile();
        saveResults.push({ data: 'user_profile', saved: true });
        shutdownState.shutdownLog.push({
            time: new Date().toISOString(),
            event: 'User profile saved'
        });
    } catch (e) {
        saveResults.push({ data: 'user_profile', saved: false, error: e.message });
    }

    // Save waypoints
    try {
        saveWaypoints();
        saveResults.push({ data: 'waypoints', saved: true });
        shutdownState.shutdownLog.push({
            time: new Date().toISOString(),
            event: 'Waypoints saved'
        });
    } catch (e) {
        saveResults.push({ data: 'waypoints', saved: false, error: e.message });
    }

    // Save breadcrumb trails
    try {
        saveBreadcrumbs();
        saveResults.push({ data: 'breadcrumb_trails', saved: true });
        shutdownState.shutdownLog.push({
            time: new Date().toISOString(),
            event: 'Breadcrumb trails saved'
        });
    } catch (e) {
        saveResults.push({ data: 'breadcrumb_trails', saved: false, error: e.message });
    }

    // Save settings
    try {
        saveSettings();
        saveResults.push({ data: 'settings', saved: true });
        shutdownState.shutdownLog.push({
            time: new Date().toISOString(),
            event: 'Settings saved'
        });
    } catch (e) {
        saveResults.push({ data: 'settings', saved: false, error: e.message });
    }

    shutdownState.dataSaved = true;
    shutdownState.shutdownLog.push({
        time: new Date().toISOString(),
        event: 'All data saved successfully'
    });

    // Update system state
    systemState.state = 'shutdown';

    shutdownState.shutdownLog.push({
        time: new Date().toISOString(),
        event: 'System shutdown complete'
    });

    console.log('[SHUTDOWN] Data saved - system shutdown complete');
    console.log('[SHUTDOWN] Clean shutdown message: All data preserved. Safe to power off.');

    res.json({
        success: true,
        message: 'Clean shutdown complete. All data has been saved.',
        shutdown_log: shutdownState.shutdownLog,
        save_results: saveResults,
        safe_to_power_off: true
    });

    // In a real system, this would trigger actual power-off
    // For simulation, we just reset state after a delay
    setTimeout(() => {
        console.log('[SHUTDOWN] System would power off now in production');
        // Reset shutdown state for simulation purposes
        shutdownState.initiated = false;
        shutdownState.confirmed = false;
        shutdownState.shutdownToken = null;
    }, 2000);
});

// Cancel pending shutdown
app.post('/api/shutdown/cancel', (req, res) => {
    if (!shutdownState.initiated || shutdownState.confirmed) {
        return res.status(400).json({
            success: false,
            error: 'No pending shutdown to cancel'
        });
    }

    shutdownState.initiated = false;
    shutdownState.shutdownToken = null;
    shutdownState.shutdownLog = [];

    console.log('[SHUTDOWN] Shutdown cancelled');

    res.json({
        success: true,
        message: 'Shutdown cancelled'
    });
});

// Get shutdown status
app.get('/api/shutdown/status', (req, res) => {
    res.json({
        shutdown_initiated: shutdownState.initiated,
        awaiting_confirmation: shutdownState.initiated && !shutdownState.confirmed,
        shutdown_complete: shutdownState.confirmed && shutdownState.dataSaved,
        shutdown_log: shutdownState.shutdownLog
    });
});

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
