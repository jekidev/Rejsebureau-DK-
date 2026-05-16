# Telegram Group Messenger - Komplet Guide

## 📋 Oversigt

Dette er en professionel Electron-baseret applikation til automatisk sending af beskeder til flere Telegram grupper med indbygget rate limiting og spam-beskyttelse.

## ✨ Funktioner

### Kerne Funktionalitet
- ✅ **Automatisk Besked-Sending**: Send beskeder til flere Telegram grupper automatisk
- ✅ **Kanal Scanning**: Automatisk parsing og validering af Telegram gruppe-links
- ✅ **Account Entry**: Sikker login med API credentials og 2FA support
- ✅ **Auto-Posting**: Intelligent scheduling med konfigurerbar frekvens
- ✅ **Rate Limiting**: Indbygget beskyttelse mod spam og flood errors
- ✅ **Real-time Statistik**: Live opdatering af sendte/fejlede beskeder
- ✅ **Session Persistence**: Automatisk gem af login session

### Tekniske Features
- 🔐 Sikker authentication med Telegram API
- ⏰ Fleksibel scheduling (gange per dag eller timer mellem beskeder)
- 🛡️ Automatisk håndtering af FloodWait errors
- 📊 Real-time logging og status opdateringer
- 💾 Automatisk gem af indstillinger
- 🎨 Moderne, professionel GUI

## 🚀 Installation

### Forudsætninger

1. **Node.js** (v16 eller nyere)
   - Download fra: https://nodejs.org/

2. **Python 3.8+**
   - Download fra: https://www.python.org/downloads/
   - Sørg for at tilføje Python til PATH under installation

3. **npm** (kommer med Node.js)

### Setup Trin

1. **Installer Node.js Dependencies**
```bash
cd TelegramGroupMessenger
npm install
```

2. **Installer Python Dependencies**
```bash
pip install -r requirements.txt
```

Eller hvis du har både Python 2 og 3:
```bash
pip3 install -r requirements.txt
```

3. **Verificer Installation**
```bash
# Test Node.js
node --version

# Test Python
python --version

# Test Telethon
python -c "import telethon; print('Telethon OK')"
```

## 📱 Brug af Applikationen

### 1. Start Applikationen

```bash
npm start
```

Eller for development mode med DevTools:
```bash
npm run dev
```

### 2. Konfigurer Telegram API Credentials

Applikationen kommer med forudindstillede credentials:
- **API ID**: 38530972
- **API Hash**: 9e9221c611ce1b078324615bc06c2932
- **Telefonnummer**: +45 91 41 58 52

**Vigtigt**: Disse er standard-værdier. For produktion bør du bruge dine egne credentials fra https://my.telegram.org/apps

#### Sådan får du dine egne credentials:
1. Gå til https://my.telegram.org/auth
2. Log ind med dit telefonnummer
3. Klik på "API development tools"
4. Opret en ny app (hvis du ikke har en)
5. Kopier API ID og API Hash

### 3. Kanal Scanning - Tilføj Telegram Grupper

I "Telegram Grupper" feltet, indsæt gruppe-links (én per linje):

**Understøttede formater:**
```
https://t.me/gruppenavn
https://t.me/+invitehash
https://t.me/joinchat/invitehash
```

**Eksempel:**
```
https://t.me/mygroup1
https://t.me/+ABC123xyz
https://t.me/mygroup2
https://t.me/+DEF456uvw
```

Applikationen scanner automatisk og viser antal fundne grupper.

### 4. Skriv Din Besked

Indtast den besked du vil sende i "Besked" feltet. Beskeden sendes præcis som du skriver den.

**Tips:**
- Brug linjeskift for bedre læsbarhed
- Emojis understøttes fuldt ud
- Markdown formatering kan bruges (afhængig af gruppe-indstillinger)

### 5. Konfigurer Send-Frekvens

**Option 1: Gange per dag**
- Vælg hvor mange gange per dag beskeden skal sendes
- Eksempel: "3" = beskeden sendes 3 gange per dag (hver 8. time)

**Option 2: Timer mellem beskeder**
- Vælg præcis hvor mange timer der skal være mellem hver besked
- Eksempel: "2.5" = beskeden sendes hver 2.5 time

