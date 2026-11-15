"""Regressions for external Codex findings before shipping to main."""
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from tools import hardware_probe

class ReviewedIssues(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/"state.sqlite3"
        self.host=app.Blackbox(self.path,radio_enabled=True)
    def tearDown(self):self.tmp.cleanup()

    def _queue(self,status='queued-for-radio'):
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status,released_at) VALUES(?,?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','hello',status,app.UTC()))

    def test_observers_and_maintenance_do_not_reset_live_outbox(self):
        self._queue()
        app.Blackbox(self.path).store.backup(Path(self.tmp.name)/'backup.sqlite3')
        app.Blackbox(self.path).store.index_knowledge()
        app.Blackbox(self.path).status()
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'queued-for-radio')
        # CLI utility methods cannot modify a message held by another worker.
        with patch.dict(os.environ,{'BLACKBOX_DB':str(self.path)}):
            self.assertEqual(app.main(['check']),0)
            self.assertEqual(app.main(['reindex']),0)
            self.assertEqual(app.main(['backup',str(Path(self.tmp.name)/'cmd.sqlite3')]),0)
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'queued-for-radio')

    @unittest.skipUnless(os.name=='posix','fcntl requires POSIX')
    def test_exclusive_radio_lock_blocks_second_server(self):
        with app.radio_ownership(self.path):
            with self.assertRaisesRegex(OSError,'already owned'):
                with app.radio_ownership(self.path):pass
        self._queue()
        with app.radio_ownership(self.path):
            self.host.store.recover_radio_outbox()
        self._queue('submitting-uncertain')
        # recovery under the radio-owner lock quarantines uncertainty.
        with app.radio_ownership(self.path):
            self.host.store.recover_radio_outbox()
        self.assertEqual(self.host.store.one("SELECT COUNT(*) AS n FROM messages WHERE status='requires-manual-review'")['n'],2)

    @unittest.skipUnless(os.name=='posix','fcntl requires POSIX')
    def test_radio_server_startup_is_only_recovery_path(self):
        self._queue()
        class FakeRadioWorker:
            def __init__(self,app):pass
            def start(self):pass
            def stop(self):pass
            def join(self):pass
        with patch('radio_bridge.RadioWorker',FakeRadioWorker),patch.object(app.Server,'serve_forever',lambda s:None):
            app.serve(self.host,port=0)
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'requires-manual-review')

    def test_content_security_policy_allows_offline_blob_tiles(self):
        import threading
        srv=app.Server(('127.0.0.1',0),self.host)
        thread=threading.Thread(target=srv.serve_forever,daemon=True);thread.start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{srv.server_address[1]}/app.js',timeout=3) as response:
                csp=response.headers['Content-Security-Policy']
            self.assertIn('blob:',csp.split('img-src ')[1].split(';')[0])
        finally:
            srv.shutdown();srv.server_close();thread.join(2)

    def test_probe_uses_no_proxy_opener(self):
        captured=[]
        class Opener:
            def open(self,*args,**kwargs):raise OSError('no local model')
        def factory(*handlers):
            captured.extend(handlers)
            return Opener()
        with patch('urllib.request.build_opener',side_effect=factory),patch.dict(os.environ,{'HTTP_PROXY':'http://bad.example:8888','NO_PROXY':''}):
            self.assertFalse(hardware_probe.local_ollama()['reachable'])
        self.assertTrue(any(isinstance(h,urllib.request.ProxyHandler) and h.proxies=={} for h in captured))

if __name__=='__main__':unittest.main()
