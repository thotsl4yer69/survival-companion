#!/usr/bin/env python3
"""Render basic, attributed offline *raster* MBTiles from real OSM features.

Inputs: Victoria OSM PBF and osmium-tool (for a real build) or streaming
GeoJSON sequence (for validation). Rendering uses Pillow at preparation time;
BLACKBOX's runtime uses only Python stdlib. NOT an authoritative topo chart.
"""
from __future__ import annotations
import argparse
import json
import math
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

try:
    from PIL import Image,ImageDraw,ImageFont
except ImportError:
    Image=ImageDraw=ImageFont=None

MAX_TILES_PER_ZOOM=1600
TILE=256


def mercator(lon,lat,zoom):
    if not (-180<=lon<=180 and -85.0511<=lat<=85.0511):
        raise ValueError('Coordinate outside Web Mercator')
    n=2**zoom
    x=(lon+180)/360*n
    rad=math.radians(lat)
    y=(1-math.asinh(math.tan(rad))/math.pi)*0.5*n
    return x,y


def tile_box(bounds,zoom):
    west,south,east,north=bounds
    if west>=east or south>=north or any(not math.isfinite(v) for v in bounds):
        raise ValueError('Invalid geographic bounding box')
    xmin,ybottom=mercator(west,south,zoom)
    xmax,ytop=mercator(east,north,zoom)
    left,top=math.floor(xmin),math.floor(ytop)
    right,bottom=math.floor(xmax),math.floor(ybottom)
    count=(right-left+1)*(bottom-top+1)
    if count<=0 or count>MAX_TILES_PER_ZOOM:
        raise ValueError(f'Region has {count} map tiles at zoom {zoom}; reduce bounds or zoom')
    return left,top,right,bottom


def features(path):
    with Path(path).open('r',encoding='utf-8') as f:
        for raw in f:
            if len(raw)>10000000:raise ValueError('Oversized GeoJSON feature')
            raw=raw.lstrip('\x1e').strip()
            if not raw:continue
            item=json.loads(raw)
            if item.get('type')!='Feature':continue
            geom=item.get('geometry')
            if not isinstance(geom,dict):continue
            tags=item.get('properties') or {}
            if not isinstance(tags,dict):continue
            yield geom,tags


def styled(tags,geomtype):
    water=(tags.get('natural')=='water' or tags.get('waterway')=='riverbank' or tags.get('landuse')=='reservoir')
    parks=(tags.get('leisure') in {'park','nature_reserve'} or tags.get('landuse') in {'forest','grass','meadow','recreation_ground'} or tags.get('natural') in {'wood','scrub'})
    if geomtype in ('Polygon','MultiPolygon'):
        if water:return 0,'polygon','#a6cee3',0
        if parks:return 0,'polygon','#cce7bd',0
        if tags.get('building'):return 0,'polygon','#d2cbc0',0
    if geomtype in ('LineString','MultiLineString'):
        if tags.get('waterway'):return 1,'line','#6ca9cf',2
        road=tags.get('highway')
        if road:
            size=4 if road in ('motorway','trunk','primary','secondary') else 2 if road in ('tertiary','residential','unclassified') else 1
            return 2,'line','#b1856c' if size==4 else '#dbac83',size
        if tags.get('railway'):return 1,'line','#8d8a86',1
    if geomtype=='Point' and tags.get('place') in ('city','town','village') and isinstance(tags.get('name'),str):
        return 3,'label','#172a3b',0
    return None


def iter_paths(geometry):
    kind=geometry.get('type');c=geometry.get('coordinates')
    if kind=='LineString' and isinstance(c,list):yield c
    elif kind in ('Polygon','MultiLineString') and isinstance(c,list):
        yield from (p for p in c if isinstance(p,list))
    elif kind=='MultiPolygon' and isinstance(c,list):
        for p in c:
            if isinstance(p,list):yield from (ring for ring in p if isinstance(ring,list))
    elif kind=='Point' and isinstance(c,list):yield c


def project(coords,z,left,top):
    points=[]
    for pt in coords:
        if not isinstance(pt,(list,tuple)) or len(pt)<2:continue
        try:x,y=mercator(float(pt[0]),float(pt[1]),z)
        except (ValueError,OverflowError,TypeError):continue
        # Avoid expensive PIL overflow on a relation spanning another continent.
        points.append((int(max(-100000,min(100000,(x-left)*TILE))),int(max(-100000,min(100000,(y-top)*TILE)))))
    return points


def draw_feature(draw,geom,tags,style,z,left,top):
    layer,op,color,width=style
    if op=='label':
        p=project([geom['coordinates']],z,left,top)
        if p:
            label=str(tags['name'])[:65]
            draw.text(p[0],label,fill=color,stroke_width=1,stroke_fill='#fffefa')
        return
    for ring in iter_paths(geom):
        xy=project(ring,z,left,top)
        if len(xy)<2:continue
        if op=='polygon' and len(xy)>2:
            draw.polygon(xy,fill=color)
        elif op=='line':
            draw.line(xy,fill=color,width=width,joint='curve')


