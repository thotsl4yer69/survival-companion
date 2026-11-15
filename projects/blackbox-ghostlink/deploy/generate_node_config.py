#!/usr/bin/env python3
"""Generate private ESP32 configuration and a matching BLACKBOX_NODE_KEY.

Run locally before building firmware. Never commit generated secrets.h.
"""
import argparse
import ipaddress
import json
import secrets
from pathlib import Path


def c_literal(value):
    return json.dumps(value,ensure_ascii=True)


def run():
    parser=argparse.ArgumentParser(description='Create BLACKBOX ESP32-S3 private secrets.h')
    parser.add_argument('--ssid',required=True)
    parser.add_argument('--wifi-password',required=True)
    parser.add_argument('--server',required=True,help='BLACKBOX server private IPv4 address on the same trusted LAN')
    parser.add_argument('--node-id',default='esp32s3-field-01')
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'firmware'/'esp32s3-node'/'secrets.h')
    parser.add_argument('--force',action='store_true',help='Overwrite a previous generated config')
    args=parser.parse_args()
    server=ipaddress.ip_address(args.server)
    if server.version!=4 or not server.is_private or server.is_loopback:
        parser.error('--server must be an actual private LAN IPv4 address accessible by the ESP32')
    if not args.ssid or not args.wifi_password:
        parser.error('Wi-Fi credentials must be provided')
    if not args.node_id.replace('_','').replace('-','').isalnum():
        parser.error('--node-id should use letters, digits, - or _ only')
    if args.output.exists() and not args.force:
        parser.error('Secrets file exists; use --force to replace it')
    key=secrets.token_urlsafe(32)
    values={'BLACKBOX_WIFI_SSID':args.ssid,'BLACKBOX_WIFI_PASSWORD':args.wifi_password,
            'BLACKBOX_SERVER_URL':f'http://{args.server}:8765/api/telemetry',
            'BLACKBOX_NODE_KEY':key,'BLACKBOX_NODE_ID':args.node_id}
    contents='#pragma once\n// Generated locally; DO NOT commit this file.\n'+''.join(
        f'#define {name} {c_literal(value)}\n' for name,value in values.items())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(contents,encoding='utf-8')
    args.output.chmod(0o600)
    print(f'Wrote {args.output} (mode 0600)')
    print('Add the following to BLACKBOX server environment file, then restart service:')
    print('BLACKBOX_NODE_KEY='+key)
    print('Transport is HTTP on a trusted LAN only, not encrypted. Prefer an isolated network.')

if __name__=='__main__':run()
