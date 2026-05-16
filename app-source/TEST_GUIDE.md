# Test Guide - Gruppe-Scanning Funktionalitet

## Før Du Tester

### Forudsætninger:
1. Node.js installeret
2. Python 3.8+ installeret
3. Dependencies installeret:
   ```bash
   npm install
   pip install -r requirements.txt
   ```

## Test Scenarie 1: Første Gang Scanning

### Trin 1: Start Applikationen
```bash
npm start
```

### Trin 2: Indtast Credentials
- Indtast dit API ID (eller brug standard: 38530972)
- Indtast dit API Hash (eller brug standard: 9e9221c611ce1b078324615bc06c2932)
- Indtast dit telefonnummer (format: +45XXXXXXXX)
- Indtast 2FA password hvis du har det aktiveret

### Trin 3: Klik "Scan Mine Grupper"
**Forventet Resultat:**
- Log viser: "Scanning for groups..."
- Hvis første gang: Prompt for authorization kode
- Log viser: "Code sent to your phone..."

### Trin 4: Indtast Authorization Kode
- Tjek din Telegram app for kode
- Indtast koden i prompten
- Hvis 2FA: Indtast også password

**Forventet Resultat:**
- Log viser: "Connected to Telegram successfully"
- Log viser: "Found X groups/channels"
- Liste over grupper vises med checkboxes

### Trin 5: Verificer Gruppe-Liste
**Tjek at:**
- ✅ Alle dine grupper vises
- ✅ Gruppe-navne er korrekte
- ✅ Ikoner vises korrekt (👥 for grupper, 📢 for kanaler)
- ✅ Medlemsantal vises (hvis tilgængeligt)
- ✅ Checkboxes fungerer
- ✅ Tæller opdateres når du vælger/fravælger

### Trin 6: Vælg Grupper og Send
- Vælg 2-3 test-grupper
- Skriv en test-besked (f.eks. "Test fra auto-poster")
- Vælg send-frekvens
- Klik "Start Sending"

**Forventet Resultat:**
- Log viser: "Starting to send messages to X groups"
- Beskeder sendes til valgte grupper
- Statistik opdateres (Sendt, Fejlet, Total)
- Status-indikator bliver grøn

## Test Scenarie 2: Genscanning

### Trin 1: Stop Aktiv Sending (hvis kørende)
- Klik "Stop"

### Trin 2: Klik "Scan Mine Grupper" Igen
**Forventet Resultat:**
- Ny scanning starter
- Opdateret liste vises
- Tidligere valg nulstilles

## Test Scenarie 3: Manuel Indtastning (Bagudkompatibilitet)

### Trin 1: Genstart Applikationen
```bash
npm start
```

### Trin 2: Spring Scanning Over
- Ignorer "Scan Mine Grupper" knappen
- Scroll ned til "Eller indsæt gruppe-links manuelt"

### Trin 3: Indtast Links Manuelt
```
https://t.me/testgroup1
https://t.me/testgroup2
```

**Forventet Resultat:**
- Link-tæller opdateres
- Kan stadig starte sending som før

## Test Scenarie 4: Fejlhåndtering

### Test 4.1: Manglende Credentials
- Lad API ID være tom
- Klik "Scan Mine Grupper"

**Forventet Resultat:**
- Fejlmeddelelse: "API ID er påkrævet"
- Scanning starter ikke

### Test 4.2: Forkert Authorization Kode
- Indtast forkert kode

**Forventet Resultat:**
- Fejlmeddelelse fra Telegram
- Mulighed for at prøve igen

### Test 4.3: Ingen Grupper Valgt
- Scan grupper
- Vælg INGEN grupper
- Klik "Start Sending"

**Forventet Resultat:**
- Fejlmeddelelse: "Vælg mindst én gruppe fra listen"

## Test Scenarie 5: Grupper Uden Username

### Trin 1: Find Private Gruppe
- Scan dine grupper
- Find en gruppe uden public username (ingen link vises)

### Trin 2: Vælg og Send
- Vælg den private gruppe
- Send test-besked

**Forventet Resultat:**
- Besked sendes korrekt via entity ID
- Ingen fejl i log

## Test Scenarie 6: Rate Limiting

### Trin 1: Vælg Mange Grupper
- Scan grupper
- Vælg 10+ grupper

### Trin 2: Start Sending
**Forventet Resultat:**
- Beskeder sendes med delays
- Log viser progress
- Hvis rate limit: "Rate limited! Waiting X seconds..."
- Automatisk retry efter wait

## Test Scenarie 7: Session Persistence

### Trin 1: Første Scanning
- Scan grupper
- Autoriser med kode

### Trin 2: Genstart Applikationen
```bash
npm start
```

### Trin 3: Scan Igen
**Forventet Resultat:**
- INGEN authorization kode nødvendig
- Session genbruges fra `data/session.session`
- Scanning starter direkte

## Verificering af Funktionalitet

### Tjekliste:
- [ ] Scanning finder alle grupper
- [ ] Gruppe-information vises korrekt
- [ ] Checkboxes fungerer
- [ ] Tæller opdateres
- [ ] Beskeder sendes til valgte grupper
- [ ] Manuel indtastning virker stadig
- [ ] Fejlhåndtering fungerer
- [ ] Session gemmes og genbruges
- [ ] Rate limiting håndteres
- [ ] Private grupper (uden username) virker

## Debugging

### Hvis Scanning Fejler:

1. **Tjek Python Installation:**
   ```bash
   python --version
   # eller
   python3 --version
   ```

2. **Tjek Telethon Installation:**
   ```bash
   pip list | grep -i telethon
   ```

3. **Tjek Logs:**
   - Se i applikationens log-vindue
   - Tjek console for fejl (F12 i Electron)

4. **Tjek Session Fil:**
   ```bash
   ls -la data/
   # Skal vise session.session fil
   ```

### Hvis Beskeder Ikke Sendes:

1. **Verificer Gruppe-Valg:**
   - Er mindst én gruppe valgt?
   - Vises valgt antal korrekt?

2. **Tjek Besked:**
   - Er besked-feltet udfyldt?

3. **Tjek Telegram Forbindelse:**
   - Er du stadig logget ind?
   - Prøv at scanne igen

## Performance Test

### Test med Mange Grupper:

1. Hvis du er medlem af 50+ grupper:
   - Scan alle grupper
   - Mål tid (typisk 2-5 sekunder)
   - Verificer at alle vises

2. Scroll gennem listen:
   - Skal være smooth
   - Ingen lag

3. Vælg/fravælg hurtigt:
   - Tæller skal opdatere øjeblikkeligt

## Konklusion

Hvis alle tests passerer, er implementeringen komplet og klar til produktion!

### Success Kriterier:
✅ Scanning fungerer konsistent
✅ Alle gruppe-typer håndteres
✅ UI er responsivt
✅ Fejlhåndtering er robust
✅ Bagudkompatibilitet bevares
✅ Performance er acceptabel
