# FORGE — build the BLACKBOX Vault

Forge fills one drive (the **Vault**) on the Windows desktop with offline knowledge, AI models, maps and runtimes. The Orin and the desktop both run from that drive.

- Every file is checked against an upstream SHA-256 before it enters the Vault. Kiwix and Ollama layers are verified as they stream.
- Downloads resume after drops, reboots or Ctrl-C.
- AI models are written straight into Ollama's own store format, so Ollama does not need to be installed on the Forge machine.
- Python 3.9+ standard library only. No accounts, tokens or cloud services.

## 1. Prepare on Windows

1. Install Python once, then open a new terminal:
   `winget install -e --id Python.Python.3.12`
2. Format the SSD as exFAT in Disk Management. Alternatively, double-check the drive letter and run `format E: /FS:exFAT /V:BBVAULT /Q`. **This erases everything on that drive.**
3. From the `projects\blackbox-ghostlink` folder:

```bat
forge\forge.cmd init E:\BLACKBOX
forge\forge.cmd profiles
forge\forge.cmd plan  E:\BLACKBOX --profile scout
forge\forge.cmd fetch E:\BLACKBOX --profile scout
forge\forge.cmd verify E:\BLACKBOX
```

`plan` lists every file with its exact size and integrity source, plus whether it fits. It exits with code 3 if it won't fit.

`fetch` can be stopped at any time. Run the same command again and it continues from the last verified piece.

Profiles: `scout` (~25 GB), `field` (~137 GB, includes scout) and `maximum` (~684 GB, needs a 1 TB drive). `test` (~0.4 GB) proves the pipeline.

Add your own items in `forge\catalog.local.json`, in the same format as `catalog.json`; it is merged automatically.

Items marked `[non-commercial]` in `plan` are fine for your own Vault. Never bundle them into a device you sell.

### Use the Vault on the desktop

```bat
forge\forge.cmd env E:\BLACKBOX --shell setx
```

Run the `setx` lines it prints, then quit Ollama from the tray and reopen it. `ollama list` now shows the Vault models.

For the library, unzip `E:\BLACKBOX\runtimes\windows-amd64\kiwix-tools_win-x86_64-3.8.1.zip`, run the printed `kiwix-serve` line, and open http://127.0.0.1:8790.

## 2. Run on the Orin (JetPack 6)

Plug the drive in. It mounts at `/media/$USER/BBVAULT`.

```bash
V=/media/$USER/BBVAULT/BLACKBOX
cd "$V" && sha256sum -c --quiet MANIFEST.sha256 && echo "VAULT OK"
# Ollama needs BOTH archives: the base build first, then the JetPack 6 overlay (as Ollama's installer does)
zstd -dc "$V/runtimes/linux-arm64/ollama-linux-arm64-v0.40.17.tar.zst"                  | sudo tar -xf - -C /usr/local
zstd -dc "$V/runtimes/linux-arm64-jetpack6/ollama-linux-arm64-jetpack6-v0.40.17.tar.zst" | sudo tar -xf - -C /usr/local
mkdir -p ~/kiwix && tar -xzf "$V/runtimes/linux-arm64/kiwix-tools_linux-aarch64-3.8.2.tar.gz" -C ~/kiwix --strip-components=1
python3 "$V/.forge/tool/forge.py" verify "$V"           # the Vault carries its own copy of Forge
eval "$(python3 "$V/.forge/tool/forge.py" env "$V" --shell sh)"   # sets OLLAMA_MODELS, OLLAMA_NOPRUNE
ollama serve &  sleep 3 && ollama run qwen3:4b "How do I make water safe to drink?"
~/kiwix/kiwix-serve --address=127.0.0.1 --port=8790 "$V"/knowledge/zim/*.zim &   # library at http://127.0.0.1:8790
```

For field use, mount the Vault read-only (`sudo mount -o remount,ro /media/$USER/BBVAULT`). That has been tested: Ollama serves and generates from a read-only Vault. Power cuts and stray writes then cannot damage the content.

## Commands

| command | what it does | exit codes |
|---|---|---|
| `init VAULT` | create a Vault in an empty folder or drive root; refuses FAT32 | 0 ok, 1 refused |
| `plan VAULT --profile P [--only ID...] [--json]` | resolve live upstream, sizes, integrity, space | 0 fits, 3 too big, 1 unresolved |
| `fetch VAULT --profile P [--only ID...] [--deep]` | download + verify + record; resumable; repairs damage | 0 ok, 1 item(s) failed, 3 no space, 4 disk full, 5 locked, 130 interrupted |
| `verify VAULT [--quick] [--strict]` | re-hash everything against `vault.json`; works on a read-only mount | 0 pass, 1 fail |
| `status VAULT` | sizes by category, interrupted downloads, last verify | 0 |
| `env VAULT --shell powershell\|cmd\|setx\|sh` | Field settings and the `kiwix-serve` command | 0 |
| `manifest VAULT` | rewrite `MANIFEST.sha256` | 0 |

What it writes at the Vault root: `vault.json` (index), `MANIFEST.sha256` (check with `sha256sum -c`), `PROVENANCE.tsv` (where every digest came from, licence, commercial flag) and `.forge/` (resume state, log, and a copy of Forge itself).

Repair: if `verify` reports damage, run the same `fetch` again; it re-downloads only the damaged files. `fetch --deep` re-hashes everything instead of trusting `vault.json`.

Tests: `python -m unittest tests.test_forge` (set `FORGE_TEST_EXFAT=<folder on an exFAT drive>` to repeat them on exFAT; `FORGE_LIVE=1` adds real-internet tests, and `FORGE_TEST_OLLAMA_BIN=<ollama>` adds the real-Ollama check).
