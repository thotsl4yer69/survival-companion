#!/usr/bin/env python3
"""Verify every file in an extracted release against bundled SHA-256 hashes."""
from __future__ import annotations
import hashlib
import re
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def verify(root=ROOT):
    root=Path(root).resolve()
    manifest=(root/'SHA256SUMS').read_text(encoding='utf-8')
    errors=[]
    observed=set()
    for line in manifest.splitlines():
        if not line.strip():continue
        m=re.fullmatch(r'([0-9a-f]{64})  ([^\n\r]+)',line)
        if not m:
            errors.append('Malformed manifest entry');continue
        digest,relative=m.groups()
        candidate=(root/relative).resolve()
        if not candidate.is_relative_to(root) or candidate==root or relative in observed:
            errors.append('Invalid path in manifest: '+relative);continue
        observed.add(relative)
        if not candidate.is_file():
            errors.append('Missing '+relative);continue
        if hashlib.sha256(candidate.read_bytes()).hexdigest()!=digest:
            errors.append('Modified '+relative)
    return len(observed),errors

if __name__=='__main__':
    try:total,errors=verify()
    except (OSError,ValueError) as exc:
        print('Verification failed:',exc,file=sys.stderr);sys.exit(1)
    if errors:
        for e in errors:print('FAIL:',e,file=sys.stderr)
        sys.exit(1)
    print(f'PASS: {total} extracted files match the bundled SHA256SUMS')
