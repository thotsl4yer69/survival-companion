#!/usr/bin/env python3
"""Read-only BLACKBOX host capabilities probe. No external networking.

Use on Jetson or Raspberry Pi to record real local configuration before wiring.
Reports unavailable rather than generating simulated measurements.
"""
from __future__ import annotations
import importlib.util
import json
import os
import platform
import shutil
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path


def read_first(path,maxlen=300):
    try:
        return Path(path).read_bytes()[:maxlen].replace(b'\x00',b' ').decode('utf-8',errors='replace').strip()
    except (OSError,PermissionError):
        return None


def available_serial():
    result=[]
    for pat in ('/dev/serial/by-id/*','/dev/ttyUSB*','/dev/ttyACM*'):
        for item in sorted(Path('/').glob(pat.lstrip('/'))):
            candidate=str(item)
            if candidate not in result:result.append(candidate)
    return result


def mem_total_bytes():
    data=read_first('/proc/meminfo',10000)
    if not data:return None
    for line in data.splitlines():
        if line.startswith('MemTotal:'):
            return int(line.split()[1])*1024
    return None


def local_ollama():
    # Host is hardcoded to loopback: never scans external networks.
    request=urllib.request.Request('http://127.0.0.1:11434/api/tags')
    try:
        with urllib.request.urlopen(request,timeout=1.5) as response:
            data=json.loads(response.read(300000))
            models=data.get('models',[]) if isinstance(data,dict) else []
            return {'reachable':True,'installed_models':[str(m.get('name')) for m in models if isinstance(m,dict)]}
    except (OSError,ValueError,urllib.error.URLError):
        return {'reachable':False,'installed_models':[]}


def probe():
    try:
        target=Path(os.environ.get('BLACKBOX_DB',Path.home()/'blackbox.sqlite3')).expanduser().resolve()
        usage=shutil.disk_usage(target.parent if target.parent.exists() else Path.home())
        disk={'free_bytes':usage.free,'total_bytes':usage.total}
    except (ValueError,OSError):disk={'free_bytes':None,'total_bytes':None}
    return {
        'hostname':socket.gethostname(),
        'os':platform.platform(),
        'architecture':platform.machine(),
        'python':platform.python_version(),
        'jetson_board_model':read_first('/proc/device-tree/model'),
        'jetson_release':read_first('/etc/nv_tegra_release'),
        'memory_total_bytes':mem_total_bytes(),
        'disk':disk,
        'serial_candidates_not_verified':available_serial(),
        'meshtastic_python_installed':bool(importlib.util.find_spec('meshtastic')),
        'ollama_loopback':local_ollama(),
        'database_path':str(target),
        'disclaimer':'USB candidates do not prove LoRa hardware, and locally available models do not prove GPU acceleration.'
    }


if __name__=='__main__':
    print(json.dumps(probe(),indent=2,ensure_ascii=False))
