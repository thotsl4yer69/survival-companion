"""FORGE acceptance tests (campaign/TARGET.md F1-F15) against a fault-injecting local server.

Network-free. Set FORGE_TEST_EXFAT=/path/on/an/exfat/volume to repeat the core tests on exFAT.
"""
from __future__ import annotations

import contextlib
import errno
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import shutil
import socket
import struct
import subprocess
import tarfile
import urllib.request
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "forge"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


forge = load_module("forge_under_test", ROOT / "forge" / "forge.py")
os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
os.environ.setdefault("no_proxy", "127.0.0.1,localhost")


# --------------------------------------------------------------------------- fault-injecting server

class Route:
    def __init__(self, body: bytes = b"", *, ranges=True, drops=None, corrupt=None, always_corrupt=False,
                 statuses=None, retry_after="0", etag_per_request=False, wrong_range_once=False,
                 redirect=None, headers=None, claim_total=None, status=200,
                 reset_after=None, resets=0, stall_after=None, stall=0.0, stalls=0, trickle=None):
        self.reset_after, self.resets = reset_after, resets
        self.stall_after, self.stall, self.stalls = stall_after, stall, stalls
        self.trickle = trickle
        self.body = body
        self.ranges = ranges
        self.drops = list(drops or [])
        self.corrupt = corrupt
        self.always_corrupt = always_corrupt
        self.corrupted = False
        self.statuses = list(statuses or [])
        self.retry_after = retry_after
        self.etag_per_request = etag_per_request
        self.wrong_range_once = wrong_range_once
        self.wrong_sent = False
        self.redirect = redirect
        self.headers = dict(headers or {})
        self.claim_total = claim_total
        self.status = status


class FaultHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self._serve(head=True)

    def do_GET(self):
        self._serve(head=False)

    def _simple(self, code, headers=None, body=b""):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _serve(self, head):
        srv = self.server
        path = urllib.parse.urlsplit(self.path).path
        rng = self.headers.get("Range")
        with srv.lock:
            srv.counter += 1
            srv.log.append((self.command, path, rng))
            route = srv.routes.get(path)
            status_override = route.statuses.pop(0) if route and route.statuses else None
            drop = route.drops.pop(0) if route and route.drops and not head else None
        if route is None:
            return self._simple(404)
        if status_override is not None:
            return self._simple(status_override, {"Retry-After": route.retry_after})
        if route.redirect:
            return self._simple(302, dict(route.headers, Location=route.redirect))
        body, start, status = route.body, 0, route.status
        if rng and route.ranges:
            match = re.fullmatch(r"bytes=(\d+)-", rng)
            start = int(match.group(1))
            if start >= len(body):
                return self._simple(416, {"Content-Range": f"bytes */{len(body)}"})
            status = 206
        payload = bytearray(body[start:])
        if route.corrupt is not None and (route.always_corrupt or not route.corrupted):
            off = route.corrupt - start
            if 0 <= off < len(payload):
                payload[off] ^= 0xFF
                route.corrupted = True
        self.send_response(status)
        if status == 206:
            cr_start = start
            if route.wrong_range_once and not route.wrong_sent:
                cr_start, route.wrong_sent = start + 1, True
            total = route.claim_total or len(body)
            self.send_header("Content-Range", f"bytes {cr_start}-{len(body) - 1}/{total}")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", f'"{srv.counter}"' if route.etag_per_request else '"fixed"')
        for k, v in route.headers.items():
            self.send_header(k, v)
        self.end_headers()
        if head:
            return
        with srv.lock:
            do_reset = route.reset_after is not None and route.resets > 0
            if do_reset:
                route.resets -= 1
            do_stall = route.stall_after is not None and route.stalls > 0
            if do_stall:
                route.stalls -= 1
        if do_reset:  # TCP RST mid-body -> ConnectionResetError on the client
            self.wfile.write(bytes(payload[:route.reset_after]))
            self.wfile.flush()
            self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            self.close_connection = True
            self.connection.close()
            return
        if do_stall:  # stop sending long enough for the client's read timeout
            self.wfile.write(bytes(payload[:route.stall_after]))
            self.wfile.flush()
            time.sleep(route.stall)
            self.close_connection = True
            return
        if route.trickle is not None:  # 1 byte at a time, each well inside the read timeout
            for i in range(len(payload)):
                try:
                    self.wfile.write(bytes(payload[i:i + 1]))
                    self.wfile.flush()
                except OSError:
                    return
                time.sleep(route.trickle)
            return
        if drop is not None:
            self.wfile.write(bytes(payload[:drop]))
            self.wfile.flush()
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return
        self.wfile.write(bytes(payload))


class FaultServer:
    def __init__(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FaultHandler)
        self.httpd.daemon_threads = True
        self.httpd.routes = {}
        self.httpd.log = []
        self.httpd.counter = 0
        self.httpd.lock = threading.Lock()
        self.httpd.handle_error = lambda request, address: None  # resets/stalls make the server side error too
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def add(self, path, route):
        self.httpd.routes[path] = route
        return self.base + path

    @property
    def log(self):
        return self.httpd.log

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def blob(n, seed=1):
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hashlib.sha256(f"{seed}:{counter}".encode()).digest()
        counter += 1
    return bytes(out[:n])


def meta4_for(name, body, urls, piece=64 * 1024):
    pieces = "".join(f"<hash>{hashlib.sha1(body[i:i + piece]).hexdigest()}</hash>"
                     for i in range(0, len(body), piece))
    url_xml = "".join(f'<url priority="{i + 1}">{u}</url>' for i, u in enumerate(urls))
    return (f'<?xml version="1.0" encoding="UTF-8"?><metalink xmlns="urn:ietf:params:xml:ns:metalink">'
            f'<file name="{name}"><size>{len(body)}</size>'
            f'<hash type="md5">{hashlib.md5(body).hexdigest()}</hash>'
            f'<hash type="sha-256">{hashlib.sha256(body).hexdigest()}</hash>'
            f'<pieces length="{piece}" type="sha-1">{pieces}</pieces>{url_xml}</file></metalink>').encode()


