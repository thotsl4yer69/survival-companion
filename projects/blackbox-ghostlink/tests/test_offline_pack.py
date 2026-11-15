"""Regression tests for offline field-pack preparation and raster map generation."""
from __future__ import annotations
import hashlib
import importlib.util
import io
import json
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]

def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

prepare=load_module('offline_prepare',ROOT/'offline/prepare.py')
mapbuild=load_module('offline_render',ROOT/'offline/render_map.py')

class FixtureDownloader:
    def __init__(self, data, url='https://example.org/a'):
        self.data=io.BytesIO(data)
        self.url=url
        self.status=200
    def read(self,n):return self.data.read(n)
    def __enter__(self):return self
    def __exit__(self,*a):self.data.close()

class FixtureOpener:
    def __init__(self, data):self.data=data
    def open(self,req,timeout=0):return FixtureDownloader(self.data)

class TestAssets(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.data=self.base/'prepared';self.data.mkdir()
        self.catalog={'schema':1,'sources':{
            'mini':{'filename':'models/mini.gguf','url':'https://example.org/mini.gguf',
                    'minimum_bytes':12,'signature_hex':'47475546','license':'Apache-2.0'}},
                'profiles':{'base':['mini']},'region':{'bounds_lonlat':[144,-37,145,-36],'tile_zooms':[10]}}
        self.catalog_path=self.base/'catalog.json'
        self.catalog_path.write_text(json.dumps(self.catalog))
        self.patch=patch.object(prepare,'CATALOG',self.catalog_path)
        self.patch.start();self.addCleanup(self.patch.stop)
    def test_pack_from_local_fetched_content(self):
        mini=self.catalog['sources']['mini']
        expected=b'GGUF'+b'\x01'*400
        r=prepare.fetch_one('mini',mini,self.data,opener=FixtureOpener(expected))
        self.assertEqual(r['sha256'],hashlib.sha256(expected).hexdigest())
        m=prepare.record_manifest(self.data,self.catalog,'base')
        self.assertTrue(m['field_ready'])
        self.assertEqual(prepare.verify_manifest(self.data,m,catalog=self.catalog),1)
        archive=self.base/'portable.tar'
        prepare.bundle(self.data,archive,catalog=self.catalog)
        data=prepare.inspect_bundle(archive,catalog=self.catalog)
        self.assertTrue(data['field_ready'])
        self.assertEqual(data['assets'],1)
        with tarfile.open(archive) as t:
            self.assertEqual(t.extractfile('assets/models/mini.gguf').read(),expected)
    def test_modified_file_fails_prior_manifest_digest(self):
        self.data.joinpath('models').mkdir()
        p=self.data/'models/mini.gguf';p.write_bytes(b'GGUF'+b'A'*100)
        m=prepare.record_manifest(self.data,self.catalog,'base')
        self.assertTrue(m['ready'])
        p.write_bytes(b'GGUF'+b'B'*100)
        with self.assertRaisesRegex(ValueError,'tampered'):
            prepare.verify_manifest(self.data,m,catalog=self.catalog)
        with self.assertRaisesRegex(ValueError,'tampered'):
            prepare.bundle(self.data,self.base/'bad.tar',catalog=self.catalog)
    def test_existing_invalid_asset_not_overwritten(self):
        p=self.data/'models/mini.gguf';p.parent.mkdir();p.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'invalid'):
            prepare.fetch_one('mini',self.catalog['sources']['mini'],self.data,opener=FixtureOpener(b'GGUF'+b'A'*20))
        self.assertEqual(p.read_bytes(),b'bad')
    def test_wrong_header_rejected(self):
        with self.assertRaisesRegex(ValueError,'signature'):
            prepare.fetch_one('mini',self.catalog['sources']['mini'],self.data,opener=FixtureOpener(b'BAD!'+b'A'*40))
        self.assertFalse((self.data/'models/mini.gguf').exists())
        self.assertFalse((self.data/'models/mini.gguf.partial').exists())
    def test_small_file_rejected(self):
        with self.assertRaisesRegex(ValueError,'too small'):
            prepare.fetch_one('mini',self.catalog['sources']['mini'],self.data,opener=FixtureOpener(b'GGUF'))
    def test_reused_verified_asset_is_not_redownloaded(self):
        p=self.data/'models/mini.gguf';p.parent.mkdir();p.write_bytes(b'GGUF'+b'A'*80)
        r=prepare.fetch_one('mini',self.catalog['sources']['mini'],self.data,opener=None)
        self.assertEqual(r['size'],84)
    def test_safe_paths(self):
        for name in ('../test','/tmp/abc','.','folder\\name','a/../../z'):
            with self.subTest(name=name),self.assertRaises(ValueError):
                prepare.safe_relpath(name)
        self.assertEqual(str(prepare.safe_relpath('data/file.gguf')),'data/file.gguf')
    def test_source_url_must_be_https(self):
        catalog=dict(self.catalog);catalog['sources']={'mini':dict(self.catalog['sources']['mini'],url='http://example.org/a')}
        self.catalog_path.write_text(json.dumps(catalog))
        with self.assertRaisesRegex(ValueError,'Insecure'):
            prepare.read_catalog(self.catalog_path)
    def test_profile_catalog_rejects_unknown_asset(self):
        catalog=dict(self.catalog);catalog['profiles']={'base':['typo']}
        self.catalog_path.write_text(json.dumps(catalog))
        with self.assertRaises(ValueError):prepare.read_catalog(self.catalog_path)
    def test_catalog_changed_fails(self):
        p=self.data/'models/mini.gguf';p.parent.mkdir();p.write_bytes(b'GGUF'+b'A'*80)
        m=prepare.record_manifest(self.data,self.catalog,'base')
        self.catalog_path.write_text(json.dumps({**self.catalog,'extra':123}))
        with self.assertRaisesRegex(ValueError,'changed'):
            prepare.verify_manifest(self.data,m,catalog=self.catalog)
    def test_tar_rejects_unknown_member(self):
        p=self.base/'fake.tar'
        with tarfile.open(p,'w') as t:
            q=tarfile.TarInfo('assets/../evil')
            b=b'evil';q.size=len(b);t.addfile(q,io.BytesIO(b))
        with self.assertRaisesRegex(ValueError,'Unsafe'):
            prepare.inspect_bundle(p,catalog=self.catalog)
    def test_missing_file_cannot_be_ready(self):
        m=prepare.record_manifest(self.data,self.catalog,'base')
        self.assertFalse(m['ready'])
        with self.assertRaisesRegex(ValueError,'incomplete'):
            prepare.verify_manifest(self.data,m,catalog=self.catalog)
    def test_no_file_symlink_download(self):
        external=self.base/'external';external.write_bytes(b'GGUF'+b'A'*50)
        p=self.data/'models/mini.gguf';p.parent.mkdir();p.symlink_to(external)
        with self.assertRaisesRegex(ValueError,'symlink'):
            prepare.fetch_one('mini',self.catalog['sources']['mini'],self.data,opener=FixtureOpener(b'GGUF'+b'A'*20))

