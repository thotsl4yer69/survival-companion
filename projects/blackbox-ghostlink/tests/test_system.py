"""HTTP, persistence, validation, security, optional adapters and CAD release tests."""
import json
import math
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from radio_bridge import RadioWorker


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.host=app.Blackbox(Path(cls.tmp.name)/'test.sqlite3', token='local-test-access-token-1234567', node_key='separate-sensor-token-12345')
        cls.server=app.Server(('127.0.0.1',0),cls.host)
        cls.port=cls.server.server_address[1]
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(2);cls.tmp.cleanup()

    def request(self,path,method='GET',payload=None, token=True, node=False,ctype='application/json'):
        headers={}
        if token:headers['Authorization']='Bearer local-test-access-token-1234567'
        if node:headers['X-Node-Key']='separate-sensor-token-12345'
        if payload is not None:
            headers['Content-Type']=ctype
            data=json.dumps(payload,allow_nan=True).encode('utf-8')
        else:data=None
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}{path}',data=data,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,timeout=3) as r:
                raw=r.read()
                return r.status,json.loads(raw) if r.headers.get_content_type()=='application/json' else raw,r.headers
        except urllib.error.HTTPError as e:
            return e.code,json.loads(e.read()),e.headers

    def test_01_health(self):
        self.assertEqual(self.request('/api/health',token=False)[0],200)

    def test_02_auth_required(self):
        self.assertEqual(self.request('/api/status',token=False)[0],401)

    def test_03_status_truthful(self):
        s=self.request('/api/status')[1]
        self.assertFalse(s['radio']['enabled'])
        self.assertFalse(s['maps']['gps_receiver_connected'])
        self.assertFalse(s['assistant']['local_model_configured'])
        self.assertEqual(s['radio']['state'],'disabled')

    def test_04_static_csp(self):
        status,document,headers=self.request('/')
        self.assertEqual(status,200)
        self.assertIn(b'BLACKBOX',document)
        self.assertIn('script-src',headers['Content-Security-Policy'])

    def test_05_create_supply(self):
        self.assertEqual(self.request('/api/supplies','POST',{'name':'Test water','quantity':6,'minimum':10,'unit':'L'})[0],201)
        items=self.request('/api/supplies')[1]
        self.assertTrue(any(x['name']=='Test water' for x in items))

    def test_06_supply_update_and_minimum(self):
        self.request('/api/supplies','POST',{'name':'Reserve', 'quantity':1,'minimum':8})
        item=next(x for x in self.request('/api/supplies')[1] if x['name']=='Reserve')
        self.assertEqual(self.request('/api/supplies/'+str(item['id']),'PATCH',{'quantity':11})[0],200)
        self.assertEqual(self.request('/api/status')[1]['inventory']['below_minimum'],1) # test water still below

    def test_07_supply_negative_rejected(self):
        self.assertEqual(self.request('/api/supplies','POST',{'name':'bad','quantity':-1})[0],400)

    def test_08_supply_nan_rejected(self):
        self.assertEqual(self.request('/api/supplies','POST',{'name':'bad','quantity':float('nan')})[0],400)

    def test_09_supply_bad_date_rejected(self):
        self.assertEqual(self.request('/api/supplies','POST',{'name':'bad','quantity':4,'expiry':'2026-99-99'})[0],400)

    def test_10_supply_sql_injection_treated_as_text(self):
        self.assertEqual(self.request('/api/supplies','POST',{'name':"x'); DROP TABLE supplies;--",'quantity':1})[0],201)
        self.assertGreater(len(self.request('/api/supplies')[1]),1)

    def test_11_notes(self):
        self.assertEqual(self.request('/api/notes','POST',{'title':'Checkpoint','body':'Battery tested'})[0],201)
        self.assertTrue(any(x['title']=='Checkpoint' for x in self.request('/api/notes')[1]))

    def test_12_notes_no_empty(self):
        self.assertEqual(self.request('/api/notes','POST',{'title':'','body':'text'})[0],400)

    def test_13_messages_local_only(self):
        code,created,_=self.request('/api/messages','POST',{'recipient':'broadcast','body':'Check in at 14:00'})
        self.assertEqual(code,201)
        self.assertFalse(created['transmitted'])
        self.assertEqual(created['status'],'local-only')
        self.assertEqual(self.request('/api/messages/'+str(created['id'])+'/release','POST',{})[0],400)

    def test_14_invalid_recipient(self):
        self.assertEqual(self.request('/api/messages','POST',{'recipient':'my friend','body':'hello'})[0],400)

    def test_15_message_utf8_limit(self):
        self.assertEqual(self.request('/api/messages','POST',{'recipient':'broadcast','body':'界'*80})[0],400)

    def test_16_local_only_message_list(self):
        self.assertTrue(any(x['status']=='local-only' for x in self.request('/api/messages')[1]))

    def test_17_knowledge_indexed(self):
        self.assertGreaterEqual(len(self.request('/api/knowledge')[1]),6)

    def test_18_knowledge_search(self):
        result=self.request('/api/knowledge/search?q=water')[1]
        self.assertTrue(any('water' in x['title'].lower() or 'water' in x['body'].lower() for x in result))

    def test_19_knowledge_document(self):
        result=self.request('/api/knowledge/01-water')[1]
        self.assertIn('boiling',result['body'].lower())

    def test_20_offline_assistant_without_model(self):
        data=self.request('/api/assistant','POST',{'question':'radio'})[1]
        self.assertEqual(data['mode'],'offline-search')
        self.assertFalse('model' in data['answer'].lower() and 'inference performed' not in data['answer'])

    def test_21a_use_model_must_be_boolean(self):
        self.assertEqual(self.request('/api/assistant','POST',{'question':'radio','use_model':'false'})[0],400)

    def test_21_model_not_installed(self):
        self.assertEqual(self.request('/api/assistant','POST',{'question':'radio','use_model':True})[0],400)

    def test_22_waypoint_bounds(self):
        self.assertEqual(self.request('/api/waypoints','POST',{'name':'invalid','latitude':100,'longitude':0})[0],400)

    def test_23_waypoint_export_safe(self):
        self.assertEqual(self.request('/api/waypoints','POST',{'name':'Forest & river <camp>','latitude':-36.75,'longitude':144.28,'notes':'Near <bridge>'})[0],201)
        geo=self.request('/api/waypoints.geojson')[1]
        self.assertEqual(geo['features'][0]['geometry']['coordinates'],[144.28,-36.75])
        xml=self.request('/api/waypoints.gpx')[1].decode('utf-8')
        self.assertIn('Forest &amp; river &lt;camp&gt;',xml)

    def test_24_telemetry_token_missing(self):
        self.assertEqual(self.request('/api/telemetry','POST',{'node_id':'a','values':{'uptime_s':1}},token=False)[0],401)

    def test_25_telemetry_uses_separate_key(self):
        self.assertEqual(self.request('/api/telemetry','POST',{'node_id':'a','values':{'uptime_s':1}},token=False,node=True)[0],201)
        self.assertTrue(any(x['node_id']=='a' for x in self.request('/api/telemetry')[1]))

    def test_26_telemetry_input_validation(self):
        self.assertEqual(self.request('/api/telemetry','POST',{'node_id':'../../x','values':{'a':1}},token=False,node=True)[0],400)
        self.assertEqual(self.request('/api/telemetry','POST',{'node_id':'x','values':{'temp':float('inf')}},token=False,node=True)[0],400)

    def test_27_telemetry_cannot_use_bearer(self):
        self.assertEqual(self.request('/api/telemetry','POST',{'node_id':'x','values':{'a':1}},token=True,node=False)[0],401)

    def test_28_backup_valid_sqlite(self):
        code,blob,headers=self.request('/api/backup')
        self.assertEqual(code,200)
        self.assertTrue(blob.startswith(b'SQLite format 3'))
        with tempfile.NamedTemporaryFile(suffix='.sqlite3') as temp:
            temp.write(blob);temp.flush()
            con=sqlite3.connect(temp.name)
            try:self.assertEqual(con.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            finally:con.close()

    def test_29_delete_existing_and_missing(self):
        self.request('/api/waypoints','POST',{'name':'Transient','latitude':0,'longitude':0})
        waypoints=self.request('/api/waypoints')[1]
        i=next(x['id'] for x in waypoints if x['name']=='Transient')
        self.assertTrue(self.request('/api/waypoints/'+str(i),'DELETE')[1]['deleted'])
        self.assertFalse(self.request('/api/waypoints/'+str(i),'DELETE')[1]['deleted'])

    def test_30_invalid_json_type(self):
        self.assertEqual(self.request('/api/notes','POST',{'title':'a','body':'b'},ctype='text/plain')[0],400)

    def test_31_missing_route(self):
        self.assertEqual(self.request('/api/missing')[0],404)

    def test_32_home_assistant_config_missing(self):
        self.assertFalse(self.request('/api/homeassistant')[1]['configured'])

    def test_33_checklist_persisted(self):
        entries=self.request('/api/checklist')[1]
        self.assertEqual(len(entries),5)
        item=entries[0]
        self.assertEqual(self.request('/api/checklist/'+str(item['id']),'PATCH',{'checked':True})[0],200)
        checked=self.request('/api/checklist')[1][0]
        self.assertEqual(checked['checked'],1)
        self.assertTrue(checked['checked_at'])

    def test_34_checklist_boolean_required(self):
        self.assertEqual(self.request('/api/checklist/1','PATCH',{'checked':1})[0],400)

    def test_35_power_estimate(self):
        code,result,_=self.request('/api/power/estimate','POST',{
            'capacity_wh':500,'efficiency_percent':80,'reserve_percent':20,
            'loads_w':{'computer':20,'radio':5}})
        self.assertEqual(code,200)
        self.assertEqual(result['usable_wh'],320)
        self.assertEqual(result['total_load_w'],25)
        self.assertEqual(result['estimated_hours'],12.8)

    def test_36_power_zero_load(self):
        result=self.request('/api/power/estimate','POST',{'capacity_wh':500,'loads_w':{'computer':0}})[1]
        self.assertIsNone(result['estimated_hours'])

    def test_37_power_invalid(self):
        code,_,_=self.request('/api/power/estimate','POST',{'capacity_wh':500,'efficiency_percent':101,'loads_w':{'computer':20}})
        self.assertEqual(code,400)

    def test_39_standalone_printable_field_report(self):
        self.assertEqual(self.request('/api/field-report',token=False)[0],401)
        self.request('/api/supplies','POST',{'name':'<script>alert(1)</script>','quantity':5,'notes':'Shelf <3'})
        code,contents,headers=self.request('/api/field-report')
        self.assertEqual(code,200)
        self.assertEqual(headers.get_content_type(),'text/html')
        doc=contents.decode('utf-8')
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;',doc)
        self.assertNotIn('<script>alert(1)</script>',doc)
        self.assertIn('Check certified alarms and exits',doc)
        self.assertIn('Saved waypoints',doc)
        self.assertIn('This document is self-contained',doc)
        self.assertIn('attachment;',headers['Content-Disposition'])

    def test_38_raster_mbtiles_tms_conversion(self):
        path=Path(self.tmp.name)/'offline-test-map.mbtiles'
        db=sqlite3.connect(path)
        try:
            db.execute('CREATE TABLE metadata (name TEXT,value TEXT)')
            db.execute("INSERT INTO metadata VALUES('format','png')")
            db.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
            db.execute('INSERT INTO tiles VALUES (?,?,?,?)',(2,1,3,b'PNG_TEST_TILE'))
            db.commit()
        finally:db.close()
        self.host.mbtiles=path
        try:
            state=self.request('/api/status')[1]
            self.assertTrue(state['maps']['mbtiles_raster_usable'])
            code,blob,headers=self.request('/api/tiles/2/1/0.png')
            self.assertEqual(code,200)
            self.assertEqual(blob,b'PNG_TEST_TILE')
            self.assertEqual(headers.get_content_type(),'image/png')
            self.assertEqual(self.request('/api/tiles/2/1/1.png')[0],404)
        finally:self.host.mbtiles=None


class UnitTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.host=app.Blackbox(Path(self.tmp.name)/'test.sqlite3')
    def tearDown(self): self.tmp.cleanup()

    def test_33_legacy_migration(self):
        old=Path(self.tmp.name)/'old.sqlite3'
        con=sqlite3.connect(old)
        try:
            con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY,direction TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            con.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES ('outgoing','BLACKBOX','broadcast','old','queued locally — no radio connected')")
            con.commit()
        finally:con.close()
        store=app.Store(old)
        self.assertEqual(store.one('SELECT status FROM messages')['status'],'local-only')
        self.assertIn('packet_id',store.one('SELECT * FROM messages'))

    def test_34_no_radio_worker_until_opt_in(self):
        self.assertFalse(self.host.radio_enabled)
        self.assertEqual(self.host.radio_state,'disabled')

    def test_35_radio_never_sends_local_only(self):
        self.host.radio_enabled=True
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES (?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','must not send','local-only'))
        class Dummy:
            def __init__(self):self.sent=[]
            def sendText(self,body,**kwargs):self.sent.append((body,kwargs));return {'id':123}
            def close(self):pass
        fake=Dummy()
        worker=RadioWorker(self.host,interface_factory=lambda port:fake)
        worker.start();time.sleep(1.2);worker.stop();worker.join(2)
        self.assertEqual(fake.sent,[])

    def test_36_radio_sends_only_released(self):
        self.host.radio_enabled=True
        self.host.store.execute("INSERT INTO messages(direction,sender,recipient,body,status) VALUES (?,?,?,?,?)",
                                ('outgoing','BLACKBOX','broadcast','release test','queued-for-radio'))
        self.host.store.execute("UPDATE messages SET released_at=? WHERE body=?",(app.UTC(),'release test'))
        class Dummy:
            def __init__(self):self.sent=[]
            def sendText(self,body,**kwargs):self.sent.append((body,kwargs));return {'id':43}
            def close(self):pass
        fake=Dummy()
        worker=RadioWorker(self.host,interface_factory=lambda port:fake)
        worker.start();time.sleep(1.3);worker.stop();worker.join(2)
        self.assertEqual(len(fake.sent),1)
        self.assertEqual(fake.sent[0][1]['destinationId'],'^all')
        self.assertEqual(self.host.store.one('SELECT status FROM messages')['status'],'submitted-to-radio-unconfirmed')

    def test_37_incoming_dedup(self):
        worker=RadioWorker(self.host,interface_factory=lambda port:None)
        packet={'fromId':'!12345678','id':100,'decoded':{'portnum':'TEXT_MESSAGE_APP','text':'Test inbound'}}
        worker.on_receive(packet)
        worker.on_receive(packet)
        self.assertEqual(self.host.store.one('SELECT COUNT(*) n FROM messages')['n'],1)

    def test_38_bad_radio_port_ignored(self):
        worker=RadioWorker(self.host,interface_factory=lambda port:None)
        worker.on_receive({'decoded':{'portnum':'POSITION_APP','text':'not text'}})
        self.assertEqual(self.host.store.one('SELECT COUNT(*) n FROM messages')['n'],0)

    def test_39_public_ha_host_rejected(self):
        self.host.ha_url='https://example.com'
        self.host.ha_token='not-a-real-token'
        with self.assertRaises(ValueError):self.host.read_homeassistant()

    def test_40_local_ha_read_only_contract(self):
        class HAHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('Authorization')!='Bearer a-test-token':
                    self.send_error(401);return
                payload=json.dumps([{'entity_id':'sensor.temperature','state':'21.3','attributes':{'friendly_name':'Temperature'}},
                    {'entity_id':'automation.bad','state':'on','attributes':{}}]).encode()
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),HAHandler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            self.host.ha_url='http://127.0.0.1:'+str(server.server_address[1]);self.host.ha_token='a-test-token'
            resp=self.host.read_homeassistant()
            self.assertTrue(resp['read_only'])
            self.assertEqual(len(resp['entities']),1)
            self.assertEqual(resp['entities'][0]['name'],'Temperature')
        finally:server.shutdown();server.server_close()

    def test_41_knowledge_search_no_match(self):
        self.assertEqual(self.host.store.search_knowledge('xyzxyz_unlikely_no_match'),[])

    def test_42_validations_do_not_convert_garbage(self):
        with self.assertRaises(ValueError):app.validate_supply({'name':'x','quantity':'not a number'})
        with self.assertRaises(ValueError):app.safe_date('2026-02-30')

    def test_43_telemetry_not_enabled_by_default(self):
        self.assertFalse(self.host.node_key)

    def test_44_ensure_no_debug_mock_records(self):
        self.assertEqual(self.host.store.query('SELECT * FROM supplies'),[])
        self.assertEqual(self.host.store.query('SELECT * FROM telemetry'),[])

    def test_45_cad_watertight_if_trimesh_available(self):
        try:import trimesh
        except ImportError:self.skipTest('trimesh not installed')
        hardware=Path(__file__).resolve().parents[1]/'hardware'
        for name in ('field_node_base.stl','field_node_lid.stl','jetson_open_tray.stl'):
            self.assertTrue((hardware/name).exists())
            self.assertTrue(trimesh.load_mesh(hardware/name).is_watertight)

    def test_46_hardware_probe_never_invents_jetson(self):
        import importlib.util
        path=Path(__file__).resolve().parents[1]/'tools'/'hardware_probe.py'
        spec=importlib.util.spec_from_file_location('blackbox_host_probe',path)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result=module.probe()
        self.assertEqual(result['architecture'],__import__('platform').machine())
        self.assertIn('serial_candidates_not_verified',result)
        self.assertIn('jetson_board_model',result)

if __name__=='__main__': unittest.main()
