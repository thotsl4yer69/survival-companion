#!/usr/bin/env python3
"""FORGE - provision a BLACKBOX Vault from verified upstream sources.

Run it on the connected Windows desktop (or any Linux host) against a drive
that the Jetson Orin can also read. Every byte that lands in the Vault is
checked against an upstream SHA-256 (or a catalogue-pinned one); interrupted
downloads resume from the last verified point; the result is a plain folder
tree with a coreutils-compatible MANIFEST.sha256.

Python 3.9+ standard library only. No accounts, tokens or cloud services.
"""
from __future__ import annotations

import argparse
import contextlib
import errno
import hashlib
import http.client
import json
import os
import random
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

VERSION = "0.5.0"
VAULT_SCHEMA = 1
CATALOG_SCHEMA = 2
CHUNK = 1 << 20
DURABLE_EVERY = 256 << 20
MAX_TEXT = 8 << 20
MAX_REL = 200
MAX_COMPONENT = 120
KIWIX_ZIM_BASE = "https://download.kiwix.org/zim/"
OLLAMA_REGISTRY = "registry.ollama.ai"
USER_AGENT = "BLACKBOX-Forge/" + VERSION
HERE = Path(__file__).resolve().parent
DEFAULT_CATALOG = HERE / "catalog.json"
LOCAL_CATALOG = HERE / "catalog.local.json"
STANDARD_DIRS = ("knowledge/zim", "ai/ollama/blobs", "ai/ollama/manifests", "ai/gguf",
                 "maps", "runtimes", "armory", "docs", "licences")
KINDS = ("kiwix", "huggingface", "ollama", "http")
# Entries an operating system creates at a drive root; they do not make a drive "in use".
OS_ROOT_ENTRIES = {"System Volume Information", "$RECYCLE.BIN", "lost+found", ".Trash-1000", ".Trashes",
                   ".fseventsd", ".Spotlight-V100", "Thumbs.db", "desktop.ini", "IndexerVolumeGuid"}
TMP_NAME = re.compile(r"^\..+\.tmp-\d+$")
# Folders that Field runtimes write as caches; never content, never a verify failure.
RUNTIME_CACHE_PREFIXES = ("ai/ollama/metadata/",)
QUIET_BELOW = 8 << 20
METADATA_DEADLINE = 120.0          # seconds for a listing / metalink / manifest document
SLOW_WINDOW = 120.0                # seconds; a download slower than SLOW_RATE over this window switches source
SLOW_RATE = 4096                   # bytes per second
MAX_PIECE = 64 << 20               # larger metalink pieces are ignored (whole-file SHA-256 still applies)
TOOL_FILES = ("forge.py", "forge.cmd", "catalog.json", "README.md")
CATEGORIES = ("knowledge", "medical", "survival", "technical", "education", "ai",
              "runtime", "maps", "armory", "reference", "test")
COMMERCIAL = ("yes", "no", "check")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")
EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_SPACE, EXIT_DISKFULL, EXIT_LOCKED, EXIT_INTERRUPTED = 0, 1, 2, 3, 4, 5, 130


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def human(n: Optional[float]) -> str:
    if n is None:
        return "?"
    n = float(n)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(n) < 1024 or unit == "TiB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TiB"


# --------------------------------------------------------------------------- errors

class ForgeError(Exception):
    exit_code = EXIT_FAIL


class ResolveError(ForgeError):
    pass


class IntegrityError(ForgeError):
    pass


class DiskFullError(ForgeError):
    exit_code = EXIT_DISKFULL


class LockedError(ForgeError):
    exit_code = EXIT_LOCKED


class ReadOnlyVaultError(ForgeError):
    """The Vault is mounted read-only (the recommended field setup); nothing can be written."""


class SourceError(ForgeError):
    """One download source is unusable (refused redirect, TLS failure, wrong size). Try the next one."""


class TransientError(Exception):
    """A retryable network condition. retry_after is a server hint in seconds."""

    def __init__(self, message: str, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


class PermanentHTTPError(SourceError):
    def __init__(self, code: int, url: str):
        super().__init__(f"HTTP {code} from {urllib.parse.urlsplit(url).hostname}")
        self.code = code


NETWORK_ERRORS = (socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException, ssl.SSLError)
_DIGITS = re.compile(r"[0-9]+")


def parse_int(value) -> Optional[int]:
    """Strict ASCII-digit integer; str.isdigit() accepts '\\xb2' which int() rejects."""
    if value is None:
        return None
    text = str(value).strip()
    return int(text) if _DIGITS.fullmatch(text) else None


class BadPieceError(TransientError):
    def __init__(self, index: int):
        super().__init__(f"piece {index} failed its SHA-1 check")
        self.index = index


def is_disk_full(err: BaseException) -> bool:
    return isinstance(err, OSError) and (err.errno == errno.ENOSPC or getattr(err, "winerror", None) in (39, 112))


# --------------------------------------------------------------------------- path rules

_WIN_BAD = set('<>:"\\|?*')
_RESERVED = ({"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} |
             {f"{dev}{n}" for dev in ("COM", "LPT") for n in list("0123456789") + ["¹", "²", "³"]})


def check_relpath(rel: str) -> str:
    """Accept only paths that are valid on exFAT, NTFS and ext4 alike."""
    if not isinstance(rel, str) or not rel:
        raise ForgeError("empty Vault path")
    if rel.startswith("/") or "\\" in rel or rel != rel.strip():
        raise ForgeError(f"unsafe Vault path: {rel!r}")
    if len(rel) > MAX_REL:
        raise ForgeError(f"Vault path longer than {MAX_REL} characters: {rel!r}")
    for part in rel.split("/"):
        if part in ("", ".", ".."):
            raise ForgeError(f"unsafe Vault path: {rel!r}")
        if any(ord(c) < 32 or c in _WIN_BAD for c in part):
            raise ForgeError(f"character not allowed on Windows/exFAT in {rel!r}")
        if part[-1] in " .":
            raise ForgeError(f"Windows forbids a trailing dot or space: {rel!r}")
        if part.split(".")[0].upper() in _RESERVED:
            raise ForgeError(f"reserved Windows device name in {rel!r}")
        if len(part) > MAX_COMPONENT:
            raise ForgeError(f"path component too long in {rel!r}")
    return rel


def check_collisions(rels: Iterable[str]) -> None:
    """Reject paths (or any of their folders) that differ only by letter case: exFAT/NTFS would merge them."""
    seen: Dict[str, str] = {}
    for rel in rels:
        parts = rel.split("/")
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            key = prefix.casefold()
            if key in seen and seen[key] != prefix:
                raise ForgeError(f"paths differ only by letter case (exFAT/NTFS cannot hold both): "
                                 f"{seen[key]} / {prefix}")
            seen[key] = prefix


def os_path(root: Path, rel: str) -> Path:
    return root.joinpath(*check_relpath(rel).split("/"))


# --------------------------------------------------------------------------- filesystem

def _unescape_mount(value: str) -> str:
    return re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), value)


def _probe_block_device(source: str) -> Optional[str]:
    if shutil.which("lsblk"):
        try:
            out = subprocess.run(["lsblk", "-no", "FSTYPE", source], capture_output=True, text=True,
                                 timeout=5, check=False).stdout.strip().splitlines()
            if out and out[0].strip():
                return out[0].strip().lower()
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        with open(source, "rb") as dev:
            boot = dev.read(16)
        if boot[3:11] == b"EXFAT   ":
            return "exfat"
        if boot[3:11] == b"NTFS    ":
            return "ntfs"
    except OSError:
        pass
    return None


def detect_filesystem(path: Path) -> Dict[str, str]:
    path = Path(path).resolve()
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        volume = ctypes.create_unicode_buffer(261)
        if not kernel32.GetVolumePathNameW(str(path), volume, 261):
            return {"type": "unknown", "source": "", "method": "GetVolumePathNameW failed"}
        label = ctypes.create_unicode_buffer(261)
        fsname = ctypes.create_unicode_buffer(261)
        serial, maxlen, flags = wintypes.DWORD(), wintypes.DWORD(), wintypes.DWORD()
        ok = kernel32.GetVolumeInformationW(volume.value, label, 261, ctypes.byref(serial), ctypes.byref(maxlen),
                                            ctypes.byref(flags), fsname, 261)
        if not ok:
            return {"type": "unknown", "source": volume.value, "method": "GetVolumeInformationW failed"}
        return {"type": fsname.value.lower(), "source": volume.value, "label": label.value, "method": "win32"}
    mountinfo = Path("/proc/self/mountinfo")
    if mountinfo.is_file():
        best: Optional[Tuple[str, str, str]] = None
        for line in mountinfo.read_text(encoding="utf-8", errors="replace").splitlines():
            left, _, right = line.partition(" - ")
            fields, tail = left.split(), right.split()
            if len(fields) < 5 or len(tail) < 2:
                continue
            mnt = _unescape_mount(fields[4])
            inside = str(path) == mnt or str(path).startswith(mnt.rstrip("/") + "/") or mnt == "/"
            if inside and (best is None or len(mnt) > len(best[0])):
                best = (mnt, tail[0], _unescape_mount(tail[1]))
        if best:
            mnt, fstype, source = best
            result = {"type": fstype.lower(), "source": source, "mount": mnt, "method": "mountinfo"}
            if fstype in ("fuseblk", "fuse") and source.startswith("/dev/"):
                probed = _probe_block_device(source)
                if probed:
                    result.update(type=probed, method="mountinfo+" + ("lsblk" if shutil.which("lsblk") else "superblock"),
                                  fuse=fstype)
            return result
    return {"type": "unknown", "source": "", "method": "unsupported platform"}


