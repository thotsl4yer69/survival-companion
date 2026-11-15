"""Validation, privacy and failure-path tests beyond the default API happy path."""
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from radio_bridge import RadioWorker


class HttpEdgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.host=app.Blackbox(Path(cls.tmp.name)/'test.sqlite3',token='123456789012345678901234567890',node_key='node12345678')
        cls.server=app.Server(('127.0.0.1',0),cls.host)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(2);cls.tmp.cleanup()

    def request(self,path,method='GET',payload=None,headers=None):
        hs={'Authorization':'Bearer 123456789012345678901234567890'}
        if headers:hs.update(headers)
        data=None if payload is None else json.dumps(payload).encode('utf-8')
        if data is not None:hs.setdefault('Content-Type','application/json')
        req=urllib.request.Request(self.base+path,method=method,data=data,headers=hs)
        try:
            with urllib.request.urlopen(req,timeout=3) as res:
                return res.status,json.loads(res.read()) if res.headers.get_content_type()=='application/json' else res.read()
        except urllib.error.HTTPError as exc:
            return exc.code,json.loads(exc.read())

    def test_release_requires_connected_serial_and_expires(self):
        status,created=self.request('/api/messages','POST',{'recipient':'broadcast','body':'fresh-only'})
        self.assertEqual(status,201)
        self.host.radio_enabled=True
        try:
            self.assertEqual(self.request('/api/messages/'+str(created['id'])+'/release','POST',{})[0],400)
            self.host.radio_state='serial-connected-not-range-tested'
            status,result=self.request('/api/messages/'+str(created['id'])+'/release','POST',{})
            self.assertEqual(status,200)
            self.assertTrue(result['queued_for_radio'])
            self.assertEqual(self.request('/api/status')[1]['pending_radio_messages'],1)
            self.host.store.execute('UPDATE messages SET released_at=? WHERE id=?',('2010-01-01T00:00:00Z',created['id']))
            self.assertIsNone(self.host.store.claim_radio_message())
            self.assertEqual(self.host.store.one('SELECT status FROM messages WHERE id=?',(created['id'],))['status'],'release-expired')
            self.assertGreater(self.request('/api/status')[1]['messages_needing_manual_review'],0)
        finally:
            self.host.radio_state='not-connected';self.host.radio_enabled=False

    def test_unconfigured_security_rejects_non_loopback_bind(self):
        no_token=app.Blackbox(Path(self.tmp.name)/'other.sqlite3',token='')
        with self.assertRaises(ValueError):app.serve(no_token,host='0.0.0.0',port=0)

    def test_static_security_headers(self):
        req=urllib.request.Request(self.base+'/app.js')
        with urllib.request.urlopen(req,timeout=3) as response:
            self.assertEqual(response.headers['X-Frame-Options'],'DENY')
            self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
            self.assertEqual(response.headers['Cache-Control'],'no-store')
            self.assertIn('frame-ancestors',response.headers['Content-Security-Policy'])

    def test_bad_note_body_and_patch_do_not_change_records(self):
        self.assertEqual(self.request('/api/notes','POST',{'title':'ok','body':''})[0],400)
        self.assertEqual(self.request('/api/supplies/999999','PATCH',{'quantity':1})[0],404)
        self.assertEqual(self.request('/api/checklist/999999','PATCH',{'checked':True})[0],404)

    def test_size_limit_rejects_large_json(self):
        status,_=self.request('/api/notes','POST',{'title':'A','body':'A'*66000})
        self.assertEqual(status,400)

    def test_unknown_route_and_bad_knowledge_search(self):
        self.assertEqual(self.request('/api/no-such-route')[0],404)
        self.assertEqual(self.request('/api/knowledge/search?q=%20%20%20')[1],[])

    def test_power_invalid_loads_and_unit(self):
        self.assertEqual(self.request('/api/power/estimate','POST',{'capacity_wh':100,'loads_w':'watts'})[0],400)
        self.assertEqual(self.request('/api/power/estimate','POST',{'capacity_wh':100,'loads_w':{'computer':True}})[0],400)

    def test_direct_radio_message_request_contract(self):
        from radio_bridge import RadioWorker
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status,released_at) VALUES(?,?,?,?,?,?)",
                                ('outgoing','BLACKBOX','!12345678','direct hello','queued-for-radio',app.UTC()))
        class FakeRadio:
            def __init__(self):self.args=None
            def sendText(self,message,**kwargs):self.args=(message,kwargs);return {'id':922}
        radio=FakeRadio();worker=RadioWorker(self.host,interface_factory=lambda port:radio)
        worker.interface=radio;worker._send_next()
        self.assertEqual(radio.args[1]['destinationId'],'!12345678')
        self.assertTrue(radio.args[1]['wantAck'])
        self.assertEqual(self.host.store.one('SELECT status FROM messages WHERE body=?',('direct hello',))['status'],
                         'submitted-to-radio-unconfirmed')


class LocalAssistantTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.host=app.Blackbox(Path(self.tmp.name)/'test.sqlite3',model='an-installed-model-only')

    def tearDown(self):self.tmp.cleanup()

    def test_model_request_is_loopback_and_response_is_marked_uncertain(self):
        class Dummy:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return json.dumps({'response':'Citation not found; verify locally'}).encode()
        def fake(request,timeout):
            self.assertEqual(request.full_url,'http://127.0.0.1:11434/api/generate')
            data=json.loads(request.data)
            self.assertEqual(data['model'],'an-installed-model-only')
            self.assertIn('Only cite',data['prompt'])
            return Dummy()
        class Opener:
            def open(self,request,timeout):return fake(request,timeout)
        original=urllib.request.build_opener
        def secure_opener(*handlers):
            self.assertTrue(any(isinstance(h,urllib.request.ProxyHandler) and not h.proxies for h in handlers))
            self.assertTrue(any(isinstance(h,urllib.request.HTTPRedirectHandler) and type(h) is not urllib.request.HTTPRedirectHandler for h in handlers))
            return Opener()
        with patch('urllib.request.build_opener',side_effect=secure_opener):
            result=self.host.assist('water',True)
        self.assertEqual(result['mode'],'local-ollama')
        self.assertIn('not verified',result['warning'])

    def test_numeric_and_utf8_input_bounds(self):
        with self.assertRaises(ValueError):app.safe_number(float('nan'),'charge')
        with self.assertRaises(ValueError):app.bad_text('X'*600,'label',100)
        with self.assertRaises(ValueError):app.bad_text('\x00','label',10)

if __name__=='__main__':unittest.main()
