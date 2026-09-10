#!/usr/bin/env python3
"""Zero-copy HeliosGen <-> Seek metadata bridge.

The shared filesystem owns the media bytes. This process only watches paths,
asks both applications to refresh their indexes, and mirrors metadata/tags.
"""
from __future__ import annotations

import hashlib
import json
import os
import select
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "/media"))
HELIOS_URL = os.environ.get("HELIOS_BASE_URL", "http://127.0.0.1:17860").rstrip("/")
SEEK_URL = os.environ.get("SEEK_BASE_URL", "http://127.0.0.1:5666/seek").rstrip("/")
SEEK_PROJECT_GUID = os.environ.get("SEEK_PROJECT_GUID", "")
SEEK_FOLDER_GUID = os.environ.get("SEEK_FOLDER_GUID", "")
SEEK_ROOT_RELATED_PATH = os.environ.get("SEEK_ROOT_RELATED_PATH", "/创作资产").rstrip("/")
SEEK_TOKEN_FILE = Path(os.environ.get("SEEK_TOKEN_FILE", "/run/secrets/seek_token"))
STATE_FILE = Path(os.environ.get("STATE_FILE", "/state/sync.json"))
DEBOUNCE_SECONDS = float(os.environ.get("SYNC_DEBOUNCE_SECONDS", "4"))
PERIODIC_SECONDS = float(os.environ.get("SYNC_PERIODIC_SECONDS", "300"))
CATEGORY_TAGS = json.loads(os.environ.get("SEEK_CATEGORY_TAGS", "{}"))
DEFAULT_TAGS = [item for item in os.environ.get("SEEK_DEFAULT_TAGS", "").split(",") if item]
IMAGE_TAG = os.environ.get("SEEK_IMAGE_TAG_GUID", "")
VIDEO_TAG = os.environ.get("SEEK_VIDEO_TAG_GUID", "")


def load_state() -> dict[str, str]:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict[str, str]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(STATE_FILE)


def request_json(method: str, url: str, body=None, seek=False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if seek:
        token = SEEK_TOKEN_FILE.read_text().strip()
        headers["Cookie"] = f"seek-token={token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.loads(response.read())
    if isinstance(payload, dict) and payload.get("code") not in (None, 0):
        raise RuntimeError(f"Seek API error {payload.get('code')}: {payload.get('msg')}")
    return payload


def helios(method: str, path: str, body=None):
    return request_json(method, HELIOS_URL + path, body)


def seek(method: str, path: str, body=None, params=None):
    url = SEEK_URL + "/api/v1" + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v})
    return request_json(method, url, body, seek=True)


def seek_files(folder_guid: str, base_relative=""):
    payload = seek("POST", "/asset/list", {
        "projectGuid": SEEK_PROJECT_GUID,
        "folderGuid": folder_guid,
        "fields": "guid,name,size,type,modTime,width,height,mediaDuration,description,tags",
    })["data"]
    folder_path = payload.get("relatedPath", "")
    root_path = SEEK_ROOT_RELATED_PATH
    if SEEK_FOLDER_GUID and folder_path.startswith(root_path):
        current = folder_path[len(root_path):].strip("/")
    else:
        current = base_relative
    for item in payload.get("files") or []:
        yield (f"{current}/{item['name']}".strip("/"), item)
    for folder in payload.get("folders") or []:
        yield from seek_files(folder["guid"], f"{current}/{folder['name']}".strip("/"))


def metadata_description(asset: dict) -> str:
    lines = ["HeliosGen 创作资产", f"路径: {asset['relative_path']}"]
    if asset.get("model"):
        lines.append(f"模型: {asset['model']}")
    if asset.get("prompt"):
        lines.append(f"提示词: {asset['prompt']}")
    if asset.get("description"):
        lines.append(f"说明: {asset['description']}")
    return "\n".join(lines)


