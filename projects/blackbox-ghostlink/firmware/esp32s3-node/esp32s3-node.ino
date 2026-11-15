/* BLACKBOX ESP32-S3 node heartbeat / radio-independent local telemetry.
   Compatible with Arduino ESP32 core (board must have working Wi-Fi).
   No external sensor library is required. Reports actual firmware uptime,
   RSSI and free heap; those are device diagnostic metrics, NOT hazard detectors.
   Never hardcode passwords in files committed to a repository.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h"

#ifndef BLACKBOX_WIFI_SSID
#error "Create secrets.h using secrets.example.h and configure credentials."
#endif
#ifndef BLACKBOX_NODE_ID
#error "BLACKBOX_NODE_ID is required"
#endif

static const uint32_t POST_INTERVAL_MS = 60000;
uint32_t lastPost = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(BLACKBOX_WIFI_SSID, BLACKBOX_WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 12000) {
    delay(200);
  }
}

void postTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, BLACKBOX_SERVER_URL)) {
    Serial.println("HTTP init failed");
    return;
  }
  http.setConnectTimeout(5000);  // Bound a missing gateway's impact.
  http.setTimeout(5000);
  http.setReuse(false);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Key", BLACKBOX_NODE_KEY);
  String payload = String("{\"node_id\":\"") + BLACKBOX_NODE_ID +
    "\",\"values\":{\"uptime_s\":" + String(millis()/1000) +
    ",\"wifi_rssi_dbm\":" + String(WiFi.RSSI()) +
    ",\"heap_free_bytes\":" + String(ESP.getFreeHeap()) + "}}";
  const int result = http.POST(payload);
  Serial.print("BLACKBOX HTTP: "); Serial.println(result);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  connectWifi();
  // Report at startup only if network is accessible.
  postTelemetry();
  lastPost = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (millis() - lastPost >= POST_INTERVAL_MS) {
    lastPost = millis();
    postTelemetry();
  }
  delay(100);
}
