// Real sensor detection - NO FAKE DATA
import { execSync } from 'child_process';

/**
 * Check if an I2C sensor is actually connected
 * @param {string} address - Hex address without '0x' prefix (e.g., '76', '57', '5a')
 * @returns {boolean} - true if sensor detected, false otherwise
 */
function checkI2CSensor(address) {
    try {
        const result = execSync('/usr/sbin/i2cdetect -y 1', { encoding: 'utf8', timeout: 5000 });
        const lines = result.split('\n');

        for (const line of lines) {
            // Look for the address in the output
            // i2cdetect shows addresses as 2-digit hex, with '--' for empty slots
            if (line.includes(address)) {
                // Match the address but not '--' (which indicates empty slot)
                const match = line.match(new RegExp(`\\b${address}\\b(?!-)`, 'i'));
                if (match) {
                    return true;
                }
            }
        }
        return false;
    } catch (error) {
        // If i2cdetect fails, assume sensor not available
        console.error('I2C detection error:', error.message);
        return false;
    }
}

/**
 * Get real sensor data or "not available" messages
 * @returns {object} - Sensor data with availability info
 */
function getSensorData() {
    const sensors = {
        bme280: checkI2CSensor('76'),      // Environmental sensor
        max30102: checkI2CSensor('57'),    // Heart rate / SpO2
        mlx90614: checkI2CSensor('5a')     // IR temperature
    };

    return {
        // Temperature from BME280
        temperature: sensors.bme280
            ? null  // Will be read from actual sensor
            : { available: false, message: 'BME280 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // Humidity from BME280
        humidity: sensors.bme280
            ? null
            : { available: false, message: 'BME280 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // Pressure from BME280
        pressure: sensors.bme280
            ? null
            : { available: false, message: 'BME280 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // Heart rate from MAX30102
        heart_rate: sensors.max30102
            ? null
            : { available: false, message: 'MAX30102 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // SpO2 from MAX30102
        spo2: sensors.max30102
            ? null
            : { available: false, message: 'MAX30102 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // Body temperature from MLX90614
        body_temp: sensors.mlx90614
            ? null
            : { available: false, message: 'MLX90614 sensor not connected', error: 'SENSOR_NOT_AVAILABLE' },

        // GPS (UART-based, not I2C)
        gps: {
            available: false,
            message: 'GPS module not connected',
            error: 'GPS_NOT_AVAILABLE'
        },

        // Sensor detection status
        sensors_detected: sensors
    };
}

export { getSensorData, checkI2CSensor };
