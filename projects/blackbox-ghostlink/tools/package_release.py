#!/usr/bin/env python3
"""Create a traceable, self-verifying, offline BLACKBOX release ZIP.

Excludes private state, secrets and build caches. No network or third-party libs.
"""
from __future__ import annotations
import hashlib
import sys
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ALLOWED_EXT={'.md','.py','.js','.css','.html','.svg','.webmanifest','.service','.stl','.scad','.sh','.ino','.h','.png','.example','.gitignore'}
EXCLUDED_DIRS={'__pycache__','.git','.pytest_cache','.venv','.mypy_cache'}
EXCLUDED_NAMES={'secrets.h','.env','blackbox.sqlite3','SHA256SUMS','dashboard_preview.png','dashboard_mobile_preview.png'}
EXCLUDED_SUFFIXES={'.sqlite3','.pyc','.bak','.swp','.zip'}


def files_to_package():
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file() or p.is_symlink():continue
        if any(part in EXCLUDED_DIRS for part in p.relative_to(ROOT).parts):continue
        if p.name in EXCLUDED_NAMES or p.suffix in EXCLUDED_SUFFIXES:continue
        if p.suffix not in ALLOWED_EXT and p.name not in {'.gitignore'}:
            raise ValueError(f'Unexpected release file: {p.relative_to(ROOT)}')
        yield p


def create(output):
    output=Path(output).resolve()
    if output.is_relative_to(ROOT):raise ValueError('Output must be outside source root')
    inputs=list(files_to_package())
    hashes=['%s  %s' % (hashlib.sha256(p.read_bytes()).hexdigest(),p.relative_to(ROOT).as_posix()) for p in inputs]
    manifest='\n'.join(hashes)+'\n'
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in inputs:
            z.write(p,arcname='blackbox_ghostlink/'+p.relative_to(ROOT).as_posix())
        z.writestr('blackbox_ghostlink/SHA256SUMS',manifest)
    with zipfile.ZipFile(output) as z:
        bad=z.testzip()
        if bad:raise IOError('Corrupt archive member: '+bad)
        if len(z.infolist())!=len(inputs)+1:raise IOError('Archive entry count mismatch')
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix+'.sha256').write_text(f'{digest}  {output.name}\n',encoding='utf-8')
    print(f'Built {output.name}: {len(inputs)+1} files, {output.stat().st_size} bytes, SHA256 {digest}')
    return output

if __name__=='__main__':
    if len(sys.argv)!=2:
        print('Usage: python3 tools/package_release.py /absolute/path/BLACKBOX_GHOSTLINK_v0.3.0.zip',file=sys.stderr)
        sys.exit(2)
    create(sys.argv[1])
