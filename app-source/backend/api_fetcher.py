import requests
from bs4 import BeautifulSoup
import sys
import json
import time
import io

# This file implements "get my.telegram.org API ID / hash" functionality.
# Parsing approach is based on Anon4You/Telegram-Api (MIT): https://github.com/Anon4You/Telegram-Api

# Force UTF-8 for standard streams on Windows
if sys.platform == 'win32':
    try:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

# Helper to print JSON logs
def log(message, type="info"):
    print(json.dumps({"type": "log", "data": {"message": message, "type": type}}), flush=True)

def error(message):
    print(json.dumps({"type": "error", "data": {"message": message}}), flush=True)

def output_result(api_id, api_hash):
    print(json.dumps({"type": "result", "data": {"api_id": api_id, "api_hash": api_hash}}), flush=True)

def request_input(prompt_type):
    print(json.dumps({"type": "input_request", "data": {"prompt": prompt_type}}), flush=True)
    return sys.stdin.readline().strip()

def _extract_value_by_label(soup: BeautifulSoup, label_text: str):
    """
    my.telegram.org/apps renders values next to <label> elements.
    Example:
      <label>App api_id:</label>
      <div><span class="onclick-select">123</span></div>
    """
    lbl = soup.find('label', string=label_text)
    if not lbl:
        return None

    # Typical structure is label -> next sibling div
    div = lbl.find_next_sibling('div')
    if not div:
        # Fallback: sometimes label is nested
        div = lbl.parent.find_next_sibling('div') if getattr(lbl, 'parent', None) else None
    if not div:
        return None

    # Values are often inside span.onclick-select; fall back to first span.
    span = div.select_one('span.onclick-select') or div.select_one('span')
    if not span:
        # Some fields (like Public keys) use <code>
        code = div.select_one('code')
        if code:
            return code.get_text(strip=True)
        return div.get_text(strip=True) or None

    return span.get_text(strip=True) or None

class TelegramApiFetcher:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://my.telegram.org"
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        self.session.headers.update({"User-Agent": self.user_agent})

    def run(self):
        try:
            # 1. Ask for Phone Number
            log("Waiting for phone number...")
            phone = request_input("phone")
            if not phone:
                error("Phone number not provided")
                return

            # 2. Send Password Request
            log(f"Sending password request to {phone}...")
            res = self.session.post(f"{self.base_url}/auth/send_password", data={"phone": phone})
            if "Sorry, too many tries. Please try again later." in (res.text or ""):
                error("Too many tries. Telegram temporarily blocked requests for this phone. Try again later (often ~8 hours).")
                return

            data = res.json()
            
            if "random_hash" not in data:
                error(f"Failed to send password: {data}")
                return
            
            random_hash = data["random_hash"]
            log("Password sent to your Telegram app.")

            # 3. Ask for Code
            code = request_input("code")
            if not code:
                error("Code not provided")
                return

            # 4. Login
            log("Logging in...")
            login_data = {
                "phone": phone,
                "random_hash": random_hash,
                "password": code
            }
            res = self.session.post(f"{self.base_url}/auth/login", data=login_data)
            
            if res.text == "true":
                # Only check 2FA if needed? The response 'true' usually means success directly if 2FA not active or handled?
                # Actually, standard flow checks cookie. If 'true', we are logged in.
                pass
            else:
                # Might be 2FA or error. my.telegram.org uses a separate 2FA flow that this tool does not implement.
                error(f"Login failed (or 2FA is enabled on my.telegram.org). Response: {res.text}")
                return

            # 5. Get Apps
            log("Fetching API keys...")
            res = self.session.get(f"{self.base_url}/apps")
            soup = BeautifulSoup(res.text, "html.parser")
            
            # Check if we already have an app
            api_id = _extract_value_by_label(soup, "App api_id:")
            api_hash = _extract_value_by_label(soup, "App api_hash:")
            if api_id and api_hash:
                log("Found existing application.")
                output_result(api_id, api_hash)
                return
            
            # 6. Create App
            log("No existing app found. Creating new application...")
            # We need hash from the form
            hash_input = soup.find("input", {"name": "hash"})
            hash_val = hash_input.get("value") if hash_input else None
            if not hash_val:
                error("Could not find form hash on apps page. Telegram may have changed the page layout.")
                return
            
            create_data = {
                "hash": hash_val,
                "app_title": "Telegram Desktop Client",
                "app_shortname": "tgdesktop" + str(int(time.time())),
                "app_url": "",
                "app_platform": "desktop",
                "app_desc": ""
            }
            
            res = self.session.post(f"{self.base_url}/apps/create", data=create_data)
            
            # 7. Parse Result
            soup = BeautifulSoup(res.text, "html.parser")
            api_id = _extract_value_by_label(soup, "App api_id:")
            api_hash = _extract_value_by_label(soup, "App api_hash:")
            if api_id and api_hash:
                output_result(api_id, api_hash)
            else:
                detailed_error = soup.find("div", {"class": "alert-danger"})
                err_msg = detailed_error.text.strip() if detailed_error else "Unknown error creating app"
                error(f"Failed to create app: {err_msg}")

        except Exception as e:
            error(str(e))

if __name__ == "__main__":
    fetcher = TelegramApiFetcher()
    fetcher.run()
