#!/usr/bin/env python3
"""
Keyword Monitor (Premium)

Listens to selected Telegram chats and records keyword "leads" to a CSV file.
This is analytics/lead-capture only: it does not auto-post messages.
"""

import sys
import json
import asyncio
import os
import io
import re
from pathlib import Path
from datetime import datetime, timezone

from telethon import TelegramClient, events

# Force UTF-8 for standard streams on Windows
if sys.platform == 'win32':
    try:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass


def send(event_type, data):
    print(json.dumps({"type": event_type, "data": data}), flush=True)


def log(message, level="info"):
    send("log", {"type": level, "message": message, "timestamp": datetime.now(timezone.utc).isoformat()})


def err(message):
    send("error", {"message": message})


def normalize_keywords(raw):
    kws = []
    for k in (raw or []):
        k = (k or "").strip()
        if not k:
            continue
        # Keep simple: case-insensitive substring match.
        kws.append(k.lower())
    # Dedupe but preserve order
    out = []
    seen = set()
    for k in kws:
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def safe_session_name(name: str):
    name = (name or "").strip()
    name = re.sub(r"[^a-zA-Z0-9_-]+", "_", name)[:64]
    return name or "default"


def get_session_file(config):
    base_dir = os.environ.get("TGM_USER_DATA")
    if base_dir:
        data_dir = Path(base_dir) / "data"
    else:
        data_dir = Path.home() / ".telegram_group_messenger" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    session_name = safe_session_name(config.get("sessionName") or "default")
    account_dir = data_dir / "accounts" / session_name
    account_dir.mkdir(parents=True, exist_ok=True)
    return str(account_dir / "telegram_session")


def get_csv_path():
    base_dir = os.environ.get("TGM_USER_DATA")
    if base_dir:
        data_dir = Path(base_dir) / "data"
    else:
        data_dir = Path.home() / ".telegram_group_messenger" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "kunder.csv"


CSV_HEADER = [
    "last_seen_utc",
    "chat_id",
    "message_id",
    "user_id",
    "username",
    "display_name",
    "keyword",
    "price_dkk",
    "price_raw",
]


_KR_PRICE_RE = re.compile(
    r"(?ix)"
    r"(?:\bkr\.?\s*)?"            # optional "kr" prefix
    r"(\d{1,3}(?:[.\s]\d{3})*|\d+)"  # number with optional thousands separators
    r"(?:[.,]\d{1,2})?"           # optional decimals
    r"\s*(?:kr\.?\b|,-\b|-?\b)"   # "kr" suffix or ",-" / "-" common notation
)


def _parse_price_dkk(text: str):
    """
    Returns (price_dkk, price_raw) for the first detected kr amount in text.
    Examples: "1200 kr", "1.200 kr", "kr 1200", "1200,-"
    """
    if not text:
        return None, None

    m = _KR_PRICE_RE.search(text)
    if not m:
        # Try a simpler "kr 1200" where suffix isn't present.
        m2 = re.search(r"(?ix)\bkr\.?\s*(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d{1,2})?\b", text)
        if not m2:
            return None, None
        raw = m2.group(0)
        num = m2.group(1)
    else:
        raw = m.group(0)
        num = m.group(1)

    # Normalize Danish thousands separators: "1.200" or "1 200" -> "1200"
    num_clean = re.sub(r"[.\s]", "", num)

    # Extract optional decimal part from the raw match, if any.
    dec_m = re.search(r"([.,]\d{1,2})", raw)
    if dec_m:
        dec = dec_m.group(1).replace(",", ".")
        try:
            price = float(num_clean + dec)
        except Exception:
            return None, raw.strip()
    else:
        try:
            price = float(num_clean)
        except Exception:
            return None, raw.strip()

    return price, raw.strip()


def csv_escape(s):
    if s is None:
        s = ""
    s = str(s)
    s = s.replace('"', '""')
    return f'"{s}"'


