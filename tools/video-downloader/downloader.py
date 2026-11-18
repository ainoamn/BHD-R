"""Local video downloader. HLS uses the optional FFmpeg runtime."""

import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class DownloadError(Exception):
    pass


def ffmpeg_executable():
    runtime = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DirectVideoDownloader" / "runtime"
    if str(runtime) not in sys.path:
        sys.path.insert(0, str(runtime))
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise DownloadError("دعم HLS يحتاج إلى مكوّن FFmpeg الاختياري، وهو غير مثبت على هذا الجهاز.") from None


def download_hls(url, destination, stop, progress):
    """Fetch ordinary VOD segments concurrently, then remux locally."""
    target = Path(destination)
    if target.exists():
        raise DownloadError("الملف موجود بالفعل. اختر اسماً آخر للحفظ.")
    with urllib.request.urlopen(url, timeout=30) as response:
        playlist = response.read(4 * 1024 * 1024).decode("utf-8-sig")
        base = response.geturl()
    if not playlist.startswith("#EXTM3U"):
        raise DownloadError("الرابط لا يحتوي على قائمة HLS صالحة.")
    # Complex playlists continue through FFmpeg's native HLS demuxer.
    unsupported = ("#EXT-X-STREAM-INF", "#EXT-X-MAP", "#EXT-X-BYTERANGE", "#EXT-X-SESSION-KEY")
    keys = [line for line in playlist.splitlines() if line.startswith("#EXT-X-KEY:")]
    if "#EXT-X-ENDLIST" not in playlist or any(tag in playlist for tag in unsupported) or len(keys) > 1:
        return download_hls_sequential(url, destination, stop, progress)
    if keys and "METHOD=AES-128," not in keys[0]:
        return download_hls_sequential(url, destination, stop, progress)
    executable = ffmpeg_executable()
    partial = Path(str(target) + ".hls.part.mp4")
    started = time.monotonic()
    downloaded = 0
    lock = threading.Lock()

    def remote(reference):
        address = urllib.parse.urljoin(base, reference)
        if urllib.parse.urlsplit(address).scheme not in ("http", "https"):
            raise DownloadError("قائمة البث تتضمن عنواناً غير مدعوم.")
        return address

    with tempfile.TemporaryDirectory(prefix="video-hls-", dir=target.parent) as temporary:
        folder = Path(temporary)
        rewritten = []
        segments = []
        for line in playlist.splitlines():
            if line.startswith("#EXT-X-KEY:"):
                match = re.search(r'URI="([^"]+)"', line)
                if not match:
                    raise DownloadError("عنوان مفتاح التشغيل غير صالح.")
                with urllib.request.urlopen(remote(match[1]), timeout=30) as response:
                    key = response.read(17)
                if len(key) != 16:
                    raise DownloadError("لم يوفر المصدر مفتاح تشغيل AES-128 صالحاً.")
                keyfile = folder / "key.bin"
                keyfile.write_bytes(key)
                keyfile.chmod(0o600)
                rewritten.append(line[:match.start(1)] + "key.bin" + line[match.end(1):])
            elif line and not line.startswith("#"):
                name = f"segment-{len(segments):06d}.ts"
                segments.append((remote(line.strip()), folder / name))
                rewritten.append(name)
            else:
                rewritten.append(line)
        if not segments:
            raise DownloadError("قائمة البث لا تحتوي على مقاطع فيديو.")

        def fetch(segment):
            nonlocal downloaded
            address, file = segment
            if stop.is_set():
                return
            with urllib.request.urlopen(address, timeout=30) as response, file.open("wb") as output:
                expected = response.headers.get("Content-Length")
                received = 0
                while not stop.is_set():
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    received += len(chunk)
                    with lock:
                        downloaded += len(chunk)
                        progress(downloaded, None, downloaded / max(time.monotonic() - started, 0.01))
                if not stop.is_set() and (not received or expected and received != int(expected)):
                    raise DownloadError("أحد مقاطع الفيديو لم يكتمل. أعد المحاولة.")

        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(fetch, segment) for segment in segments]
                try:
                    for future in as_completed(futures):
                        future.result()
                        if stop.is_set():
                            for pending in futures:
                                pending.cancel()
                            return False
                except Exception:
                    stop.set()
                    for pending in futures:
                        pending.cancel()
                    raise
        except urllib.error.HTTPError as exc:
            raise DownloadError(f"المصدر رفض مقطعاً من البث: HTTP {exc.code}") from None
        if stop.is_set():
            return False
        local_playlist = folder / "video.m3u8"
        local_playlist.write_text("\n".join(rewritten) + "\n", encoding="utf-8")
        command = [executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                   "-protocol_whitelist", "file,crypto", "-allowed_extensions", "ALL",
                   "-f", "hls", "-i", str(local_playlist), "-map", "0:v:0?", "-map", "0:a:0?",
                   "-c", "copy", "-movflags", "+faststart", "-f", "mp4", str(partial)]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            while process.poll() is None:
                if stop.wait(0.15):
                    process.kill()
                    process.wait()
                    return False
            if process.returncode or not partial.exists() or not partial.stat().st_size:
                raise DownloadError("تعذر تجميع مقاطع البث في ملف MP4.")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        try:
            os.link(partial, target)
        except FileExistsError:
            raise DownloadError("الاسم أصبح مستخدماً. اختر اسماً آخر للحفظ.") from None
        partial.unlink()
        size = target.stat().st_size
        progress(size, size, 0)
        return True


