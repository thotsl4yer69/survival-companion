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

// Battery level
app.get('/api/battery', (req, res) => {
    res.json({ battery_level: systemState.bootStatus.battery_level });
});

app.post('/api/battery', (req, res) => {
    const { level } = req.body;
    if (typeof level === 'number') {
        systemState.bootStatus.battery_level = Math.max(0, Math.min(100, level));
    }
    res.json({ battery_level: systemState.bootStatus.battery_level });
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
            systemState.state = 'emergency';
            return res.json({
                success: true,
                confirmed: true,
                action,
                message: 'Emergency beacon activated',
                result: {
                    status: 'emergency_activated',
                    gps: sensorData.gps
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

// Emergency activation
app.post('/api/emergency/activate', (req, res) => {
    systemState.state = 'emergency';
    res.json({
        status: 'emergency_activated',
        gps: {
            latitude: sensorData.gps.latitude,
            longitude: sensorData.gps.longitude
        },
        message: 'SOS beacon activated. Broadcasting position.'
    });
});

app.post('/api/emergency/deactivate', (req, res) => {
    systemState.state = 'ready';
    res.json({ status: 'emergency_deactivated' });
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

    if (commandLower.includes('emergency') || commandLower.includes('sos') || commandLower.includes('help')) {
        response.action = 'emergency';
        response.response = 'Activating emergency mode. SOS beacon enabled.';
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