def judge_filesystem(fs: Dict[str, str]) -> Tuple[str, str]:
    kind = fs.get("type", "unknown")
    if kind in ("vfat", "fat", "fat32", "fat16", "msdos"):
        return "refuse", "FAT32 cannot store files over 4 GiB (Wikipedia is 119 GiB). Reformat as exFAT."
    if kind == "exfat":
        return "ok", "exFAT: readable by Windows and by the Orin (JetPack 6 kernel) natively."
    if kind in ("ntfs", "ntfs3", "fuseblk"):
        return "ok", "NTFS: native on Windows; the Orin needs the ntfs3 driver or ntfs-3g."
    if kind in ("ext4", "ext3", "xfs", "btrfs", "f2fs"):
        return "warn", f"{kind}: fine on the Orin, but Windows cannot read it without extra software."
    return "warn", f"Filesystem '{kind}' not recognised; check both machines can read it."


def windows_long_paths_enabled() -> bool:
    if os.name != "nt":
        return True
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as key:
            return winreg.QueryValueEx(key, "LongPathsEnabled")[0] == 1
    except OSError:
        return False


def windows_path_budget_problem(root: str, is_windows: bool, long_paths_ok: bool) -> Optional[str]:
    """Classic Windows MAX_PATH is 260 including the terminator; Vault paths can be MAX_REL long."""
    if not is_windows or long_paths_ok or len(root) + 1 + MAX_REL <= 259:
        return None
    return (f"Vault folder path is too long for Windows without long-path support ({len(root)} chars); "
            "use a short path such as E:\\BLACKBOX, or enable long paths (LongPathsEnabled=1)")


def fsync_dir(path: Path) -> None:
    if os.name != "posix":
        return
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def replace_file(src: Path, dst: Path, *, sleep: Callable[[float], None] = time.sleep) -> None:
    """os.replace, retrying briefly on Windows where antivirus/indexers hold files open (WinError 5/32)."""
    for attempt in range(6):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if os.name != "nt" or attempt == 5:
                raise
            sleep(0.25 * (2 ** attempt))


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        replace_file(tmp, path)
    except BaseException as err:
        with contextlib.suppress(OSError):
            tmp.unlink()
        if is_disk_full(err):
            raise DiskFullError(f"Vault drive is full while writing {path.name}; free space and rerun") from None
        raise
    fsync_dir(path.parent)


# --------------------------------------------------------------------------- vault

class VaultLock:
    """Exclusive advisory lock held for the life of a mutating Forge run."""

    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            handle = open(self.path, "a+b")
        except OSError as err:
            if err.errno in (errno.EROFS, errno.EACCES, errno.EPERM):
                raise ReadOnlyVaultError("the Vault is read-only here (read-only mount or no write permission)") from None
            raise
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise LockedError("another Forge process is using this Vault; wait for it to finish") from None
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid={os.getpid()} host={socket.gethostname()} since={utcnow()}\n".encode())
        handle.flush()
        self.handle = handle
        return self

    def __exit__(self, *exc):
        if self.handle:
            try:
                if os.name == "nt":
                    import msvcrt
                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            finally:
                self.handle.close()
                self.handle = None
        return False


class Vault:
    INDEX = "vault.json"
    MANIFEST = "MANIFEST.sha256"
    PROVENANCE = "PROVENANCE.tsv"
    META = ".forge"

    def __init__(self, root: Path, index: dict):
        self.root = Path(root)
        self.index = index

    # layout
    @property
    def meta(self) -> Path:
        return self.root / self.META

    @property
    def partial_dir(self) -> Path:
        return self.meta / "partial"

    def lock(self) -> VaultLock:
        return VaultLock(self.meta / "forge.lock")

    def log(self, message: str) -> None:
        try:
            self.meta.mkdir(parents=True, exist_ok=True)
            with open(self.meta / "forge.log", "a", encoding="utf-8") as f:
                f.write(f"{utcnow()} {message}\n")
        except OSError:
            pass

    # lifecycle
    @classmethod
    def create(cls, root: Path, label: str = "BLACKBOX VAULT") -> Tuple["Vault", Dict[str, str], str]:
        root = Path(root).expanduser()
        if (root / cls.INDEX).is_file():
            vault = cls.open(root)
            for rel in STANDARD_DIRS:
                os_path(vault.root, rel).mkdir(parents=True, exist_ok=True)
            fs = detect_filesystem(vault.root)
            return vault, fs, "existing Vault opened; folders checked"
        created = False
        if root.exists():
            if not root.is_dir():
                raise ForgeError(f"{root} exists and is not a folder")
            if any(p.name not in OS_ROOT_ENTRIES for p in root.iterdir()):
                raise ForgeError(f"{root} is not empty and is not a Vault; choose an empty folder or a drive root")
        else:
            if not root.parent.is_dir():
                raise ForgeError(f"parent folder {root.parent} does not exist")
            root.mkdir()
            created = True
        root = root.resolve()
        fs = detect_filesystem(root)
        verdict, note = judge_filesystem(fs)
        problem = None
        if verdict == "refuse":
            problem = note
        else:
            problem = windows_path_budget_problem(str(root), os.name == "nt",
                                                  os.name == "nt" and windows_long_paths_enabled())
        if problem:
            if created:
                root.rmdir()
            raise ForgeError(problem)
        index = {"schema": VAULT_SCHEMA, "kind": "blackbox-vault", "vault_id": uuid.uuid4().hex,
                 "label": label[:80], "created_utc": utcnow(), "forge_version": VERSION,
                 "filesystem": fs, "items": {}, "superseded": [], "last_verify": None}
        vault = cls(root, index)
        for rel in STANDARD_DIRS:
            os_path(root, rel).mkdir(parents=True, exist_ok=True)
        vault.partial_dir.mkdir(parents=True, exist_ok=True)
        vault.save()
        vault.write_manifest()
        vault.install_tool()
        vault.log(f"vault created label={label!r} fs={fs.get('type')}")
        return vault, fs, note

    @classmethod
    def open(cls, root: Path) -> "Vault":
        root = Path(root).expanduser().resolve()
        path = root / cls.INDEX
        if not path.is_file():
            raise ForgeError(f"{root} is not a Vault (no {cls.INDEX}); run: forge init {root}")
        try:
            index = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            raise ForgeError(f"cannot read {path}: {err}") from None
        if index.get("kind") != "blackbox-vault" or index.get("schema") != VAULT_SCHEMA:
            raise ForgeError(f"{path} is not a supported Vault index (schema {index.get('schema')})")
        index.setdefault("items", {})
        index.setdefault("superseded", [])
        return cls(root, index)

    def save(self) -> None:
        self.index["forge_version"] = VERSION
        atomic_write(self.root / self.INDEX, (json.dumps(self.index, indent=2, sort_keys=True) + "\n").encode("utf-8"))

    # records
    def file_records(self) -> Dict[str, dict]:
        records: Dict[str, dict] = {}
        for item in self.index["items"].values():
            for rec in item.get("files", []):
                records[rec["path"]] = rec
        return records

    def record_item(self, item_id: str, record: dict) -> List[str]:
        old = self.index["items"].get(item_id)
        self.index["items"][item_id] = record
        current = set(self.file_records())
        superseded = []
        if old:
            for rec in old.get("files", []):
                if rec["path"] not in current and os_path(self.root, rec["path"]).exists():
                    entry = dict(rec, item=item_id, superseded_utc=utcnow())
                    self.index["superseded"] = [s for s in self.index["superseded"] if s["path"] != rec["path"]]
                    self.index["superseded"].append(entry)
                    superseded.append(rec["path"])
        self.index["superseded"] = [s for s in self.index["superseded"] if s["path"] not in current]
        repaired = {rec["path"] for rec in record.get("files", [])}
        self.index["damaged"] = [p for p in self.index.get("damaged", []) if p not in repaired]
        self.save()
        return superseded

    def damaged(self) -> set:
        """Paths the last verify found missing/modified/wrong size; fetch re-hashes and repairs them."""
        return set(self.index.get("damaged", []))

    def install_tool(self) -> None:
        """Keep a copy of Forge inside the Vault so any machine can verify it without this repo."""
        dest = self.meta / "tool"
        for name in TOOL_FILES:
            src = HERE / name
            if not src.is_file():
                continue
            data = src.read_bytes()
            target = dest / name
            with contextlib.suppress(OSError):
                if target.is_file() and target.read_bytes() == data:
                    continue
            atomic_write(target, data)

    def write_manifest(self) -> int:
        """MANIFEST.sha256 stays pure coreutils format; PROVENANCE.tsv labels where each digest came from."""
        records = self.file_records()
        lines = [f"{rec['sha256']}  {path}\n" for path, rec in sorted(records.items())]
        atomic_write(self.root / self.MANIFEST, "".join(lines).encode("utf-8"))
        owner = {rec["path"]: (item_id, item) for item_id, item in self.index["items"].items()
                 for rec in item.get("files", [])}
        rows = ["path\tsha256\tsize\tintegrity\titem\tversion\tlicence\tcommercial\tsource\n"]
        for path, rec in sorted(records.items()):
            item_id, item = owner[path]
            fields = [path, rec["sha256"], str(rec["size"]), rec.get("integrity", ""), item_id,
                      str(item.get("version", "")), item.get("licence", ""), item.get("commercial", ""),
                      rec.get("source", "")]
            rows.append("\t".join(f.replace("\t", " ").replace("\n", " ") for f in fields) + "\n")
        atomic_write(self.root / self.PROVENANCE, "".join(rows).encode("utf-8"))
        return len(lines)


# --------------------------------------------------------------------------- HTTP

