# Offline pack build subsystem

This is actual build tooling, not a folder of download URLs.

The upstream dependency catalog is [catalog.json](catalog.json), the downloader/pack verifier is [prepare.py](prepare.py), the raster map generator is [render_map.py](render_map.py), and the target-side runtime check/import tool is [activate.py](activate.py).

Run `python3 offline/prepare.py assemble --profile bendigo --dir /mnt/blackbox-assets --output /mnt/BLACKBOX_FIELD_DATA_bendigo_v0.4.0.tar` on a connected Linux workstation with `osmium-tool` and Pillow installed. It fetches actual AI weights, legal notices, encyclopaedia content and geographic data, plus pinned JetPack 5 and 6 Ollama runtime archives and Kiwix ARM64 tools; generates PNG raster MBTiles; verifies and records digests; creates an air-gappable archive. No data pack is marked field-ready if the map or any input is missing.

The `.tar.sha256` accompanying the pack lets it be checked before installation. `python3 offline/prepare.py inspect --output ...tar` reads the TAR members and verifies every embedded hash without extraction. `python3 offline/activate.py --assets /path/to/assets` verifies that extracted files match their recorded hashes and provides host-specific activation commands. None of these commands need an API key.

**Intentionally not included in Git:** 1+ GB of model weights, hundreds of MB of ZIM/PBF data, user's radio keys, private databases, private field notes. These are packed in a distinct GitHub Release asset after the CI preparation job completes. The source ZIP remains small because it is source code. Do not interpret presence of the recipes as proof the field data has been successfully downloaded. See [full build guide](../docs/FULL_OFFLINE_BUILD.md).

For downloaded multi-part GitHub Release data files, use [`rehydrate.py`](rehydrate.py) to reconstruct, checksum and safely extract the archive. It will not overwrite an existing field-data destination.
