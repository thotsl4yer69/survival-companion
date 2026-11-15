#pragma once
/* Copy to secrets.h and fill in values on the local build machine.
   Requires a trusted private LAN. HTTP is not encrypted. */
#define BLACKBOX_WIFI_SSID "YOUR_LOCAL_WIFI_SSID"
#define BLACKBOX_WIFI_PASSWORD "YOUR_LOCAL_WIFI_PASSWORD"
#define BLACKBOX_SERVER_URL "http://192.168.1.20:8765/api/telemetry"
#define BLACKBOX_NODE_KEY "GENERATE_A_SEPARATE_RANDOM_NODE_KEY"
#define BLACKBOX_NODE_ID "esp32s3-field-01"