class ForgeCase(unittest.TestCase):
    base_dir = None

    def setUp(self):
        parent = os.environ.get("FORGE_TEST_EXFAT") if self.base_dir == "exfat" else None
        if os.name == "nt":  # CI temp folders are deep; the long-path rule has its own unit test
            patcher = mock.patch.object(forge, "windows_long_paths_enabled", return_value=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.tmp = Path(tempfile.mkdtemp(prefix="forge-", dir=parent))
        self.server = FaultServer()
        self.http = forge.Http(timeout=5, allow_http_loopback=True)
        self.out = io.StringIO()
        self.vault, _, _ = forge.Vault.create(self.tmp / "vault", "TEST")
        self.dl = forge.Downloader(self.vault, self.http, sleep=lambda s: None, out=self.out)

    def tearDown(self):
        self.server.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def spec(self, body, urls, rel="docs/file.bin", pieces=None, **kw):
        return forge.FileSpec(rel=rel, size=len(body), sha256=hashlib.sha256(body).hexdigest(), pieces=pieces,
                              urls=urls, source=urls[0], **kw)

    def pieces(self, body, piece=64 * 1024):
        return forge.Pieces(piece, [hashlib.sha1(body[i:i + piece]).hexdigest() for i in range(0, len(body), piece)])

    def final(self, rel):
        return forge.os_path(self.vault.root, rel)

    def ranges_requested(self, path):
        return [r for (m, p, r) in self.server.log if p == path and m == "GET"]


# --------------------------------------------------------------------------- F2 path rules

class PathRuleTests(unittest.TestCase):
    def test_accepts_normal_vault_paths(self):
        for rel in ("knowledge/zim/wikipedia_en_all_maxi_2026-08.zim", "ai/ollama/blobs/sha256-" + "a" * 64,
                    "ai/ollama/manifests/registry.ollama.ai/library/qwen3.5/4b"):
            self.assertEqual(forge.check_relpath(rel), rel)

    def test_rejects_windows_and_exfat_hazards(self):
        bad = ["", "/abs", "a\\b", "a/../b", "a//b", "./a", "a/b.", "a/b ", " a", "a/CON", "a/com1.txt",
               "a/LPT9", "a/aux.zim", "a/b:c", "a/b?c", 'a/b"c', "a/b<c", "a/b|c", "a/b*c", "a/\x01b",
               "x" * 201, "a/" + "y" * 121]
        for rel in bad:
            with self.subTest(rel=rel), self.assertRaises(forge.ForgeError):
                forge.check_relpath(rel)

    def test_windows_path_budget(self):
        self.assertIsNone(forge.windows_path_budget_problem("E:\\BLACKBOX", True, False))
        self.assertIsNone(forge.windows_path_budget_problem("C:\\" + "d" * 100, True, True))
        self.assertIsNone(forge.windows_path_budget_problem("/" + "d" * 100, False, False))
        self.assertIn("too long", forge.windows_path_budget_problem("C:\\" + "d" * 100, True, False))

    def test_case_collisions_rejected(self):
        forge.check_collisions(["a/B.zim", "a/c.zim"])
        with self.assertRaises(forge.ForgeError):
            forge.check_collisions(["a/B.zim", "a/b.zim"])


# --------------------------------------------------------------------------- catalogue

class CatalogTests(unittest.TestCase):
    def test_shipped_catalogue_is_valid_and_paths_are_safe(self):
        catalog = forge.load_catalog([ROOT / "forge" / "catalog.json"])
        self.assertGreaterEqual(len(catalog["items"]), 80)
        for name in ("test", "scout", "field", "maximum"):
            items = forge.profile_items(catalog, name)
            self.assertTrue(items, name)
        maximum = forge.profile_items(catalog, "maximum")
        self.assertTrue(set(forge.profile_items(catalog, "scout")) <= set(maximum))
        for item_id, item in catalog["items"].items():
            self.assertIn(item.get("commercial"), forge.COMMERCIAL, item_id)
            if item["kind"] == "http":
                forge.check_relpath(item["dest"])
                self.assertTrue(item["url"].startswith("https://"))

    def test_non_commercial_items_are_flagged(self):
        catalog = forge.load_catalog([ROOT / "forge" / "catalog.json"])
        for item_id in ("ifixit", "khanacademy", "libretexts-med", "trueprepper", "medlineplus"):
            self.assertEqual(catalog["items"][item_id]["commercial"], "no", item_id)

    def _catalog(self, items, profiles):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        path = tmp / "c.json"
        path.write_text(json.dumps({"schema": 2, "items": items, "profiles": profiles}))
        return path

    def test_rejects_bad_catalogues(self):
        ok = {"kind": "kiwix", "path": "other", "name": "x_en", "title": "t", "category": "knowledge", "licence": "l"}
        cases = [
            ({"a1": dict(ok, kind="ftp")}, {}),
            ({"a1": dict(ok, category="nope")}, {}),
            ({"a1": {k: v for k, v in ok.items() if k != "licence"}}, {}),
            ({"a1": ok}, {"p1": {"items": ["missing"]}}),
            ({"a1": ok}, {"p1": {"extends": ["p2"]}, "p2": {"extends": ["p1"]}}),
            ({"h1": {"kind": "http", "url": "http://x/y", "dest": "docs/y", "sha256": "0" * 64, "title": "t",
                     "category": "reference", "licence": "l"}}, {}),
            ({"h1": {"kind": "http", "url": "https://x/y", "dest": "docs/y", "title": "t", "category": "reference",
                     "licence": "l"}}, {}),
            ({"h1": {"kind": "http", "url": "https://x/y", "dest": "docs/CON", "sha256": "0" * 64, "title": "t",
                     "category": "reference", "licence": "l"}}, {}),
        ]
        for items, profiles in cases:
            with self.subTest(items=list(items), profiles=profiles), self.assertRaises(forge.ForgeError):
                forge.load_catalog([self._catalog(items, profiles)])

    def test_profile_inheritance_order_and_dedupe(self):
        ok = {"kind": "kiwix", "path": "other", "name": "x_en", "title": "t", "category": "knowledge", "licence": "l"}
        path = self._catalog({"a1": ok, "b1": ok, "c1": ok},
                             {"base": {"items": ["a1", "b1"]}, "big": {"extends": ["base"], "items": ["b1", "c1"]}})
        self.assertEqual(forge.profile_items(forge.load_catalog([path]), "big"), ["a1", "b1", "c1"])


# --------------------------------------------------------------------------- real upstream formats

class UpstreamFormatTests(unittest.TestCase):
    def test_real_kiwix_meta4(self):
        meta = forge.parse_meta4((FIXTURES / "kiwix_zimgit-water_en_2024-08.meta4").read_bytes())
        self.assertEqual(meta["size"], 20924451)
        self.assertEqual(meta["sha256"], "392c7bc970a44fddd61dd17f6eabf1f4e21936f2d5c27c83093e1dc475cb56b6")
        self.assertEqual(len(meta["pieces"].sha1), math.ceil(meta["size"] / meta["pieces"].length))
        self.assertTrue(meta["urls"] and all(u.startswith("https://") for u in meta["urls"]))

    def test_meta4_with_entities_is_refused(self):
        evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><metalink xmlns="urn:ietf:params:xml:ns:metalink"/>'
        with self.assertRaises(forge.ResolveError):
            forge.parse_meta4(evil)

    def test_real_ollama_checksum_list(self):
        text = (FIXTURES / "ollama_v0.40.17_sha256sum.txt").read_text()
        digest = forge.parse_checksum_list(text, "./ollama-linux-arm64-jetpack6.tar.zst")
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertEqual(digest, forge.parse_checksum_list(text, "ollama-linux-arm64-jetpack6.tar.zst"))
        self.assertIsNone(forge.parse_checksum_list(text, "./not-there.zip"))

    def test_real_kiwix_listing_picks_newest(self):
        listing = (FIXTURES / "kiwix_listing_other_excerpt.html").read_text()
        found = re.findall(r'href="(zimgit-water_en_(\d{4}-\d{2})\.zim)"', listing)
        self.assertIn("zimgit-water_en_2024-08.zim", [f for f, _ in found])

    def test_real_ollama_manifest_shape(self):
        manifest = json.loads((FIXTURES / "ollama_manifest_all-minilm_22m.json").read_text())
        self.assertEqual(manifest["schemaVersion"], 2)
        self.assertTrue(all(re.fullmatch(r"sha256:[0-9a-f]{64}", l["digest"]) for l in manifest["layers"]))


# --------------------------------------------------------------------------- F1 init / F12 lock

class VaultTests(ForgeCase):
    def test_init_layout_and_index(self):
        for rel in forge.STANDARD_DIRS:
            self.assertTrue(self.final(rel).is_dir(), rel)
        index = json.loads((self.vault.root / "vault.json").read_text())
        self.assertEqual(index["kind"], "blackbox-vault")
        self.assertEqual((self.vault.root / "MANIFEST.sha256").read_text(), "")
        tool = self.vault.root / ".forge" / "tool" / "forge.py"
        self.assertEqual(tool.read_bytes(), (ROOT / "forge" / "forge.py").read_bytes())

    def test_env_output_is_safe_to_eval(self):
        rel = "knowledge/zim/a_en_2026-01.zim"
        self.final(rel).write_bytes(b"zim")
        self.vault.record_item("a", {"kind": "kiwix", "title": "a", "category": "test", "licence": "l", "version": "1",
                                     "files": [{"path": rel, "size": 3, "sha256": hashlib.sha256(b"zim").hexdigest()}]})
        text = forge.field_env(self.vault, "sh")
        executable = [l for l in text.splitlines() if l and not l.startswith("#")]
        self.assertTrue(all(l.startswith("export ") for l in executable), executable)
        self.assertIn("kiwix-serve", text)
        if shutil.which("sh"):
            proc = subprocess.run(["sh", "-c", text + '\nprintf %s "$OLLAMA_MODELS"'], capture_output=True, text=True,
                                  timeout=10)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(proc.stdout.endswith("ollama"), proc.stdout)

    def test_init_refuses_non_empty_folder_and_reopens_existing_vault(self):
        busy = self.tmp / "busy"
        busy.mkdir()
        (busy / "photo.jpg").write_bytes(b"x")
        with self.assertRaises(forge.ForgeError):
            forge.Vault.create(busy)
        again, _, note = forge.Vault.create(self.vault.root)
        self.assertEqual(again.index["vault_id"], self.vault.index["vault_id"])
        self.assertIn("existing", note)

    def test_init_ignores_os_drive_root_entries(self):
        root = self.tmp / "driveroot"
        (root / "System Volume Information").mkdir(parents=True)
        (root / "$RECYCLE.BIN").mkdir()
        forge.Vault.create(root)
        self.assertTrue((root / "vault.json").is_file())

    def test_init_refuses_fat32_and_removes_only_folders_it_created(self):
        with mock.patch.object(forge, "detect_filesystem", return_value={"type": "vfat", "method": "test"}):
            with self.assertRaisesRegex(forge.ForgeError, "4 GiB"):
                forge.Vault.create(self.tmp / "fatnew")
            self.assertFalse((self.tmp / "fatnew").exists())
            existing = self.tmp / "fatold"
            existing.mkdir()
            with self.assertRaises(forge.ForgeError):
                forge.Vault.create(existing)
            self.assertTrue(existing.is_dir())

    def test_detects_filesystem_of_vault(self):
        fs = forge.detect_filesystem(self.vault.root)
        self.assertIn("type", fs)
        self.assertNotEqual(fs["type"], "")

    def test_lock_is_exclusive_in_process(self):
        with self.vault.lock():
            with self.assertRaises(forge.LockedError):
                with forge.Vault.open(self.vault.root).lock():
                    pass
        with self.vault.lock():
            pass

    def test_lock_is_exclusive_across_processes(self):
        code = ("import importlib.util,sys;s=importlib.util.spec_from_file_location('f',sys.argv[1]);"
                "m=importlib.util.module_from_spec(s);sys.modules['f']=m;s.loader.exec_module(m);"
                "sys.exit(m.main(['verify',sys.argv[2]]))")
        with self.vault.lock():
            proc = subprocess.run([sys.executable, "-c", code, str(ROOT / "forge" / "forge.py"), str(self.vault.root)],
                                  capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, forge.EXIT_LOCKED, proc.stdout + proc.stderr)
        self.assertIn("another Forge process", proc.stdout)


# --------------------------------------------------------------------------- F4-F7 download engine

class DownloadTests(ForgeCase):
    def test_happy_path_promotes_verified_file(self):
        body = blob(300_000)
        url = self.server.add("/f.bin", Route(body))
        rec = self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)
        self.assertEqual(rec["sha256"], hashlib.sha256(body).hexdigest())
        self.assertFalse(list(self.vault.partial_dir.glob("*.part")))

    def test_five_dropped_connections_with_pieces_resume_by_range(self):
        body = blob(1_000_000, seed=2)
        url = self.server.add("/z.zim", Route(body, drops=[150_000, 90_000, 200_000, 10_000, 120_000]))
        self.dl.fetch(self.spec(body, [url], rel="knowledge/zim/z.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/z.zim").read_bytes(), body)
        ranges = self.ranges_requested("/z.zim")
        self.assertEqual(len(ranges), 6)
        starts = [int(r.split("=")[1].rstrip("-")) if r else 0 for r in ranges]
        self.assertEqual(starts[0], 0)
        self.assertTrue(all(s % (64 * 1024) == 0 for s in starts), starts)
        self.assertEqual(starts, sorted(starts))
        self.assertGreater(starts[-1], 0)

    def test_dropped_connections_without_pieces(self):
        body = blob(700_000, seed=3)
        url = self.server.add("/b.bin", Route(body, drops=[100_001, 33_333, 250_000, 7]))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)
        starts = [int(r.split("=")[1].rstrip("-")) for r in self.ranges_requested("/b.bin") if r]
        self.assertEqual(starts, [100_001, 133_334, 383_334, 383_341])

    def test_mirror_rotation_with_changing_etags(self):
        body = blob(500_000, seed=4)
        u1 = self.server.add("/m1/z.zim", Route(body, drops=[100_000, 100_000], etag_per_request=True))
        u2 = self.server.add("/m2/z.zim", Route(body, etag_per_request=True))
        self.dl.fetch(self.spec(body, [u1, u2], rel="knowledge/zim/z.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/z.zim").read_bytes(), body)
        self.assertTrue(self.ranges_requested("/m2/z.zim"), "second mirror was used after a drop")

    def test_server_ignoring_range_restarts_cleanly(self):
        body = blob(400_000, seed=5)
        url = self.server.add("/n.bin", Route(body, ranges=False, drops=[123_456]))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)
        self.assertIn("ignored the resume request", self.out.getvalue())

    def test_corrupt_piece_is_caught_and_refetched_from_another_mirror(self):
        body = blob(600_000, seed=6)
        bad = self.server.add("/bad/z.zim", Route(body, corrupt=300_000, always_corrupt=True))
        good = self.server.add("/good/z.zim", Route(body))
        self.dl.fetch(self.spec(body, [bad, good], rel="knowledge/zim/z.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/z.zim").read_bytes(), body)
        resumed = [r for r in self.ranges_requested("/good/z.zim") if r]
        self.assertEqual(resumed, [f"bytes={(300_000 // 65536) * 65536}-"])

    def test_corruption_without_pieces_triggers_one_clean_refetch(self):
        body = blob(300_000, seed=7)
        url = self.server.add("/c.bin", Route(body, corrupt=12_345))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)
        self.assertIn("mismatch", self.out.getvalue())

    def test_persistent_corruption_is_never_promoted(self):
        body = blob(200_000, seed=8)
        url = self.server.add("/c.bin", Route(body, corrupt=5, always_corrupt=True))
        with self.assertRaises(forge.IntegrityError):
            self.dl.fetch(self.spec(body, [url]))
        self.assertFalse(self.final("docs/file.bin").exists())
        self.assertFalse(list(self.vault.partial_dir.glob("*.part")))

    def test_503_storm_then_success(self):
        body = blob(100_000, seed=9)
        url = self.server.add("/s.bin", Route(body, statuses=[503, 503, 429, 503]))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)

    def test_wrong_content_range_is_retried(self):
        body = blob(300_000, seed=10)
        url = self.server.add("/w.bin", Route(body, drops=[50_000], wrong_range_once=True))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)

    def test_404_everywhere_fails_cleanly(self):
        body = blob(10_000)
        with self.assertRaisesRegex(forge.ForgeError, "every source refused"):
            self.dl.fetch(self.spec(body, [self.server.base + "/missing1", self.server.base + "/missing2"]))
        self.assertFalse(self.final("docs/file.bin").exists())

    def test_upstream_size_change_is_reported(self):
        body = blob(200_000, seed=11)
        url = self.server.add("/g.bin", Route(body, drops=[40_000], claim_total=999_999))
        with self.assertRaisesRegex(forge.ForgeError, "different size"):
            self.dl.fetch(self.spec(body, [url]))
        self.assertFalse(self.final("docs/file.bin").exists())

    def test_insecure_redirect_is_refused(self):
        self.server.add("/r", Route(redirect="http://example.com/evil"))
        with self.assertRaisesRegex(forge.ForgeError, "non-HTTPS"):
            self.dl.fetch(self.spec(b"abc", [self.server.base + "/r"]))

    def test_resume_after_give_up_continues_from_verified_bytes(self):
        body = blob(900_000, seed=12)
        url = self.server.add("/p.zim", Route(body, drops=[400_000, 0, 0]))
        spec = self.spec(body, [url], rel="knowledge/zim/p.zim", pieces=self.pieces(body))
        stubborn = forge.Downloader(self.vault, self.http, max_attempts=2, sleep=lambda s: None, out=self.out)
        with self.assertRaisesRegex(forge.ForgeError, "rerun to resume"):
            stubborn.fetch(spec)
        self.assertFalse(self.final("knowledge/zim/p.zim").exists())
        fresh = forge.Downloader(forge.Vault.open(self.vault.root), self.http, sleep=lambda s: None, out=self.out)
        fresh.fetch(spec)
        self.assertEqual(self.final("knowledge/zim/p.zim").read_bytes(), body)
        last = self.ranges_requested("/p.zim")[-1]
        self.assertEqual(last, f"bytes={(400_000 // 65536) * 65536}-")

    def test_disk_full_keeps_resumable_partial(self):
        body = blob(500_000, seed=13)
        url = self.server.add("/d.bin", Route(body))
        spec = self.spec(body, [url], rel="knowledge/zim/d.zim", pieces=self.pieces(body))
        real_stream = forge.Downloader._stream

        def full_disk(self_, resp, f, spec_, st, progress, state):
            data = resp.read(200_000)
            f.write(data)
            st.feed_pending(data)
            raise OSError(errno.ENOSPC, "No space left on device")

        with mock.patch.object(forge.Downloader, "_stream", full_disk):
            with self.assertRaises(forge.DiskFullError):
                self.dl.fetch(spec)
        self.assertFalse(self.final("knowledge/zim/d.zim").exists())
        self.assertTrue(list(self.vault.partial_dir.glob("*.part")))
        with mock.patch.object(forge.Downloader, "_stream", real_stream):
            self.dl.fetch(spec)
        self.assertEqual(self.final("knowledge/zim/d.zim").read_bytes(), body)

    def test_crash_mid_download_resumes_from_durable_point(self):
        """Simulate kill -9: a child process downloads, is killed, a new process resumes."""
        body = blob(3_000_000, seed=14)
        url = self.server.add("/k.zim", Route(body))
        spec = {"rel": "knowledge/zim/k.zim", "size": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                "piece": 65536, "sha1": [hashlib.sha1(body[i:i + 65536]).hexdigest() for i in range(0, len(body), 65536)],
                "url": url}
        driver = self.tmp / "driver.py"
        driver.write_text(
            "import importlib.util,json,sys,time,os\n"
            "s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);"
            "sys.modules['f']=m;s.loader.exec_module(m)\n"
            "spec=json.loads(open(sys.argv[3]).read());m.DURABLE_EVERY=128*1024\n"
            "orig=m.Downloader._stream\n"
            "def slow(self,resp,f,sp,st,pr,state):\n"
            "    real=resp.read1\n"
            "    def throttled(n=-1):\n"
            "        time.sleep(0.02); return real(32768)\n"
            "    resp.read=resp.read1=throttled\n"
            "    return orig(self,resp,f,sp,st,pr,state)\n"
            "m.Downloader._stream=slow\n"
            "v=m.Vault.open(sys.argv[2]);h=m.Http(timeout=5,allow_http_loopback=True)\n"
            "fs=m.FileSpec(rel=spec['rel'],size=spec['size'],sha256=spec['sha256'],pieces=m.Pieces(spec['piece'],spec['sha1']),urls=[spec['url']],source=spec['url'])\n"
            "m.Downloader(v,h,sleep=lambda s:None).fetch(fs)\n")
        spec_path = self.tmp / "spec.json"
        spec_path.write_text(json.dumps(spec))
        proc = subprocess.Popen([sys.executable, str(driver), str(ROOT / "forge" / "forge.py"), str(self.vault.root),
                                 str(spec_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        part = None
        deadline = time.time() + 30
        while time.time() < deadline:
            parts = list(self.vault.partial_dir.glob("*.part"))
            if parts and parts[0].stat().st_size > 600_000:
                part = parts[0]
                break
            time.sleep(0.05)
        proc.kill()
        proc.wait(timeout=10)
        self.assertIsNotNone(part, "child never made progress")
        fs = forge.FileSpec(rel=spec["rel"], size=spec["size"], sha256=spec["sha256"],
                            pieces=forge.Pieces(65536, spec["sha1"]), urls=[url], source=url)
        forge.Downloader(forge.Vault.open(self.vault.root), self.http, sleep=lambda s: None, out=self.out).fetch(fs)
        self.assertEqual(self.final(spec["rel"]).read_bytes(), body)
        last = self.ranges_requested("/k.zim")[-1]
        self.assertIsNotNone(last)
        self.assertGreater(int(last.split("=")[1].rstrip("-")), 0, "resumed from zero after a crash")

    def test_existing_mismatching_file_is_quarantined_not_deleted(self):
        body = blob(50_000, seed=15)
        url = self.server.add("/q.bin", Route(body))
        target = self.final("docs/file.bin")
        target.write_bytes(b"something else the owner put here")
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(target.read_bytes(), body)
        quarantined = list((self.vault.meta / "quarantine").rglob("*"))
        self.assertTrue(any(p.is_file() and p.read_bytes().startswith(b"something else") for p in quarantined))

    def test_existing_matching_file_is_adopted_without_download(self):
        body = blob(50_000, seed=16)
        url = self.server.add("/a.bin", Route(body))
        self.final("docs/file.bin").write_bytes(body)
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.ranges_requested("/a.bin"), [])


# --------------------------------------------------------------------------- resolvers + profile fetch (F3, F8 store layout)

class ResolverAndProfileTests(ForgeCase):
    def setUp(self):
        super().setUp()
        self.resolver = forge.Resolver(self.http, sleep=lambda s: None, kiwix_base=self.server.base + "/zim/",
                                       hf_base=self.server.base + "/hf", ollama_base=self.server.base + "/reg")

    def add_kiwix(self, name, version, body, mirrors=1, drops=None):
        fname = f"{name}_{version}.zim"
        urls = [self.server.add(f"/mirror{i}/{fname}", Route(body, drops=drops if i == 0 else None))
                for i in range(mirrors)]
        canonical = self.server.add(f"/zim/other/{fname}", Route(body))
        self.server.add(f"/zim/other/{fname}.meta4", Route(meta4_for(fname, body, urls + ["http://plain.example/x"])))
        return canonical

    def listing(self, names):
        rows = "".join(f'<a href="{n}">{n}</a>   2026-01-01 00:00   1M\n' for n in names)
        self.server.add("/zim/other/", Route(f"<html><pre>{rows}</pre></html>".encode()))

    def add_ollama(self, model, tag, layers):
        blobs = []
        for data in layers:
            digest = hashlib.sha256(data).hexdigest()
            self.server.add(f"/reg/v2/library/{model}/blobs/sha256:{digest}", Route(data))
            blobs.append({"mediaType": "application/vnd.ollama.image.model", "digest": f"sha256:{digest}",
                          "size": len(data)})
        manifest = json.dumps({"schemaVersion": 2, "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                               "config": blobs[0], "layers": blobs[1:]}).encode()
        self.server.add(f"/reg/v2/library/{model}/manifests/{tag}", Route(manifest))
        return manifest

    def test_kiwix_resolves_newest_and_uses_mirrors_then_canonical(self):
        self.listing(["water_en_2024-05.zim", "water_en_2024-08.zim", "waterworld_en_2025-01.zim"])
        body = blob(200_000, seed=20)
        self.add_kiwix("water_en", "2024-08", body, mirrors=2)
        res = self.resolver.resolve("w", {"kind": "kiwix", "path": "other", "name": "water_en"})
        spec = res.files[0]
        self.assertEqual(res.version, "2024-08")
        self.assertEqual(spec.rel, "knowledge/zim/water_en_2024-08.zim")
        self.assertEqual(spec.sha256, hashlib.sha256(body).hexdigest())
        self.assertTrue(spec.urls[0].endswith("/mirror0/water_en_2024-08.zim"))
        self.assertTrue(spec.urls[-1].endswith("/zim/other/water_en_2024-08.zim"))
        self.assertFalse(any("plain.example" in u for u in spec.urls))

    def test_huggingface_uses_linked_etag_and_pins_commit(self):
        body = blob(150_000, seed=21)
        sha = hashlib.sha256(body).hexdigest()
        commit = "09816acd5d99df7be770d85ea30822623dab342c"
        self.server.add("/hf/org/repo/resolve/main/m.gguf",
                        Route(redirect=self.server.base + "/cdn/m.gguf",
                              headers={"X-Linked-Etag": f'"{sha}"', "X-Linked-Size": str(len(body)), "X-Repo-Commit": commit}))
        self.server.add(f"/hf/org/repo/resolve/{commit}/m.gguf", Route(redirect=self.server.base + "/cdn/m.gguf"))
        self.server.add("/cdn/m.gguf", Route(body))
        res = self.resolver.resolve("m", {"kind": "huggingface", "repo": "org/repo", "file": "m.gguf"})
        self.assertEqual(res.files[0].sha256, sha)
        self.assertIn(commit, res.files[0].urls[0])
        self.dl.fetch(res.files[0])
        self.assertEqual(self.final("ai/gguf/m.gguf").read_bytes(), body)

    def test_huggingface_without_sha_requires_pin(self):
        self.server.add("/hf/org/repo/resolve/main/README.md", Route(b"hi", headers={"ETag": '"abc"'}))
        with self.assertRaisesRegex(forge.ResolveError, "pin a sha256"):
            self.resolver.resolve("r", {"kind": "huggingface", "repo": "org/repo", "file": "README.md"})

    def test_http_sha256_list_and_md5_sidecar(self):
        body = blob(80_000, seed=22)
        self.server.add("/rel/tool.tar.zst", Route(body))
        self.server.add("/rel/sha256sum.txt", Route(f"{'0' * 64}  ./other.zip\n{hashlib.sha256(body).hexdigest()}  ./tool.tar.zst\n".encode()))
        res = self.resolver.resolve("t", {"kind": "http", "url": self.server.base + "/rel/tool.tar.zst",
                                          "dest": "runtimes/tool.tar.zst", "sha256_list_url": self.server.base + "/rel/sha256sum.txt",
                                          "sha256_list_name": "./tool.tar.zst"})
        self.assertEqual(res.files[0].sha256, hashlib.sha256(body).hexdigest())
        self.assertEqual(res.files[0].size, len(body))
        self.server.add("/osm/vic.pbf", Route(body))
        self.server.add("/osm/vic.pbf.md5", Route(f"{hashlib.md5(body).hexdigest()}  vic.pbf\n".encode()))
        res2 = self.resolver.resolve("o", {"kind": "http", "url": self.server.base + "/osm/vic.pbf", "dest": "maps/vic.pbf",
                                           "md5_url": self.server.base + "/osm/vic.pbf.md5"})
        rec = self.dl.fetch(res2.files[0])
        self.assertEqual(rec["integrity"], "upstream-md5")
        self.assertEqual(rec["md5"], hashlib.md5(body).hexdigest())
        self.assertEqual(rec["sha256"], hashlib.sha256(body).hexdigest())

    def _catalog(self, items, profiles):
        return {"schema": 2, "items": items, "profiles": profiles}

    def test_profile_fetch_writes_ollama_store_manifest_last_and_shares_blobs(self):
        shared = b'{"license":"MIT"}'
        m1 = self.add_ollama("tiny", "1b", [b'{"config":1}', blob(120_000, 30), shared])
        self.add_ollama("tinier", "0.5b", [b'{"config":2}', blob(60_000, 31), shared])
        catalog = self._catalog({
            "t1": {"kind": "ollama", "model": "tiny", "tag": "1b", "title": "t", "category": "ai", "licence": "MIT"},
            "t2": {"kind": "ollama", "model": "tinier", "tag": "0.5b", "title": "t", "category": "ai", "licence": "MIT"}},
            {"p": {"items": ["t1", "t2"]}})
        code = forge.fetch_profile(self.vault, catalog, "p", self.resolver, self.dl, out=self.out)
        self.assertEqual(code, 0, self.out.getvalue())
        store = self.vault.root / "ai" / "ollama"
        self.assertEqual((store / "manifests/registry.ollama.ai/library/tiny/1b").read_bytes(), m1)
        for data in (shared, blob(120_000, 30), blob(60_000, 31)):
            self.assertTrue((store / "blobs" / f"sha256-{hashlib.sha256(data).hexdigest()}").is_file())
        shared_path = f"/reg/v2/library/tiny/blobs/sha256:{hashlib.sha256(shared).hexdigest()}"
        shared_path2 = f"/reg/v2/library/tinier/blobs/sha256:{hashlib.sha256(shared).hexdigest()}"
        self.assertEqual(len(self.ranges_requested(shared_path)) + len(self.ranges_requested(shared_path2)), 1)
        manifest_lines = (self.vault.root / "MANIFEST.sha256").read_text().splitlines()
        self.assertEqual(len(manifest_lines), 7)  # 2 configs + 2 weights + 1 shared licence + 2 manifests

    def test_ollama_manifest_not_written_if_a_blob_fails(self):
        self.add_ollama("broken", "1b", [b'{"c":1}', blob(50_000, 32)])
        bad = [p for p in self.server.httpd.routes if "/blobs/" in p and "broken" in p][-1]
        del self.server.httpd.routes[bad]
        catalog = self._catalog({"b": {"kind": "ollama", "model": "broken", "tag": "1b", "title": "t",
                                       "category": "ai", "licence": "MIT"}}, {"p": {"items": ["b"]}})
        code = forge.fetch_profile(self.vault, catalog, "p", self.resolver, self.dl, out=self.out)
        self.assertEqual(code, 1)
        self.assertFalse((self.vault.root / "ai/ollama/manifests/registry.ollama.ai/library/broken/1b").exists())
        self.assertNotIn("b", self.vault.index["items"])

    def test_plan_reports_space_and_refuses_when_too_big(self):
        self.listing(["huge_en_2026-01.zim"])
        body = blob(10_000, seed=33)
        fname = "huge_en_2026-01.zim"
        meta = meta4_for(fname, body, [self.server.base + "/m/" + fname]).replace(
            f"<size>{len(body)}</size>".encode(), b"<size>999999999999999</size>")
        meta = re.sub(rb"<pieces.*</pieces>", b"", meta)
        self.server.add("/zim/other/" + fname + ".meta4", Route(meta))
        catalog = self._catalog({"h": {"kind": "kiwix", "path": "other", "name": "huge_en", "title": "t",
                                       "category": "knowledge", "licence": "l"}}, {"p": {"items": ["h"]}})
        resolved, failed = forge.resolve_profile(catalog, "p", self.resolver, out=self.out)
        report = forge.plan_report(self.vault, resolved)
        self.assertFalse(report["fits"])
        code = forge.fetch_profile(self.vault, catalog, "p", self.resolver, self.dl, out=self.out)
        self.assertEqual(code, forge.EXIT_SPACE)

    def test_new_upstream_version_marks_old_file_superseded(self):
        self.listing(["water_en_2024-05.zim"])
        old = blob(30_000, seed=40)
        self.add_kiwix("water_en", "2024-05", old)
        catalog = self._catalog({"w": {"kind": "kiwix", "path": "other", "name": "water_en", "title": "t",
                                       "category": "survival", "licence": "l"}}, {"p": {"items": ["w"]}})
        self.assertEqual(forge.fetch_profile(self.vault, catalog, "p", self.resolver, self.dl, out=self.out), 0)
        self.listing(["water_en_2024-05.zim", "water_en_2024-08.zim"])
        self.add_kiwix("water_en", "2024-08", blob(31_000, seed=41))
        resolver = forge.Resolver(self.http, sleep=lambda s: None, kiwix_base=self.server.base + "/zim/")
        self.assertEqual(forge.fetch_profile(self.vault, catalog, "p", resolver, self.dl, out=self.out), 0)
        sup = [s["path"] for s in self.vault.index["superseded"]]
        self.assertEqual(sup, ["knowledge/zim/water_en_2024-05.zim"])
        code, summary = forge.verify_vault(self.vault, out=io.StringIO())
        self.assertEqual(code, 0)
        self.assertEqual(summary["superseded"], sup)
        self.assertEqual(summary["untracked"], [])


# --------------------------------------------------------------------------- F10 / F11 manifest + verify

class VerifyTests(ForgeCase):
    def populate(self):
        files = {"docs/a.bin": blob(70_000, 50), "knowledge/zim/b.zim": blob(90_000, 51), "maps/c.pbf": blob(10, 52)}
        records = []
        for rel, data in files.items():
            url = self.server.add("/" + rel, Route(data))
            records.append(self.dl.fetch(self.spec(data, [url], rel=rel)))
        self.vault.record_item("x", {"kind": "http", "title": "x", "category": "test", "licence": "l",
                                     "version": "1", "files": records})
        self.vault.write_manifest()
        return files

    def test_manifest_is_coreutils_format(self):
        files = self.populate()
        lines = (self.vault.root / "MANIFEST.sha256").read_text().splitlines()
        self.assertEqual(lines, sorted(lines, key=lambda l: l.split("  ", 1)[1]))
        for line in lines:
            digest, rel = line.split("  ", 1)
            self.assertEqual(digest, hashlib.sha256(files[rel]).hexdigest())
        if shutil.which("sha256sum"):
            proc = subprocess.run(["sha256sum", "-c", "MANIFEST.sha256"], cwd=self.vault.root,
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    def test_verify_detects_flip_truncation_missing_and_untracked(self):
        self.populate()
        code, summary = forge.verify_vault(self.vault, out=io.StringIO())
        self.assertEqual(code, 0)
        a = self.final("docs/a.bin")
        data = bytearray(a.read_bytes())
        data[1000] ^= 1
        a.write_bytes(bytes(data))
        b = self.final("knowledge/zim/b.zim")
        b.write_bytes(b.read_bytes()[:-1])
        self.final("maps/c.pbf").unlink()
        self.final("docs/notes.txt").write_text("mine")
        (self.vault.root / "ai/ollama/metadata").mkdir(parents=True)
        (self.vault.root / "ai/ollama/metadata/sha256-x.json").write_text("{}")
        code, summary = forge.verify_vault(self.vault, out=io.StringIO())
        self.assertEqual(code, 1)
        self.assertEqual(summary["modified"], ["docs/a.bin"])
        self.assertEqual(summary["wrong_size"], ["knowledge/zim/b.zim"])
        self.assertEqual(summary["missing"], ["maps/c.pbf"])
        self.assertEqual(summary["untracked"], ["docs/notes.txt"])
        self.assertEqual(summary["runtime_cache_files"], 1)
        quick_code, quick = forge.verify_vault(self.vault, quick=True, out=io.StringIO())
        self.assertEqual(quick["modified"], [])
        self.assertEqual(quick_code, 1)

    def test_strict_mode_fails_on_untracked(self):
        self.populate()
        self.final("docs/extra.txt").write_text("x")
        self.assertEqual(forge.verify_vault(self.vault, out=io.StringIO())[0], 0)
        self.assertEqual(forge.verify_vault(self.vault, strict=True, out=io.StringIO())[0], 1)

    def test_cli_verify_status_env_manifest(self):
        self.populate()
        for argv, code in ((["verify", str(self.vault.root)], 0), (["status", str(self.vault.root)], 0),
                           (["manifest", str(self.vault.root)], 0), (["env", str(self.vault.root), "--shell", "sh"], 0),
                           (["env", str(self.vault.root), "--shell", "setx"], 0),
                           (["verify", str(self.tmp / "nope")], 1)):
            out = io.StringIO()
            self.assertEqual(forge.main(argv, out=out), code, (argv, out.getvalue()))
        out = io.StringIO()
        forge.main(["env", str(self.vault.root), "--shell", "sh"], out=out)
        self.assertIn("OLLAMA_MODELS=", out.getvalue())
        self.assertIn("kiwix-serve", out.getvalue())
        index = json.loads((self.vault.root / "vault.json").read_text())
        self.assertTrue(index["last_verify"]["ok"])


# --------------------------------------------------------------------------- F14 portability

class PortabilityTests(unittest.TestCase):
    def test_standard_library_only(self):
        source = (ROOT / "forge" / "forge.py").read_text()
        imported = set(re.findall(r"^\s*(?:import|from)\s+([a-zA-Z_][\w]*)", source, re.M))
        stdlib = set(getattr(sys, "stdlib_module_names", ())) or imported
        self.assertEqual(imported - stdlib - {"__future__"}, set())

    def test_windows_launcher_present(self):
        text = (ROOT / "forge" / "forge.cmd").read_text()
        self.assertIn("py -3", text)
        self.assertIn("forge.py", text)


# --------------------------------------------------------------------------- regressions from the independent review

class ReviewRegressionTests(ForgeCase):
    """One test per defect in the 2026-11-24 adversarial review (campaign/LOG.md)."""

    def test_r1_tcp_reset_mid_body_is_retried(self):
        body = blob(600_000, seed=60)
        url = self.server.add("/rst.bin", Route(body, reset_after=150_000, resets=3))
        self.dl.fetch(self.spec(body, [url]))
        self.assertEqual(self.final("docs/file.bin").read_bytes(), body)

    def test_r1_read_timeout_mid_body_is_retried(self):
        body = blob(400_000, seed=61)
        url = self.server.add("/stall.bin", Route(body, stall_after=100_000, stall=1.5, stalls=1))
        dl = forge.Downloader(self.vault, forge.Http(timeout=0.5, allow_http_loopback=True), sleep=lambda s: None,
                              out=self.out)
        dl.fetch(self.spec(body, [url], rel="knowledge/zim/s.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/s.zim").read_bytes(), body)

    def test_r1_profile_continues_after_an_item_keeps_resetting(self):
        bad, good = blob(200_000, seed=62), blob(50_000, seed=63)
        self.server.add("/rel/bad.bin", Route(bad, reset_after=0, resets=10_000))  # RST before any byte: never progresses
        self.server.add("/rel/good.bin", Route(good))
        resolver = forge.Resolver(self.http, sleep=lambda s: None)
        catalog = {"schema": 2, "items": {
            "bad": {"kind": "http", "url": self.server.base + "/rel/bad.bin", "dest": "docs/bad.bin",
                    "sha256": hashlib.sha256(bad).hexdigest(), "size": len(bad), "title": "t", "category": "test", "licence": "l"},
            "good": {"kind": "http", "url": self.server.base + "/rel/good.bin", "dest": "docs/good.bin",
                     "sha256": hashlib.sha256(good).hexdigest(), "size": len(good), "title": "t", "category": "test", "licence": "l"}},
            "profiles": {"p": {"items": ["bad", "good"]}}}
        dl = forge.Downloader(self.vault, self.http, max_attempts=3, sleep=lambda s: None, out=self.out)
        self.assertEqual(forge.fetch_profile(self.vault, catalog, "p", resolver, dl, out=self.out), 1)
        self.assertIn("good", self.vault.index["items"])
        self.assertNotIn("bad", self.vault.index["items"])

    def test_r2_verify_on_read_only_vault(self):
        with mock.patch.object(forge.VaultLock, "__enter__", side_effect=forge.ReadOnlyVaultError("ro")):
            out = io.StringIO()
            self.assertEqual(forge.main(["verify", str(self.vault.root)], out=out), 0, out.getvalue())
        self.assertIn("read-only", out.getvalue())
        self.assertIsNone(json.loads((self.vault.root / "vault.json").read_text())["last_verify"])

    def test_r2_lock_maps_read_only_errors(self):
        with mock.patch("builtins.open", side_effect=OSError(errno.EROFS, "Read-only file system")):
            with self.assertRaises(forge.ReadOnlyVaultError):
                with forge.VaultLock(self.vault.meta / "forge.lock"):
                    pass

    def _tracked(self, body, rel="maps/osm/vic.pbf"):
        url = self.server.add("/v1/" + rel, Route(body))
        rec = self.dl.fetch(self.spec(body, [url], rel=rel))
        self.vault.record_item("osm", {"kind": "http", "title": "t", "category": "maps", "licence": "l",
                                       "version": "1", "files": [rec]})
        self.vault.write_manifest()
        return rec

    def test_r3_failed_update_keeps_the_old_good_file(self):
        old, new = blob(40_000, seed=64), blob(41_000, seed=65)
        self._tracked(old)
        with self.assertRaises(forge.ForgeError):
            self.dl.fetch(self.spec(new, [self.server.base + "/gone"], rel="maps/osm/vic.pbf"))
        self.assertEqual(self.final("maps/osm/vic.pbf").read_bytes(), old)
        self.assertEqual(forge.verify_vault(self.vault, out=io.StringIO())[0], 0)

    def test_r3_successful_update_replaces_tracked_file_without_quarantine_copies(self):
        self._tracked(blob(40_000, seed=66))
        for seed in (67, 68):
            new = blob(40_500, seed=seed)
            url = self.server.add(f"/v{seed}/vic.pbf", Route(new))
            self.dl.fetch(self.spec(new, [url], rel="maps/osm/vic.pbf"))
            self.assertEqual(self.final("maps/osm/vic.pbf").read_bytes(), new)
        self.assertFalse((self.vault.meta / "quarantine").exists())

    def test_r4_verify_flags_damage_and_fetch_repairs_it(self):
        body = blob(90_000, seed=69)
        self._tracked(body)
        target = self.final("maps/osm/vic.pbf")
        data = bytearray(target.read_bytes())
        data[500] ^= 0x55
        target.write_bytes(bytes(data))
        out = io.StringIO()
        self.assertEqual(forge.main(["verify", str(self.vault.root)], out=out), 1)
        self.assertIn("To repair", out.getvalue())
        vault = forge.Vault.open(self.vault.root)
        self.assertEqual(vault.damaged(), {"maps/osm/vic.pbf"})
        dl = forge.Downloader(vault, self.http, sleep=lambda s: None, out=self.out)
        rec = dl.fetch(self.spec(body, [self.server.base + "/v1/maps/osm/vic.pbf"], rel="maps/osm/vic.pbf"))
        vault.record_item("osm", {"kind": "http", "title": "t", "category": "maps", "licence": "l", "version": "1",
                                  "files": [rec]})
        self.assertEqual(target.read_bytes(), body)
        self.assertEqual(vault.damaged(), set())
        self.assertEqual(forge.verify_vault(vault, out=io.StringIO())[0], 0)

    def test_r4_deep_fetch_rehashes_instead_of_trusting_the_index(self):
        body = blob(30_000, seed=70)
        self._tracked(body)
        target = self.final("maps/osm/vic.pbf")
        data = bytearray(target.read_bytes())
        data[0] ^= 1
        target.write_bytes(bytes(data))
        shallow = forge.Downloader(self.vault, self.http, sleep=lambda s: None, out=self.out)
        shallow.fetch(self.spec(body, [self.server.base + "/v1/maps/osm/vic.pbf"], rel="maps/osm/vic.pbf"))
        self.assertNotEqual(target.read_bytes(), body, "fast path trusts the index (by design)")
        deep = forge.Downloader(self.vault, self.http, sleep=lambda s: None, out=self.out, deep=True)
        deep.fetch(self.spec(body, [self.server.base + "/v1/maps/osm/vic.pbf"], rel="maps/osm/vic.pbf"))
        self.assertEqual(target.read_bytes(), body)

    def test_r4_fast_path_makes_no_requests(self):
        body = blob(30_000, seed=71)
        self._tracked(body)
        before = len(self.server.log)
        self.dl.fetch(self.spec(body, [self.server.base + "/v1/maps/osm/vic.pbf"], rel="maps/osm/vic.pbf"))
        self.assertEqual(len(self.server.log), before)

    def test_r5_bad_mirrors_fall_through_to_a_good_one(self):
        body = blob(300_000, seed=72)
        insecure = self.server.add("/m/insecure.zim", Route(redirect="http://203.0.113.9/x.zim"))
        wrong = self.server.add("/m/wrong.zim", Route(blob(123, seed=1)))
        good = self.server.add("/m/good.zim", Route(body))
        self.dl.fetch(self.spec(body, [insecure, wrong, good], rel="knowledge/zim/m.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/m.zim").read_bytes(), body)
        self.assertIn("non-HTTPS", self.out.getvalue())
        self.assertIn("different size", self.out.getvalue())

    def test_r6_trickling_download_switches_source(self):
        body = blob(200_000, seed=73)
        slow = self.server.add("/t/slow.zim", Route(body, trickle=0.01))
        good = self.server.add("/t/good.zim", Route(body))
        with mock.patch.object(forge, "SLOW_WINDOW", 0.4), mock.patch.object(forge, "SLOW_RATE", 50_000):
            self.dl.fetch(self.spec(body, [slow, good], rel="knowledge/zim/t.zim", pieces=self.pieces(body)))
        self.assertEqual(self.final("knowledge/zim/t.zim").read_bytes(), body)
        self.assertIn("too slow", self.out.getvalue())

    def test_r6_trickling_metadata_hits_deadline(self):
        self.server.add("/zim/other/", Route(b"<a href='x_en_2026-01.zim'>" * 50, trickle=0.01))
        resolver = forge.Resolver(self.http, sleep=lambda s: None, kiwix_base=self.server.base + "/zim/")
        start = time.monotonic()
        with mock.patch.object(forge, "METADATA_DEADLINE", 0.3):
            with self.assertRaisesRegex(forge.ResolveError, "too slowly"):
                resolver.resolve("x", {"kind": "kiwix", "path": "other", "name": "x_en"})
        self.assertLess(time.monotonic() - start, 15)

    def test_r7_disk_full_writing_index_is_typed_and_leaves_no_tmp(self):
        target = self.vault.root / "vault.json"
        with mock.patch.object(forge.os, "fsync", side_effect=OSError(errno.ENOSPC, "No space left on device")):
            with self.assertRaises(forge.DiskFullError):
                forge.atomic_write(target, b"{}")
        self.assertEqual([p.name for p in self.vault.root.glob(".vault.json.tmp-*")], [])

    def test_r7_main_reports_os_errors_without_traceback(self):
        for err, code in ((OSError(errno.ENOSPC, "No space left on device"), forge.EXIT_DISKFULL),
                          (PermissionError(errno.EACCES, "Access is denied"), forge.EXIT_FAIL)):
            out = io.StringIO()
            with mock.patch.object(forge.Vault, "open", side_effect=err):
                self.assertEqual(forge.main(["status", str(self.vault.root)], out=out), code)
            self.assertIn("forge:", out.getvalue())

    def test_r8_unicode_digits_never_crash(self):
        self.assertIsNone(forge.parse_int("\u00b2"))
        self.assertIsNone(forge.parse_int("\u0663"))
        self.assertEqual(forge.parse_int(" 42 "), 42)
        self.server.add("/hf/o/r/resolve/main/m.gguf", Route(redirect=self.server.base + "/x",
                        headers={"X-Linked-Etag": '"' + "a" * 64 + '"', "X-Linked-Size": "\u00b2"}))
        resolver = forge.Resolver(self.http, sleep=lambda s: None, hf_base=self.server.base + "/hf")
        with self.assertRaisesRegex(forge.ResolveError, "no size"):
            resolver.resolve("m", {"kind": "huggingface", "repo": "o/r", "file": "m.gguf"})
        body = blob(10_000, seed=74)
        url = self.server.add("/ra.bin", Route(body, statuses=[503], retry_after="\u00b2"))
        self.dl.fetch(self.spec(body, [url]))

    def test_r9_oversized_piece_length_is_ignored(self):
        size = 300 << 20
        meta = (f'<metalink xmlns="urn:ietf:params:xml:ns:metalink"><file name="a"><size>{size}</size>'
                f'<hash type="sha-256">{"b" * 64}</hash><pieces length="{size}" type="sha-1"><hash>{"c" * 40}</hash>'
                f'</pieces></file></metalink>').encode()
        self.assertIsNone(forge.parse_meta4(meta)["pieces"])

    def test_r10_utf16_metalink_is_refused(self):
        evil = ('<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE m [<!ENTITY s "9999">]>'
                '<metalink xmlns="urn:ietf:params:xml:ns:metalink"><file name="a"><size>&s;</size></file></metalink>')
        with self.assertRaises(forge.ResolveError):
            forge.parse_meta4(evil.encode("utf-16"))
        with self.assertRaises(forge.ResolveError):
            forge.parse_meta4(evil.replace("UTF-16", "ISO-8859-1").replace("<!DOCTYPE m [<!ENTITY s \"9999\">]>", "")
                              .replace("&s;", "1").encode("latin-1"))

    def test_r11_folder_level_case_collisions(self):
        with self.assertRaises(forge.ForgeError):
            forge.check_collisions(["docs/a.pdf", "Docs/guide/b.pdf"])
        res = forge.Resolved("x", {"title": "t", "kind": "http", "licence": "l"}, "1",
                             [forge.FileSpec(rel="Docs/guide/a.pdf", size=1, sha256="a" * 64)])
        with self.assertRaises(forge.ForgeError):
            forge.check_vault_collisions(self.vault, [res])

    def test_r12_stale_partial_of_an_old_build_is_pruned(self):
        old = blob(500_000, seed=75)
        url = self.server.add("/old.zim", Route(old, drops=[100_000, 0, 0]))
        spec = self.spec(old, [url], rel="knowledge/zim/w_en_2024-05.zim", pieces=self.pieces(old))
        stubborn = forge.Downloader(self.vault, self.http, max_attempts=2, sleep=lambda s: None, out=self.out)
        with self.assertRaises(forge.ForgeError):
            stubborn.fetch(spec, label="water")
        self.assertEqual(len(list(self.vault.partial_dir.glob("*.part"))), 1)
        removed = self.dl.prune_stale("water", keep={"f" * 64})
        self.assertEqual(removed, ["knowledge/zim/w_en_2024-05.zim"])
        self.assertEqual(list(self.vault.partial_dir.glob("*.part")), [])
        self.assertEqual(self.dl.prune_stale("other-item", keep=set()), [])

    def test_r13_unverified_md5_is_not_recorded(self):
        body = blob(20_000, seed=76)
        url = self.server.add("/m5.zim", Route(body))
        spec = self.spec(body, [url], rel="knowledge/zim/m5.zim")
        spec.md5 = "0" * 32
        rec = self.dl.fetch(spec)
        self.assertNotIn("md5", rec)

    def test_r14_plan_exit_codes(self):
        catalog_path = self.tmp / "c.json"
        items = {"a1": {"kind": "kiwix", "path": "other", "name": "a_en", "title": "t", "category": "knowledge", "licence": "l"},
                 "b1": {"kind": "kiwix", "path": "other", "name": "missing_en", "title": "t", "category": "knowledge", "licence": "l"}}
        catalog_path.write_text(json.dumps({"schema": 2, "items": items,
                                            "profiles": {"ok": {"items": ["a1"]}, "mixed": {"items": ["a1", "b1"]}}}))
        self.server.add("/zim/other/", Route(b'<a href="a_en_2026-01.zim">a</a>'))
        resolver = forge.Resolver(self.http, sleep=lambda s: None, kiwix_base=self.server.base + "/zim/")
        small = blob(1000, seed=77)
        self.server.add("/zim/other/a_en_2026-01.zim.meta4", Route(meta4_for("a_en_2026-01.zim", small, [])))
        run = lambda profile: forge.main(["--catalog", str(catalog_path), "plan", str(self.vault.root),
                                          "--profile", profile], resolver=resolver, out=io.StringIO())
        self.assertEqual(run("ok"), 0)
        self.assertEqual(run("mixed"), 1)
        huge = meta4_for("a_en_2026-01.zim", small, []).replace(b"<size>1000</size>", b"<size>999999999999999</size>")
        huge = re.sub(rb"<pieces.*</pieces>", b"", huge)
        self.server.add("/zim/other/a_en_2026-01.zim.meta4", Route(huge))
        resolver._listing.clear()
        self.assertEqual(run("ok"), forge.EXIT_SPACE)
        self.assertEqual(run("mixed"), forge.EXIT_SPACE)

    def test_r14_plan_counts_unrecorded_matching_file_as_present(self):
        res = forge.Resolved("x", {"title": "t", "kind": "http", "licence": "l"}, "1",
                             [forge.FileSpec(rel="docs/have.bin", size=5, sha256="a" * 64)])
        self.final("docs/have.bin").write_bytes(b"12345")
        report = forge.plan_report(self.vault, [res])
        self.assertEqual(report["need_bytes"], 0)
        self.assertEqual(report["unverified_present"], 1)

    def test_r15_more_reserved_device_names(self):
        for rel in ("a/COM0", "a/lpt0.txt", "a/COM\u00b9", "a/lpt\u00b3.zim", "a/CONIN$", "a/conout$.log"):
            with self.subTest(rel=rel), self.assertRaises(forge.ForgeError):
                forge.check_relpath(rel)

    def test_r16_setx_quotes_trailing_backslash(self):
        self.assertEqual(forge._setx_quote("E:\\"), '"E:\\\\"')
        self.assertEqual(forge._setx_quote("E:\\BLACKBOX"), '"E:\\BLACKBOX"')

    def test_r16_windows_replace_retries_sharing_violation(self):
        src, dst = self.tmp / "s", self.tmp / "d"
        src.write_bytes(b"x")
        calls = []
        real = os.replace

        def flaky(a, b):
            calls.append(1)
            if len(calls) < 3:
                raise PermissionError(13, "The process cannot access the file")
            return real(a, b)

        with mock.patch.object(forge.os, "replace", flaky), mock.patch.object(forge.os, "name", "nt"):
            forge.replace_file(src, dst, sleep=lambda s: None)
        self.assertEqual(dst.read_bytes(), b"x")
        self.assertEqual(len(calls), 3)


class CoverageGapTests(ForgeCase):
    def test_kill_minus_9_resume_without_pieces_uses_durable_offset(self):
        body = blob(2_000_000, seed=80)
        url = self.server.add("/np.bin", Route(body))
        driver = self.tmp / "np_driver.py"
        driver.write_text(
            "import importlib.util,sys,time\n"
            "s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);"
            "sys.modules['f']=m;s.loader.exec_module(m)\n"
            "m.DURABLE_EVERY=128*1024\n"
            "orig=m.Downloader._stream\n"
            "def slow(self,resp,f,sp,st,pr,state):\n"
            "    real=resp.read1\n"
            "    def throttled(n=-1):\n"
            "        time.sleep(0.02); return real(32768)\n"
            "    resp.read=resp.read1=throttled\n"
            "    return orig(self,resp,f,sp,st,pr,state)\n"
            "m.Downloader._stream=slow\n"
            "v=m.Vault.open(sys.argv[2]);h=m.Http(timeout=5,allow_http_loopback=True)\n"
            f"fs=m.FileSpec(rel='docs/np.bin',size={len(body)},sha256='{hashlib.sha256(body).hexdigest()}',urls=[sys.argv[3]],source=sys.argv[3])\n"
            "m.Downloader(v,h,sleep=lambda s:None).fetch(fs)\n")
        proc = subprocess.Popen([sys.executable, str(driver), str(ROOT / "forge" / "forge.py"), str(self.vault.root), url],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline, durable = time.time() + 30, 0
        while time.time() < deadline and durable < 500_000:
            for state in self.vault.partial_dir.glob("*.json"):
                with contextlib.suppress(OSError, ValueError):
                    durable = json.loads(state.read_text()).get("durable", 0)
            time.sleep(0.05)
        proc.kill()
        proc.wait(timeout=10)
        self.assertGreaterEqual(durable, 500_000, "child never reached a durable checkpoint")
        spec = forge.FileSpec(rel="docs/np.bin", size=len(body), sha256=hashlib.sha256(body).hexdigest(), urls=[url],
                              source=url)
        forge.Downloader(forge.Vault.open(self.vault.root), self.http, sleep=lambda s: None, out=self.out).fetch(spec)
        self.assertEqual(self.final("docs/np.bin").read_bytes(), body)
        start = int(self.ranges_requested("/np.bin")[-1].split("=")[1].rstrip("-"))
        self.assertGreaterEqual(start, durable)

    def test_provenance_labels_every_file(self):
        body = blob(1000, seed=81)
        url = self.server.add("/p.bin", Route(body))
        rec = self.dl.fetch(self.spec(body, [url], rel="docs/p.bin", integrity="pinned-sha256"))
        self.vault.record_item("p", {"kind": "http", "title": "t", "category": "reference", "licence": "CC0",
                                     "commercial": "yes", "version": "9", "files": [rec]})
        self.vault.write_manifest()
        rows = [l.split("\t") for l in (self.vault.root / "PROVENANCE.tsv").read_text().splitlines()]
        self.assertEqual(rows[0][:4], ["path", "sha256", "size", "integrity"])
        self.assertEqual(rows[1][0], "docs/p.bin")
        self.assertEqual(rows[1][3], "pinned-sha256")
        self.assertEqual(rows[1][6], "CC0")
        self.assertEqual(forge.verify_vault(self.vault, strict=True, out=io.StringIO())[0], 0)


@unittest.skipUnless(os.environ.get("FORGE_LIVE") == "1", "set FORGE_LIVE=1 for real-upstream integration tests")
class LiveUpstreamTests(unittest.TestCase):
    """F3/F8/F9 against the real internet: Kiwix, Hugging Face, Ollama registry, kiwix-serve, Ollama.

    FORGE_TEST_OLLAMA_BIN=/path/to/ollama enables the real-Ollama check (F8).
    FORGE_TEST_EXFAT=<folder> puts the live Vault on exFAT.
    """

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="forge-live-", dir=os.environ.get("FORGE_TEST_EXFAT")))
        cls.root = cls.tmp / "vault"
        out = io.StringIO()
        assert forge.main(["init", str(cls.root)], out=out) == 0, out.getvalue()
        cls.fetch_code = forge.main(["fetch", str(cls.root), "--profile", "test"], out=out)
        cls.fetch_log = out.getvalue()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_f3_f4_live_fetch_and_strict_verify(self):
        self.assertEqual(self.fetch_code, 0, self.fetch_log[-3000:])
        out = io.StringIO()
        self.assertEqual(forge.main(["verify", str(self.root), "--strict"], out=out), 0, out.getvalue())
        rows = (self.root / "PROVENANCE.tsv").read_text().splitlines()[1:]
        self.assertTrue(rows and all(r.split("\t")[3] in ("upstream-sha256", "pinned-sha256", "registry-manifest")
                                     for r in rows))
        if shutil.which("sha256sum"):
            proc = subprocess.run(["sha256sum", "-c", "--quiet", "MANIFEST.sha256"], cwd=self.root, capture_output=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    @unittest.skipUnless(sys.platform.startswith("linux") and os.uname().machine == "x86_64", "kiwix-serve x86-64 Linux build")
    def test_f9_kiwix_serve_from_the_vault(self):
        archive = self.root / "runtimes/linux-amd64/kiwix-tools_linux-x86_64-3.8.2.tar.gz"
        bindir = self.tmp / "kiwix"
        with tarfile.open(archive) as tar:
            member = next(m for m in tar.getmembers() if m.name.endswith("/kiwix-serve"))
            member.name = "kiwix-serve"
            tar.extract(member, bindir, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))
        zim = next((self.root / "knowledge/zim").glob("zimgit-water_en_*.zim"))
        port = free_port()
        proc = subprocess.Popen([str(bindir / "kiwix-serve"), "--address=127.0.0.1", f"--port={port}", str(zim)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: (proc.kill(), proc.wait(10)))
        base = f"http://127.0.0.1:{port}"
        wait_http(base + "/catalog/v2/entries")
        book = zim.stem
        with urllib.request.urlopen(f"{base}/content/{book}/", timeout=10) as resp:
            self.assertEqual(resp.status, 200)
        with urllib.request.urlopen(f"{base}/search?books.name={book}&pattern=water&format=xml", timeout=10) as resp:
            text = resp.read().decode()
        total = int(re.search(r"<opensearch:totalResults>(\d+)", text).group(1))
        self.assertGreater(total, 0)

    @unittest.skipUnless(os.environ.get("FORGE_TEST_OLLAMA_BIN"), "set FORGE_TEST_OLLAMA_BIN to an ollama binary")
    def test_f8_real_ollama_serves_forge_written_models(self):
        port = free_port()
        env = dict(os.environ, OLLAMA_MODELS=str(self.root / "ai/ollama"), OLLAMA_NOPRUNE="1",
                   OLLAMA_HOST=f"127.0.0.1:{port}")
        proc = subprocess.Popen([os.environ["FORGE_TEST_OLLAMA_BIN"], "serve"], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: (proc.kill(), proc.wait(10)))
        base = f"http://127.0.0.1:{port}"
        wait_http(base + "/api/version")
        with urllib.request.urlopen(base + "/api/tags", timeout=10) as resp:
            names = {m["name"] for m in json.load(resp)["models"]}
        self.assertTrue({"all-minilm:22m", "smollm2:135m"} <= names, names)
        req = urllib.request.Request(base + "/api/embed", data=json.dumps(
            {"model": "all-minilm:22m", "input": "boil water for one minute"}).encode())
        with urllib.request.urlopen(req, timeout=120) as resp:
            self.assertEqual(len(json.load(resp)["embeddings"][0]), 384)
        req = urllib.request.Request(base + "/api/generate", data=json.dumps(
            {"model": "smollm2:135m", "prompt": "Name one way to purify water.", "stream": False,
             "options": {"num_predict": 16, "temperature": 0}}).encode())
        with urllib.request.urlopen(req, timeout=300) as resp:
            self.assertGreater(json.load(resp)["eval_count"], 0)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except OSError:
            time.sleep(0.3)
    raise AssertionError(f"{url} never answered")


@unittest.skipUnless(os.environ.get("FORGE_TEST_EXFAT"), "set FORGE_TEST_EXFAT to a folder on an exFAT volume")
class ExfatResolverAndProfileTests(ResolverAndProfileTests):
    base_dir = "exfat"


@unittest.skipUnless(os.environ.get("FORGE_TEST_EXFAT"), "set FORGE_TEST_EXFAT to a folder on an exFAT volume")
class ExfatReviewRegressionTests(ReviewRegressionTests):
    base_dir = "exfat"


@unittest.skipUnless(os.environ.get("FORGE_TEST_EXFAT"), "set FORGE_TEST_EXFAT to a folder on an exFAT volume")
class ExfatDownloadTests(DownloadTests):
    base_dir = "exfat"

    def test_vault_is_on_exfat(self):
        self.assertEqual(forge.detect_filesystem(self.vault.root)["type"], "exfat")


@unittest.skipUnless(os.environ.get("FORGE_TEST_EXFAT"), "set FORGE_TEST_EXFAT to a folder on an exFAT volume")
class ExfatVerifyTests(VerifyTests):
    base_dir = "exfat"


@unittest.skipUnless(os.environ.get("FORGE_TEST_EXFAT"), "set FORGE_TEST_EXFAT to a folder on an exFAT volume")
class ExfatVaultTests(VaultTests):
    base_dir = "exfat"


if __name__ == "__main__":
    unittest.main()
