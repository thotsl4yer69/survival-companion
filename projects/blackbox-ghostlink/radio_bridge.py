"""Opt-in Meshtastic serial adapter with bounded reconnection attempts.

All outbound messages must be manually released. A serial write NEVER means
end-to-end delivery; the dashboard displays 'submitted-to-radio-unconfirmed'.
"""
import threading


class RadioWorker(threading.Thread):
    def __init__(self, app, interface_factory=None, pub=None, reconnect_delay=10):
        super().__init__(daemon=True,name="ghostlink-radio")
        self.app=app
        self.interface_factory=interface_factory
        self.pub=pub
        self.reconnect_delay=reconnect_delay
        self.done=threading.Event()
        self.interface=None

    def stop(self):
        self.done.set()
        if self.interface is not None:
            try:self.interface.close()
            except Exception:pass

    def on_lost(self,interface=None,**kwargs):
        if not self.done.is_set():
            self.app.radio_state="not-connected"
            self.app.radio_error="Serial radio connection reported lost"

    def on_receive(self,packet,interface=None):
        if not isinstance(packet,dict):return
        decoded=packet.get("decoded",{})
        if not isinstance(decoded,dict):return
        if decoded.get("portnum") not in ("TEXT_MESSAGE_APP",1,"1"):
            return
        body=decoded.get("text")
        if not isinstance(body,str):return
        body=body.strip()[:200]
        if not body:return
        sender=str(packet.get("fromId") or packet.get("from") or "unknown")[:80]
        packet_id=str(packet.get("id") or "")[:80]
        # Uniqueness is enforced by SQLite, not volatile RAM (survives restarts).
        self.app.store.execute("INSERT OR IGNORE INTO messages(direction,sender,recipient,body,status,packet_id) VALUES(?,?,?,?,?,?)",
                               ("incoming",sender,"BLACKBOX",body,"received-by-radio",packet_id))

    def _connect(self):
        if self.interface_factory is None:
            import meshtastic.serial_interface
            from pubsub import pub
            self.pub=pub
            self.interface_factory=lambda port:meshtastic.serial_interface.SerialInterface(devPath=port or None)
        self.interface=self.interface_factory(self.app.serial_port)
        if self.interface is None:
            raise OSError("No serial radio interface opened")
        self.app.radio_state="serial-connected-not-range-tested"
        self.app.radio_error=""
        self.app.store.event("radio","Serial Meshtastic connection opened; RF range/delivery unverified")

    def _send_next(self):
        msg=self.app.store.claim_radio_message()
        if not msg:return
        try:
            dest='^all' if msg['recipient']=='broadcast' else msg['recipient']
            packet=self.interface.sendText(msg['body'],destinationId=dest,
                                            wantAck=dest!='^all',channelIndex=0)
            packet_id=str(packet.get("id", "")) if isinstance(packet,dict) else ""
            self.app.store.execute("UPDATE messages SET status='submitted-to-radio-unconfirmed',packet_id=?,error='' WHERE id=?",
                                   (packet_id,msg['id']))
        except Exception as error:
            # Never retry a transmission automatically; the radio could have sent it
            # just before a serial error was raised.
            self.app.store.execute("UPDATE messages SET status='failed-transmission-uncertain',error=? WHERE id=?",
                                   (type(error).__name__+": "+str(error)[:120],msg['id']))
            self.app.radio_error="Send failed: "+type(error).__name__
            raise

    def run(self):
        try:
            if self.pub is not None:
                self.pub.subscribe(self.on_receive,"meshtastic.receive.text")
                self.pub.subscribe(self.on_lost,"meshtastic.connection.lost")
                self._subscribed=True
            while not self.done.is_set():
                try:
                    self._connect()
                    # The Meshtastic library obtains PubSub during _connect on a fresh import.
                    if self.pub is not None and not getattr(self,'_subscribed',False):
                        self.pub.subscribe(self.on_receive,"meshtastic.receive.text")
                        self.pub.subscribe(self.on_lost,"meshtastic.connection.lost")
                        self._subscribed=True
                    while not self.done.wait(1.0):
                        if self.app.radio_state=="not-connected":
                            raise OSError("Radio serial connection lost")
                        self._send_next()
                except Exception as error:
                    self.app.radio_state="not-connected"
                    self.app.radio_error=type(error).__name__+": "+str(error)[:140]
                    self.app.store.event("radio","Bridge disconnected: "+type(error).__name__)
                finally:
                    if self.interface is not None:
                        try:self.interface.close()
                        except Exception:pass
                        self.interface=None
                if not self.done.is_set():self.done.wait(self.reconnect_delay)
        finally:
            if self.pub is not None:
                for callback,topic in [(self.on_receive,"meshtastic.receive.text"),(self.on_lost,"meshtastic.connection.lost")]:
                    try:self.pub.unsubscribe(callback,topic)
                    except Exception:pass
            self.app.radio_state="stopped"
