import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest

from downloader import download, DownloadError


DATA = bytes(range(256)) * 4096


class Handler(http.server.BaseHTTPRequestHandler):
    ranges = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/denied":
            self.send_error(403)
            return
        if self.path == "/page":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            return
        if self.path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl")
            self.end_headers()
            return
        requested = self.headers.get("Range")
        self.ranges.append(requested)
        offset = int(requested.split("=")[1].split("-")[0]) if requested else 0
        if self.path == "/ignore":
            offset = 0
        self.send_response(206 if offset else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("ETag", '"test-video-v1"')
        if offset:
            start = offset + 1 if self.path == "/bad-range" else offset
            self.send_header("Content-Range", f"bytes {start}-{len(DATA)-1}/{len(DATA)}")
        if self.path != "/unknown":
            self.send_header("Content-Length", str(len(DATA) - offset))
        self.end_headers()
        try:
            self.wfile.write(DATA[offset:])
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


class Downloads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / "video.mp4"

    def run_download(self, route="/video", stop=None, progress=None):
        return download(self.base + route, self.target, stop or threading.Event(), progress or (lambda *args: None))

    def pause(self, route):
        stop = threading.Event()
        self.assertFalse(self.run_download(route, stop, lambda done, *_: stop.set() if done else None))
        self.assertFalse(self.target.exists())
        self.assertGreater(Path(str(self.target) + ".part").stat().st_size, 0)

    def test_complete_and_no_overwrite(self):
        self.assertTrue(self.run_download())
        self.assertEqual(self.target.read_bytes(), DATA)
        self.assertFalse(Path(str(self.target) + ".part").exists())
        with self.assertRaises(DownloadError):
            self.run_download()
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_pause_and_resume(self):
        self.pause("/video")
        self.assertTrue(self.run_download())
        self.assertIsNotNone(Handler.ranges[-1])
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_ignored_range_restarts_without_duplication(self):
        self.pause("/ignore")
        self.assertTrue(self.run_download("/ignore"))
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_invalid_range_preserves_partial(self):
        self.pause("/bad-range")
        partial = Path(str(self.target) + ".part")
        before = partial.read_bytes()
        with self.assertRaises(DownloadError):
            self.run_download("/bad-range")
        self.assertEqual(partial.read_bytes(), before)

    def test_unknown_length(self):
        self.assertTrue(self.run_download("/unknown"))
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_changed_source_restarts(self):
        self.pause("/video")
        self.assertTrue(self.run_download("/other"))
        self.assertIsNone(Handler.ranges[-1])
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_missing_validator_restarts(self):
        self.pause("/video")
        metadata = Path(str(self.target) + ".part.json")
        state = json.loads(metadata.read_text())
        state["validator"] = None
        metadata.write_text(json.dumps(state))
        self.assertTrue(self.run_download())
        self.assertIsNone(Handler.ranges[-1])
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_rejected_inputs(self):
        for route in ("/page", "/stream", "/denied"):
            with self.subTest(route=route), self.assertRaises(DownloadError):
                self.run_download(route)
        with self.assertRaises(DownloadError):
            download("file:///private", self.target, threading.Event(), lambda *args: None)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
