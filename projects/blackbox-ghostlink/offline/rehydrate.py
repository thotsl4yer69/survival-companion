#!/usr/bin/env python3
"""Safely reconstruct and extract large, split, SHA-256-checked field packs.

Use only packs produced by this project from trusted GitHub release assets.
No external network, shell commands, dynamic imports or arbitrary symlinks.
"""
from __future__ import annotations
import argparse
import hashlib
import os
import re
import tarfile
from pathlib import Path

BUF=1024*1024


def checksum(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(BUF),b''):
            digest.update(chunk)
    return digest.hexdigest()


def assemble(parts,output,sha_file):
    output=Path(output).resolve()
    if not parts:raise ValueError('At least one part is required')
    # Splits produced by GNU split with fixed-width numeric suffixes.
    files=[Path(p).resolve() for p in parts]
    if len(set(files))!=len(files):raise ValueError('Duplicate input parts')
    if any(not f.is_file() or f.is_symlink() for f in files):
        raise ValueError('An input part is absent or symbolic')
    names=[f.name for f in files]
    if len(files)>1:
        suffixes=[re.search(r'\.part-(\d+)$',x) for x in names]
        if any(x is None for x in suffixes):raise ValueError('Expected numbered .part-NN files')
        nums=[int(x.group(1)) for x in suffixes]
        if nums!=list(range(1,len(files)+1)):
            raise ValueError('Split data must be supplied in ascending contiguous order starting at 01')
    if output in files or output.exists():raise ValueError('Refusing to overwrite input or existing output')
    sha_line=Path(sha_file).read_text(encoding='utf-8').strip().splitlines()
    if len(sha_line)!=1:raise ValueError('Expected one SHA-256 line')
    m=re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)',sha_line[0])
    if not m or m.group(2)!=output.name:raise ValueError('SHA-256 filename does not match intended output')
    output.parent.mkdir(parents=True,exist_ok=True)
    part=output.with_suffix(output.suffix+'.partial')
    if part.exists():raise ValueError('Partial output exists; inspect before retrying')
    sha=hashlib.sha256()
    try:
        with part.open('xb') as dest:
            for f in files:
                with f.open('rb') as source:
                    while True:
                        chunk=source.read(BUF)
                        if not chunk:break
                        sha.update(chunk);dest.write(chunk)
            dest.flush();os.fsync(dest.fileno())
        if sha.hexdigest()!=m.group(1):
            raise ValueError('Field pack SHA-256 DOES NOT MATCH; refusing to use corrupted data')
        part.rename(output)
    finally:
        if part.exists():part.unlink()
    return output


def safe_extract(archive,dest):
    archive=Path(archive).resolve();dest=Path(dest).resolve()
    if not archive.is_file():raise FileNotFoundError(archive)
    # Validate all member paths, types and duplicates before writing ANY data.
    with tarfile.open(archive,'r') as tar:
        entries=tar.getmembers();seen=set()
        for member in entries:
            rel=Path(member.name)
            if (not member.isfile() or member.issym() or member.islnk() or
                len(rel.parts)<2 or rel.parts[0]!='assets' or
                rel.is_absolute() or any(c in ('..','.','') for c in rel.parts) or
                member.name in seen):
                raise ValueError('Refusing unsafe or duplicate archive entry: '+member.name)
            seen.add(member.name)
        if dest.exists() and any(dest.iterdir()):
            raise ValueError('Extraction destination must be empty to prevent overwrites')
        dest.mkdir(parents=True,exist_ok=True)
        for member in entries:
            path=dest/member.name
            if not path.resolve().is_relative_to(dest):
                raise ValueError('Archive path leaves destination')
            path.parent.mkdir(parents=True,exist_ok=True)
            with tar.extractfile(member) as src, path.open('xb') as out:
                for chunk in iter(lambda:src.read(BUF),b''):
                    out.write(chunk)
    return len(entries)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--part',action='append',required=True,help='One or more ordered parts; single whole TAR is also supported')
    p.add_argument('--output',required=True,help='Full TAR filename expected by .sha256')
    p.add_argument('--sha256',required=True,help='Field pack .tar.sha256 file')
    p.add_argument('--extract-to',required=True)
    args=p.parse_args(argv)
    tarfile_path=assemble(args.part,args.output,args.sha256)
    count=safe_extract(tarfile_path,args.extract_to)
    print(f'EXTRACTED {count} validated TAR entries to {args.extract_to}')
    print('Next: python3 offline/prepare.py verify --profile bendigo --dir '+str(Path(args.extract_to)/'assets'))
    return 0

if __name__=='__main__':raise SystemExit(main())