class LeadStore:
    """
    Keep a deduped lead table and flush it to CSV periodically.
    Keyed by (chat_id, user_id, keyword) to keep it small and stable.
    """

    def __init__(self, csv_path: Path):
        self.csv_path = csv_path
        self.leads = {}  # (chat_id, user_id, keyword) -> row dict
        self.lock = asyncio.Lock()

    async def upsert(self, row):
        key = (row["chat_id"], row["user_id"], row["keyword"])
        async with self.lock:
            self.leads[key] = row

    async def flush(self):
        async with self.lock:
            rows = list(self.leads.values())

        tmp = self.csv_path.with_suffix(".csv.tmp")
        try:
            tmp.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "w", encoding="utf-8", newline="") as f:
                f.write(",".join(CSV_HEADER) + "\n")
                for r in rows:
                    f.write(",".join([
                        csv_escape(r.get("last_seen_utc", "")),
                        csv_escape(r.get("chat_id", "")),
                        csv_escape(r.get("message_id", "")),
                        csv_escape(r.get("user_id", "")),
                        csv_escape(r.get("username", "")),
                        csv_escape(r.get("display_name", "")),
                        csv_escape(r.get("keyword", "")),
                        csv_escape(r.get("price_dkk", "")),
                        csv_escape(r.get("price_raw", "")),
                    ]) + "\n")
            os.replace(tmp, self.csv_path)
            send("csv_flushed", {"path": str(self.csv_path), "count": len(rows)})
        except Exception as e:
            try:
                if tmp.exists():
                    tmp.unlink()
            except Exception:
                pass
            err(f"Failed to write CSV: {e}")


async def main():
    if len(sys.argv) > 1:
        try:
            config = json.loads(sys.argv[1])
        except Exception:
            err("Invalid JSON config argument")
            return
    else:
        # Also support stdin-first-line config (handy for debugging)
        line = sys.stdin.readline().strip()
        if not line:
            err("Missing config")
            return
        config = json.loads(line)

    try:
        api_id = int(config.get("apiId"))
        api_hash = (config.get("apiHash") or "").strip()
    except Exception:
        err("Missing/invalid apiId/apiHash")
        return

    chat_ids = config.get("chatIds") or []
    try:
        chat_ids = [int(x) for x in chat_ids]
    except Exception:
        err("Invalid chatIds (must be integers)")
        return

    keywords = normalize_keywords(config.get("keywords") or [])
    if not keywords:
        err("No keywords provided")
        return

    flush_seconds = int(config.get("flushSeconds") or 600)
    if flush_seconds < 60:
        flush_seconds = 60

    csv_path = Path(config.get("csvPath") or str(get_csv_path()))

    store = LeadStore(csv_path)
    session_file = get_session_file(config)

    log(f"Starting keyword monitor (chats={len(chat_ids)}, keywords={len(keywords)})")
    log(f"CSV output: {csv_path}")

    client = TelegramClient(session_file, api_id, api_hash, connection_retries=5, retry_delay=1)

    await client.connect()
    if not await client.is_user_authorized():
        err("Telegram session is not authorized. Please login in the app first (scan groups or start messaging once) and try again.")
        try:
            await client.disconnect()
        except Exception:
            pass
        return

    # Precompile a simple keyword regex for quick filtering. (case-insensitive)
    # Keep it safe: escape keywords.
    regex = re.compile("|".join(re.escape(k) for k in keywords), re.IGNORECASE)

    @client.on(events.NewMessage(chats=chat_ids))
    async def handler(event):
        try:
            msg = event.message
            text = (msg.message or "")
            if not text:
                return

            m = regex.search(text)
            if not m:
                return

            matched = m.group(0).lower()
            sender = await event.get_sender()

            user_id = getattr(sender, "id", None)
            username = getattr(sender, "username", "") or ""
            first = getattr(sender, "first_name", "") or ""
            last = getattr(sender, "last_name", "") or ""
            display_name = (first + " " + last).strip()

            # Phone numbers are not reliably available and are sensitive; do not attempt to capture them.
            ts = (msg.date or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()

            price_dkk, price_raw = _parse_price_dkk(text)

            row = {
                "last_seen_utc": ts,
                "chat_id": int(event.chat_id) if event.chat_id is not None else "",
                "message_id": getattr(msg, "id", ""),
                "user_id": int(user_id) if user_id is not None else "",
                "username": username,
                "display_name": display_name,
                "keyword": matched,
                "price_dkk": price_dkk if price_dkk is not None else "",
                "price_raw": price_raw or "",
            }

            await store.upsert(row)
            send("lead", row)
        except Exception as e:
            err(f"Handler error: {e}")

    async def flusher():
        while True:
            try:
                await asyncio.sleep(flush_seconds)
                await store.flush()
            except asyncio.CancelledError:
                return
            except Exception as e:
                err(f"Flush error: {e}")

    flush_task = asyncio.create_task(flusher())

    try:
        send("status", {"running": True})
        await client.run_until_disconnected()
    finally:
        try:
            flush_task.cancel()
        except Exception:
            pass
        try:
            await store.flush()
        except Exception:
            pass
        try:
            await client.disconnect()
        except Exception:
            pass
        send("status", {"running": False})


if __name__ == "__main__":
    asyncio.run(main())