class TestRaster(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.geo=ROOT/'tests/fixtures/town.geojsonseq'
    def test_map_tile_rendering_and_database_contract(self):
        out=self.base/'town.mbtiles'
        result=mapbuild.build_mbtiles(self.geo,out,(144.18,-36.82,144.31,-36.68),(10,11,12))
        self.assertEqual(result['tiles'],9)
        self.assertEqual(result['zooms'],{10:1,11:2,12:6})
        with sqlite3.connect(out) as db:
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE name='format'").fetchone()[0],'png')
            self.assertIn('OpenStreetMap contributors',db.execute("SELECT value FROM metadata WHERE name='attribution'").fetchone()[0])
            png=db.execute('SELECT tile_data FROM tiles LIMIT 1').fetchone()[0]
            self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertEqual(prepare.validate_map(out)[1],9)
        # Actual BLACKBOX adapter must display these tiles with standard TMS row inversion.
        import sys
        sys.path.insert(0,str(ROOT))
        import app
        instance=app.Blackbox(db_path=self.base/'test.sqlite3',mbtiles=out)
        self.assertTrue(instance.map_metadata()['mbtiles_raster_usable'])
        left,top,_,_=mapbuild.tile_box((144.18,-36.82,144.31,-36.68),10)
        result=instance.read_tile(10,left,top)
        self.assertIsNotNone(result)
        self.assertEqual(result[1],'image/png')
    def test_reject_bad_geographic_bounds(self):
        with self.assertRaises(ValueError):mapbuild.tile_box((145,-37,144,-36),10)
        with self.assertRaises(ValueError):mapbuild.tile_box((144,-36,145,-37),10)
    def test_reject_overlarge_region(self):
        with self.assertRaisesRegex(ValueError,'reduce bounds'):
            mapbuild.tile_box((-180,-70,180,70),14)
    def test_empty_geojson_is_not_a_real_map(self):
        geo=self.base/'empty.geojsonseq';geo.write_text('')
        with self.assertRaisesRegex(ValueError,'No styled'):
            mapbuild.build_mbtiles(geo,self.base/'empty.mbtiles',(144,-37,145,-36),(10,))
        self.assertFalse((self.base/'empty.mbtiles').exists())
    def test_output_protects_existing(self):
        out=self.base/'existing.mbtiles';out.write_bytes(b'user map')
        with self.assertRaisesRegex(ValueError,'Refusing'):
            mapbuild.build_mbtiles(self.geo,out,(144,-37,145,-36),(10,))
        self.assertEqual(out.read_bytes(),b'user map')
    def test_geojsonseq_parsed(self):
        f=list(mapbuild.features(self.geo))
        self.assertEqual(len(f),3)
        self.assertEqual(f[-1][1]['name'],'Bendigo test')

if __name__=='__main__':unittest.main()