def build_mbtiles(geojsonseq,output,bounds,zooms=(10,11,12,13,14)):
    if Image is None:raise RuntimeError('Pillow is required to generate offline raster tiles (pip install Pillow)')
    output=Path(output)
    if output.exists():raise ValueError('Refusing to overwrite an existing map')
    output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix(output.suffix+'.partial')
    if temp.exists():temp.unlink()
    counts={};features_drawn=0
    try:
        with sqlite3.connect(temp) as db:
            db.executescript('''CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT);
                             CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB);
                             CREATE UNIQUE INDEX tile_unique ON tiles(zoom_level,tile_column,tile_row);''')
            db.executemany('INSERT INTO metadata(name,value) VALUES(?,?)',[
                ('name','BLACKBOX Offline OSM Raster: '+str(bounds)),('format','png'),('type','baselayer'),
                ('bounds',','.join(map(str,bounds))),('minzoom',str(min(zooms))),('maxzoom',str(max(zooms))),
                ('attribution','© OpenStreetMap contributors | ODbL | https://www.openstreetmap.org/copyright')])
            for z in sorted(set(zooms)):
                if not 0<=z<=18:raise ValueError('Zoom outside supported range 0-18')
                left,top,right,bottom=tile_box(bounds,z)
                wide=(right-left+1)*TILE; high=(bottom-top+1)*TILE
                canvas=Image.new('RGB',(wide,high),'#f4f1e9');draw=ImageDraw.Draw(canvas)
                per_zoom=0
                for layer in range(4):
                    for geo,tags in features(geojsonseq):
                        style=styled(tags,geo.get('type'))
                        if not style or style[0]!=layer:continue
                        try:
                            draw_feature(draw,geo,tags,style,z,left,top)
                            per_zoom+=1
                        except (KeyError,TypeError,ValueError):
                            continue
                if not per_zoom:raise ValueError('No styled geographic features; refusing an empty map')
                features_drawn+=per_zoom
                for xx in range(left,right+1):
                    for yy in range(top,bottom+1):
                        x0=(xx-left)*TILE;y0=(yy-top)*TILE
                        tile=canvas.crop((x0,y0,x0+TILE,y0+TILE))
                        from io import BytesIO
                        data=BytesIO();tile.save(data,format='PNG',optimize=True)
                        db.execute('INSERT INTO tiles VALUES(?,?,?,?)',(z,xx,2**z-1-yy,data.getvalue()))
                counts[z]=(right-left+1)*(bottom-top+1)
                db.commit()
        temp.replace(output)
    finally:
        if temp.exists():temp.unlink()
    return {'tiles':sum(counts.values()),'zooms':counts,'drawn_features_per_zoom_total':features_drawn,'size_bytes':output.stat().st_size}


def create_from_pbf(pbf,out,bounds,zooms):
    if shutil.which('osmium') is None:raise RuntimeError('Install osmium-tool before extracting OSM PBF')
    pbf=Path(pbf)
    if not pbf.is_file():raise FileNotFoundError(pbf)
    with tempfile.TemporaryDirectory(prefix='blackbox-osm-') as tmp:
        cut=Path(tmp)/'extract.osm.pbf'; geo=Path(tmp)/'features.geojsonseq'
        bbox=','.join(map(str,bounds))
        subprocess.run(['osmium','extract','--strategy','complete_ways','--bbox',bbox,str(pbf),'-o',str(cut)],check=True)
        subprocess.run(['osmium','export',str(cut),'-o',str(geo)],check=True)
        # osmium export uses .geojsonseq to select the streaming format.
        return build_mbtiles(geo,out,bounds,zooms)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,help='Victoria OSM PBF (or a GeoJSONSeq file with --geojsonseq)')
    parser.add_argument('--output',required=True,help='New raster MBTiles path')
    parser.add_argument('--bbox',default='143.93,-36.99,144.70,-36.49')
    parser.add_argument('--zooms',default='10,11,12,13,14')
    parser.add_argument('--geojsonseq',action='store_true',help='Source is already GeoJSONSeq; skip osmium')
    args=parser.parse_args(argv)
    bounds=tuple(float(x) for x in args.bbox.split(','))
    zooms=tuple(int(x) for x in args.zooms.split(','))
    if len(bounds)!=4 or not zooms:parser.error('Invalid bbox or zoom levels')
    if args.geojsonseq:
        result=build_mbtiles(args.source,args.output,bounds,zooms)
    else:result=create_from_pbf(args.source,args.output,bounds,zooms)
    print(json.dumps(result,indent=2))
    print(f'Use BLACKBOX_MBTILES={Path(args.output).resolve()} on the service host')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