class _HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, check: Callable[[str], None]):
        super().__init__()
        self.check = check

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.check(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Http:
    """HTTPS-only client. Honours HTTPS_PROXY and the OS/SSL_CERT_FILE trust store."""

    TRANSIENT_CODES = (408, 425, 429, 500, 502, 503, 504)

    def __init__(self, *, timeout: float = 60, ssl_context: Optional[ssl.SSLContext] = None,
                 allow_http_loopback: bool = False):
        self.timeout = timeout
        self.allow_http_loopback = allow_http_loopback
        context = ssl_context or ssl.create_default_context()
        https = urllib.request.HTTPSHandler(context=context)
        self.opener = urllib.request.build_opener(https, _HttpsOnlyRedirect(self.check_url))
        self.head_opener = urllib.request.build_opener(https, _NoRedirect())

    def check_url(self, url: str) -> None:
        parts = urllib.parse.urlsplit(url)
        if parts.username or parts.password or not parts.hostname:
            raise SourceError(f"refused URL with credentials or no host: {url}")
        if parts.scheme == "https":
            return
        if parts.scheme == "http" and self.allow_http_loopback and parts.hostname in ("127.0.0.1", "::1", "localhost"):
            return
        raise SourceError(f"refused non-HTTPS URL: {url}")

    def _request(self, url: str, headers: Optional[dict], method: str) -> urllib.request.Request:
        self.check_url(url)
        merged = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
        merged.update(headers or {})
        return urllib.request.Request(url, headers=merged, method=method)

    @staticmethod
    def _translate(err: BaseException, url: str) -> BaseException:
        if isinstance(err, urllib.error.HTTPError):
            if err.code in Http.TRANSIENT_CODES:
                seconds = parse_int(err.headers.get("Retry-After")) if err.headers else None
                return TransientError(f"HTTP {err.code}", min(float(seconds), 300.0) if seconds is not None else None)
            return PermanentHTTPError(err.code, url)
        if isinstance(err, urllib.error.URLError):
            reason = err.reason
            if isinstance(reason, ssl.SSLCertVerificationError):
                return SourceError(f"TLS certificate check failed for {urllib.parse.urlsplit(url).hostname}: {reason}")
            if isinstance(reason, ForgeError):
                return reason
            return TransientError(f"network error: {reason}")
        if isinstance(err, NETWORK_ERRORS):
            return TransientError(f"connection problem: {err.__class__.__name__}: {err}")
        return err

    def open(self, url: str, *, headers: Optional[dict] = None, method: str = "GET"):
        try:
            return self.opener.open(self._request(url, headers, method), timeout=self.timeout)
        except ForgeError:
            raise
        except Exception as err:  # noqa: BLE001 - translated to typed errors below
            raise self._translate(err, url) from None

    def get_bytes(self, url: str, limit: int = MAX_TEXT, headers: Optional[dict] = None) -> bytes:
        """Small metadata documents: size-capped and bounded by METADATA_DEADLINE (defeats trickling servers)."""
        deadline = time.monotonic() + METADATA_DEADLINE
        data = bytearray()
        with self.open(url, headers=headers) as resp:
            while True:
                try:
                    chunk = resp.read1(65536)
                except Exception as err:  # noqa: BLE001
                    raise self._translate(err, url) from None
                if not chunk:
                    break
                data += chunk
                if len(data) > limit:
                    raise SourceError(f"response from {url} exceeds {limit} bytes")
                if time.monotonic() > deadline:
                    raise TransientError(f"{urllib.parse.urlsplit(url).hostname} is sending metadata too slowly")
        return bytes(data)

    def head_first_hop(self, url: str) -> Tuple[int, Dict[str, str]]:
        """HEAD without following redirects; returns the first response's headers."""
        try:
            with self.head_opener.open(self._request(url, None, "HEAD"), timeout=self.timeout) as resp:
                return resp.status, {k.lower(): v for k, v in resp.headers.items()}
        except urllib.error.HTTPError as err:
            if 300 <= err.code < 400:
                return err.code, {k.lower(): v for k, v in err.headers.items()}
            raise self._translate(err, url) from None
        except ForgeError:
            raise
        except Exception as err:  # noqa: BLE001
            raise self._translate(err, url) from None

    def content_length(self, url: str) -> Optional[int]:
        try:
            with self.open(url, method="HEAD") as resp:
                return parse_int(resp.headers.get("Content-Length"))
        except (TransientError, PermanentHTTPError):
            return None


def with_retries(fn: Callable[[], object], *, attempts: int = 5, sleep: Callable[[float], None] = time.sleep):
    for n in range(attempts):
        try:
            return fn()
        except TransientError as err:
            if n == attempts - 1:
                raise ResolveError(f"gave up after {attempts} attempts: {err}") from None
            sleep(err.retry_after or min(30.0, 2.0 ** n) * random.uniform(0.5, 1.0))
    raise AssertionError("unreachable")


# --------------------------------------------------------------------------- catalogue

def load_catalog(paths: Optional[List[Path]] = None) -> dict:
    paths = list(paths) if paths else [DEFAULT_CATALOG] + ([LOCAL_CATALOG] if LOCAL_CATALOG.is_file() else [])
    merged = {"schema": CATALOG_SCHEMA, "items": {}, "profiles": {}}
    for path in paths:
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            raise ForgeError(f"cannot read catalogue {path}: {err}") from None
        if data.get("schema") != CATALOG_SCHEMA:
            raise ForgeError(f"{path}: catalogue schema must be {CATALOG_SCHEMA}")
        merged["items"].update(data.get("items", {}))
        merged["profiles"].update(data.get("profiles", {}))
    validate_catalog(merged)
    return merged


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise ForgeError("catalogue: " + message)


def validate_catalog(catalog: dict) -> None:
    for item_id, item in catalog["items"].items():
        _require(bool(ITEM_ID.match(item_id)), f"bad item id {item_id!r}")
        _require(isinstance(item, dict), f"{item_id}: item must be an object")
        kind = item.get("kind")
        _require(kind in KINDS, f"{item_id}: unknown kind {kind!r}")
        _require(isinstance(item.get("title"), str) and item["title"], f"{item_id}: title required")
        _require(item.get("category") in CATEGORIES, f"{item_id}: unknown category {item.get('category')!r}")
        _require(isinstance(item.get("licence"), str) and item["licence"], f"{item_id}: licence required")
        _require(item.get("commercial", "check") in COMMERCIAL, f"{item_id}: commercial must be yes/no/check")
        if kind == "kiwix":
            _require(bool(re.fullmatch(r"[a-z0-9_-]+", item.get("path", ""))), f"{item_id}: kiwix path")
            _require(bool(re.fullmatch(r"[A-Za-z0-9._-]+", item.get("name", ""))), f"{item_id}: kiwix name")
            check_relpath(item.get("dest", "knowledge/zim"))
        elif kind == "huggingface":
            _require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*", item.get("repo", ""))),
                     f"{item_id}: huggingface repo must be owner/name")
            filename = item.get("file", "")
            _require(bool(filename) and ".." not in filename.split("/") and not filename.startswith("/"),
                     f"{item_id}: huggingface file")
            _require(bool(re.fullmatch(r"[A-Za-z0-9._-]+", item.get("revision", "main"))), f"{item_id}: revision")
            check_relpath(item.get("dest", "ai/gguf") + "/" + filename.split("/")[-1])
            if "sha256" in item:
                _require(bool(HEX64.match(item["sha256"])), f"{item_id}: sha256 must be 64 lowercase hex")
        elif kind == "ollama":
            _require(bool(re.fullmatch(r"([a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*", item.get("model", ""))),
                     f"{item_id}: ollama model")
            _require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", item.get("tag", "latest"))),
                     f"{item_id}: ollama tag")
        elif kind == "http":
            url = item.get("url", "")
            _require(url.startswith("https://"), f"{item_id}: http url must be https")
            check_relpath(item.get("dest", ""))
            sources = [k for k in ("sha256", "sha256_url", "sha256_list_url", "md5_url") if k in item]
            _require(len(sources) == 1, f"{item_id}: give exactly one of sha256 / sha256_url / sha256_list_url / md5_url")
            if "sha256" in item:
                _require(bool(HEX64.match(item["sha256"])), f"{item_id}: sha256 must be 64 lowercase hex")
            if "sha256_list_url" in item:
                _require(isinstance(item.get("sha256_list_name"), str), f"{item_id}: sha256_list_name required")
            for key in ("sha256_url", "sha256_list_url", "md5_url"):
                if key in item:
                    _require(item[key].startswith("https://"), f"{item_id}: {key} must be https")
    for name, profile in catalog["profiles"].items():
        _require(bool(ITEM_ID.match(name)), f"bad profile name {name!r}")
        _require(isinstance(profile.get("items", []), list), f"profile {name}: items must be a list")
        for ref in profile.get("extends", []):
            _require(ref in catalog["profiles"], f"profile {name} extends unknown profile {ref}")
        for ref in profile.get("items", []):
            _require(ref in catalog["items"], f"profile {name} lists unknown item {ref}")
    for name in catalog["profiles"]:
        profile_items(catalog, name)


def profile_items(catalog: dict, name: str, _stack: Tuple[str, ...] = ()) -> List[str]:
    if name not in catalog["profiles"]:
        raise ForgeError(f"unknown profile {name!r}; available: {', '.join(sorted(catalog['profiles']))}")
    if name in _stack:
        raise ForgeError("catalogue: profile inheritance cycle: " + " -> ".join(_stack + (name,)))
    out: List[str] = []
    profile = catalog["profiles"][name]
    for parent in profile.get("extends", []):
        for item in profile_items(catalog, parent, _stack + (name,)):
            if item not in out:
                out.append(item)
    for item in profile.get("items", []):
        if item not in out:
            out.append(item)
    return out


# --------------------------------------------------------------------------- resolution