### 6. Start Auto-Posting

1. Klik på "Start Sending" knappen
2. **Første gang**: Du vil blive bedt om at indtaste en autoriseringskode
   - Koden sendes til dit Telegram telefonnummer
   - Indtast koden i popup-vinduet
3. **Hvis 2FA aktiveret**: Indtast dit 2FA password når du bliver spurgt
4. Applikationen starter automatisk sending

### 7. Overvåg Status

**Real-time Statistik:**
- **Sendt**: Antal beskeder sendt succesfuldt
- **Fejlet**: Antal beskeder der fejlede
- **Total**: Totalt antal grupper
- **Status**: Grøn prik = aktiv, Grå prik = inaktiv

**Log Output:**
- ✓ Grøn = Success
- ⚠ Gul = Warning
- ✗ Rød = Error
- ℹ Blå = Info

### 8. Stop Sending

Klik på "Stop" knappen for at stoppe sending. Statistikken gemmes.

## 🔧 Avancerede Features

### Rate Limiting

Applikationen implementerer intelligent rate limiting:

1. **Tilfældige Delays**
   - 2-5 sekunder før hver besked
   - 3-7 sekunder efter hver besked
   - Forhindrer spam-detection

2. **FloodWait Håndtering**
   - Automatisk venter hvis Telegram rate limiter
   - Retry efter wait periode
   - Logger wait tid

3. **Intelligent Scheduling**
   - Beregner optimal delay baseret på frekvens
   - Fordeler beskeder jævnt over dagen

### Session Management

**Automatisk Session Gem:**
- Session gemmes i `data/session.session`
- Ingen re-authentication nødvendig efter første login
- Session er krypteret og sikker

**Manuel Session Reset:**
1. Stop applikationen
2. Slet `data/session.session` filen
3. Start applikationen igen
4. Log ind på ny

### Data Persistence

**Automatisk Gem:**
- Alle indstillinger gemmes automatisk
- Beskeder og gruppe-links huskes
- Frekvens-indstillinger gemmes

**Lokation:**
- Indstillinger: Browser localStorage
- Session: `data/session.session`
- Logs: Kun i hukommelsen (ikke gemt)

## 🛡️ Sikkerhed

### Best Practices

1. **Brug Dine Egne Credentials**
   - Standard credentials er kun til test
   - Opret dine egne på https://my.telegram.org/apps

2. **Beskyt Din Session**
   - Del aldrig `session.session` filen
   - Slet filen hvis du skifter computer

3. **2FA Anbefales**
   - Aktiver 2FA på din Telegram konto
   - Giver ekstra sikkerhed

4. **Rate Limiting**
   - Respekter Telegram's limits
   - Brug ikke for høj frekvens
   - Anbefalet: Max 3-4 gange per dag

### Sikkerhedsfunktioner

- ✅ Krypteret kommunikation via Telegram's MTProto
- ✅ Lokal session storage (ingen cloud)
- ✅ Ingen data sendes til tredjepartsservere
- ✅ Automatisk håndtering af authentication errors

## 🐛 Fejlfinding

### Problem: "Python not found"

**Løsning:**
1. Verificer Python installation: `python --version`
2. Hvis ikke installeret, download fra python.org
3. Sørg for Python er i PATH
4. Genstart terminalen efter installation

### Problem: "Telethon import error"

**Løsning:**
```bash
pip install telethon
# eller
pip3 install telethon
```

### Problem: "Authorization failed"

**Løsning:**
1. Verificer telefonnummer er korrekt (inkl. landekode)
2. Sørg for du indtaster koden korrekt
3. Check om 2FA er aktiveret (indtast password)
4. Prøv at slette session og log ind igen

### Problem: "FloodWait error"

**Løsning:**
- Dette er normalt - applikationen håndterer det automatisk
- Vent den angivne tid
- Reducer send-frekvens hvis det sker ofte

### Problem: "Group not found"

**Løsning:**
1. Verificer gruppe-link er korrekt
2. Sørg for du er medlem af gruppen
3. For private grupper, brug invite link (+hash)
4. Check om gruppen stadig eksisterer

### Problem: "Message sending fails"

