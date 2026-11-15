#!/usr/bin/env python3
"""Build a *genuinely provisioned* portable offline data pack.

Only downloaded, locally validated assets are marked present. A package with
missing assets never reports ready. Network access is required only for fetch.
The manifest records actual byte counts and SHA-256, not invented digests.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CATALOG = Path(__file__).with_name('catalog.json')
CHUNK = 1024 * 1024
MAX_CHUNK = 8 * 1024 * 1024


def read_catalog(path=CATALOG):
    catalog=json.loads(Path(path).read_text(encoding='utf-8'))
    if catalog.get('schema') != 1:
        raise ValueError('Unsupported catalog version')
    for key, asset in catalog['sources'].items():
        url=urllib.parse.urlparse(asset['url'])
        if url.scheme!='https' or not url.hostname or url.username or url.password:
            raise ValueError(f'Insecure source URL for {key}')
        safe_relpath(asset['filename'])
        if asset['minimum_bytes'] < 1:
            raise ValueError('Minimum byte count must be positive')
        expected=asset.get('expected_sha256')
        if expected and (len(expected)!=64 or any(c not in '0123456789abcdef' for c in expected)):
            raise ValueError('Invalid trusted upstream SHA256 in catalog')
        sig=bytes.fromhex(asset['signature_hex'])
        if len(sig)>16:
            raise ValueError('Signature is unexpectedly long')
    for profile, keys in catalog['profiles'].items():
        if not isinstance(keys,list) or not keys or len(set(keys))!=len(keys):
            raise ValueError('Invalid or empty asset profile')
        if any(k not in catalog['sources'] for k in keys):
            raise ValueError(f'Unknown asset in {profile}')
    return catalog


def safe_relpath(value):
    if not isinstance(value,str) or '\\' in value or value.startswith('/'):
        raise ValueError('Unsafe relative asset name')
    p=Path(value)
    if not value or value=='.' or any(x in ('..','.','') for x in p.parts) or p.is_absolute() or str(p)!=value:
        raise ValueError('Unsafe relative asset name')
    return p


def sha256_file(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for part in iter(lambda:f.read(CHUNK),b''):
            h.update(part)
    return h.hexdigest()


def validate_asset(path, asset):
    path=Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError(f'Asset is missing or not a regular file: {path}')
    st=path.stat()
    if st.st_size < asset['minimum_bytes']:
        raise ValueError(f'Asset too small: {path.name}: {st.st_size} bytes')
    magic=bytes.fromhex(asset['signature_hex'])
    if magic:
        with path.open('rb') as f:
            if f.read(len(magic)) != magic:
                raise ValueError(f'Invalid file signature: {path.name}')
    digest=sha256_file(path)
    if asset.get('expected_sha256') and digest!=asset['expected_sha256']:
        raise ValueError(f'Asset SHA256 differs from trusted upstream release: {path.name}')
    return {'size':st.st_size,'sha256':digest}


class HttpsRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Kiwix/Geofabrik can redirect to changing mirrors; reject any http
        # downgrade and URLs containing auth credentials.
        parsed=urllib.parse.urlparse(newurl)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Refused insecure asset redirect')
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def fetch_one(name, asset, root, *, opener=None):
    dest=root/safe_relpath(asset['filename'])
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.is_symlink():
        raise ValueError('Asset target cannot be a symlink')
    if dest.exists():
        try:
            result=validate_asset(dest,asset)
            print(f'EXISTS {name}: {result["size"]:,} bytes; SHA256 {result["sha256"]}')
            return result
        except ValueError:
            raise ValueError(f'Existing asset {dest} is invalid; inspect it manually before retrying') from None
    open_url=opener or urllib.request.build_opener(HttpsRedirects())
    part=dest.with_suffix(dest.suffix+'.partial')
    if part.is_symlink():
        raise ValueError('Temporary asset cannot be a symlink')
    # Do not resume an unvalidated partial download: server content may have changed.
    if part.exists():
        part.unlink()
    request=urllib.request.Request(asset['url'],headers={'User-Agent':'MAZLABZ-Blackbox-offline-prep/1.0'})
    try:
        with open_url.open(request,timeout=45) as response, part.open('xb') as f:
            code=getattr(response,'status',200)
            if code != 200:
                raise ValueError(f'Download failed (HTTP {code})')
            final_url=getattr(response,'url',asset['url'])
            if urllib.parse.urlparse(final_url).scheme!='https':
                raise ValueError('Source redirected away from HTTPS')
            total=0
            while True:
                data=response.read(CHUNK)
                if not data:break
                if len(data)>MAX_CHUNK:raise ValueError('Unexpected oversized chunk')
                f.write(data); total+=len(data)
            f.flush();os.fsync(f.fileno())
        result=validate_asset(part,asset)
        part.replace(dest)
        print(f'FETCHED {name}: {result["size"]:,} bytes; SHA256 {result["sha256"]}')
        return result
    finally:
        if part.exists():part.unlink()


def record_manifest(root,catalog,profile):
    root=Path(root).resolve()
    manifest={'schema':1,'profile':profile,'created_utc':datetime.now(timezone.utc).isoformat(),
              'source_catalog_sha256':sha256_file(CATALOG),'assets':{},'derived':{},'ready':True,'field_ready':True}
    for name in catalog['profiles'][profile]:
        asset=catalog['sources'][name]
        path=root/safe_relpath(asset['filename'])
        try:
            v=validate_asset(path,asset)
            manifest['assets'][name]={**v,'path':asset['filename'],'source':asset['url'],'license':asset['license'],'present':True}
        except ValueError as e:
            manifest['ready']=False
            manifest['assets'][name]={'path':asset['filename'],'present':False,'error':str(e)}
    if profile=='bendigo':
        map_rel='maps/bendigo-raster.mbtiles'
        map_file=root/map_rel
        try:
            size, count = validate_map(map_file)
            manifest['derived']['bendigo_raster']={'path':map_rel,'present':True,'size':size,
                'sha256':sha256_file(map_file),'tiles':count,
                'description':'Raster MBTiles rendered locally from the downloaded Victoria OpenStreetMap extract'}
        except (ValueError,sqlite3.Error,OSError) as err:
            manifest['field_ready']=False
            manifest['derived']['bendigo_raster']={'path':map_rel,'present':False,'error':str(err)}
    manifest['field_ready']=manifest['field_ready'] and manifest['ready']
    (root/'asset-manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return manifest


def validate_map(path):
    path=Path(path)
    if not path.is_file() or path.is_symlink():raise ValueError('Rendered raster map is missing')
    # Read-only URI prevents an existing untrusted file being mutated on inspection.
    with sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True) as db:
        fmt=db.execute("SELECT value FROM metadata WHERE name='format'").fetchone()
        if not fmt or fmt[0].lower()!='png':raise ValueError('Expected raster PNG MBTiles format')
        count=db.execute('SELECT COUNT(*) FROM tiles').fetchone()[0]
        if count<1:raise ValueError('MBTiles does not contain any map tiles')
    return path.stat().st_size,count


def verify_manifest(root,manifest,*,catalog=None):
    root=Path(root).resolve()
    if not manifest.get('ready') or manifest.get('schema')!=1:
        raise ValueError('Pack is incomplete or invalid')
    catalog=catalog or read_catalog()
    if manifest.get('source_catalog_sha256')!=sha256_file(CATALOG):
        raise ValueError('Source catalog has changed since recording the pack')
    profile=manifest.get('profile')
    if profile not in catalog['profiles']:
        raise ValueError('Unknown pack profile')
    if set(manifest['assets'])!=set(catalog['profiles'][profile]):
        raise ValueError('Asset set does not match profile')
    for name,record in manifest['assets'].items():
        asset=catalog['sources'][name]
        if not record.get('present') or record['path']!=asset['filename']:
            raise ValueError(f'Asset missing: {name}')
        actual=validate_asset(root/safe_relpath(record['path']),asset)
        if actual != {k:record[k] for k in ('size','sha256')}:
            raise ValueError(f'Asset tampered or changed: {name}')
    if profile=='bendigo' and manifest.get('field_ready'):
        derived=manifest.get('derived',{}).get('bendigo_raster',{})
        if derived.get('path')!='maps/bendigo-raster.mbtiles' or not derived.get('present'):
            raise ValueError('Bendigo map record missing')
        actual_size, actual_count=validate_map(root/safe_relpath(derived['path']))
        if (actual_size!=derived['size'] or actual_count!=derived['tiles'] or
                sha256_file(root/derived['path'])!=derived['sha256']):
            raise ValueError('Rendered map has changed since manifest was written')
    return len(manifest['assets'])


def bundle(root,output,catalog=None):
    root=Path(root).resolve()
    output=Path(output).resolve()
    catalog=catalog or read_catalog()
    if output.is_relative_to(root):
        raise ValueError('Cannot write a pack inside its source directory')
    manifest=json.loads((root/'asset-manifest.json').read_text(encoding='utf-8'))
    count=verify_manifest(root,manifest,catalog=catalog)
    if not manifest.get('field_ready'):
        raise ValueError('Required offline map has not been rendered; run build-map first')
    if output.exists():raise ValueError('Refusing to overwrite existing pack')
    output.parent.mkdir(parents=True,exist_ok=True)
    part=output.with_suffix(output.suffix+'.partial')
    with tarfile.open(part,'w',format=tarfile.PAX_FORMAT) as tar:
        for name in sorted(manifest['assets']):
            rel=safe_relpath(manifest['assets'][name]['path'])
            tar.add(root/rel,arcname='assets/'+str(rel),recursive=False)
        for derived in manifest.get('derived',{}).values():
            if derived.get('present'):
                rel=safe_relpath(derived['path'])
                tar.add(root/rel,arcname='assets/'+str(rel),recursive=False)
        tar.add(root/'asset-manifest.json',arcname='assets/asset-manifest.json',recursive=False)
    part.replace(output)
    checksum=sha256_file(output)
    output.with_suffix(output.suffix+'.sha256').write_text(f'{checksum}  {output.name}\n',encoding='utf-8')
    print(f'PACK READY: {count} verified assets, {output.stat().st_size:,} bytes, SHA256 {checksum}')
    return output


def inspect_bundle(path,catalog=None):
    catalog=catalog or read_catalog()
    with tarfile.open(path,'r') as tar:
        members=tar.getmembers()
        if any(not m.isfile() or m.issym() or m.islnk() or not m.name.startswith('assets/') or '..' in Path(m.name).parts for m in members):
            raise ValueError('Unsafe tar member')
        entries={m.name:m for m in members}
        if 'assets/asset-manifest.json' not in entries:
            raise ValueError('Missing asset manifest')
        m=json.load(tar.extractfile(entries['assets/asset-manifest.json']))
        if not m.get('ready') or not m.get('field_ready'):
            raise ValueError('Incomplete archive manifest')
        wanted={'assets/asset-manifest.json'}|{'assets/'+a['path'] for a in m['assets'].values()}|{'assets/'+d['path'] for d in m.get('derived',{}).values() if d.get('present')}
        if set(entries)!=wanted:raise ValueError('Unexpected or missing archive member')
        if m.get('profile') not in catalog['profiles'] or set(m['assets'])!=set(catalog['profiles'][m['profile']]):
            raise ValueError('Archive profile mismatch')
        for name, record in m['assets'].items():
            if not record.get('present'):raise ValueError('Incomplete asset in archive')
            if record['path']!=catalog['sources'][name]['filename']:raise ValueError('Archive path mismatch')
            f=tar.extractfile(entries['assets/'+record['path']]);h=hashlib.sha256();total=0
            while True:
                b=f.read(CHUNK)
                if not b:break
                h.update(b);total+=len(b)
            if h.hexdigest()!=record['sha256'] or total!=record['size']:
                raise ValueError(f'Archive member does not match SHA256: {name}')
        for name,record in m.get('derived',{}).items():
            if not record.get('present'):raise ValueError('Derived map missing')
            member=entries['assets/'+record['path']]
            stream=tar.extractfile(member); h=hashlib.sha256();total=0
            for chunk in iter(lambda:stream.read(CHUNK),b''):
                h.update(chunk);total+=len(chunk)
            if h.hexdigest()!=record['sha256'] or total!=record['size']:
                raise ValueError(f'Derived data changed: {name}')
        return {'profile':m['profile'],'assets':len(m['assets']),'derived':len(m.get('derived',{})),'field_ready':True}


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['plan','fetch','build-map','verify','bundle','assemble','inspect'])
    p.add_argument('--profile',default='bendigo')
    p.add_argument('--dir',default='offline_assets')
    p.add_argument('--output')
    args=p.parse_args(argv)
    catalog=read_catalog()
    if args.profile not in catalog['profiles']:
        p.error(f'Unknown profile: {args.profile}')
    root=Path(args.dir).expanduser().resolve()
    if args.command=='plan':
        print(json.dumps({'profile':args.profile,'assets':{name:catalog['sources'][name] for name in catalog['profiles'][args.profile]},'note':'Download size is substantial; GitHub source ZIP does not contain these binaries'},indent=2))
        return 0
    if args.command=='inspect':
        if not args.output:p.error('--output path to .tar is required for inspect')
        print(json.dumps(inspect_bundle(args.output),indent=2));return 0
    if args.command in ('fetch','assemble'):
        root.mkdir(parents=True,exist_ok=True)
        for name in catalog['profiles'][args.profile]:
            fetch_one(name,catalog['sources'][name],root)
        m=record_manifest(root,catalog,args.profile)
        if args.command=='fetch':
            print('SOURCE DOWNLOADS COMPLETE; map generation may still be required')
            return 0 if m['ready'] else 1
    if args.command in ('build-map','assemble'):
        if args.profile=='bendigo':
            map_file=root/'maps/bendigo-raster.mbtiles'
            if not map_file.exists():
                from render_map import create_from_pbf
                bounds=catalog['region']['bounds_lonlat']
                zooms=catalog['region']['tile_zooms']
                print('Generating raster offline MBTiles from the real Victoria OSM extract...')
                print(create_from_pbf(root/'maps/victoria-latest.osm.pbf',map_file,bounds,zooms))
            record_manifest(root,catalog,args.profile)
        if args.command=='build-map':return 0
    if args.command=='assemble':
        if not args.output:p.error('--output .tar is required for assemble')
        bundle(root,args.output,catalog);return 0
    if args.command=='verify':
        m=json.loads((root/'asset-manifest.json').read_text(encoding='utf-8'))
        verify_manifest(root,m)
        print(f'VERIFIED {len(m["assets"])} source assets; SHA256 unchanged from original manifest')
        return 0
    if args.command=='bundle':
        if not args.output:p.error('--output path to .tar is required for bundle')
        bundle(root,args.output,catalog)
        return 0
    raise AssertionError(args.command)

if __name__=='__main__':
    raise SystemExit(main())