@dataclass
class Pieces:
    length: int
    sha1: List[str]


@dataclass
class FileSpec:
    rel: str
    size: Optional[int]
    sha256: Optional[str]
    md5: Optional[str] = None
    pieces: Optional[Pieces] = None
    urls: List[str] = field(default_factory=list)
    content: Optional[bytes] = None
    integrity: str = "upstream-sha256"
    source: str = ""
    order: int = 0

    @property
    def key(self) -> str:
        if self.sha256:
            return self.sha256
        return hashlib.sha256((self.rel + "\0" + self.source).encode()).hexdigest()


@dataclass
class Resolved:
    item_id: str
    item: dict
    version: str
    files: List[FileSpec]

    @property
    def size(self) -> Optional[int]:
        sizes = [f.size for f in self.files]
        return None if any(s is None for s in sizes) else sum(sizes)  # type: ignore[arg-type]


def parse_meta4(data: bytes, accept: Callable[[str], bool] = lambda u: u.startswith("https://")) -> dict:
    # Only UTF-8 is accepted, so the DOCTYPE/ENTITY guard cannot be sidestepped with UTF-16.
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise ResolveError("metalink is not UTF-8; refused") from None
    if "\x00" in text or "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ResolveError("metalink contains a DOCTYPE/ENTITY declaration; refused")
    if re.search(r"encoding\s*=\s*[\"'](?!utf-?8)", text[:200], re.I):
        raise ResolveError("metalink declares a non-UTF-8 encoding; refused")
    ns = "{urn:ietf:params:xml:ns:metalink}"
    try:
        root = ET.fromstring(data)
    except ET.ParseError as err:
        raise ResolveError(f"metalink is not valid XML: {err}") from None
    node = root.find(ns + "file")
    if node is None:
        raise ResolveError("metalink has no <file>")
    size = parse_int(node.findtext(ns + "size"))
    if size is None:
        raise ResolveError("metalink has no valid <size>")
    hashes = {h.get("type", "").lower(): (h.text or "").strip().lower() for h in node.findall(ns + "hash")}
    pieces = None
    pnode = node.find(ns + "pieces")
    if pnode is not None and pnode.get("type", "").lower() == "sha-1":
        length = parse_int(pnode.get("length")) or 0
        plist = [(h.text or "").strip().lower() for h in pnode.findall(ns + "hash")]
        if 0 < length <= MAX_PIECE and len(plist) == -(-size // length) and all(HEX40.match(p) for p in plist):
            pieces = Pieces(length, plist)
    urls = []
    for u in node.findall(ns + "url"):
        url_text = (u.text or "").strip()
        if accept(url_text):
            priority = parse_int(u.get("priority"))
            urls.append((priority if priority is not None else 999999, url_text))
    urls.sort()
    sha256 = hashes.get("sha-256")
    md5 = hashes.get("md5")
    return {"name": node.get("name", ""), "size": size,
            "sha256": sha256 if sha256 and HEX64.match(sha256) else None,
            "md5": md5 if md5 and HEX32.match(md5) else None,
            "pieces": pieces, "urls": [u for _, u in urls]}


def parse_checksum_list(text: str, name: str) -> Optional[str]:
    want = name.lstrip("*").removeprefix("./")
    for line in text.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        digest, fname = parts[0].lower(), parts[1].strip().lstrip("*").removeprefix("./")
        if fname == want and (HEX64.match(digest) or HEX32.match(digest)):
            return digest
    return None


class Resolver:
    def __init__(self, http: Http, *, sleep: Callable[[float], None] = time.sleep,
                 kiwix_base: str = KIWIX_ZIM_BASE, hf_base: str = "https://huggingface.co",
                 ollama_base: str = "https://" + OLLAMA_REGISTRY):
        self.http = http
        self.sleep = sleep
        self.kiwix_base = kiwix_base.rstrip("/") + "/"
        self.hf_base = hf_base.rstrip("/")
        self.ollama_base = ollama_base.rstrip("/")
        self._listing: Dict[str, str] = {}

    def _url_ok(self, url: str) -> bool:
        try:
            self.http.check_url(url)
            return True
        except ForgeError:
            return False

    def _get(self, url: str, limit: int = MAX_TEXT, headers: Optional[dict] = None) -> bytes:
        return with_retries(lambda: self.http.get_bytes(url, limit, headers), sleep=self.sleep)  # type: ignore[return-value]

    def resolve(self, item_id: str, item: dict) -> Resolved:
        kind = item["kind"]
        try:
            return getattr(self, "_resolve_" + kind)(item_id, item)
        except SourceError as err:
            raise ResolveError(f"{item_id}: {err}") from None

    def _resolve_kiwix(self, item_id: str, item: dict) -> Resolved:
        directory = self.kiwix_base + item["path"] + "/"
        if directory not in self._listing:
            self._listing[directory] = self._get(directory).decode("utf-8", "replace")
        pattern = re.compile(r'href="(' + re.escape(item["name"]) + r'_(\d{4}-\d{2})\.zim)"')
        found = pattern.findall(self._listing[directory])
        if not found:
            raise ResolveError(f"{item_id}: no {item['name']}_YYYY-MM.zim in {directory}")
        filename, version = max(found, key=lambda pair: pair[1])
        url = directory + filename
        meta = parse_meta4(self._get(url + ".meta4", 4 << 20), self._url_ok)
        sha256 = meta["sha256"]
        if not sha256:
            sha256 = parse_checksum_list(self._get(url + ".sha256", 4096).decode("ascii", "replace"), filename)
        if not sha256 or not HEX64.match(sha256):
            raise ResolveError(f"{item_id}: Kiwix published no SHA-256 for {filename}")
        urls = [u for u in meta["urls"] if u != url] + [url]
        spec = FileSpec(rel=check_relpath(item.get("dest", "knowledge/zim") + "/" + filename), size=meta["size"],
                        sha256=sha256, md5=meta["md5"], pieces=meta["pieces"], urls=urls, source=url)
        return Resolved(item_id, item, version, [spec])

    def _resolve_huggingface(self, item_id: str, item: dict) -> Resolved:
        repo, filename, revision = item["repo"], item["file"], item.get("revision", "main")
        quoted = urllib.parse.quote(filename)
        url = f"{self.hf_base}/{repo}/resolve/{revision}/{quoted}"
        status, headers = with_retries(lambda: self.http.head_first_hop(url), sleep=self.sleep)  # type: ignore[misc]
        etag = headers.get("x-linked-etag", "").strip().strip('"').lower()
        size_text = headers.get("x-linked-size") or headers.get("content-length") or ""
        commit = headers.get("x-repo-commit", "")
        sha256, integrity = None, "upstream-sha256"
        if HEX64.match(etag):
            sha256 = etag
        elif item.get("sha256"):
            sha256, integrity = item["sha256"], "pinned-sha256"
        else:
            raise ResolveError(f"{item_id}: Hugging Face returned no SHA-256 for {filename} (not an LFS file); "
                               "pin a sha256 in the catalogue")
        if item.get("sha256") and item["sha256"] != sha256:
            raise ResolveError(f"{item_id}: upstream SHA-256 differs from the catalogue pin")
        size = parse_int(size_text)
        if size is None:
            raise ResolveError(f"{item_id}: Hugging Face returned no size (HTTP {status})")
        pinned = f"{self.hf_base}/{repo}/resolve/{commit}/{quoted}" if re.fullmatch(r"[0-9a-f]{40}", commit) else url
        spec = FileSpec(rel=check_relpath(item.get("dest", "ai/gguf") + "/" + filename.split("/")[-1]),
                        size=size, sha256=sha256, urls=[pinned], integrity=integrity, source=pinned)
        return Resolved(item_id, item, commit[:12] or revision, [spec])

    def _resolve_ollama(self, item_id: str, item: dict) -> Resolved:
        model = item["model"]
        namespace, name = model.split("/", 1) if "/" in model else ("library", model)
        tag = item.get("tag", "latest")
        url = f"{self.ollama_base}/v2/{namespace}/{name}/manifests/{tag}"
        data = self._get(url, 1 << 20, {"Accept": "application/vnd.docker.distribution.manifest.v2+json"})
        try:
            manifest = json.loads(data)
        except ValueError:
            raise ResolveError(f"{item_id}: registry manifest is not JSON") from None
        if manifest.get("schemaVersion") != 2 or not isinstance(manifest.get("layers"), list):
            raise ResolveError(f"{item_id}: unexpected registry manifest format")
        files: List[FileSpec] = []
        for blob in [manifest.get("config")] + manifest["layers"]:
            if not isinstance(blob, dict):
                raise ResolveError(f"{item_id}: manifest blob entry is not an object")
            digest, size = blob.get("digest", ""), blob.get("size")
            match = re.fullmatch(r"sha256:([0-9a-f]{64})", digest)
            if not match or not isinstance(size, int) or size < 0:
                raise ResolveError(f"{item_id}: manifest blob has an invalid digest or size")
            hexd = match.group(1)
            blob_url = f"{self.ollama_base}/v2/{namespace}/{name}/blobs/sha256:{hexd}"
            files.append(FileSpec(rel=f"ai/ollama/blobs/sha256-{hexd}", size=size, sha256=hexd, urls=[blob_url],
                                  integrity="upstream-sha256", source=blob_url))
        # The store path always names the canonical registry: that is where Ollama looks up "qwen3:4b".
        rel = check_relpath(f"ai/ollama/manifests/{OLLAMA_REGISTRY}/{namespace}/{name}/{tag}")
        files.append(FileSpec(rel=rel, size=len(data), sha256=hashlib.sha256(data).hexdigest(), content=data,
                              integrity="registry-manifest", source=url, order=1))
        return Resolved(item_id, item, "manifest-" + hashlib.sha256(data).hexdigest()[:12], files)

    def _resolve_http(self, item_id: str, item: dict) -> Resolved:
        url = item["url"]
        name = urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1])
        md5, integrity = None, "upstream-sha256"
        if "sha256" in item:
            sha256, integrity = item["sha256"], "pinned-sha256"
        elif "sha256_url" in item:
            sha256 = parse_checksum_list(self._get(item["sha256_url"], 1 << 20).decode("utf-8", "replace"), name)
            if sha256 is None:
                text = self._get(item["sha256_url"], 4096).decode("ascii", "replace").split()
                sha256 = text[0].lower() if text else None
        elif "sha256_list_url" in item:
            sha256 = parse_checksum_list(self._get(item["sha256_list_url"], 1 << 20).decode("utf-8", "replace"),
                                         item["sha256_list_name"])
        else:
            sha256 = None
            text = self._get(item["md5_url"], 4096).decode("ascii", "replace").split()
            md5 = text[0].lower() if text else None
            integrity = "upstream-md5"
            if not md5 or not HEX32.match(md5):
                raise ResolveError(f"{item_id}: no MD5 found at {item['md5_url']}")
        if integrity != "upstream-md5" and (not sha256 or not HEX64.match(sha256)):
            raise ResolveError(f"{item_id}: no SHA-256 found for {name}")
        size = item.get("size")
        if not isinstance(size, int):
            size = with_retries(lambda: self.http.content_length(url), sleep=self.sleep)  # type: ignore[assignment]
        spec = FileSpec(rel=check_relpath(item["dest"]), size=size, sha256=sha256, md5=md5, urls=[url],
                        integrity=integrity, source=url)
        return Resolved(item_id, item, item.get("version", ""), [spec])


