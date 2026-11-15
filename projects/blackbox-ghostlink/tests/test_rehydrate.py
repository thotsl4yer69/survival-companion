import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'offline'))
import rehydrate

class RehydrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.src=self.root/'field.tar'
        with tarfile.open(self.src,'w') as tar:
            data=b'verified test data'
            m=tarfile.TarInfo('assets/models/data.txt');m.size=len(data)
            tar.addfile(m,io.BytesIO(data))
        self.sha=self.root/'field.tar.sha256'
        self.sha.write_text(hashlib.sha256(self.src.read_bytes()).hexdigest()+'  field.tar\n')
    def test_two_part_rebuild_and_extract(self):
        raw=self.src.read_bytes();self.src.unlink()
        a=self.root/'field.tar.part-01';b=self.root/'field.tar.part-02'
        a.write_bytes(raw[:350]);b.write_bytes(raw[350:])
        out=rehydrate.assemble([a,b],self.src,self.sha)
        self.assertEqual(out.read_bytes(),raw)
        self.assertEqual(rehydrate.safe_extract(out,self.root/'unpacked'),1)
        self.assertEqual((self.root/'unpacked/assets/models/data.txt').read_bytes(),b'verified test data')
    def test_reject_reverse_part_order(self):
        raw=self.src.read_bytes();self.src.unlink()
        a=self.root/'field.tar.part-01';b=self.root/'field.tar.part-02'
        a.write_bytes(raw[:350]);b.write_bytes(raw[350:])
        with self.assertRaisesRegex(ValueError,'ascending'):
            rehydrate.assemble([b,a],self.src,self.sha)
    def test_reject_corrupt_part_and_leave_no_output(self):
        raw=self.src.read_bytes();self.src.unlink()
        part=self.root/'field.tar.part-01';part.write_bytes(raw+b'corrupt')
        with self.assertRaisesRegex(ValueError,'DOES NOT MATCH'):
            rehydrate.assemble([part],self.src,self.sha)
        self.assertFalse(self.src.exists())
        self.assertFalse(self.root.joinpath('field.tar.partial').exists())
    def test_reject_archive_path_traversal(self):
        bad=self.root/'bad.tar'
        with tarfile.open(bad,'w') as tar:
            data=b'evil';m=tarfile.TarInfo('assets/../../bad.txt');m.size=len(data)
            tar.addfile(m,io.BytesIO(data))
        with self.assertRaisesRegex(ValueError,'unsafe'):
            rehydrate.safe_extract(bad,self.root/'out')
        self.assertFalse((self.root/'out').exists())
    def test_refuse_overwrite_extraction(self):
        d=self.root/'dest';d.mkdir();(d/'existing').write_text('keep')
        with self.assertRaisesRegex(ValueError,'empty'):
            rehydrate.safe_extract(self.src,d)
        self.assertEqual((d/'existing').read_text(),'keep')
if __name__=='__main__':unittest.main()
