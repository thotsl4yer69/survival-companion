#!/usr/bin/env python3
"""Activate a verified offline pack without accessing any external network.

Uses installed Ollama and Kiwix binaries. Never automatically installs packages,
transmits radio, overwrites system credentials, or modifies the Jetson service.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from prepare import read_catalog,verify_manifest
except ModuleNotFoundError:
    from offline.prepare import read_catalog,verify_manifest

MODEL='blackbox-qwen2.5:1.5b'

def plan(assets,*,check=True):
    root=Path(assets).expanduser().resolve()
    manifest=json.loads((root/'asset-manifest.json').read_text(encoding='utf-8'))
    if check:verify_manifest(root,manifest)
    model=root/'models/qwen2.5-1.5b-instruct-q4_k_m.gguf'
    zim=root/'library/wikipedia_en_top_mini_2026-09.zim'
    tile=root/'maps/bendigo-raster.mbtiles'
    runtime_files={
        'ollama_jetpack5':str(root/'runtimes/ollama-linux-arm64-jetpack5-v0.34.0.tar.zst'),
        'ollama_jetpack6':str(root/'runtimes/ollama-linux-arm64-jetpack6-v0.34.0.tar.zst'),
        'kiwix_aarch64':str(root/'runtimes/kiwix-tools_linux-aarch64-3.8.2.tar.gz')}
    return {'root':str(root),'model':str(model),'model_name':MODEL,'bundled_runtime_archives':runtime_files,
            'zim':str(zim),'raster_mbtiles':str(tile),
            'has_kiwix_binary':bool(shutil.which('kiwix-serve')),
            'has_ollama_binary':bool(shutil.which('ollama')),
            'has_map_file':tile.is_file(),
            'instructions':[
                'Verified Ollama JetPack 5/6 and Kiwix AArch64 runtime archives are included; select only the archive matching the actual JetPack release.',
                'Extract trusted native runtime archives into a controlled local directory before activation; ensure native shared libraries resolve.',
                'Run this command with --import-model on the host where Ollama is already running to import the local GGUF.',
                'Set BLACKBOX_OLLAMA_MODEL='+MODEL+' in the BLACKBOX service environment.',
                'Set BLACKBOX_MBTILES='+str(tile)+' if the generated map exists and is readable by the BLACKBOX service.',
                'To browse the ZIM, run kiwix-serve --address=127.0.0.1 --port=8790 '+str(zim)+' on the local host.',
                'Do not enable unattended radio transmission; actual RF hardware remains untested.'
            ]}


def import_model(asset_root,*,binary='ollama'):
    item=plan(asset_root)
    if not item['has_ollama_binary'] and binary=='ollama':
        raise RuntimeError('Ollama is not installed; install/copy its ARM64 runtime while online')
    # temporary Modelfile must outlive the subprocess; CLI targets the local
    # Ollama server and may fail when it is not running (never claims success).
    with tempfile.TemporaryDirectory(prefix='blackbox-model-') as tmp:
        modelfile=Path(tmp)/'Modelfile'
        # Paths must not contain newlines or quotes in Ollama Modelfile syntax.
        model_path=item['model']
        if any(c in model_path for c in ('\n','\r','"')):
            raise ValueError('Unsupported model directory path')
        modelfile.write_text(f'FROM "{model_path}"\nPARAMETER temperature 0.2\n',encoding='utf-8')
        subprocess.run([binary,'create',MODEL,'-f',str(modelfile)],check=True)
    return MODEL


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assets',default='offline_assets')
    p.add_argument('--import-model',action='store_true')
    args=p.parse_args(argv)
    info=plan(args.assets)
    print(json.dumps(info,indent=2))
    if args.import_model:
        import_model(args.assets)
        print('MODEL IMPORTED: local Ollama creation returned success')
    return 0

if __name__=='__main__':raise SystemExit(main())
