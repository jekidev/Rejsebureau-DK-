# Telegram Group Messenger

Professionel Electron-baseret applikation til automatisk sending af beskeder til Telegram grupper med rate limiting og spam-beskyttelse.

## Features

- 🎨 Moderne, professionel Electron GUI
- 🔍 **NY: Automatisk scanning af dine Telegram-grupper**
- 📱 Automatisk sending til flere Telegram grupper
- ✅ Vælg præcist hvilke grupper der skal bruges
- ⏰ Konfigurerbar send-frekvens (gange per dag eller timer mellem beskeder)
- 🛡️ Rate limiting og spam-beskyttelse
- 📊 Real-time statistik og logging
- 💾 Automatisk gem af indstillinger

## Installation

### Forudsætninger

- Node.js (v16 eller nyere)
- Python 3.8+ (til Telethon backend)
- npm eller yarn

### Setup

1. Installer Node.js dependencies:
```bash
npm install
```

2. Installer Python dependencies:
```bash
pip install -r requirements.txt
```

## Brug

1. Start applikationen:
```bash
npm start
```

2. Indtast dine Telegram credentials (eller brug standardværdierne)

3. **Vælg én af to metoder:**

   **Metode A: Automatisk Scanning (Anbefalet)**
   - Klik på "Scan Mine Grupper"
   - Vent mens programmet finder alle dine grupper
   - Vælg de grupper du vil sende til ved at sætte flueben
   
   **Metode B: Manuel Indtastning**
   - Indsæt Telegram gruppe-links (én per linje)

4. Skriv din besked

5. Vælg send-frekvens

6. Klik "Start Sending"

## Quick Start Guide

### Metode 1: Automatisk Scanning (Anbefalet) 🔍

1. Start applikationen: `npm start`
2. Indtast dine Telegram credentials
3. Klik **"Scan Mine Grupper"**
4. Vælg de grupper du vil sende til
5. Skriv din besked
6. Klik **"Start Sending"**

### Metode 2: Manuel Indtastning 📝

1. Start applikationen: `npm start`
2. Indtast dine Telegram credentials
3. Indsæt gruppe-links i tekstfeltet (én per linje)
4. Skriv din besked
5. Klik **"Start Sending"**

## Standard Credentials

Applikationen kommer med forudindstillede credentials:
- API ID: 38530972
- API Hash: 9e9221c611ce1b078324615bc06c2932
- Telefonnummer: +45 91 41 58 52

## Build til Executable

```bash
npm run build
```

Dette vil oprette en installeret version i `dist/` mappen.

## Rate Limiting

Applikationen implementerer automatisk rate limiting:
- Tilfældige delays mellem beskeder (2-5 sekunder før, 3-7 sekunder efter)
- Automatisk håndtering af FloodWait errors
- Intelligent scheduling baseret på din konfiguration

## Sikkerhed

- Session data gemmes lokalt i `data/` mappen
- Ingen credentials sendes til tredjepartsservere
- Alle forbindelser er krypteret via Telegram's MTProto protokol

## Fejlfinding

### Python ikke fundet
Sørg for at Python er installeret og tilgængelig i PATH.

### Telethon import fejl
Kør: `pip install telethon`

### Authorization fejl
Ved første kørsel skal du indtaste den kode du modtager på din telefon.

## License

MIT

