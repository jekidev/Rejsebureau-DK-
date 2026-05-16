# Quick Start Guide

## Hurtig Installation

1. **Åbn terminal i projektmappen**

2. **Install dependencies:**
```bash
npm install
pip install telethon
```

3. **Start applikationen:**
```bash
npm start
```

## Første Brug

1. **Log ind i applikationen:**
   - Brugernavn: `admin`
   - Password: `password123!`

2. **Konfiguration:**
   - Indtast din **API ID** og **API Hash** (klik på "?" ikonet i appen for at se hvordan du finder dem)
   - Indtast dit **telefonnummer** i internationalt format (f.eks. +45XXXXXXXX)

3. **Ved første kørsel:**
   - Du vil modtage en bekræftelseskode fra Telegram
   - Indtast koden i applikationen
   - Hvis du har 2FA aktiveret, indtast også dit password

3. **Indsæt gruppe-links:**
   - Kopier dine Telegram gruppe-links
   - Indsæt dem i "Telegram Grupper" feltet (én per linje)
   - Eksempel:
     ```
     https://t.me/group1
     https://t.me/+invitehash
     https://t.me/group2
     ```

4. **Skriv din besked:**
   - Indtast den besked du vil sende til alle grupper

5. **Vælg send-frekvens:**
   - **Gange per dag**: Hvor mange gange om dagen skal beskeden sendes
   - **Timer mellem beskeder**: Fast interval mellem hver besked

6. **Klik "Start Sending"**

## Tips

- Applikationen håndterer automatisk rate limiting
- Beskeder sendes med tilfældige delays for at undgå spam-detection
- Du kan stoppe sendingen når som helst med "Stop" knappen
- Alle indstillinger gemmes automatisk

## Fejlfinding

**Applikationen starter ikke:**
- Tjek at Node.js er installeret: `node --version`
- Tjek at Python er installeret: `python --version`

**"Module not found" fejl:**
- Kør: `npm install`
- Kør: `pip install telethon`

**Authorization fejler:**
- Tjek at telefonnummeret er korrekt formateret (+45...)
- Sørg for at du har internetforbindelse
- Prøv at slette `data/session.session` filen og start forfra


   