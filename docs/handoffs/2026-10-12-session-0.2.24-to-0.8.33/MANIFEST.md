# Manifest — session handoff 2026-10-12 (0.2.24 → 0.8.33 + full chat)

| Item                    | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Session start           | 2026-08-25 20:34 (Asia/Muscat, UTC+4)                              |
| First release           | 0.2.24 — `00ca5df` — 2026-08-25 20:59                              |
| Last code release       | 0.8.33 — `b66264d` — 2026-10-12 22:36                              |
| Branch                  | `main`                                                             |
| Remote                  | https://github.com/ainoamn/BHD-R                                   |
| Production              | https://r.bhd-om.com                                               |
| Cursor transcript       | `307d3b18-d433-4130-9cd4-fbf9f887f158`                             |
| JSONL lines             | 1487                                                               |
| JSONL SHA256 (redacted) | `591f7f878117e05476fd5e1d5fca14216c615d5997e25c479e165581b88f597c` |
| Readable messages       | 608                                                                |
| Releases in index       | 251                                                                |

The transcript ends at the 0.8.32 request (2026-10-12 22:15). The 0.8.33 request (22:34) and the handoff request (22:36) are summarised in `README.md`.

## Files

| File                                 | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `README.md`                          | ملخص الجلسة والحالة والمهام المفتوحة وخطوات الاستكمال |
| `RELEASE-INDEX.md`                   | كل إصدار بتاريخه ووقته ورقم الـ commit ورابط وثيقته   |
| `MANIFEST.md`                        | هذا الملف                                             |
| `conversation-transcript-FULL.jsonl` | المحادثة الكاملة (بعد حذف الأسرار)                    |
| `conversation-readable-FULL.md`      | نسخة مقروءة                                           |

Regenerate the archive with:

```bash
node scripts/archive-cursor-transcript.mjs <source.jsonl> docs/handoffs/2026-10-12-session-0.2.24-to-0.8.33
```

## Earlier partial archives covering the same period

- `docs/handoffs/2026-09-02-evening-home-handoff/` (through 0.4.40, transcript `d0d5551b-…`)
- `docs/handoffs/2026-09-03-esign-guest-flow-0.4.63/` (through 0.4.63)

This handoff covers the whole period through 0.8.33.