def download_hls_sequential(url, destination, stop, progress):
    """Save a source-accessible HLS stream using its normal playback key."""
    target = Path(destination)
    if target.exists():
        raise DownloadError("الملف موجود بالفعل. اختر اسماً آخر للحفظ.")
    partial = Path(str(target) + ".hls.part.mp4")
    command = [
        ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-nostdin",
        "-y", "-rw_timeout", "30000000", "-protocol_whitelist", "http,https,tcp,tls,crypto",
        "-allowed_extensions", "ALL", "-allowed_segment_extensions", "ALL",
        "-extension_picky", "0", "-f", "hls", "-i", url, "-map", "0:v:0?", "-map", "0:a:0?",
        "-c", "copy", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats",
        "-f", "mp4", str(partial),
    ]
    lines = queue.Queue()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def read_progress():
        for line in process.stdout:
            lines.put(line.strip())

    reader = threading.Thread(target=read_progress, daemon=True)
    reader.start()
    started = time.monotonic()
    try:
        while process.poll() is None or not lines.empty():
            if stop.is_set():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                return False
            try:
                line = lines.get(timeout=0.15)
            except queue.Empty:
                continue
            if line.startswith("total_size="):
                value = line.partition("=")[2]
                if value.isdigit():
                    size = int(value)
                    progress(size, None, size / max(time.monotonic() - started, 0.01))
        if process.wait() != 0 or not partial.exists() or not partial.stat().st_size:
            raise DownloadError("تعذر حفظ بث HLS. قد يكون المصدر رفض الوصول أو انقطع الاتصال. أعد المحاولة برابط صالح.")
        try:
            os.link(partial, target)
        except FileExistsError:
            raise DownloadError("الاسم أصبح مستخدماً. اختر اسماً آخر للحفظ.") from None
        partial.unlink()
        size = target.stat().st_size
        progress(size, size, 0)
        return True
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        reader.join(timeout=2)
        process.stdout.close()


