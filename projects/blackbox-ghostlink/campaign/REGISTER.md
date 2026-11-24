# REGISTER — options and hypotheses

| id | option / hypothesis / idea | status | evidence | killed by |
|---|---|---|---|---|
| B1 | Use Project NOMAD as the Field base | dead | NOMAD FAQ: designed for x86-64, no official ARM images; Windows only via community WSL2 | Orin is ARM64 |
| F-O1 | Extend `offline/prepare.py` in place for Windows + resume | dead | prepare.py deliberately never resumes, is TAR-centric and Linux-only; changing it risks its 30+ tests and the published v0.4.0 pack format | Regression risk; conflicting resume policy |
| F-O2 | New stdlib `forge/forge.py` writing a Vault directory; prepare.py kept for TAR packs | **chosen** | Spikes: Kiwix mirrors and Ollama registry answer `Range` with 206; every source exposes an upstream SHA-256 | — |
| F-O3 | aria2c as the download engine (native metalink) | dead | Extra native binary on Windows; still needs custom Ollama-store writer | Zero-dependency constraint |
| F-O4 | PowerShell + BITS on Windows | dead | Windows-only, cannot re-verify on the Orin, cannot be tested in CI | Portability |
| R1 | ETag/If-Range to validate resumes | dead | Kiwix `download.kiwix.org` 302s each request to a different mirror with a different ETag → If-Range would restart 119 GB files | Mirror rotation |
| R2 | Resume validated by metalink SHA-1 piece hashes (4 MiB) + final SHA-256 | **chosen** for Kiwix | meta4 for every ZIM carries `<pieces length="4194304" type="sha-1">` | — |
| R3 | Resume validated by content-addressed digest (re-hash partial on resume, stream the rest, compare final) | **chosen** for HF/Ollama/HTTP | Ollama blobs are named by SHA-256; HF returns `x-linked-etag` = SHA-256 | — |
| M1 | Ship models as GGUF + `ollama create` on target (v0.4.0 approach) | alive (kept for GGUF items) | Needs Ollama running on target and duplicates the weights | — |
| M2 | Write Ollama's native store (`manifests/…`, `blobs/sha256-…`) directly from the registry | **chosen** | Ollama v0.34.0 source `manifest/paths.go`, `types/model/name.go`; registry reachable with layer digests | Pending F8 real-server test |
| K1 | Pin dated ZIM filenames in the catalogue | dead | Live listing keeps only the two newest builds per ZIM (e.g. `wikipedia_en_all_maxi_2026-02` and `2026-08`) → pins 404 within months | Upstream retention |
| K2 | Resolve newest `<name>_YYYY-MM.zim` from the live directory listing at plan time | **chosen** | Listing hrefs parse cleanly | — |
| S2-K1 | Cited answers from Kiwix /search only | dead (for zimgit) | zimgit-water: 1 HTML article, 7 PDFs; full-text index covers HTML only | PDF content invisible to Kiwix search |
| S2-K2 | Kiwix /search for HTML ZIMs + local PDF text index (extracted on the Forge) for zimgit/document ZIMs | alive (S2) | — | — |
| V1 | Mount the Vault read-only on the Orin in the field | alive (recommended) | Ollama 0.40.17 served/generated from a read-only exFAT mount | — |
| RT1 | Ship only the JetPack overlay for Ollama on the Orin (v0.4.0 approach) | dead | jetpack6 tar.zst has no bin/ollama; install.sh layers base + overlay | Missing binary |
| P1 | Buffer a metalink piece in memory until its SHA-1 verifies | dead | review: 256 MiB piece → +832 MiB RSS | Memory on large pieces |
| P2 | Advance whole-file digests on tentative hashlib copies; commit per verified piece | **verified** | 256 MiB piece → +7 MiB RSS; all resume tests pass | — |
| Q1 | Quarantine a mismatching file before downloading its replacement | dead | review: failed update left a hole in the Vault; "latest" items piled up copies | Availability |
| Q2 | Replace tracked files only after the verified successor exists; quarantine only foreign files | **verified** | ReviewRegressionTests r3 | — |
