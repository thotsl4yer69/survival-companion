"""Knowledge-index correctness and release-manifest integrity regression tests."""
from __future__ import annotations
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from tools import verify_integrity


class IndexedKnowledgeTests(unittest.TestCase):
    def test_deleted_files_disappear_and_timestamps_stay_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            test_root=Path(directory)
            sources=test_root/'knowledge'
            sources.mkdir()
            (sources/'alpha.md').write_text('# Alpha\nFirst edition\n',encoding='utf-8')
            (sources/'beta.md').write_text('# Beta\nSecond edition\n',encoding='utf-8')
            old_root=app.ROOT
            try:
                app.ROOT=test_root
                store=app.Store(test_root/'test.sqlite3')
                first=store.one('SELECT updated FROM knowledge WHERE slug=?',('alpha',))['updated']
                store.index_knowledge()
                self.assertEqual(first,store.one('SELECT updated FROM knowledge WHERE slug=?',('alpha',))['updated'])
                (sources/'beta.md').unlink()
                store.index_knowledge()
                self.assertEqual(store.query('SELECT slug FROM knowledge'),[{'slug':'alpha'}])
                self.assertEqual(store.search_knowledge('Second'),[])
            finally:
                app.ROOT=old_root


class ManifestTests(unittest.TestCase):
    def test_hash_verifier_flags_tampered_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            src=root/'radio_bridge.py'
            src.write_text('original',encoding='utf-8')
            digest=hashlib.sha256(src.read_bytes()).hexdigest()
            (root/'SHA256SUMS').write_text(f'{digest}  radio_bridge.py\n',encoding='utf-8')
            count,errors=verify_integrity.verify(root)
            self.assertEqual((count,errors),(1,[]))
            src.write_text('tampered',encoding='utf-8')
            count,errors=verify_integrity.verify(root)
            self.assertEqual(count,1)
            self.assertIn('Modified radio_bridge.py',errors)

    def test_path_traversal_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'SHA256SUMS').write_text('0'*64+'  ../outside\n',encoding='utf-8')
            _,errors=verify_integrity.verify(root)
            self.assertTrue(errors)

if __name__=='__main__':unittest.main()