def download(url, destination, stop, progress):
    """Download atomically; keep partial data and validators for safe resume."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise DownloadError("أدخل رابطاً مباشراً يبدأ بـ https:// أو http://")
    if parsed.username or parsed.password:
        raise DownloadError("استخدم رابطاً مباشراً بدون اسم مستخدم وكلمة مرور داخل الرابط.")
    if parsed.path.lower().endswith(".m3u8"):
        return download_hls(url, destination, stop, progress)
    target = Path(destination)
    if target.exists():
        raise DownloadError("الملف موجود بالفعل. اختر اسماً آخر للحفظ.")
    partial = Path(str(target) + ".part")
    metadata = Path(str(target) + ".part.json")
    fingerprint = hashlib.sha256(url.encode()).hexdigest()
    try:
        saved = json.loads(metadata.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    offset = partial.stat().st_size if partial.exists() else 0
    validator = saved.get("validator") if saved.get("source") == fingerprint else None
    if not validator:
        offset = 0
    headers = {"User-Agent": "DirectVideoDownloader/1.0", "Accept-Encoding": "identity"}
    if offset:
        headers.update({"Range": f"bytes={offset}-", "If-Range": validator})
    request = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as exc:
        messages = {
            401: "الرابط يتطلب تسجيل الدخول. احصل على رابط تنزيل مصرح به من المصدر.",
            403: "المصدر رفض التنزيل؛ قد تكون صلاحية الرابط انتهت أو يحتاج إلى تصريح.",
            404: "الملف غير موجود أو الرابط لم يعد صالحاً.",
            416: "تعذر استكمال الجزء المحفوظ. اختر اسماً جديداً لبدء تنزيل جديد.",
            429: "طلبات كثيرة؛ انتظر قليلاً ثم أعد المحاولة.",
        }
        raise DownloadError(messages.get(exc.code, f"فشل المصدر: HTTP {exc.code}")) from None
    except (urllib.error.URLError, OSError, ValueError):
        raise DownloadError("تعذر الاتصال بالمصدر. تحقق من الرابط والاتصال ثم أعد المحاولة.") from None
    with response:
        mime = response.headers.get_content_type()
        if mime.startswith("text/") or mime in ("application/json", "application/xhtml+xml"):
            raise DownloadError("الرابط أعاد صفحة أو نصاً بدلاً من ملف فيديو مباشر.")
        if "mpegurl" in mime or "dash+xml" in mime or parsed.path.lower().endswith((".m3u8", ".mpd")):
            raise DownloadError("هذا رابط بث HLS/DASH. هذه الأداة تدعم ملفات الفيديو المباشرة فقط.")
        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
            raise DownloadError("المصدر أعاد ترميز نقل لا يدعم الاستكمال الآمن.")
        length = response.headers.get("Content-Length")
        length = int(length) if length is not None else None
        if response.status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if not match or int(match[1]) != offset or int(match[2]) != int(match[3]) - 1:
                raise DownloadError("المصدر أعاد نطاقاً غير صالح. تعذر استكمال التنزيل بأمان.")
            total = int(match[3])
            if length is not None and length != total - offset:
                raise DownloadError("حجم الاستجابة لا يتطابق مع نطاق التنزيل.")
        elif response.status == 200:
            offset = 0  # Server ignored Range or the remote file changed: restart.
            total = length
        else:
            raise DownloadError(f"استجابة غير متوقعة من المصدر: {response.status}")
        etag = response.headers.get("ETag", "")
        current_validator = etag if etag and not etag.startswith("W/") else response.headers.get("Last-Modified")
        if offset and current_validator and current_validator != validator:
            raise DownloadError("تغير الملف لدى المصدر. اختر اسماً جديداً لإعادة التنزيل.")
        if not offset:
            partial.write_bytes(b"")
        metadata.write_text(json.dumps({"source": fingerprint, "validator": current_validator}), encoding="utf-8")
        downloaded = offset
        started = time.monotonic()
        progress(downloaded, total, 0)
        with partial.open("ab" if offset else "wb") as output:
            while True:
                if stop.is_set():
                    return False
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                progress(downloaded, total, (downloaded - offset) / max(time.monotonic() - started, 0.01))
        if total is not None and downloaded != total:
            raise DownloadError("انقطع التنزيل قبل اكتمال الملف. اضغط تنزيل للمحاولة والاستكمال.")
        if not downloaded:
            raise DownloadError("المصدر أعاد ملفاً فارغاً.")
        # Exclusive creation prevents overwriting a file created while downloading.
        try:
            os.link(partial, target)
        except FileExistsError:
            raise DownloadError("الاسم أصبح مستخدماً. الجزء المحفوظ ما زال موجوداً.") from None
        partial.unlink()
        metadata.unlink(missing_ok=True)
        progress(downloaded, downloaded, 0)
        return True


def main():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("تنزيل الفيديو — يدعم HLS — لصق سريع")
    root.geometry("740x440")
    root.minsize(640, 420)
    root.configure(bg="#f3f6fa")
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("TFrame", background="#f3f6fa")
    style.configure("TLabel", background="#f3f6fa", font=("Segoe UI", 11))
    style.configure("TButton", font=("Segoe UI", 11), padding=8)
    frame = ttk.Frame(root, padding=26)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="تنزيل الفيديو من رابط مباشر", font=("Segoe UI", 21, "bold"), anchor="e").pack(fill="x")
    ttk.Label(frame, text="روابط الفيديو المباشرة وHLS (m3u8) • الحفظ محلياً على جهازك", anchor="e").pack(fill="x", pady=(4, 20))
    ttk.Label(frame, text="رابط الفيديو", anchor="e").pack(fill="x")
    url = tk.StringVar()
    url_row = ttk.Frame(frame)
    url_row.pack(fill="x", pady=(5, 14))
    entry = ttk.Entry(url_row, textvariable=url, font=("Segoe UI", 11))
    entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

    def paste_url():
        if entry.instate(("disabled",)):
            return "break"
        try:
            value = root.clipboard_get().strip()
        except tk.TclError:
            messagebox.showinfo("لصق الرابط", "الحافظة فارغة. انسخ رابط الفيديو أولاً ثم اضغط لصق الرابط.")
            return "break"
        url.set(value)
        entry.focus_set()
        entry.icursor("end")
        entry.xview_moveto(0)
        return "break"

    paste = ttk.Button(url_row, text="لصق الرابط", command=paste_url)
    paste.pack(side="right")

    def control_key(event):
        # Windows virtual-key codes remain stable with Arabic keyboard layouts.
        if event.state & 0x4:
            if event.keycode == 86:
                return paste_url()
            if event.keycode == 65:
                entry.selection_range(0, "end")
                return "break"

    entry.bind("<KeyPress>", control_key)
    entry.bind("<Shift-Insert>", lambda event: paste_url())
    menu = tk.Menu(entry, tearoff=False)
    menu.add_command(label="لصق الرابط", command=paste_url)
    entry.bind("<Button-3>", lambda event: menu.tk_popup(event.x_root, event.y_root))
    entry.focus()
    ttk.Label(frame, text="حفظ باسم", anchor="e").pack(fill="x")
    path = tk.StringVar()
    path_row = ttk.Frame(frame)
    path_row.pack(fill="x", pady=5)
    path_entry = ttk.Entry(path_row, textvariable=path)
    path_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

    def browse():
        try:
            name = Path(urllib.parse.unquote(urllib.parse.urlsplit(url.get().strip()).path)).name
        except ValueError:
            name = ""
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)[:180]
        if not name or "." not in name or name.lower().endswith(".m3u8"):
            name = "video.mp4"
        selected = filedialog.asksaveasfilename(initialfile=name, defaultextension=".mp4", filetypes=[("Video / All files", "*.*")])
        if selected:
            path.set(selected)

    choose = ttk.Button(path_row, text="اختيار…", command=browse)
    choose.pack(side="right")
    bar = ttk.Progressbar(frame, maximum=100)
    bar.pack(fill="x", pady=(18, 8))
    status = tk.StringVar(value="جاهز — ألصق الرابط واختر مكان الحفظ")
    ttk.Label(frame, textvariable=status, anchor="e").pack(fill="x")
    actions = ttk.Frame(frame)
    actions.pack(fill="x", pady=14)
    stop = threading.Event()
    events = queue.Queue()
    running = False
    closing = False

    def worker(source, destination):
        last = 0.0

        def progress(done, total, speed):
            nonlocal last
            now = time.monotonic()
            if now - last >= 0.15 or done == total:
                events.put(("progress", (done, total, speed)))
                last = now

        try:
            complete = download(source, destination, stop, progress)
            paused = "تم الإيقاف؛ تنزيل HLS يبدأ من جديد عند المحاولة التالية" if urllib.parse.urlsplit(source).path.lower().endswith(".m3u8") else "تم الإيقاف؛ اضغط تنزيل لاستكمال الملف إن كان المصدر يدعمه"
            events.put(("done", "اكتمل التنزيل بنجاح" if complete else paused))
        except DownloadError as exc:
            events.put(("error", str(exc)))
        except Exception:
            events.put(("error", "تعذر إكمال التنزيل. تحقق من الاتصال ومساحة القرص وصلاحية الحفظ ثم أعد المحاولة."))

    def start():
        nonlocal running
        if not url.get().strip():
            messagebox.showinfo("رابط الفيديو", "ألصق رابط الفيديو أولاً.")
            return
        if not path.get().strip():
            browse()
        if not path.get().strip():
            return
        stop.clear()
        running = True
        for widget in (entry, paste, path_entry, choose, begin):
            widget.configure(state="disabled")
        pause.configure(state="normal")
        bar.configure(mode="indeterminate", value=0)
        bar.start(12)
        status.set("جارٍ الاتصال بالمصدر…")
        threading.Thread(target=worker, args=(url.get().strip(), path.get().strip()), daemon=True).start()

    def cancel():
        stop.set()
        pause.configure(state="disabled")
        status.set("جارٍ الإيقاف… قد يستغرق انتظار المصدر حتى 30 ثانية")

    begin = ttk.Button(actions, text="تنزيل / استكمال", command=start)
    begin.pack(side="right")
    pause = ttk.Button(actions, text="إيقاف مؤقت", command=cancel, state="disabled")
    pause.pack(side="right", padx=8)

    def poll():
        nonlocal running
        while True:
            try:
                kind, value = events.get_nowait()
            except queue.Empty:
                break
            if kind == "progress":
                done, total, speed = value
                if total:
                    bar.stop()
                    bar.configure(mode="determinate", value=done / total * 100)
                size = f"{done / 1048576:.1f} MB"
                if total:
                    size += f" / {total / 1048576:.1f} MB ({done / total:.0%})"
                status.set(f"{size}  •  {speed / 1048576:.1f} MB/s")
            else:
                running = False
                bar.stop()
                for widget in (entry, paste, path_entry, choose, begin):
                    widget.configure(state="normal")
                pause.configure(state="disabled")
                status.set(value)
                if kind == "error" and not closing:
                    messagebox.showerror("تعذر التنزيل", value)
        if closing and not running:
            root.destroy()
        else:
            root.after(100, poll)

    def close():
        nonlocal closing
        if running:
            closing = True
            cancel()
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.after(100, poll)
    root.mainloop()


if __name__ == "__main__":
    main()