**Løsning:**
1. Check internet forbindelse
2. Verificer du har rettigheder til at sende i gruppen
3. Check om gruppen har restriktioner
4. Prøv at sende manuelt først for at teste

## 📦 Build til Executable

### Windows

```bash
npm run build
```

Dette opretter en installeret `.exe` fil i `dist/` mappen.

### Konfiguration

Build indstillinger findes i `package.json` under `build` sektionen:

```json
"build": {
  "appId": "com.telegramgroupmessenger.app",
  "productName": "Telegram Group Messenger",
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  }
}
```

## 🔄 Opdateringer

### Manuel Opdatering

1. Download ny version
2. Kør `npm install` for nye dependencies
3. Kør `pip install -r requirements.txt` for Python opdateringer
4. Start applikationen

### Automatisk Opdatering

Ikke implementeret endnu. Planlagt i fremtidige versioner.

## 📊 Teknisk Arkitektur

### Frontend (Electron Renderer)
- **HTML/CSS/JavaScript**: Moderne, responsivt UI
- **IPC Communication**: Kommunikation med main process
- **LocalStorage**: Persistence af indstillinger

### Backend (Electron Main)
- **Node.js**: Main process håndtering
- **Child Process**: Python subprocess management
- **Event Emitters**: Real-time status opdateringer

### Python Backend
- **Telethon**: Telegram MTProto client
- **Asyncio**: Asynkron besked-sending
- **JSON Communication**: Struktureret output til Electron

### Data Flow

```
User Input (Renderer)
    ↓
IPC Message (Main Process)
    ↓
Python Subprocess (Backend)
    ↓
Telegram API (Telethon)
    ↓
Status Updates (JSON)
    ↓
Event Emitters (Main)
    ↓
UI Updates (Renderer)
```

## 🎯 Use Cases

### 1. Marketing Kampagner
- Send promotional beskeder til flere grupper
- Planlæg beskeder til optimal tid
- Track success rate

### 2. Community Management
- Send opdateringer til community grupper
- Automatiser rutine-beskeder
- Koordiner på tværs af grupper

### 3. Event Announcements
- Annoncér events til flere grupper samtidigt
- Planlæg påmindelser
- Automatisk follow-up

### 4. Content Distribution
- Del content til flere kanaler
- Automatiser posting schedule
- Track engagement

## ⚠️ Vigtige Advarsler

1. **Respekter Telegram's Terms of Service**
   - Brug ikke til spam
   - Respekter gruppe-regler
   - Følg rate limits

2. **Juridiske Overvejelser**
   - Sørg for du har tilladelse til at sende i grupperne
   - Respekter GDPR og privacy regler
   - Brug ikke til ulovlige formål

3. **Tekniske Begrænsninger**
   - Telegram har rate limits
   - For mange beskeder kan resultere i ban
   - Test altid med få grupper først

## 📝 Changelog

### Version 1.0.0
- ✅ Initial release
- ✅ Kanal scanning funktionalitet
- ✅ Account entry med 2FA support
- ✅ Auto-posting med scheduling
- ✅ Rate limiting og flood protection
- ✅ Real-time statistik og logging
- ✅ Session persistence

## 🤝 Support

### Få Hjælp

1. **Læs denne guide grundigt**
2. **Check fejlfinding sektionen**
3. **Verificer alle forudsætninger er opfyldt**
4. **Test med få grupper først**

### Rapporter Bugs

Hvis du finder en bug:
1. Beskriv problemet detaljeret
2. Inkluder fejlmeddelelser fra log
3. Angiv dit OS og versioner (Node.js, Python)
4. Beskriv trin til at reproducere

## 📄 License

MIT License - Se LICENSE fil for detaljer.

## 🎉 Konklusion

Telegram Group Messenger er nu klar til brug! Applikationen er fuldt funktionel med:

✅ **Kanal Scanning**: Automatisk parsing af gruppe-links
✅ **Account Entry**: Sikker login med credentials
✅ **Auto-Posting**: Intelligent scheduling og sending
✅ **Rate Limiting**: Beskyttelse mod spam
✅ **Real-time Monitoring**: Live statistik og logs

**Start nu:**
```bash
npm start
```

God fornøjelse med automatisk besked-sending! 🚀
