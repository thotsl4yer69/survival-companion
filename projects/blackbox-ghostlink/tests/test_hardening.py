"""Regression cases for previously discovered radio and HTTP trust-boundary defects."""
import json
from contextlib import closing
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from radio_bridge import RadioWorker


class RadioCrashSafety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'db.sqlite3'
        self.host=app.Blackbox(self.path, radio_enabled=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_claim_persisted_before_radio_send(self):
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES(?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','urgent','queued-for-radio'))
        self.host.store.execute("UPDATE messages SET released_at=?",(app.UTC(),))
        msg=self.host.store.claim_radio_message()
        self.assertEqual(msg['body'],'urgent')
        self.assertIsNone(self.host.store.claim_radio_message())
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'submitting-uncertain')

    def test_reboot_does_not_repeat_unknown_transmission(self):
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES(?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','do not replay','queued-for-radio'))
        self.host.store.execute("UPDATE messages SET released_at=?",(app.UTC(),))
        self.host.store.claim_radio_message()  # pretend process was killed before send returned
        # Starting a second observer/maintenance command must NOT touch the outbox.
        observer=app.Blackbox(self.path,radio_enabled=True)
        self.assertEqual(observer.store.one('SELECT status FROM messages')['status'],'submitting-uncertain')
        # Recovery belongs exclusively to the radio server's startup path.
        with app.radio_ownership(self.path):
            observer.store.recover_radio_outbox()
        host2=observer
        self.assertEqual(host2.store.one('SELECT status FROM messages')['status'],'requires-manual-review')
        self.assertEqual(host2.status()['messages_needing_manual_review'],1)
        self.assertIsNone(host2.store.claim_radio_message())
        class Fake:
            def __init__(self):self.sent=[]
            def sendText(self,body,**kwargs):self.sent.append(body)
            def close(self):pass
        fake=Fake()
        worker=RadioWorker(host2,interface_factory=lambda port:fake,reconnect_delay=.01)
        worker.start();time.sleep(1.05);worker.stop();worker.join(2)
        self.assertEqual(fake.sent,[])
        self.assertEqual(host2.store.one('SELECT status FROM messages')['status'],'requires-manual-review')
        self.assertEqual(host2.status()['messages_needing_manual_review'],1)

    def test_radio_failure_is_uncertain_and_never_automatically_retries(self):
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES(?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','check','queued-for-radio'))
        self.host.store.execute("UPDATE messages SET released_at=?",(app.UTC(),))
        class Bad:
            def __init__(self):self.calls=0
            def sendText(self,*args,**kwargs):self.calls+=1;raise OSError('serial failed')
        fake=Bad()
        worker=RadioWorker(self.host,interface_factory=lambda port:fake,reconnect_delay=.01)
        worker.interface=fake
        with self.assertRaises(OSError):worker._send_next()
        self.assertEqual(fake.calls,1)
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'failed-transmission-uncertain')
        self.assertIsNone(self.host.store.claim_radio_message())

    def test_expired_release_is_never_submitted(self):
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status,released_at) VALUES(?,?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','outdated','queued-for-radio','2020-01-01T00:00:00Z'))
        self.assertIsNone(self.host.store.claim_radio_message())
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'release-expired')

    def test_incoming_deduplicated_across_worker_restart(self):
        packet={'fromId':'!12345678','id':100,'decoded':{'portnum':'TEXT_MESSAGE_APP','text':'hello'}}
        RadioWorker(self.host).on_receive(packet)
        RadioWorker(app.Blackbox(self.path)).on_receive(packet)
        rows=self.host.store.query('SELECT * FROM messages')
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['body'],'hello')

    def test_database_and_backup_files_are_private(self):
        if sys.platform == 'win32':self.skipTest('POSIX file modes')
        import stat
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
        backup=Path(self.tmp.name)/'backup.sqlite3'
        self.host.store.backup(backup)
        self.assertEqual(backup.stat().st_mode & 0o777,0o600)
        with closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_boolean_and_infinite_values_rejected(self):
        with self.assertRaises(ValueError): app.safe_number(True,'watts')
        with self.assertRaises(ValueError): app.safe_number('Infinity','watts')

    def test_legacy_duplicate_incoming_rows_migrated(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("DROP INDEX incoming_radio_packet_unique")
            db.execute("INSERT INTO messages(direction,sender,recipient,body,status,packet_id) VALUES(?,?,?,?,?,?)",
                       ('incoming','!abc','BLACKBOX','one','received-by-radio','222'))
            db.execute("INSERT INTO messages(direction,sender,recipient,body,status,packet_id) VALUES(?,?,?,?,?,?)",
                       ('incoming','!abc','BLACKBOX','two','received-by-radio','222'))
            db.commit()
        store=app.Store(self.path)
        self.assertEqual(store.one("SELECT COUNT(*) AS n FROM messages WHERE packet_id='222'")['n'],1)
        with self.assertRaises(sqlite3.IntegrityError):
            store.execute("INSERT INTO messages(direction,sender,recipient,body,status,packet_id) VALUES(?,?,?,?,?,?)",
                          ('incoming','!abc','BLACKBOX','again','received-by-radio','222'))


class HomeAssistantTransport(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.host=app.Blackbox(Path(self.tmp.name)/'db.sqlite3',ha_token='local-secret')

    def tearDown(self):self.tmp.cleanup()

    def test_public_hostname_rejected(self):
        for endpoint in ['https://example.com','http://fake.local','http://homeassistant.lan',
                         'http://192.168.1.4/evasive','http://192.168.1.4:8123/?x=y']:
            with self.subTest(endpoint=endpoint):
                self.host.ha_url=endpoint
                with self.assertRaises(ValueError):self.host.read_homeassistant()

    def test_redirect_does_not_send_bearer_to_destination(self):
        seen=[]
        class RedirectTarget(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.headers.get('Authorization'))
                self.send_response(200);self.end_headers();self.wfile.write(b'[]')
            def log_message(self,*args):pass
        receiver=ThreadingHTTPServer(('127.0.0.1',0),RedirectTarget)
        link=f'http://127.0.0.1:{receiver.server_address[1]}/outside'
        class RedirectServer(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header('Location',link)
                self.end_headers()
            def log_message(self,*args):pass
        redir=ThreadingHTTPServer(('127.0.0.1',0),RedirectServer)
        t1=threading.Thread(target=receiver.serve_forever,daemon=True);t1.start()
        t2=threading.Thread(target=redir.serve_forever,daemon=True);t2.start()
        try:
            self.host.ha_url=f'http://127.0.0.1:{redir.server_address[1]}'
            with self.assertRaises(urllib.error.HTTPError):self.host.read_homeassistant()
            self.assertEqual(seen,[])
        finally:
            redir.shutdown();redir.server_close();t2.join(2)
            receiver.shutdown();receiver.server_close();t1.join(2)

    def test_null_attributes_does_not_crash(self):
        class Server(BaseHTTPRequestHandler):
            def do_GET(self):
                data=json.dumps([{'entity_id':'sensor.rain','state':'0','attributes':None}]).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            def log_message(self,*args):pass
        srv=ThreadingHTTPServer(('127.0.0.1',0),Server)
        t=threading.Thread(target=srv.serve_forever,daemon=True);t.start()
        try:
            self.host.ha_url=f'http://127.0.0.1:{srv.server_address[1]}'
            self.assertEqual(self.host.read_homeassistant()['entities'][0]['name'],'sensor.rain')
        finally:srv.shutdown();srv.server_close();t.join(2)

if __name__=='__main__':unittest.main()
