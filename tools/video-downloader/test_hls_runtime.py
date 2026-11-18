"""Real encrypted HLS roundtrip against a local server, without external media."""
import functools
import http.server
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

from downloader import download, ffmpeg_executable, DownloadError


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class HLSRuntime(unittest.TestCase):
    def test_aes_hls_download_and_decode(self):
        try:
            executable = ffmpeg_executable()
        except DownloadError:
            self.skipTest("Optional FFmpeg runtime is not installed")
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "key.bin").write_bytes(os.urandom(16))
            (folder / "keyinfo.txt").write_text("/key.bin\n" + str(folder / "key.bin") + "\n")
            subprocess.run([
                executable, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                "-i", "color=c=blue:s=160x90:r=10", "-f", "lavfi", "-i", "sine=frequency=440",
                "-t", "2", "-c:v", "libx264", "-c:a", "aac", "-g", "10",
                "-hls_time", "1", "-hls_list_size", "0", "-hls_key_info_file", str(folder / "keyinfo.txt"),
                "-hls_segment_filename", str(folder / "video%d.dts"), str(folder / "video.m3u8"),
            ], check=True, capture_output=True, timeout=30)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                target = folder / "result.mp4"
                stop = threading.Event()
                self.assertFalse(download(f"http://127.0.0.1:{server.server_port}/video.m3u8", target,
                                          stop, lambda *args: stop.set()))
                self.assertFalse(target.exists())
                self.assertFalse(list(folder.glob("video-hls-*")))
                self.assertTrue(download(f"http://127.0.0.1:{server.server_port}/video.m3u8", target,
                                         threading.Event(), lambda *args: None))
                self.assertGreater(target.stat().st_size, 1000)
                self.assertFalse(Path(str(target) + ".hls.part.mp4").exists())
                subprocess.run([executable, "-v", "error", "-xerror", "-i", str(target), "-f", "null", "-"],
                               check=True, capture_output=True, timeout=30)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
