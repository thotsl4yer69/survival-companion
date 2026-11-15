"""Tests covering Meshtastic PubSub bridge wiring without physical RF activity."""
import tempfile
import time
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from radio_bridge import RadioWorker


class RadioStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.host=app.Blackbox(Path(self.tmp.name)/'db.sqlite3',radio_enabled=True)
    def tearDown(self):self.tmp.cleanup()

    def test_malformed_packets_ignored_safely(self):
        worker=RadioWorker(self.host)
        for packet in (None,'str',[],{}, {'decoded':None},
                       {'decoded':{'portnum':'TEXT_MESSAGE_APP','text':None}},
                       {'decoded':{'portnum':'POSITION_APP','text':'nothing'}},
                       {'decoded':{'portnum':'TEXT_MESSAGE_APP','text':'   '}}):
            worker.on_receive(packet)
        self.assertEqual(self.host.store.one('SELECT COUNT(*) AS n FROM messages')['n'],0)

    def test_connection_loss_is_explicit(self):
        worker=RadioWorker(self.host)
        worker.on_lost()
        self.assertEqual(self.host.radio_state,'not-connected')
        self.assertIn('lost',self.host.radio_error)
        worker.stop()
        worker.on_lost()
        self.assertEqual(self.host.radio_state,'not-connected')

    def test_pubsub_registration_and_teardown(self):
        class Pub:
            def __init__(self):self.subscribed=[];self.unsubscribed=[]
            def subscribe(self,callback,topic):self.subscribed.append(topic)
            def unsubscribe(self,callback,topic):self.unsubscribed.append(topic)
        class Fake:
            def __init__(self):self.closed=0
            def close(self):self.closed+=1
            def sendText(self,*args,**kwargs):raise AssertionError('No messages released')
        radio=Fake();pub=Pub()
        worker=RadioWorker(self.host,interface_factory=lambda port:radio,pub=pub,reconnect_delay=.01)
        worker.start()
        time.sleep(.15)
        self.assertEqual(self.host.radio_state,'serial-connected-not-range-tested')
        worker.stop();worker.join(2)
        self.assertIn('meshtastic.receive.text',pub.subscribed)
        self.assertIn('meshtastic.connection.lost',pub.unsubscribed)
        self.assertGreaterEqual(radio.closed,1)
        self.assertEqual(self.host.radio_state,'stopped')

    def test_failed_connect_is_event_logged(self):
        def fail(port):raise OSError('no port found')
        worker=RadioWorker(self.host,interface_factory=fail,reconnect_delay=.2)
        worker.start();time.sleep(.1)
        self.assertEqual(self.host.radio_state,'not-connected')
        self.assertIn('OSError',self.host.radio_error)
        self.assertTrue(self.host.store.query('SELECT * FROM events WHERE source=?',('radio',)))
        worker.stop();worker.join(2)

if __name__=='__main__':unittest.main()
