# Guide til Gruppe-Scanning

## Ny Funktionalitet: Automatisk Gruppe-Scanning

Programmet kan nu automatisk scanne og finde alle de Telegram-grupper du er medlem af!

## Sådan Bruger Du Det

### 1. Indtast Dine Credentials
- API ID
- API Hash  
- Telefonnummer
- Password (hvis 2FA er aktiveret)

### 2. Klik på "Scan Mine Grupper"
- Programmet vil forbinde til Telegram
- Hvis det er første gang, skal du indtaste den kode du modtager på din telefon
- Programmet scanner automatisk alle dine grupper

### 3. Vælg Grupper
- Du vil se en liste over alle grupper du er medlem af
- Hver gruppe viser:
  - 👥 for normale grupper
  - 📢 for kanaler
  - Antal medlemmer (hvis tilgængeligt)
- Sæt flueben ved de grupper du vil sende beskeder til
- Du kan se hvor mange grupper du har valgt

### 4. Skriv Din Besked
- Indtast den besked du vil sende

### 5. Vælg Send-Frekvens
- Gange per dag ELLER
- Timer mellem beskeder

### 6. Start Sending
- Klik "Start Sending"
- Programmet sender kun til de valgte grupper

## Fordele ved Scanning

✅ **Ingen manuel indtastning** - Programmet finder automatisk alle dine grupper

✅ **Se gruppe-information** - Navn, type og medlemsantal

✅ **Vælg præcist** - Vælg kun de grupper du vil bruge

✅ **Opdater nemt** - Scan igen for at opdatere listen

## Manuel Indtastning Stadig Mulig

Hvis du foretrækker det, kan du stadig indtaste gruppe-links manuelt i tekstfeltet.

## Fejlfinding

### "Authorization needed"
- Indtast den kode du modtager på din telefon
- Hvis du har 2FA, indtast også dit password

### "No groups found"
- Sørg for at du er medlem af mindst én gruppe
- Tjek at dine credentials er korrekte

### "Cannot scan while messaging is running"
- Stop den aktuelle sending først
- Scan derefter igen

## Sikkerhed

- Din session gemmes lokalt i `data/` mappen
- Ingen data sendes til tredjepartsservere
- Alle forbindelser er krypteret via Telegram's MTProto protokol