# --------------------------------------------------------------------------- download engine

class Progress:
    def __init__(self, label: str, total: Optional[int], stream=None, every: float = 2.0):
        self.label, self.total = label, total
        self.stream = stream or sys.stdout
        self.every = every
        self.start = time.monotonic()
        self.base = 0
        self.last = 0.0
        self.tty = hasattr(self.stream, "isatty") and self.stream.isatty()

    @property
    def quiet(self) -> bool:
        return self.total is not None and self.total < QUIET_BELOW

    def begin(self, offset: int) -> None:
        self.base = offset
        self.start = self.last = time.monotonic()

    def update(self, done: int, force: bool = False) -> None:
        if self.quiet:
            return
        now = time.monotonic()
        if not force and now - self.last < (self.every if self.tty else 30.0):
            return
        self.last = now
        rate = (done - self.base) / max(now - self.start, 1e-6)
        pct = f"{100.0 * done / self.total:5.1f}%" if self.total else "   ? %"
        eta = ""
        if self.total and rate > 0:
            secs = int((self.total - done) / rate)
            eta = f" ETA {secs // 3600}h{secs % 3600 // 60:02d}m" if secs >= 3600 else f" ETA {secs // 60}m{secs % 60:02d}s"
        line = f"  {self.label}: {human(done)} / {human(self.total)} {pct} {human(rate)}/s{eta}"
        if self.tty:
            self.stream.write("\r" + line[:110].ljust(110))
        else:
            self.stream.write(line + "\n")
        self.stream.flush()

    def finish(self) -> None:
        if self.tty and not self.quiet:
            self.stream.write("\n")
            self.stream.flush()


class _DownloadState:
    """Running digests for one download.

    With metalink pieces, new bytes stay "pending" until their piece's SHA-1 checks out. The whole-file
    digests advance on tentative copies (hashlib .copy()), so no piece data is held in memory: a failed
    piece is rolled back by discarding the copies and truncating the file to `offset`.
    """

    def __init__(self, spec: FileSpec):
        self.spec = spec
        self.md5_wanted = bool(spec.md5 and not spec.sha256)
        self.reset()

    def reset(self) -> None:
        self.offset = 0
        self.sha256 = hashlib.sha256()
        self.md5 = hashlib.md5() if self.md5_wanted else None
        self.rollback()

    def rollback(self) -> None:
        self.pending = 0
        self.piece_sha1 = hashlib.sha1()
        self.tent_sha256 = self.sha256.copy()
        self.tent_md5 = self.md5.copy() if self.md5 is not None else None

    def feed(self, data) -> None:
        """Bytes already known good (resume re-check, or a download without pieces)."""
        self.sha256.update(data)
        if self.md5 is not None:
            self.md5.update(data)

    def feed_pending(self, data) -> None:
        self.piece_sha1.update(data)
        self.tent_sha256.update(data)
        if self.tent_md5 is not None:
            self.tent_md5.update(data)
        self.pending += len(data)

    def commit_piece(self) -> None:
        self.offset += self.pending
        self.sha256, self.md5 = self.tent_sha256, self.tent_md5
        self.rollback()


