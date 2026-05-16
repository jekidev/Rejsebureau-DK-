# Installations Guide

## Hurtig Start

1. **Install Node.js dependencies:**
```bash
npm install
```

2. **Install Python dependencies:**
```bash
pip install -r requirements.txt
```

3. **Start applikationen:**
```bash
npm start
```

## Detaljeret Installation

### Windows

1. Download og installer Node.js fra [nodejs.org](https://nodejs.org/)
2. Download og installer Python 3.8+ fra [python.org](https://www.python.org/)
3. Åbn PowerShell/Command Prompt i projektmappen
4. Kør: `npm install`
5. Kør: `pip install -r requirements.txt`
6. Kør: `npm start`

### Fejlfinding

**"python ikke fundet":**
- Sørg for at Python er tilføjet til PATH
- Prøv `python3` i stedet for `python` på nogle systemer

**"telethon ikke fundet":**
- Kør: `pip install telethon`
- Eller: `python -m pip install telethon`

**"electron ikke fundet":**
- Kør: `npm install electron --save-dev`

## Build til Executable

For at bygge en standalone .exe fil:

```bash
npm run build
```

Executablen vil blive placeret i `dist/` mappen.