def asset_tags(asset: dict) -> list[str]:
    tags = list(DEFAULT_TAGS)
    category_tag = CATEGORY_TAGS.get(asset.get("category"))
    if category_tag:
        tags.append(category_tag)
    if asset.get("mime_type", "").startswith("image/") and IMAGE_TAG:
        tags.append(IMAGE_TAG)
    if asset.get("mime_type", "").startswith("video/") and VIDEO_TAG:
        tags.append(VIDEO_TAG)
    return list(dict.fromkeys(tags))


def sync_once() -> None:
    print("[asset-bridge] reconcile started", flush=True)
    reconciled = helios("POST", "/api/assets/reconcile")
    assets = {item["relative_path"]: item for item in reconciled.get("assets", [])}
    seek("POST", "/folder/scan", {"projectGuid": SEEK_PROJECT_GUID, "guid": SEEK_FOLDER_GUID})
    time.sleep(1)
    state = load_state()
    seen = 0
    for relative_path, seek_asset in seek_files(SEEK_FOLDER_GUID):
        asset = assets.get(relative_path)
        if not asset:
            try:
                asset = helios("POST", "/api/assets/import", {
                    "relativePath": relative_path, "seekGuid": seek_asset["guid"], "source": "seek",
                })["asset"]
                assets[relative_path] = asset
            except (urllib.error.HTTPError, OSError, RuntimeError, KeyError) as error:
                print(f"[asset-bridge] import skipped {relative_path}: {error}", flush=True)
                continue
        elif asset.get("seek_guid") != seek_asset["guid"]:
            asset = helios("PATCH", f"/api/assets/{asset['id']}", {"seekGuid": seek_asset["guid"]})["asset"]
        description = metadata_description(asset)
        tags = asset_tags(asset)
        digest = hashlib.sha256((description + "\0" + ",".join(tags)).encode()).hexdigest()
        if state.get(seek_asset["guid"]) != digest:
            seek("POST", "/asset/updateAttributes", {"assetGuids": [seek_asset["guid"]], "description": description})
            if tags:
                seek("POST", "/asset/updateTags", {"assetGuids": [seek_asset["guid"]], "addTagGuids": tags})
            state[seek_asset["guid"]] = digest
        seen += 1
    save_state(state)
    print(f"[asset-bridge] reconcile complete: helios={len(assets)} seek={seen}", flush=True)


def main() -> None:
    if not SEEK_PROJECT_GUID or not SEEK_FOLDER_GUID:
        raise SystemExit("SEEK_PROJECT_GUID and SEEK_FOLDER_GUID are required")
    if not SEEK_TOKEN_FILE.is_file():
        raise SystemExit(f"Seek token file not found: {SEEK_TOKEN_FILE}")
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    sync_once()
    watcher = subprocess.Popen([
        "inotifywait", "-m", "-r", "-q",
        "-e", "close_write,create,delete,moved_to,moved_from",
        "--format", "%w%f", str(MEDIA_ROOT),
    ], stdout=subprocess.PIPE, text=True)
    assert watcher.stdout is not None
    next_periodic = time.monotonic() + PERIODIC_SECONDS
    dirty_at = None
    while watcher.poll() is None:
        timeout = 1.0
        readable, _, _ = select.select([watcher.stdout], [], [], timeout)
        if readable and watcher.stdout.readline():
            dirty_at = time.monotonic()
        now = time.monotonic()
        if dirty_at is not None and now - dirty_at >= DEBOUNCE_SECONDS:
            try: sync_once()
            except Exception as error: print(f"[asset-bridge] sync failed: {error}", flush=True)
            dirty_at = None
            next_periodic = now + PERIODIC_SECONDS
        elif now >= next_periodic:
            try: sync_once()
            except Exception as error: print(f"[asset-bridge] periodic sync failed: {error}", flush=True)
            next_periodic = now + PERIODIC_SECONDS
    raise SystemExit(f"inotifywait exited with {watcher.returncode}")


if __name__ == "__main__":
    main()