class Downloader:
    def __init__(self, vault: Vault, http: Http, *, max_attempts: int = 12, sleep: Callable[[float], None] = time.sleep,
                 out=None, deep: bool = False):
        self.vault = vault
        self.http = http
        self.max_attempts = max_attempts
        self.sleep = sleep
        self.out = out or sys.stdout
        self.deep = deep
        self.item = ""

    def prune_stale(self, item_id: str, keep: Iterable[str]) -> List[str]:
        """Remove interrupted downloads of an item's older upstream builds (e.g. last month's ZIM)."""
        keep = set(keep)
        removed = []
        if not self.vault.partial_dir.is_dir():
            return removed
        for state_path in self.vault.partial_dir.glob("*.json"):
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if state.get("item") == item_id and state_path.stem not in keep:
                for path in (state_path.with_suffix(".part"), state_path):
                    with contextlib.suppress(OSError):
                        path.unlink()
                removed.append(state.get("rel", state_path.stem))
                self.vault.log(f"pruned stale partial {state.get('rel')} for {item_id}")
        return removed

    def say(self, message: str) -> None:
        self.out.write(message + "\n")
        self.out.flush()

    # state sidecar ------------------------------------------------------
    def _paths(self, spec: FileSpec) -> Tuple[Path, Path]:
        base = self.vault.partial_dir / spec.key
        return base.with_suffix(".part"), base.with_suffix(".json")

    def _load_state(self, spec: FileSpec, state_path: Path) -> Optional[dict]:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if state.get("size") != spec.size or state.get("sha256") != spec.sha256 or state.get("md5") != spec.md5:
            return None
        return state

    def _save_state(self, spec: FileSpec, state_path: Path, durable: int) -> None:
        atomic_write(state_path, json.dumps({"rel": spec.rel, "item": self.item, "size": spec.size,
                                             "sha256": spec.sha256, "md5": spec.md5, "durable": durable,
                                             "source": spec.source, "updated_utc": utcnow()}).encode())

    # existing file handling --------------------------------------------
    def _existing(self, spec: FileSpec, final: Path) -> Tuple[Optional[dict], Optional[str]]:
        """Return (record, None) if the file already matches; else (None, occupant) where occupant is
        None (nothing there), 'tracked' (an older/damaged Forge file) or 'foreign' (unknown origin).
        Nothing is moved here: a file is only replaced once its verified successor exists."""
        if not final.exists():
            return None, None
        if final.is_symlink() or not final.is_file():
            raise ForgeError(f"{spec.rel} exists but is not a regular file")
        size = final.stat().st_size
        known = self.vault.file_records().get(spec.rel)
        trusted = (known and spec.size == size and not self.deep and spec.rel not in self.vault.damaged() and
                   ((spec.sha256 and known.get("sha256") == spec.sha256) or
                    (not spec.sha256 and known.get("md5") == spec.md5)))
        if trusted:
            return dict(known), None
        if spec.size is None or size == spec.size:
            sha, md5 = hash_file(final, want_md5=bool(spec.md5 and not spec.sha256))
            if (spec.sha256 and sha == spec.sha256) or (not spec.sha256 and md5 == spec.md5):
                return self._record(spec, size, sha, md5), None
        return None, ("tracked" if known else "foreign")

    def _promote(self, part: Path, final: Path, spec: FileSpec, occupant: Optional[str]) -> None:
        final.parent.mkdir(parents=True, exist_ok=True)
        if occupant == "foreign" and final.exists():
            quarantine = self.vault.meta / "quarantine" / utcnow().replace(":", "") / spec.rel.replace("/", "__")
            quarantine.parent.mkdir(parents=True, exist_ok=True)
            replace_file(final, quarantine)
            self.say(f"  ! a different file was already at {spec.rel}; kept it at "
                     f"{quarantine.relative_to(self.vault.root).as_posix()}")
            self.vault.log(f"quarantined foreign {spec.rel} -> {quarantine}")
        elif occupant == "tracked":
            self.say(f"  replaced the old/damaged copy of {spec.rel} with the verified download")
        replace_file(part, final)
        fsync_dir(final.parent)

    def _record(self, spec: FileSpec, size: int, sha256: str, md5: Optional[str]) -> dict:
        record = {"path": spec.rel, "size": size, "sha256": sha256, "integrity": spec.integrity, "source": spec.source}
        if md5:  # only a digest Forge computed itself is recorded
            record["md5"] = md5
        return record

    # resume preparation --------------------------------------------------
    def _prepare_partial(self, spec: FileSpec, part: Path, st: _DownloadState, state: Optional[dict]) -> None:
        st.reset()
        if not part.exists():
            part.parent.mkdir(parents=True, exist_ok=True)
            open(part, "wb").close()
            return
        size = part.stat().st_size
        if state is None or (spec.size is not None and size > spec.size):
            with open(part, "r+b") as f:
                f.truncate(0)
            return
        if not spec.pieces:
            limit = min(size, int(state.get("durable", 0)))
        else:
            limit = size
        if limit:
            self.say(f"  re-checking {human(limit)} already downloaded for {spec.rel}")
        good = 0
        with open(part, "r+b") as f:
            if spec.pieces:
                length = spec.pieces.length
                index = 0
                while good < limit:
                    expected = min(length, (spec.size or 0) - good)
                    data = f.read(expected)
                    if len(data) < expected or hashlib.sha1(data).hexdigest() != spec.pieces.sha1[index]:
                        break
                    st.feed(data)
                    good += len(data)
                    index += 1
            else:
                while good < limit:
                    data = f.read(min(CHUNK, limit - good))
                    if not data:
                        break
                    st.feed(data)
                    good += len(data)
            f.truncate(good)
        st.offset = good
        st.rollback()  # tentative digests must start from the re-checked state, not the empty one

    # streaming -------------------------------------------------------------
    def _stream(self, resp, f, spec: FileSpec, st: _DownloadState, progress: Progress, part_state: Path) -> None:
        durable_mark = st.offset
        window_start, window_bytes = time.monotonic(), 0
        reader = getattr(resp, "read1", resp.read)
        while True:
            try:
                chunk = reader(CHUNK)
            except NETWORK_ERRORS as err:
                raise TransientError(f"connection problem: {err.__class__.__name__}: {err}") from None
            if not chunk:
                break
            window_bytes += len(chunk)
            elapsed = time.monotonic() - window_start
            if elapsed >= SLOW_WINDOW:
                if window_bytes / elapsed < SLOW_RATE:
                    raise TransientError(f"transfer too slow ({window_bytes / elapsed:.0f} B/s); trying another source")
                window_start, window_bytes = time.monotonic(), 0
            if spec.size is not None and st.offset + st.pending + len(chunk) > spec.size:
                raise TransientError("server sent more data than the expected size")
            f.write(chunk)
            if spec.pieces:
                length, view, pos = spec.pieces.length, memoryview(chunk), 0
                while pos < len(view):
                    index = st.offset // length
                    piece_end = min((index + 1) * length, spec.size or 0)
                    take = view[pos:pos + piece_end - st.offset - st.pending]
                    st.feed_pending(take)
                    pos += len(take)
                    if st.offset + st.pending == piece_end:
                        if st.piece_sha1.hexdigest() != spec.pieces.sha1[index]:
                            raise BadPieceError(index)
                        st.commit_piece()
            else:
                st.feed(chunk)
                st.offset += len(chunk)
            if st.offset - durable_mark >= DURABLE_EVERY:
                f.flush()
                os.fsync(f.fileno())
                self._save_state(spec, part_state, st.offset)
                durable_mark = st.offset
            progress.update(st.offset + st.pending)

    def _open_range(self, url: str, start: int, spec: FileSpec, st: _DownloadState, f):
        headers = {"Range": f"bytes={start}-"} if start else None
        resp = self.http.open(url, headers=headers)
        status = getattr(resp, "status", 200)
        if start and status == 200:
            self.say("  server ignored the resume request; restarting this file from the beginning")
            st.reset()
            f.seek(0)
            f.truncate(0)
        elif status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", (resp.headers.get("Content-Range") or "").strip())
            if not match or int(match.group(1)) != start:
                resp.close()
                raise TransientError("server returned the wrong byte range")
            total = match.group(3)
            if spec.size is not None and total != "*" and int(total) != spec.size:
                resp.close()
                raise SourceError(f"source has a different size ({total} bytes, expected {spec.size})")
        elif status != 200:
            resp.close()
            raise TransientError(f"unexpected HTTP {status}")
        else:
            length = parse_int(resp.headers.get("Content-Length"))
            if spec.size is not None and length is not None and length != spec.size:
                resp.close()
                raise SourceError(f"source has a different size ({length} bytes, expected {spec.size})")
        return resp

    def fetch(self, spec: FileSpec, label: str = "") -> dict:
        final = os_path(self.vault.root, spec.rel)
        if spec.content is not None:
            if final.is_file() and final.read_bytes() == spec.content:
                return self._record(spec, len(spec.content), spec.sha256 or hashlib.sha256(spec.content).hexdigest(), None)
            atomic_write(final, spec.content)
            return self._record(spec, len(spec.content), hashlib.sha256(spec.content).hexdigest(), None)
        existing, occupant = self._existing(spec, final)
        if existing:
            return existing
        if not spec.urls:
            raise ForgeError(f"{spec.rel}: no download URL")
        self.item = label
        part, state_path = self._paths(spec)
        for attempt in (1, 2):
            size, sha256, md5 = self._fetch_once(spec, part, state_path, label)
            if (sha256 == spec.sha256) if spec.sha256 else (md5 == spec.md5):
                break
            with contextlib.suppress(OSError):
                part.unlink()
            with contextlib.suppress(OSError):
                state_path.unlink()
            what = "SHA-256" if spec.sha256 else "MD5"
            self.vault.log(f"digest mismatch {spec.rel} attempt={attempt}")
            if attempt == 2:
                raise IntegrityError(f"{spec.rel}: downloaded file does not match the upstream {what} twice; "
                                     "the source may be corrupt, nothing was saved")
            self.say(f"  {spec.rel}: {what} mismatch; discarding and downloading again from the start")
        self._promote(part, final, spec, occupant)
        with contextlib.suppress(OSError):
            state_path.unlink()
        return self._record(spec, size, sha256, md5)

    def _fetch_once(self, spec: FileSpec, part: Path, state_path: Path, label: str) -> Tuple[int, str, Optional[str]]:
        st = _DownloadState(spec)
        self._prepare_partial(spec, part, st, self._load_state(spec, state_path))
        self._save_state(spec, state_path, st.offset)
        progress = Progress(label or spec.rel, spec.size, self.out)
        progress.begin(st.offset)
        dead: Dict[str, str] = {}
        url_index, failures = 0, 0
        piece_failures: Dict[int, int] = {}
        with open(part, "r+b") as f:
            while True:
                if spec.size is not None and st.offset == spec.size:
                    break
                live = [u for u in spec.urls if u not in dead]
                if not live:
                    f.flush()
                    os.fsync(f.fileno())
                    self._save_state(spec, state_path, st.offset)
                    reasons = "; ".join(sorted(set(dead.values())))
                    raise ForgeError(f"{spec.rel}: every source refused the download ({reasons})")
                url = live[url_index % len(live)]
                before = st.offset
                try:
                    f.seek(st.offset)
                    f.truncate(st.offset)
                    resp = self._open_range(url, st.offset, spec, st, f)
                    with resp:
                        self._stream(resp, f, spec, st, progress, state_path)
                    if spec.size is not None and st.offset + st.pending < spec.size:
                        raise TransientError("connection closed before the file was complete")
                    if spec.pieces and st.pending:
                        raise TransientError("incomplete final piece")
                    if spec.size is None:
                        break
                except SourceError as err:
                    dead[url] = str(err)
                    st.rollback()
                    f.flush()
                    f.truncate(st.offset)
                    self.say(f"  {spec.rel}: {err}; trying the next source")
                    self.vault.log(f"source dropped for {spec.rel}: {url} ({err})")
                    continue
                except TransientError as err:
                    f.flush()
                    st.rollback()
                    f.truncate(st.offset)
                    if isinstance(err, BadPieceError):
                        piece_failures[err.index] = piece_failures.get(err.index, 0) + 1
                        if piece_failures[err.index] >= 3 * max(1, len(spec.urls)):
                            raise IntegrityError(f"{spec.rel}: piece {err.index} is corrupt on every mirror")
                    failures = 0 if st.offset > before else failures + 1
                    if failures >= self.max_attempts:
                        os.fsync(f.fileno())
                        self._save_state(spec, state_path, st.offset)
                        raise ForgeError(f"{spec.rel}: giving up after {failures} attempts without progress ({err}); "
                                         "rerun to resume")
                    url_index += 1
                    delay = err.retry_after if err.retry_after else min(60.0, 2.0 ** min(failures, 6)) * random.uniform(0.5, 1.0)
                    self.say(f"  {spec.rel}: {err}; resuming at {human(st.offset)} in {delay:.0f}s")
                    self.sleep(delay)
                    continue
                except OSError as err:
                    if is_disk_full(err):
                        f.flush()
                        st.rollback()
                        with contextlib.suppress(OSError):
                            f.truncate(st.offset)
                            os.fsync(f.fileno())
                        self._save_state(spec, state_path, st.offset)
                        raise DiskFullError(f"Vault drive is full while writing {spec.rel}; free space and rerun "
                                            "(download will resume)") from None
                    raise
                except KeyboardInterrupt:
                    f.flush()
                    st.rollback()
                    with contextlib.suppress(OSError):
                        f.truncate(st.offset)
                        os.fsync(f.fileno())
                    self._save_state(spec, state_path, st.offset)
                    raise
                # stream finished with the full size: verify the whole-file digest
                if spec.size is not None and st.offset == spec.size:
                    break
            f.flush()
            os.fsync(f.fileno())
        progress.update(st.offset, force=True)
        progress.finish()
        return st.offset, st.sha256.hexdigest(), (st.md5.hexdigest() if st.md5 is not None else None)


def hash_file(path: Path, want_md5: bool = False, progress: Optional[Progress] = None) -> Tuple[str, Optional[str]]:
    sha = hashlib.sha256()
    md5 = hashlib.md5() if want_md5 else None
    done = 0
    with open(path, "rb") as f:
        while True:
            data = f.read(CHUNK)
            if not data:
                break
            sha.update(data)
            if md5 is not None:
                md5.update(data)
            done += len(data)
            if progress:
                progress.update(done)
    if progress:
        progress.update(done, force=True)
        progress.finish()
    return sha.hexdigest(), (md5.hexdigest() if md5 is not None else None)


