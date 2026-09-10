"""Non-billable deployment verification. Uses only synthetic test assets."""
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://fn-evo4-8cad.tail071480.ts.net:9443"
OUT = Path(__file__).parent
STATE = OUT / "smoke-results.json"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(path, data=None, mime=None, method=None):
    headers = {"Content-Type": mime} if mime else {}
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        response = HTTP.open(req, timeout=45)
    except urllib.error.HTTPError as exc:
        response = exc
    raw = response.read()
    parsed = json.loads(raw) if "application/json" in response.headers.get("content-type", "") else raw
    return response.status, parsed, dict(response.headers)


def ok(path, **kwargs):
    status, body, _ = request(path, **kwargs)
    assert status == 200, (path, status, body)
    return body


if sys.argv[1] == "create":
    results = {"base_url": BASE, "api": {}, "assets": [], "outputs": [], "billable_generation": "not_run_no_key"}
    for path in ["/", "/workflow", "/gallery", "/chat", "/api/workflows", "/api/folders", "/api/gallery", "/api/settings/kie-key", "/api/settings/codex-status", "/api/job-status?taskId=heliosgen-nas-smoke-missing"]:
        body = ok(path)
        results["api"][path] = body if isinstance(body, dict) else {"status": 200, "bytes": len(body)}
    for filename, mime in [("/tmp/heliosgen-smoke.png", "image/png"), ("/tmp/heliosgen-smoke.mp4", "video/mp4")]:
        source = Path(filename).read_bytes()
        uploaded = ok("/api/upload-asset", data=source, mime=mime)
        url = uploaded["cdnUrl"]
        downloaded = ok(url)
        assert len(downloaded) > 100, (filename, "empty upload")
        if mime == "image/png":
            assert downloaded.startswith(b"\x89PNG\r\n\x1a\n")
        (OUT / ("uploaded-" + Path(filename).name)).write_bytes(downloaded)
        # The app strips metadata; record the stored bytes for restart checks.
        results["assets"].append({"url": url, "mime": mime, "sha256": hashlib.sha256(downloaded).hexdigest(), "bytes": len(downloaded)})
    video = results["assets"][1]["url"]
    for name, path, payload in [
        ("frame", "/api/extract-frame", {"videoUrl": video, "timeSeconds": 0.2}),
        ("trim", "/api/trim-video", {"videoUrl": video, "startTime": 0, "endTime": 0.5}),
    ]:
        generated = ok(path, data=payload)
        url = generated["cdnUrl"]
        data = ok(url)
        suffix = ".jpg" if name == "frame" else ".mp4"
        (OUT / (name + suffix)).write_bytes(data)
        results["outputs"].append({"name": name, "url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    status, _, _ = request("/api/open-external", data={"url": "https://example.com"})
    assert status == 404, status
    results["desktop_opener_disabled"] = True
    for path in ["/generated/../db/guest.db", "/generated/%2e%2e/db/guest.db"]:
        status, _, _ = request("/api/extract-frame", data={"videoUrl": path})
        assert status >= 400, status
    results["traversal_rejected"] = True
    STATE.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps({"http_routes": len(results["api"]), "uploads": len(results["assets"]), "media_operations": len(results["outputs"]), "status": "passed_before_restart"}))

elif sys.argv[1] == "verify":
    results = json.loads(STATE.read_text())
    for asset in results["assets"] + results["outputs"]:
        raw = ok(asset["url"])
        assert hashlib.sha256(raw).hexdigest() == asset["sha256"]
    for asset in results["assets"]:
        media_type = "video" if asset["mime"].startswith("video/") else "image"
        items = ok("/api/gallery?source=upload&type=" + media_type)["items"]
        assert any(item["url"] == asset["url"] for item in items)
    results["restart_persistence"] = "passed"
    STATE.write_text(json.dumps(results, indent=2) + "\n")
    print("Database and media persisted across container recreation")

elif sys.argv[1] == "cleanup":
    results = json.loads(STATE.read_text())
    test_urls = {item["url"] for item in results["assets"]}
    for media_type in ["image", "video"]:
        for item in ok("/api/gallery?source=upload&type=" + media_type)["items"]:
            if item["url"] in test_urls:
                ok("/api/gallery", data={"id": item["id"], "source": "upload"}, method="DELETE")
    results["test_gallery_records_removed"] = True
    STATE.write_text(json.dumps(results, indent=2) + "\n")
    print("Removed only synthetic smoke-test gallery records")

elif sys.argv[1] == "final":
    results = json.loads(STATE.read_text())
    for asset in results["assets"] + results["outputs"]:
        raw = ok(asset["url"])
        assert hashlib.sha256(raw).hexdigest() == asset["sha256"]
    test_urls = {item["url"] for item in results["assets"]}
    for media_type in ["image", "video"]:
        items = ok("/api/gallery?source=upload&type=" + media_type)["items"]
        assert not any(item["url"] in test_urls for item in items)
    results["final_media_access_after_cleanup"] = "passed"
    STATE.write_text(json.dumps(results, indent=2) + "\n")
    print("Media files remain accessible; synthetic gallery records are absent")
