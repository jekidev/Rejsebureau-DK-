#!/usr/bin/env python3
"""
Telegram Messenger Backend - Python implementation using Telethon
Called from Electron via subprocess
"""

import sys
import json
import asyncio
import os
import io
from pathlib import Path
from telethon import TelegramClient
from telethon.errors import FloodWaitError, SessionPasswordNeededError
import re
import hashlib

# Force UTF-8 for standard streams on Windows to prevent encoding issues with Node.js
if sys.platform == 'win32':
    try:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass # Fallback if buffer is not available

class TelegramMessenger:
    def __init__(self, config):
        self.config = config
        self.client = None
        self.is_active = False
        self.stats = {
            'sent': 0,
            'failed': 0,
            'total': 0,
            'startTime': None
        }
        self.current_index = 0
        self.groups = []
        self.scanned_groups = []

    async def scan_groups(self):
        """Scan all groups the user is a member of"""
        try:
            self.send_output('log', {'type': 'info', 'message': 'Scanning for groups...'})
            
            dialogs = await self.client.get_dialogs()
            scanned_groups = []
            
            for dialog in dialogs:
                # Check if it's a group or channel
                if dialog.is_group or dialog.is_channel:
                    try:
                        entity = dialog.entity
                        group_info = {
                            'id': entity.id,
                            'title': entity.title,
                            'username': getattr(entity, 'username', None),
                            'members_count': getattr(entity, 'participants_count', 'N/A'),
                            'is_channel': dialog.is_channel,
                            'is_group': dialog.is_group
                        }
                        
                        # Create a link if username exists
                        if group_info['username']:
                            group_info['link'] = f"https://t.me/{group_info['username']}"
                        else:
                            group_info['link'] = None
                        
                        scanned_groups.append(group_info)
                        
                    except Exception as e:
                        self.send_output('log', {
                            'type': 'warning',
                            'message': f'Could not get info for dialog: {str(e)}'
                        })
                        continue
            
            self.scanned_groups = scanned_groups
            
            self.send_output('log', {
                'type': 'success',
                'message': f'Found {len(scanned_groups)} groups/channels'
            })
            
            # Send the groups list to frontend
            self.send_output('groups_scanned', {
                'groups': scanned_groups,
                'count': len(scanned_groups)
            })
            
            return scanned_groups
            
        except Exception as e:
            self.send_output('error', {'message': f'Error scanning groups: {str(e)}'})
            raise

    def use_scanned_groups(self, selected_ids=None):
        """Use scanned groups for messaging (optionally filter by IDs)"""
        if selected_ids:
            # Use only selected groups
            filtered_groups = [g for g in self.scanned_groups if g['id'] in selected_ids]
        else:
            # Use all scanned groups
            filtered_groups = self.scanned_groups
        
        # Convert to format expected by send_message
        self.groups = []
        for group in filtered_groups:
            if group.get('username'):
                self.groups.append({
                    'username': group['username'],
                    'fullLink': group.get('link', f"https://t.me/{group['username']}"),
                    'title': group['title'],
                    'id': group['id']
                })
            else:
                # For groups without username, use entity ID directly
                self.groups.append({
                    'entity_id': group['id'],
                    'title': group['title'],
                    'id': group['id']
                })
        
        self.stats['total'] = len(self.groups)
        return len(self.groups)

    def parse_links(self, links_text):
        """Parse Telegram group links from text"""
        lines = [line.strip() for line in links_text.split('\n') if line.strip()]
        group_links = []
        link_regex = re.compile(r'https?://t\.me/([a-zA-Z0-9_+]+)')

        for line in lines:
            matches = link_regex.findall(line)
            for match in matches:
                if match.startswith('+'):
                    group_links.append({
                        'inviteHash': match[1:],
                        'fullLink': f'https://t.me/{match}'
                    })
                else:
                    group_links.append({
                        'username': match,
                        'fullLink': f'https://t.me/{match}'
                    })

        return group_links

    async def initialize(self):
        """Initialize Telegram client"""
        try:
            # Setup session in a writable per-user directory.
            # The Electron app provides TGM_USER_DATA via environment to avoid writing inside Program Files/resources.
            base_dir = os.environ.get('TGM_USER_DATA')
            if base_dir:
                data_dir = Path(base_dir) / 'data'
            else:
                data_dir = Path.home() / '.telegram_group_messenger' / 'data'
            data_dir.mkdir(parents=True, exist_ok=True)

            # Multi-account support: isolate Telethon sessions per account.
            # sessionName should be stable (e.g. an account id from the UI). If missing, fall back to phone hash.
            session_name = (self.config.get('sessionName') or '').strip()
            if not session_name:
                phone_norm = (self.config.get('phoneNumber') or '').strip()
                phone_norm = re.sub(r'[^0-9+]+', '', phone_norm)
                if phone_norm:
                    session_name = hashlib.sha256(phone_norm.encode('utf-8')).hexdigest()[:16]
                else:
                    session_name = 'default'

            # Keep path safe and short for Windows.
            session_name = re.sub(r'[^a-zA-Z0-9_-]+', '_', session_name)[:64] or 'default'

            account_dir = data_dir / 'accounts' / session_name
            account_dir.mkdir(parents=True, exist_ok=True)
            session_file = str(account_dir / 'telegram_session')

            # Create client with file-based session
            self.client = TelegramClient(
                session_file,
                int(self.config['apiId']),
                self.config['apiHash'],
                connection_retries=5,
                retry_delay=1
            )

            await self.client.connect()

            # Check authorization
            if not await self.client.is_user_authorized():
                # Need to authorize
                self.send_output('log', {'type': 'info', 'message': 'Authorization needed...'})
                
                phone = self.config['phoneNumber'].replace(' ', '').replace('-', '')
                await self.client.send_code_request(phone)
                
                self.send_output('log', {'type': 'info', 'message': 'Code sent to your phone. Please check and enter it.'})
                self.send_output('status', {'needsCode': True, 'running': False})
                
                code = sys.stdin.readline().strip()
                if not code:
                    raise Exception('No authorization code received')
                
                try:
                    await self.client.sign_in(phone, code)
                except SessionPasswordNeededError:
                    password = self.config.get('password', '')
                    if not password:
                        self.send_output('log', {'type': 'info', 'message': '2FA password required'})
                        self.send_output('status', {'needsPassword': True, 'running': False})
                        password = sys.stdin.readline().strip()
                        if not password:
                            raise Exception('No 2FA password provided')
                    await self.client.sign_in(password=password)

            self.send_output('log', {'type': 'success', 'message': 'Connected to Telegram successfully'})

            if self.config.get('connectOnly', False):
                self.send_output('status', {'running': False, 'authorized': True})
                await self.client.disconnect()
                return True
            
            # Check if we should scan groups or use provided links
            if self.config.get('scanGroups', False):
                await self.scan_groups()
                # Use scanned groups
                selected_ids = self.config.get('selectedGroupIds', None)
                self.use_scanned_groups(selected_ids)
            else:
                # Parse links from config
                self.groups = self.parse_links(self.config.get('links', ''))
                self.stats['total'] = len(self.groups)

                if len(self.groups) == 0:
                    raise Exception('No valid Telegram group links found')
            
            return True

        except Exception as e:
            self.send_output('error', {'message': f'Initialization error: {str(e)}'})
            raise

    async def start(self):
        """Start sending messages"""
        if self.is_active:
            return

        self.is_active = True
        self.stats['startTime'] = str(asyncio.get_event_loop().time())
        self.current_index = 0

        self.send_output('status', {'running': True, 'stats': self.stats})
        self.send_output('log', {'type': 'info', 'message': f'Starting to send messages to {len(self.groups)} groups'})

        await self.process_next()

    async def process_next(self):
        """Process next group in queue"""
        if not self.is_active:
            return

        if self.current_index >= len(self.groups):
            # Finished sending to all groups - schedule next batch
            if self.is_active:
                await self.schedule_next_batch()
            return

        group = self.groups[self.current_index]

        try:
            self.send_output('log', {
                'type': 'info',
                'message': f'Sending to group {self.current_index + 1}/{len(self.groups)}: {group.get("title", group.get("fullLink", group.get("username", "unknown")))}'
            })

            await self.send_message(group)

            self.stats['sent'] += 1
            self.send_output('status', {'running': True, 'stats': self.stats})
            self.send_output('log', {
                'type': 'success',
                'message': f'✓ Message sent successfully to {group.get("title", "group")}'
            })

            self.current_index += 1

            # Short delay between groups (5-10 seconds) to avoid rate limiting
            if self.is_active and self.current_index < len(self.groups):
                delay = 5 + (5 * (hash(str(group)) % 100) / 100)
                await asyncio.sleep(delay)
                await self.process_next()
            elif self.is_active:
                # All groups done, schedule next batch
                await self.process_next()

        except Exception as e:
            self.stats['failed'] += 1
            self.send_output('status', {'running': True, 'stats': self.stats})
            self.send_output('log', {
                'type': 'error',
                'message': f'✗ Failed to send to {group.get("title", "group")}: {str(e)}'
            })

            self.current_index += 1

            # Short delay on error (10 seconds)
            if self.is_active:
                await asyncio.sleep(10)
                await self.process_next()

    async def send_message(self, group):
        """Send message to a group"""
        try:
            # Get entity
            entity = None
            group_id = group.get('entity_id') or group.get('id')
            
            if group_id:
                try:
                    entity = await self.client.get_entity(int(group_id))
                except Exception:
                    pass
            
            if not entity and group.get('username'):
                try:
                    entity = await self.client.get_entity(group['username'])
                except Exception:
                    pass
                    
            if not entity and group.get('inviteHash'):
                try:
                    entity = await self.client.get_entity(f'https://t.me/joinchat/{group["inviteHash"]}')
                except Exception:
                    pass
            
            if not entity:
                raise Exception('Could not find group entity')

            # Random delay before sending (2-5 seconds)
            import random
            await asyncio.sleep(2 + random.random() * 3)

            # Get message text - preserve newlines
            message_text = self.config.get('message', '')
            
            # Handle image path - skip if None or empty
            image_path = self.config.get('imagePath')
            valid_image = False
            
            if image_path and isinstance(image_path, str) and len(image_path) > 3:
                try:
                    if sys.platform == 'win32':
                        image_path = image_path.replace('/', '\\')
                    image_path = os.path.normpath(image_path)
                    if os.path.isfile(image_path):
                        valid_image = True
                except Exception:
                    valid_image = False
            
            # Try to send
            sent = False
            
            if valid_image:
                try:
                    await self.client.send_file(entity, image_path, caption=message_text)
                    sent = True
                except Exception as img_error:
                    self.send_output('log', {
                        'type': 'warning',
                        'message': f'⚠️ Image failed to send, sending text only...'
                    })
            
            if not sent and message_text:
                await self.client.send_message(entity, message_text)
                sent = True
            
            if not sent:
                raise Exception('No message to send')

            # Random delay after sending
            await asyncio.sleep(3 + random.random() * 4)

        except FloodWaitError as e:
            self.send_output('log', {
                'type': 'warning',
                'message': f'⏳ Rate limited! Waiting {e.seconds} seconds...'
            })
            await asyncio.sleep(e.seconds)
            return await self.send_message(group)
        except UnicodeDecodeError as e:
            # Specific handling for the utf-16-le error reported by users
            if 'utf-16' in str(e).lower() or 'codec' in str(e).lower():
                self.send_output('log', {
                    'type': 'warning',
                    'message': f'⚠️ Encoding error detected. Retrying message without formatting...'
                })
                # Retry sending the message as plain text without any parsing
                try:
                    sent = False
                    if valid_image:
                        await self.client.send_file(entity, image_path, caption=message_text, parse_mode=None)
                        sent = True
                    elif message_text:
                        await self.client.send_message(entity, message_text, parse_mode=None)
                        sent = True
                    
                    if sent:
                        return
                except Exception as retry_err:
                    raise retry_err
            raise
        except Exception as e:
            # Generic retry logic for network errors
            if 'Connection' in str(e) or 'Network' in str(e) or 'Timeout' in str(e):
                 self.send_output('log', {
                    'type': 'warning',
                    'message': f'⚠️ Network error: {str(e)}. Retrying in 5 seconds...'
                 })
                 await asyncio.sleep(5)
                 return await self.send_message(group)
            raise

    def calculate_delay(self):
        """Calculate delay in milliseconds"""
        if self.config.get('scheduleType') == 'interval':
            hours = float(self.config.get('intervalHours', 1))
            return hours * 60 * 60 * 1000
        else:
            times_per_day = int(self.config.get('timesPerDay', 1))
            hours_in_day = 24
            interval_hours = hours_in_day / times_per_day
            return interval_hours * 60 * 60 * 1000

    async def schedule_next_batch(self):
        """Schedule next batch based on schedule type"""
        if self.config.get('scheduleType') == 'interval':
            # Interval mode: wait X hours between batches
            interval_hours = float(self.config.get('intervalHours', 1))
            delay_seconds = interval_hours * 60 * 60
            
            self.send_output('log', {
                'type': 'info',
                'message': f'✅ Batch finished! Next batch in {interval_hours} hours'
            })
        else:
            # Daily mode: X times per day
            times_per_day = int(self.config.get('timesPerDay', 1))
            hours_in_day = 24
            interval_hours = hours_in_day / times_per_day
            delay_seconds = interval_hours * 60 * 60
            
            self.send_output('log', {
                'type': 'info',
                'message': f'✅ Batch finished! Next batch in {interval_hours:.1f} hours ({times_per_day}x daily)'
            })

        await asyncio.sleep(delay_seconds)
        self.current_index = 0
        self.send_output('log', {
            'type': 'info',
            'message': '🔄 Starting new batch...'
        })
        await self.process_next()

    async def stop(self):
        """Stop sending messages"""
        self.is_active = False
        self.send_output('status', {'running': False, 'stats': self.stats})
        self.send_output('log', {'type': 'info', 'message': 'Messaging stopped'})

    def send_output(self, event_type, data):
        """Send output to Electron via stdout"""
        output = {
            'type': event_type,
            'data': data
        }
        print(json.dumps(output))
        sys.stdout.flush()

async def main():
    """Main entry point"""
    # Read config from stdin (first line)
    config_line = sys.stdin.readline()
    config = json.loads(config_line.strip())

    messenger = TelegramMessenger(config)

    try:
        await messenger.initialize()
        
        # If scan-only mode, don't start messaging - just exit after scanning
        if config.get('scanGroups', False) and not config.get('selectedGroupIds'):
            messenger.send_output('log', {'type': 'info', 'message': 'Scan complete. Select groups and start messaging.'})
            # Keep process alive briefly to ensure output is sent
            await asyncio.sleep(1)
            return
        
        # Only start messaging if we have groups to send to
        if len(messenger.groups) > 0:
            await messenger.start()

            # Keep running until stopped
            while messenger.is_active:
                await asyncio.sleep(1)
        else:
            messenger.send_output('log', {'type': 'warning', 'message': 'No groups to send messages to.'})

    except KeyboardInterrupt:
        await messenger.stop()
    except Exception as e:
        messenger.send_output('error', {'message': str(e)})
        if messenger.is_active:
            await messenger.stop()

if __name__ == '__main__':
    asyncio.run(main())