# --------------------------------------------------------------------------- operations

def resolve_profile(catalog: dict, profile: str, resolver: Resolver, only: Optional[List[str]] = None,
                    out=None) -> Tuple[List[Resolved], List[Tuple[str, str]]]:
    out = out or sys.stdout
    ids = profile_items(catalog, profile)
    if only:
        unknown = [i for i in only if i not in ids]
        if unknown:
            raise ForgeError(f"not in profile {profile}: {', '.join(unknown)}")
        ids = [i for i in ids if i in only]
    resolved, failed = [], []
    for item_id in ids:
        out.write(f"  resolving {item_id} ...\n")
        out.flush()
        try:
            resolved.append(resolver.resolve(item_id, catalog["items"][item_id]))
        except ForgeError as err:
            failed.append((item_id, str(err)))
    seen: Dict[str, Tuple[str, Optional[str]]] = {}
    for res in resolved:
        for spec in res.files:
            if spec.rel in seen and seen[spec.rel][1] != spec.sha256:
                raise ForgeError(f"two catalogue items write different content to {spec.rel}")
            seen[spec.rel] = (res.item_id, spec.sha256)
    check_collisions(seen)
    return resolved, failed


def check_vault_collisions(vault: Vault, resolved: List[Resolved]) -> None:
    """Planned paths must not case-collide with each other, existing records or the standard folders."""
    planned = [spec.rel for res in resolved for spec in res.files]
    check_collisions(list(STANDARD_DIRS) + sorted(vault.file_records()) + planned)


def plan_report(vault: Vault, resolved: List[Resolved]) -> dict:
    records = vault.file_records()
    counted: set = set()
    rows, need, unknown, unverified = [], 0, 0, 0
    for res in resolved:
        present, todo = 0, 0
        for spec in res.files:
            if spec.rel in counted:
                continue
            counted.add(spec.rel)
            rec = records.get(spec.rel)
            on_disk = os_path(vault.root, spec.rel)
            same = rec and ((spec.sha256 and rec.get("sha256") == spec.sha256) or
                            (not spec.sha256 and spec.md5 and rec.get("md5") == spec.md5))
            if same and on_disk.is_file() and on_disk.stat().st_size == spec.size:
                present += spec.size or 0
                continue
            if not rec and spec.size is not None and on_disk.is_file() and on_disk.stat().st_size == spec.size:
                unverified += 1  # same size, not yet recorded: fetch will hash it and adopt it if it matches
                present += spec.size
                continue
            if spec.size is None:
                unknown += 1
                continue
            part = vault.partial_dir / (spec.key + ".part")
            have = part.stat().st_size if part.is_file() else 0
            todo += max(0, spec.size - have)
        need += todo
        rows.append({"id": res.item_id, "title": res.item["title"], "kind": res.item["kind"],
                     "version": res.version, "files": len(res.files), "bytes": res.size,
                     "present": present, "to_download": todo,
                     "integrity": sorted({s.integrity for s in res.files}),
                     "licence": res.item["licence"], "commercial": res.item.get("commercial", "check")})
    free = shutil.disk_usage(vault.root).free
    margin = (1 << 30) + need // 100
    return {"items": rows, "need_bytes": need, "free_bytes": free, "margin_bytes": margin,
            "fits": need + margin <= free, "unknown_sizes": unknown, "unverified_present": unverified}


def print_plan(report: dict, failed: List[Tuple[str, str]], out) -> None:
    out.write(f"{'item':38} {'version':16} {'size':>11} {'download':>11}  integrity\n")
    for row in report["items"]:
        nc = " [non-commercial]" if row["commercial"] == "no" else ""
        out.write(f"{row['id'][:38]:38} {str(row['version'])[:16]:16} {human(row['bytes']):>11} "
                  f"{human(row['to_download']):>11}  {','.join(row['integrity'])}{nc}\n")
    for item_id, why in failed:
        out.write(f"{item_id[:38]:38} UNRESOLVED: {why}\n")
    nc_count = sum(1 for r in report["items"] if r["commercial"] == "no")
    out.write(f"\nTo download: {human(report['need_bytes'])}   Free on Vault drive: {human(report['free_bytes'])}"
              f"   Safety margin: {human(report['margin_bytes'])}\n")
    if report["unknown_sizes"]:
        out.write(f"{report['unknown_sizes']} file(s) have no published size; space check excludes them.\n")
    if report.get("unverified_present"):
        out.write(f"{report['unverified_present']} file(s) already on the drive but not recorded; "
                  "fetch will hash them and keep them if they match.\n")
    if nc_count:
        out.write(f"{nc_count} item(s) are licensed non-commercial: fine for your own Vault, "
                  "never bundle them into a device you sell.\n")
    out.write("FITS\n" if report["fits"] else "DOES NOT FIT: free space or choose a smaller profile\n")


def fetch_profile(vault: Vault, catalog: dict, profile: str, resolver: Resolver, downloader: Downloader,
                  only: Optional[List[str]] = None, check_space: bool = True, out=None) -> int:
    out = out or sys.stdout
    resolved, failed = resolve_profile(catalog, profile, resolver, only, out)
    check_vault_collisions(vault, resolved)
    report = plan_report(vault, resolved)
    print_plan(report, failed, out)
    if check_space and not report["fits"]:
        return EXIT_SPACE
    errors = list(failed)
    ready = 0
    vault.log(f"fetch start profile={profile} items={len(resolved)} need={report['need_bytes']}")
    for res in resolved:
        out.write(f"\n== {res.item_id}: {res.item['title']} ({res.version})\n")
        out.flush()
        for stale in downloader.prune_stale(res.item_id, {spec.key for spec in res.files}):
            out.write(f"  removed an interrupted download of an older build: {stale}\n")
        records = []
        try:
            for spec in sorted(res.files, key=lambda s: s.order):
                records.append(downloader.fetch(spec, label=res.item_id))
        except DiskFullError:
            vault.log(f"disk full during {res.item_id}")
            raise
        except ForgeError as err:
            errors.append((res.item_id, str(err)))
            out.write(f"  FAILED: {err}\n")
            vault.log(f"item failed {res.item_id}: {err}")
            continue
        superseded = vault.record_item(res.item_id, {
            "kind": res.item["kind"], "title": res.item["title"], "category": res.item["category"],
            "licence": res.item["licence"], "commercial": res.item.get("commercial", "check"),
            "version": res.version, "fetched_utc": utcnow(), "files": records})
        vault.write_manifest()
        vault.log(f"item ok {res.item_id} version={res.version} files={len(records)}")
        out.write(f"  OK {res.item_id}: {len(records)} file(s) verified\n")
        ready += 1
        for path in superseded:
            out.write(f"  superseded (safe to delete after you check the new version): {path}\n")
    out.write(f"\n{ready} of {len(resolved) + len(failed)} item(s) ready; MANIFEST.sha256 updated\n")
    for item_id, why in errors:
        out.write(f"  not ready: {item_id}: {why}\n")
    return EXIT_OK if not errors else EXIT_FAIL


def verify_vault(vault: Vault, quick: bool = False, strict: bool = False, out=None) -> Tuple[int, dict]:
    out = out or sys.stdout
    records = vault.file_records()
    problems: Dict[str, List[str]] = {"missing": [], "modified": [], "size": []}
    for n, (rel, rec) in enumerate(sorted(records.items()), 1):
        path = os_path(vault.root, rel)
        if not path.is_file() or path.is_symlink():
            problems["missing"].append(rel)
            continue
        if path.stat().st_size != rec["size"]:
            problems["size"].append(rel)
            continue
        if quick:
            continue
        progress = Progress(f"[{n}/{len(records)}] {rel.rsplit('/', 1)[-1][:48]}", rec["size"], out) \
            if rec["size"] > (256 << 20) else None
        sha, _ = hash_file(path, progress=progress)
        if sha != rec["sha256"]:
            problems["modified"].append(rel)
    tracked = set(records) | {s["path"] for s in vault.index.get("superseded", [])}
    untracked, cache = [], 0
    for dirpath, dirnames, filenames in os.walk(vault.root):
        rel_dir = Path(dirpath).relative_to(vault.root).as_posix()
        if rel_dir == ".":
            rel_dir = ""
            dirnames[:] = [d for d in dirnames if d != Vault.META]
        if not rel_dir:
            dirnames[:] = [d for d in dirnames if d not in OS_ROOT_ENTRIES]
        for name in filenames:
            rel = f"{rel_dir}/{name}" if rel_dir else name
            if rel in (Vault.INDEX, Vault.MANIFEST, Vault.PROVENANCE) or TMP_NAME.match(name) or \
                    (not rel_dir and name in OS_ROOT_ENTRIES):
                continue
            if rel.startswith(RUNTIME_CACHE_PREFIXES):
                cache += 1
                continue
            if rel not in tracked:
                untracked.append(rel)
    bad = problems["missing"] + problems["modified"] + problems["size"]
    ok = not bad and not (strict and untracked)
    summary = {"utc": utcnow(), "mode": "quick" if quick else "full", "checked": len(records), "ok": ok,
               "missing": problems["missing"], "modified": problems["modified"], "wrong_size": problems["size"],
               "damaged": sorted(bad),
               "untracked": untracked, "superseded": [s["path"] for s in vault.index.get("superseded", [])]}
    for key, label in (("missing", "MISSING"), ("modified", "MODIFIED (SHA-256 mismatch)"), ("wrong_size", "WRONG SIZE")):
        for rel in summary[key]:
            out.write(f"{label}: {rel}\n")
    for rel in untracked:
        out.write(f"untracked: {rel}\n")
    for rel in summary["superseded"]:
        out.write(f"superseded (old version, safe to delete): {rel}\n")
    summary["runtime_cache_files"] = cache
    out.write(f"{'PASS' if ok else 'FAIL'}: {summary['mode']} check of {len(records)} file(s); "
              f"{len(bad)} problem(s), {len(untracked)} untracked"
              + (f", {cache} runtime cache file(s) ignored" if cache else "") + "\n")
    if bad:
        out.write("To repair: run `fetch` again with the same profile; it re-downloads only the damaged files.\n")
    return (EXIT_OK if ok else EXIT_FAIL), summary


