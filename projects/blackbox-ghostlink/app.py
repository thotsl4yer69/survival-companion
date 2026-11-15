#!/usr/bin/env python3
"""BLACKBOX/GHOSTLINK: offline-first operations gateway (Python standard library)."""
from __future__ import annotations

import hmac
import html
import ipaddress
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parent
VERSION = "0.3.0"
MAX_BODY = 65536
SAFE_RECIPIENT = re.compile(r"^(broadcast|![0-9a-fA-F]{8})$")
UTC = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bad_text(value, label, maxlen, *, allow_empty=False):
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > maxlen or "\x00" in value:
        raise ValueError(f"{label} is empty or too long (max {maxlen})")
    return value


def safe_number(value, label, lo=-float("inf"), hi=float("inf")):
    if isinstance(value, bool):
        raise ValueError(f"{label} must be numeric, not boolean")
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{label} must be numeric") from None
    if not math.isfinite(number) or not lo <= number <= hi:
        raise ValueError(f"{label} must be between {lo} and {hi}")
    return number


def safe_date(value):
    if value in (None, ""):
        return ""
    value = bad_text(value, "Expiry", 10)
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise ValueError("Expiry must be YYYY-MM-DD") from None


def env_bool(name):
    return os.environ.get(name, "").lower() in ("yes", "true", "1", "on")


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # SQLite's default file mode follows the caller's umask (often 0644).
        # Store field notes, waypoints and contact details in a private DB.
        if os.name == "posix":
            try:
                handle = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                if not self.path.is_file():
                    raise ValueError("Database path is not a regular file")
            else:
                os.close(handle)
            os.chmod(self.path,0o600)
        self.init()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(str(self.path), timeout=20)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA busy_timeout=20000")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def init(self):
        with self.lock, self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS supplies(
              id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0,
              unit TEXT NOT NULL DEFAULT 'units', minimum REAL NOT NULL DEFAULT 0,
              expiry TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS notes(
              id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
              created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS messages(
              id INTEGER PRIMARY KEY, direction TEXT NOT NULL, sender TEXT NOT NULL,
              recipient TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
              created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS events(
              id INTEGER PRIMARY KEY, source TEXT NOT NULL, detail TEXT NOT NULL,
              created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS waypoints(
              id INTEGER PRIMARY KEY, name TEXT NOT NULL, latitude REAL NOT NULL,
              longitude REAL NOT NULL, category TEXT NOT NULL DEFAULT 'location',
              notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS telemetry(
              id INTEGER PRIMARY KEY, node_id TEXT NOT NULL, captured TEXT NOT NULL,
              values_json TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS telemetry_idx ON telemetry(node_id, id DESC);
            CREATE TABLE IF NOT EXISTS knowledge(
              slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS checklist(
              id INTEGER PRIMARY KEY, title TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
              checked_at TEXT NOT NULL DEFAULT '');
            """)
            for identifier, title in enumerate((
                "Confirm people and immediate safety",
                "Check certified alarms and exits",
                "Check water and critical medication",
                "Verify independent power and radio",
                "Update field notes and emergency contacts",
            ), start=1):
                db.execute("INSERT OR IGNORE INTO checklist(id,title) VALUES(?,?)",(identifier,title))
            columns = [r[1] for r in db.execute("PRAGMA table_info(messages)")]
            if "packet_id" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN packet_id TEXT DEFAULT NULL")
            if "error" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN error TEXT NOT NULL DEFAULT ''")
            if "released_at" not in columns:
                db.execute("ALTER TABLE messages ADD COLUMN released_at TEXT NOT NULL DEFAULT ''")
            db.execute("UPDATE messages SET status='local-only' WHERE status LIKE 'queued locally%'")
            # Preserve radio-send uncertainty across restarts; never silently retry.
            db.execute("UPDATE messages SET status='requires-manual-review' "
                       "WHERE direction='outgoing' "
                       "AND status IN ('submitting-uncertain','queued-for-radio')")
            # Durable inbound de-duplication, including after a process restart.
            db.execute("DELETE FROM messages WHERE direction='incoming' AND packet_id IS NOT NULL "
                       "AND packet_id<>'' AND id NOT IN (SELECT MIN(id) FROM messages "
                       "WHERE direction='incoming' AND packet_id IS NOT NULL AND packet_id<>'' "
                       "GROUP BY sender,packet_id)")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS incoming_radio_packet_unique "
                       "ON messages(sender,packet_id) "
                       "WHERE direction='incoming' AND packet_id IS NOT NULL AND packet_id<>''")
            try:
                db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(slug UNINDEXED, title, body)")
                self.fts = True
            except sqlite3.OperationalError:
                self.fts = False
            db.commit()
        self.index_knowledge()

    def query(self, sql, args=()):
        with self.lock, self.connect() as db:
            return [dict(r) for r in db.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        data = self.query(sql, args)
        return data[0] if data else None

    def execute(self, sql, args=()):
        with self.lock, self.connect() as db:
            cur = db.execute(sql, args)
            db.commit()
            return cur.lastrowid, cur.rowcount

    def event(self, source, detail):
        self.execute("INSERT INTO events(source,detail) VALUES(?,?)", (source[:50], detail[:500]))

    def index_knowledge(self):
        root = ROOT / "knowledge"
        if not root.exists():
            return
        documents = []
        for path in sorted(root.glob("*.md")):
            content = path.read_text(encoding="utf-8")[:100000]
            title = content.splitlines()[0].lstrip("# ").strip() if content else path.stem
            documents.append((path.stem, title, content, UTC()))
        with self.lock, self.connect() as db:
            for item in documents:
                db.execute("INSERT INTO knowledge(slug,title,body,updated) VALUES(?,?,?,?) "
                           "ON CONFLICT(slug) DO UPDATE SET title=excluded.title,body=excluded.body,updated=excluded.updated "
                           "WHERE knowledge.title<>excluded.title OR knowledge.body<>excluded.body", item)
            # Deleted or renamed local reference files must disappear from results.
            if documents:
                placeholders=",".join("?" for _ in documents)
                db.execute(f"DELETE FROM knowledge WHERE slug NOT IN ({placeholders})",
                           tuple(item[0] for item in documents))
            else:
                db.execute("DELETE FROM knowledge")
            if self.fts:
                db.execute("DELETE FROM knowledge_fts")
                db.execute("INSERT INTO knowledge_fts(slug,title,body) SELECT slug,title,body FROM knowledge")
            db.commit()

    def search_knowledge(self, term, limit=12):
        term = bad_text(term, "Search", 120)
        tokens = re.findall(r"[\w-]+", term, flags=re.UNICODE)[:10]
        if not tokens:
            return []
        if self.fts:
            expression = " AND ".join('"' + t.replace('"', '') + '"' for t in tokens)
            try:
                return self.query("SELECT slug,title,substr(body,1,2400) AS body "
                                  "FROM knowledge_fts WHERE knowledge_fts MATCH ? "
                                  "ORDER BY bm25(knowledge_fts) LIMIT ?", (expression, limit))
            except sqlite3.OperationalError:
                pass
        needle = "%" + "%".join(tokens) + "%"
        return self.query("SELECT slug,title,substr(body,1,2400) AS body FROM knowledge "
                          "WHERE title LIKE ? OR body LIKE ? ORDER BY title LIMIT ?", (needle, needle, limit))

    def backup(self, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if os.name == "posix":
            try:
                handle=os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                if not destination.is_file():
                    raise ValueError("Backup destination is not a regular file")
            else:
                os.close(handle)
            os.chmod(destination,0o600)
        with self.lock, self.connect() as src:
            dst = sqlite3.connect(str(destination))
            try:
                src.backup(dst)
                dst.commit()
            finally:
                dst.close()
        return destination

    def claim_radio_message(self):
        """Persist an uncertain handoff *before* calling the radio API.

        After power loss or process crash, this message will not be transmitted
        automatically on restart. The operator must assess duplicate risk.
        """
        with self.lock, self.connect() as db:
            db.execute("UPDATE messages SET status='release-expired' "
                       "WHERE direction='outgoing' AND status='queued-for-radio' "
                       "AND (released_at='' OR (julianday('now') - julianday(released_at)) * 86400 > 120)")
            row = db.execute("SELECT id,recipient,body FROM messages "
                             "WHERE direction='outgoing' AND status='queued-for-radio' "
                             "ORDER BY id LIMIT 1").fetchone()
            if row is None:
                return None
            db.execute("UPDATE messages SET status='submitting-uncertain',error='' "
                       "WHERE id=?", (row['id'],))
            return dict(row)

    def latest_nodes(self):
        return self.query("SELECT t.node_id,t.captured,t.values_json FROM telemetry t "
                          "JOIN (SELECT node_id,MAX(id) AS id FROM telemetry GROUP BY node_id) m "
                          "ON t.id=m.id ORDER BY t.node_id")


def validate_supply(obj, partial=False):
    if not isinstance(obj, dict):
        raise ValueError("Expected object")
    out = {}
    fields = ("name", "quantity", "unit", "minimum", "expiry", "notes")
    if not partial and not all(k in obj for k in ("name", "quantity")):
        raise ValueError("Supply requires name and quantity")
    for k in fields:
        if k not in obj:
            continue
        if k in ("name", "unit", "notes"):
            out[k] = bad_text(obj[k], k.title(), {"name":120,"unit":24,"notes":1000}[k], allow_empty=k=="notes")
        elif k in ("quantity", "minimum"):
            out[k] = safe_number(obj[k], k, 0, 1e12)
        else:
            out[k] = safe_date(obj[k])
    return out


def estimate_power(x):
    capacity=safe_number(x.get("capacity_wh"),"Battery capacity (Wh)",0,10000000)
    efficiency=safe_number(x.get("efficiency_percent",85),"Conversion efficiency (%)",1,100)
    reserve=safe_number(x.get("reserve_percent",20),"Reserved charge (%)",0,99)
    loads=x.get("loads_w")
    if not isinstance(loads,dict) or not loads or len(loads)>12:
        raise ValueError("Provide named device power loads in watts")
    clean={}
    for name,value in loads.items():
        key=bad_text(name,"Device name",50)
        clean[key]=safe_number(value,key,0,1000000)
    total=sum(clean.values())
    usable=capacity*(efficiency/100)*(1-reserve/100)
    return {"capacity_wh":capacity,"usable_wh":round(usable,2),"total_load_w":round(total,2),
            "loads_w":clean,"estimated_hours":round(usable/total,2) if total>0 else None,
            "battery_remaining_assumption":"Assumes full rated battery capacity is available at calculation start",
            "warning":"Estimate only. Hardware, depth-of-discharge limits, inverter idle load, battery health and temperature may reduce runtime."}


@contextmanager
def open_mbtiles(path):
    con=sqlite3.connect(f"file:{urllib.parse.quote(str(path))}?mode=ro",uri=True)
    try:yield con
    finally:con.close()


def build_geojson(points):
    return {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[p["longitude"],p["latitude"]]},"properties":{"name":p["name"],"category":p["category"],"notes":p["notes"]}} for p in points]}


def build_gpx(points):
    tracks = []
    for p in points:
        tracks.append(f'<wpt lat="{p["latitude"]}" lon="{p["longitude"]}"><name>{xml_escape(p["name"])}</name><desc>{xml_escape(p["notes"])}</desc><type>{xml_escape(p["category"])}</type></wpt>')
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<gpx version="1.1" creator="BLACKBOX" xmlns="http://www.topografix.com/GPX/1/1">\n'
            + '\n'.join(tracks) + '\n</gpx>')


def field_report(store, status):
    """Standalone printable report made only from stored operator-entered records."""
    esc = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    def table(headers, rows):
        if not rows:
            return '<p class="empty">No records stored.</p>'
        head = "".join("<th>" + esc(h) + "</th>" for h in headers)
        body = "".join("<tr>" + "".join("<td>" + esc(c) + "</td>" for c in row) + "</tr>" for row in rows)
        return "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>"
    checklist = store.query("SELECT title,checked,checked_at FROM checklist ORDER BY id")
    supplies = store.query("SELECT name,quantity,unit,minimum,expiry,notes FROM supplies ORDER BY name COLLATE NOCASE,id")
    waypoints = store.query("SELECT name,latitude,longitude,category,notes FROM waypoints ORDER BY id")
    notes = store.query("SELECT title,body,created FROM notes ORDER BY id DESC LIMIT 200")
    devices = store.latest_nodes()
    checked = sum(bool(c["checked"]) for c in checklist)
    parts = [f"<h1>BLACKBOX / GHOSTLINK — field report</h1>"
             f"<p>Snapshot generated: <strong>{esc(UTC())} (UTC)</strong></p>"
             "<div class='warning'>LOCAL SNAPSHOT, NOT VERIFIED EMERGENCY DATA. "
             "Check timestamps, quantities and locations independently. "
             "A checked task is an operator declaration, not a successful physical test.</div>"
             f"<p><strong>Radio bridge state:</strong> {esc(status['radio']['state'])}; "
             "radio transmissions and delivery are not guaranteed.</p>"
             f"<h2>Readiness checks ({checked}/{len(checklist)} self-reported)</h2>"
             + table(["Task", "Recorded", "Time (UTC)"], [[c['title'], "YES" if c['checked'] else "NO",c['checked_at']] for c in checklist])
             + "<h2>Supplies</h2>" + table(["Item", "Quantity", "Unit", "Minimum", "Expires", "Details"],
               [[x['name'],x['quantity'],x['unit'],x['minimum'],x['expiry'],x['notes']] for x in supplies])
             + "<h2>Saved waypoints</h2>" + table(["Label", "Latitude", "Longitude", "Type", "Details"],
               [[x['name'],x['latitude'],x['longitude'],x['category'],x['notes']] for x in waypoints])
             + "<h2>Latest device reports (uncalibrated unless independently validated)</h2>" +
               table(["Node", "Reported at (UTC)", "Measurements"],
               [[d['node_id'],d['captured'],d['values_json']] for d in devices])
             + "<h2>Recent field notes (newest first, up to 200)</h2>" +
               table(["Title", "Recorded", "Details"], [[x['title'],x['created'],x['body']] for x in notes])
             + "<p class='end'>This document is self-contained and does not require a BLACKBOX server or internet. "
               "Store securely; it may contain private information.</p>"]
    css = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>BLACKBOX field report</title>
<style>*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;background:#fff;color:#14282a;margin:0 auto;padding:32px;max-width:1080px}
h1{border-bottom:3px solid #156b58;padding-bottom:12px}h2{padding-top:22px;border-bottom:1px solid #c8d3d0}
table{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}th,td{border:1px solid #aabbb6;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
th{background:#dbeae4}.warning{border:2px solid #a86b15;padding:13px;background:#fff3db}.empty{color:#657a76}.end{color:#50645f;font-size:12px}
@media print{body{padding:0;font-size:12px}h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body>"""
    return (css + "\n".join(parts) + "</body></html>").encode('utf-8')


class Blackbox:
    def __init__(self, db_path=None, *, token=None, node_key=None, ha_url=None, ha_token=None, model=None, radio_enabled=False, serial_port=None, mbtiles=None):
        self.store = Store(db_path or os.environ.get("BLACKBOX_DB", str(ROOT / "blackbox.sqlite3")))
        self.token = token if token is not None else os.environ.get("BLACKBOX_TOKEN", "")
        self.node_key = node_key if node_key is not None else os.environ.get("BLACKBOX_NODE_KEY", "")
        self.ha_url = (ha_url if ha_url is not None else os.environ.get("BLACKBOX_HA_URL", "")).rstrip("/")
        self.ha_token = ha_token if ha_token is not None else os.environ.get("BLACKBOX_HA_TOKEN", "")
        self.model = model if model is not None else os.environ.get("BLACKBOX_OLLAMA_MODEL", "")
        self.radio_enabled = radio_enabled or env_bool("BLACKBOX_MESH_ENABLED")
        self.serial_port = serial_port if serial_port is not None else os.environ.get("BLACKBOX_MESH_PORT", "")
        self.mbtiles = Path(mbtiles) if mbtiles else Path(os.environ["BLACKBOX_MBTILES"]) if os.environ.get("BLACKBOX_MBTILES") else None
        self.radio_state = "disabled" if not self.radio_enabled else "not-connected"
        self.radio_error = ""
        self.worker = None
        self.started = time.monotonic()

    def map_metadata(self):
        if not self.mbtiles or not self.mbtiles.is_file():
            return {"mbtiles_configured":False,"mbtiles_raster_usable":False}
        try:
            with open_mbtiles(self.mbtiles) as con:
                meta=dict(con.execute("SELECT name,value FROM metadata").fetchall())
                form=meta.get("format", "").lower()
                raster=form in ("png","jpg","jpeg","webp")
                bounds=con.execute("SELECT MIN(zoom_level),MAX(zoom_level) FROM tiles").fetchone()
                return {"mbtiles_configured":True,"mbtiles_raster_usable":raster,
                        "format":form,"min_zoom":bounds[0],"max_zoom":bounds[1],
                        "detail":"Raster tile display only; vector MBTiles not supported"}
        except sqlite3.Error:
            return {"mbtiles_configured":True,"mbtiles_raster_usable":False,"detail":"Could not open MBTiles as valid raster tile database"}

    def read_tile(self,z,x,y):
        meta=self.map_metadata()
        if not meta.get("mbtiles_raster_usable"):
            raise ValueError("No usable raster MBTiles file configured")
        if not 0<=z<=22 or not 0<=x<2**z or not 0<=y<2**z:
            raise ValueError("Invalid tile coordinates")
        y_tms=2**z-1-y
        with open_mbtiles(self.mbtiles) as con:
            result=con.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",(z,x,y_tms)).fetchone()
        if not result:return None
        mime={"png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","webp":"image/webp"}[meta["format"]]
        return result[0],mime

    def status(self):
        supplies = self.store.one("SELECT COUNT(*) AS n, SUM(CASE WHEN quantity<minimum THEN 1 ELSE 0 END) AS low FROM supplies")
        pending = self.store.one("SELECT COUNT(*) AS n FROM messages WHERE direction='outgoing' AND status='queued-for-radio'")
        manual_review = self.store.one("SELECT COUNT(*) AS n FROM messages WHERE direction='outgoing' "
                                       "AND status IN ('requires-manual-review','failed-transmission-uncertain','release-expired')")
        return {"name":"BLACKBOX + GHOSTLINK", "version":VERSION,"offline_first":True,
                "database":"online", "uptime_seconds":int(time.monotonic()-self.started),
                "radio":{"enabled":self.radio_enabled,"state":self.radio_state,"error":self.radio_error,
                         "capability":"not verified on physical hardware"},
                "home_assistant":{"configured":bool(self.ha_url and self.ha_token),"mode":"read-only"},
                "assistant":{"local_model_configured":bool(self.model),"search_available":True},
                "maps":{**self.map_metadata(), "gps_receiver_connected":False},
                "inventory":{"items":supplies["n"],"below_minimum":supplies["low"] or 0},
                "pending_radio_messages":pending["n"],
                "messages_needing_manual_review":manual_review["n"], "timestamp":UTC()}

    def read_homeassistant(self):
        if not self.ha_url or not self.ha_token:
            return {"configured":False,"entities":[],"message":"Set BLACKBOX_HA_URL and BLACKBOX_HA_TOKEN to enable read-only access."}
        parsed = urllib.parse.urlsplit(self.ha_url)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname or
            parsed.username or parsed.password or parsed.path not in ("", "/") or
            parsed.query or parsed.fragment or parsed.port == 0):
            raise ValueError("Invalid Home Assistant endpoint")
        # A host's apparent .local / .lan name can resolve (or rebind) to a public
        # address. Require an explicit private numeric address or 'localhost'.
        if parsed.hostname != "localhost":
            try:
                addr = ipaddress.ip_address(parsed.hostname)
            except ValueError:
                raise ValueError("Use a private IP address or localhost for Home Assistant") from None
            if not (addr.is_private or addr.is_loopback or addr.is_link_local):
                raise ValueError("Home Assistant host must be on a private local network")
        class RejectRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, request, fp, code, msg, headers, newurl):
                return None
        # Do not inherit HTTP_PROXY and never follow a redirect with the HA token.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect())
        url = self.ha_url.rstrip("/") + "/api/states"
        req = urllib.request.Request(url,headers={"Authorization":"Bearer " + self.ha_token})
        with opener.open(req,timeout=5) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError("Home Assistant response exceeds 1 MB limit")
        data = json.loads(raw)
        if not isinstance(data,list):
            raise ValueError("Home Assistant returned unexpected data")
        domains = ("sensor.","binary_sensor.","switch.","light.","climate.","person.","device_tracker.")
        entities=[]
        for x in data:
            if not isinstance(x,dict): continue
            entity_id=x.get("entity_id")
            if not isinstance(entity_id,str) or not entity_id.startswith(domains): continue
            attributes=x.get("attributes")
            if not isinstance(attributes,dict): attributes={}
            entities.append({"entity_id":entity_id,"state":x.get("state"),
                             "name":attributes.get("friendly_name",entity_id)})
            if len(entities)>=250: break
        return {"configured":True,"entities":entities,"read_only":True}

    def assist(self, question, use_model=False):
        question = bad_text(question,"Question",500)
        docs = self.store.search_knowledge(question,6)
        if not use_model:
            return {"mode":"offline-search","sources":[{"slug":x["slug"],"title":x["title"]} for x in docs],"results":docs,
                    "answer":"Search results from locally indexed reference files. No AI inference performed."}
        if not self.model:
            raise ValueError("Local Ollama model not configured; search works without it")
        context = '\n\n'.join(f'[{d["slug"]}] {d["body"][:1500]}' for d in docs) or "No matching local references."
        payload = json.dumps({"model":self.model,"stream":False,
                "prompt":"You are an offline reference assistant. Only cite the supplied references. "
                          "State uncertainties; never invent procedures or claim to be emergency services. "
                          "If not supported by references, say so.\n\nReferences:\n"+context+"\n\nQuestion: "+question,
                "options":{"temperature":0.2,"num_predict":400}}).encode()
        req = urllib.request.Request("http://127.0.0.1:11434/api/generate",data=payload,
                                     headers={"Content-Type":"application/json"})
        with urllib.request.urlopen(req,timeout=90) as response:
            result=json.loads(response.read(1_000_000))
        return {"mode":"local-ollama","answer":str(result.get("response", ""))[:5000],
                "sources":[{"slug":x["slug"],"title":x["title"]} for x in docs],
                "warning":"Model output is not verified emergency or medical guidance."}


def handler_factory():
    class Handler(BaseHTTPRequestHandler):
        server_version = "Blackbox/" + VERSION
        def _send(self, code, data, ctype="application/json", filename=None):
            content = json.dumps(data,ensure_ascii=False,allow_nan=False).encode("utf-8") if ctype=="application/json" else data
            if isinstance(content,str): content=content.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type",ctype + ("; charset=utf-8" if ctype.startswith(("text/","application/json","application/javascript")) else ""))
            self.send_header("Content-Length",str(len(content)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("X-Frame-Options","DENY")
            self.send_header("X-Permitted-Cross-Domain-Policies","none")
            self.send_header("Content-Security-Policy","default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
            if filename: self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
            self.end_headers()
            try:self.wfile.write(content)
            except (BrokenPipeError,ConnectionResetError): pass

        def _json(self):
            try: n=int(self.headers.get("Content-Length", "0"))
            except ValueError: raise ValueError("Invalid content length") from None
            if not 0<n<=MAX_BODY: raise ValueError("JSON body required (maximum 64 KiB)")
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise ValueError("Content-Type must be application/json")
            try: data=json.loads(self.rfile.read(n))
            except (UnicodeDecodeError,ValueError): raise ValueError("Invalid JSON") from None
            if not isinstance(data,dict): raise ValueError("JSON object required")
            return data

        def _authorised(self, telemetry=False):
            app=self.server.app
            expected = app.node_key if telemetry else app.token
            if telemetry and not expected: return False
            if not expected: return True
            value = self.headers.get("X-Node-Key", "") if telemetry else self.headers.get("Authorization", "").removeprefix("Bearer ")
            return hmac.compare_digest(value,expected)

        def _require(self,telemetry=False):
            if self._authorised(telemetry):return True
            self._send(401,{"error":"Node key required" if telemetry else "Access token required"})
            return False

        def do_GET(self):
            p=urllib.parse.urlsplit(self.path)
            path=p.path
            if path in ("/","/index.html","/app.js","/style.css","/manifest.webmanifest","/icon.svg"):
                name="index.html" if path=="/" else path[1:]
                target=ROOT/name
                if not target.is_file():return self._send(404,{"error":"Not found"})
                typ={".html":"text/html",".js":"application/javascript",".css":"text/css",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"}.get(target.suffix,"application/octet-stream")
                return self._send(200,target.read_bytes(),typ)
            if path=="/api/health":return self._send(200,{"ok":True,"version":VERSION})
            if not path.startswith("/api/"): return self._send(404,{"error":"Not found"})
            if not self._require(): return
            app=self.server.app
            db=app.store
            try:
                if path=="/api/status":return self._send(200,app.status())
                tile_match=re.fullmatch(r"/api/tiles/(\d+)/(\d+)/(\d+)\.(?:png|jpg|webp)",path)
                if tile_match:
                    tile=app.read_tile(*(int(t) for t in tile_match.groups()))
                    return self._send(200,tile[0],tile[1]) if tile else self._send(404,{"error":"Tile not in offline map"})
                if path=="/api/checklist":return self._send(200,db.query("SELECT id,title,checked,checked_at FROM checklist ORDER BY id"))
                if path=="/api/supplies":return self._send(200,db.query("SELECT * FROM supplies ORDER BY name COLLATE NOCASE,id"))
                if path=="/api/notes":return self._send(200,db.query("SELECT * FROM notes ORDER BY id DESC LIMIT 500"))
                if path=="/api/messages":return self._send(200,db.query("SELECT * FROM messages ORDER BY id DESC LIMIT 500"))
                if path=="/api/knowledge":return self._send(200,db.query("SELECT slug,title,substr(body,1,300) AS summary FROM knowledge ORDER BY title"))
                if path=="/api/knowledge/search":
                    q=urllib.parse.parse_qs(p.query).get("q",[""])[0]
                    return self._send(200,db.search_knowledge(q) if q.strip() else [])
                if path.startswith("/api/knowledge/"):
                    slug=path.split("/")[-1]
                    doc=db.one("SELECT slug,title,body FROM knowledge WHERE slug=?",(slug,))
                    return self._send(200,doc) if doc else self._send(404,{"error":"Not found"})
                if path=="/api/waypoints":return self._send(200,db.query("SELECT * FROM waypoints ORDER BY id DESC"))
                if path=="/api/waypoints.geojson":return self._send(200,build_geojson(db.query("SELECT * FROM waypoints ORDER BY id")))
                if path=="/api/waypoints.gpx":return self._send(200,build_gpx(db.query("SELECT * FROM waypoints ORDER BY id")),"application/gpx+xml","blackbox-waypoints.gpx")
                if path=="/api/telemetry":
                    result=db.latest_nodes()
                    return self._send(200,[{"node_id":x["node_id"],"captured":x["captured"],"values":json.loads(x["values_json"])} for x in result])
                if path=="/api/events":return self._send(200,db.query("SELECT * FROM events ORDER BY id DESC LIMIT 200"))
                if path=="/api/homeassistant":return self._send(200,app.read_homeassistant())
                if path=="/api/field-report":
                    return self._send(200,field_report(db,app.status()),"text/html","blackbox-field-report.html")
                if path=="/api/backup":
                    with tempfile.TemporaryDirectory() as tmp:
                        bak=db.backup(Path(tmp)/"blackbox.sqlite3")
                        return self._send(200,bak.read_bytes(),"application/octet-stream","blackbox-backup.sqlite3")
                return self._send(404,{"error":"Not found"})
            except ValueError as error:
                return self._send(400,{"error":str(error)[:250]})
            except (urllib.error.URLError,TimeoutError) as error:
                return self._send(502,{"error":str(error)[:250]})
            except sqlite3.DatabaseError:
                return self._send(500,{"error":"Database error"})

        def do_POST(self):
            path=urllib.parse.urlsplit(self.path).path
            is_node=path=="/api/telemetry"
            if not self._require(is_node):return
            app=self.server.app
            db=app.store
            try:
                x=self._json()
                if path=="/api/power/estimate":return self._send(200,estimate_power(x))
                if path=="/api/supplies":
                    s=validate_supply(x)
                    _,_=db.execute("INSERT INTO supplies(name,quantity,unit,minimum,expiry,notes) VALUES(?,?,?,?,?,?)",
                        (s["name"],s["quantity"],s.get("unit","units"),s.get("minimum",0),s.get("expiry",""),s.get("notes","")))
                    db.event("inventory","Supply added: "+s["name"])
                    return self._send(201,{"ok":True})
                if path=="/api/notes":
                    title=bad_text(x.get("title"),"Title",120)
                    body=bad_text(x.get("body"),"Body",12000)
                    db.execute("INSERT INTO notes(title,body) VALUES(?,?)",(title,body))
                    return self._send(201,{"ok":True})
                if path=="/api/messages":
                    dest=bad_text(x.get("recipient"),"Recipient",15)
                    if not SAFE_RECIPIENT.fullmatch(dest):raise ValueError("Recipient must be broadcast or ! followed by eight hex digits")
                    body=bad_text(x.get("body"),"Message",200)
                    if len(body.encode("utf-8"))>180:raise ValueError("Message exceeds conservative 180-byte LoRa limit")
                    i,_=db.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES(?,?,?,?,?)",
                                   ("outgoing","BLACKBOX",dest,body,"local-only"))
                    return self._send(201,{"id":i,"status":"local-only","transmitted":False})
                if path.startswith("/api/messages/") and path.endswith("/release"):
                    item_id=int(path.split("/")[3])
                    if not app.radio_enabled:raise ValueError("Enable radio bridge before releasing messages")
                    if app.radio_state!="serial-connected-not-range-tested":
                        raise ValueError("Radio serial link must be connected before release")
                    _,updated=db.execute("UPDATE messages SET status='queued-for-radio',error='',released_at=? WHERE id=? AND direction='outgoing' AND status IN ('local-only','failed','failed-transmission-uncertain','requires-manual-review','release-expired')",(UTC(),item_id))
                    return self._send(200,{"queued_for_radio":bool(updated)})
                if path=="/api/waypoints":
                    name=bad_text(x.get("name"),"Name",120)
                    lat=safe_number(x.get("latitude"),"Latitude",-90,90)
                    lon=safe_number(x.get("longitude"),"Longitude",-180,180)
                    cat=bad_text(x.get("category","location"),"Category",40)
                    notes=bad_text(x.get("notes", ""),"Notes",1000,allow_empty=True)
                    db.execute("INSERT INTO waypoints(name,latitude,longitude,category,notes) VALUES(?,?,?,?,?)",(name,lat,lon,cat,notes))
                    return self._send(201,{"ok":True})
                if path=="/api/telemetry":
                    node=bad_text(x.get("node_id"),"Node ID",64)
                    if not re.fullmatch(r"[A-Za-z0-9_-]+",node):raise ValueError("Node ID contains invalid characters")
                    values=x.get("values")
                    if not isinstance(values,dict) or not values or len(values)>24:raise ValueError("values must be a small object")
                    checked={}
                    for key,val in values.items():
                        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,39}",key):raise ValueError("Invalid metric name")
                        checked[key]=safe_number(val,key,-1e12,1e12)
                    db.execute("INSERT INTO telemetry(node_id,captured,values_json) VALUES(?,?,?)",(node,UTC(),json.dumps(checked)))
                    db.execute("DELETE FROM telemetry WHERE id NOT IN (SELECT id FROM telemetry ORDER BY id DESC LIMIT 10000)")
                    return self._send(201,{"ok":True,"node_id":node})
                if path=="/api/assistant":
                    use_model=x.get("use_model",False)
                    if type(use_model) is not bool:raise ValueError("use_model must be boolean")
                    return self._send(200,app.assist(x.get("question"),use_model))
                return self._send(404,{"error":"Not found"})
            except (TypeError,ValueError) as error:
                return self._send(400,{"error":str(error)[:250]})
            except (urllib.error.URLError,TimeoutError) as error:
                return self._send(502,{"error":"Local model unreachable: "+str(error)[:150]})
            except sqlite3.DatabaseError:
                return self._send(500,{"error":"Database error"})

        def do_PATCH(self):
            path=urllib.parse.urlsplit(self.path).path
            if not self._require():return
            check=re.fullmatch(r"/api/checklist/(\d+)",path)
            if check:
                try:
                    obj=self._json()
                    if type(obj.get("checked")) is not bool:raise ValueError("checked must be boolean")
                    value=int(obj["checked"])
                    _,count=self.server.app.store.execute(
                        "UPDATE checklist SET checked=?,checked_at=? WHERE id=?",
                        (value,UTC() if value else "",int(check.group(1))))
                    if not count:return self._send(404,{"error":"Not found"})
                    return self._send(200,{"updated":True})
                except (ValueError,TypeError) as error:return self._send(400,{"error":str(error)})
            m=re.fullmatch(r"/api/supplies/(\d+)",path)
            if not m:return self._send(404,{"error":"Not found"})
            try:
                obj=validate_supply(self._json(),True)
                if not obj:raise ValueError("No fields to update")
                sql="UPDATE supplies SET "+", ".join(k+"=?" for k in obj)+" WHERE id=?"
                _,count=self.server.app.store.execute(sql,tuple(obj.values())+(int(m.group(1)),))
                if not count:return self._send(404,{"error":"Not found"})
                return self._send(200,{"updated":True})
            except (ValueError,TypeError) as error:return self._send(400,{"error":str(error)})

        def do_DELETE(self):
            if not self._require():return
            m=re.fullmatch(r"/api/(supplies|notes|messages|waypoints)/(\d+)",urllib.parse.urlsplit(self.path).path)
            if not m:return self._send(404,{"error":"Not found"})
            table, ident=m.groups()
            _,count=self.server.app.store.execute("DELETE FROM "+table+" WHERE id=?",(int(ident),))
            return self._send(200,{"deleted":bool(count)})

        def log_message(self, fmt, *args):
            # Omit raw URLs and bearer token to reduce sensitive log leakage.
            if os.environ.get("BLACKBOX_DEBUG")=="1": super().log_message(fmt,*args)
    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=True
    def __init__(self,addr,app):
        self.app=app
        super().__init__(addr,handler_factory())


def serve(app,host="127.0.0.1",port=8765):
    if host not in ("127.0.0.1","::1","localhost") and (not app.token or len(app.token)<24):
        raise ValueError("LAN mode requires BLACKBOX_TOKEN of at least 24 characters")
    server=Server((host,port),app)
    if app.radio_enabled:
        from radio_bridge import RadioWorker
        app.worker=RadioWorker(app)
        app.worker.start()
    try:
        print(f"BLACKBOX {VERSION} listening at http://{host}:{server.server_address[1]}",flush=True)
        server.serve_forever()
    finally:
        server.server_close()
        if app.worker:app.worker.stop()


def main(argv=None):
    argv=list(sys.argv[1:] if argv is None else argv)
    app=Blackbox()
    if argv and argv[0]=="reindex":
        app.store.index_knowledge();print("Offline knowledge indexed");return 0
    if argv and argv[0]=="backup":
        if len(argv)!=2:print("Usage: python3 app.py backup /safe/path/backup.sqlite3",file=sys.stderr);return 2
        print(app.store.backup(argv[1]));return 0
    if argv and argv[0]=="check":
        print(json.dumps(app.status(),indent=2));return 0
    if argv:
        print("Usage: python3 app.py [check|reindex|backup FILE]",file=sys.stderr);return 2
    try:serve(app,os.environ.get("BLACKBOX_HOST","127.0.0.1"),int(os.environ.get("BLACKBOX_PORT","8765")))
    except (ValueError,OSError) as error:
        print("Startup blocked:",error,file=sys.stderr);return 1
    return 0

if __name__=="__main__":sys.exit(main())