def _setx_quote(value: str) -> str:
    # setx parses argv with Microsoft rules: backslashes before a closing quote must be doubled ("E:\" -> "E:\\").
    match = re.search(r"\\+$", value)
    return f'"{value + match.group(0) if match else value}"'


def field_env(vault: Vault, shell: str) -> str:
    root = vault.root
    zims = sorted(str(os_path(root, rel)) for rel in vault.file_records() if rel.endswith(".zim"))
    pairs = [("BLACKBOX_VAULT", str(root)), ("OLLAMA_MODELS", str(os_path(root, "ai/ollama"))), ("OLLAMA_NOPRUNE", "1")]
    lines = []
    if shell == "powershell":
        lines += [f'$env:{k} = "{v}"' for k, v in pairs]
        quoted = " ".join(f'"{z}"' for z in zims)
    elif shell == "setx":
        lines.append("REM Persist for the Ollama desktop app, then quit and reopen Ollama from the tray:")
        lines += [f"setx {k} {_setx_quote(v)}" for k, v in pairs]
        quoted = " ".join(f'"{z}"' for z in zims)
    elif shell == "cmd":
        lines += [f'set "{k}={v}"' for k, v in pairs]
        quoted = " ".join(f'"{z}"' for z in zims)
    else:
        import shlex
        lines += [f"export {k}={shlex.quote(v)}" for k, v in pairs]
        quoted = " ".join(shlex.quote(z) for z in zims)
    if zims:
        comment = "#" if shell in ("sh", "powershell") else "REM"
        lines.append(f"{comment} Start the offline library (kiwix-serve from runtimes/), then open http://127.0.0.1:8790 :")
        lines.append(f"{comment} kiwix-serve --address=127.0.0.1 --port=8790 {quoted}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="forge", description=__doc__.split("\n\n")[0])
    p.add_argument("--catalog", action="append", type=Path, help="catalogue file (repeatable; default forge/catalog.json "
                   "plus forge/catalog.local.json if present)")
    p.add_argument("--version", action="version", version=f"forge {VERSION}")
    sub = p.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="create a Vault in an empty folder or drive root")
    init.add_argument("vault", type=Path)
    init.add_argument("--label", default="BLACKBOX VAULT")
    sub.add_parser("profiles", help="list catalogue profiles")
    for name, text in (("plan", "resolve a profile against live upstream and check space"),
                       ("fetch", "download and verify a profile into the Vault (resumable)")):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("vault", type=Path)
        cmd.add_argument("--profile", required=True)
        cmd.add_argument("--only", nargs="+", metavar="ITEM", help="restrict to these item ids")
        cmd.add_argument("--json", action="store_true", help="machine-readable plan")
        if name == "fetch":
            cmd.add_argument("--no-space-check", action="store_true")
            cmd.add_argument("--deep", action="store_true",
                             help="re-hash files already in the Vault instead of trusting vault.json (slow; repairs silent damage)")
    verify = sub.add_parser("verify", help="re-hash every file against vault.json")
    verify.add_argument("vault", type=Path)
    verify.add_argument("--quick", action="store_true", help="check presence and size only")
    verify.add_argument("--strict", action="store_true", help="treat untracked files as failures")
    manifest = sub.add_parser("manifest", help="rewrite MANIFEST.sha256 from vault.json")
    manifest.add_argument("vault", type=Path)
    status = sub.add_parser("status", help="summarise the Vault")
    status.add_argument("vault", type=Path)
    env = sub.add_parser("env", help="print Field environment settings for this Vault")
    env.add_argument("vault", type=Path)
    env.add_argument("--shell", choices=("powershell", "cmd", "setx", "sh"),
                     default="powershell" if os.name == "nt" else "sh")
    return p


def cmd_status(vault: Vault, out) -> int:
    idx = vault.index
    out.write(f"Vault {idx['label']!r} id={idx['vault_id']} created {idx['created_utc']}\n")
    fs = detect_filesystem(vault.root)
    out.write(f"Location {vault.root} filesystem={fs.get('type')} free={human(shutil.disk_usage(vault.root).free)}\n")
    by_cat: Dict[str, Tuple[int, int]] = {}
    for item in idx["items"].values():
        n, b = by_cat.get(item["category"], (0, 0))
        by_cat[item["category"]] = (n + 1, b + sum(f["size"] for f in item.get("files", [])))
    for cat, (n, b) in sorted(by_cat.items()):
        out.write(f"  {cat:12} {n:4} item(s) {human(b):>11}\n")
    total = sum(r["size"] for r in vault.file_records().values())
    out.write(f"  {'total':12} {len(idx['items']):4} item(s) {human(total):>11}\n")
    parts = list(vault.partial_dir.glob("*.part")) if vault.partial_dir.is_dir() else []
    if parts:
        out.write(f"  {len(parts)} interrupted download(s) waiting to resume "
                  f"({human(sum(p.stat().st_size for p in parts))}):\n")
        for part in sorted(parts):
            with contextlib.suppress(OSError, ValueError):
                state = json.loads(part.with_suffix(".json").read_text(encoding="utf-8"))
                out.write(f"    {state.get('item', '?')}: {state.get('rel', part.name)} "
                          f"({human(part.stat().st_size)} of {human(state.get('size'))})\n")
    if idx.get("damaged"):
        out.write(f"  {len(idx['damaged'])} damaged file(s) from the last verify; run fetch to repair\n")
    lv = idx.get("last_verify")
    out.write(f"Last verify: {lv['utc']} {lv['mode']} {'PASS' if lv['ok'] else 'FAIL'}\n" if lv else "Last verify: never\n")
    return EXIT_OK


def main(argv: Optional[List[str]] = None, *, http: Optional[Http] = None, resolver: Optional[Resolver] = None,
         out=None) -> int:
    out = out or sys.stdout
    with contextlib.suppress(AttributeError, ValueError):
        out.reconfigure(errors="replace")  # type: ignore[union-attr]
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init":
            vault, fs, note = Vault.create(args.vault, args.label)
            out.write(f"Vault ready at {vault.root}\nFilesystem: {fs.get('type')} ({fs.get('method')}). {note}\n")
            return EXIT_OK
        catalog = load_catalog(args.catalog)
        if args.command == "profiles":
            for name, prof in sorted(catalog["profiles"].items()):
                ids = profile_items(catalog, name)
                approx = sum(float(catalog["items"][i].get("approx_gb", 0)) for i in ids)
                out.write(f"{name:10} {len(ids):3} items  ~{approx:,.1f} GB  {prof.get('title', '')}\n")
            return EXIT_OK
        vault = Vault.open(args.vault)
        http = http or Http()
        resolver = resolver or Resolver(http)
        if args.command == "plan":
            resolved, failed = resolve_profile(catalog, args.profile, resolver, args.only, out)
            check_vault_collisions(vault, resolved)
            report = plan_report(vault, resolved)
            if args.json:
                out.write(json.dumps({**report, "unresolved": failed}, indent=2) + "\n")
            else:
                print_plan(report, failed, out)
            if not report["fits"]:
                return EXIT_SPACE
            return EXIT_FAIL if failed else EXIT_OK
        if args.command == "fetch":
            with vault.lock():
                vault = Vault.open(vault.root)
                vault.install_tool()
                downloader = Downloader(vault, http, out=out, deep=args.deep)
                return fetch_profile(vault, catalog, args.profile, resolver, downloader, args.only,
                                     not args.no_space_check, out)
        if args.command == "verify":
            try:
                with vault.lock():
                    vault = Vault.open(vault.root)
                    code, summary = verify_vault(vault, args.quick, args.strict, out)
                    vault.index["last_verify"] = {k: summary[k] for k in ("utc", "mode", "ok", "checked")}
                    vault.index["damaged"] = summary["damaged"]
                    vault.save()
                    return code
            except ReadOnlyVaultError:
                out.write("Vault is read-only here: verifying without recording the result.\n")
                return verify_vault(vault, args.quick, args.strict, out)[0]
        if args.command == "manifest":
            with vault.lock():
                n = Vault.open(vault.root).write_manifest()
            out.write(f"MANIFEST.sha256 written with {n} file(s)\n")
            return EXIT_OK
        if args.command == "status":
            return cmd_status(vault, out)
        if args.command == "env":
            out.write(field_env(vault, args.shell))
            return EXIT_OK
    except KeyboardInterrupt:
        out.write("\nInterrupted. Progress is saved; run the same command again to resume.\n")
        return EXIT_INTERRUPTED
    except ForgeError as err:
        out.write(f"forge: {err}\n")
        return err.exit_code
    except BrokenPipeError:
        raise
    except OSError as err:  # e.g. drive unplugged, permission denied, antivirus lock: report, never a traceback
        if is_disk_full(err):
            out.write(f"forge: Vault drive is full ({err}); free space and rerun\n")
            return EXIT_DISKFULL
        out.write(f"forge: {err.__class__.__name__}: {err}\n")
        return EXIT_FAIL
    raise AssertionError(args.command)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:  # output piped into `head`, `findstr` etc. that exited early
        with contextlib.suppress(OSError):
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(EXIT_FAIL)
