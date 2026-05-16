!include "MUI2.nsh"
!include "LogicLib.nsh"

!macro customInit
  DetailPrint "Closing running instances..."
  nsExec::Exec 'taskkill /F /IM "Telegram Group Messenger.exe" /T'
!macroend

!macro customInstall
  DetailPrint "Checking for Python..."
  nsExec::ExecToStack 'python --version'
  Pop $0
  Pop $1
  
  ${If} $0 != 0
    DetailPrint "Python not found. Downloading Python 3.11..."
    ; Use PowerShell to download for better HTTPS support
    nsExec::ExecToLog 'powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \"https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe\" -OutFile \"$TEMP\python_installer.exe\""'
    Pop $0
    
    ${If} $0 == 0
      DetailPrint "Installing Python..."
      ExecWait '"$TEMP\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0'
      Delete "$TEMP\python_installer.exe"
    ${Else}
      MessageBox MB_OK "Could not download Python automatically. Please install Python 3 manually."
    ${EndIf}
  ${Else}
    DetailPrint "Python is already installed ($1)."
  ${EndIf}

  ; Create a per-user venv and install requirements so the app works without manual pip steps.
  ; This avoids admin permissions and avoids touching global site-packages.
  DetailPrint "Setting up TelegramGroupMessenger Python environment..."

  StrCpy $2 "$LOCALAPPDATA\\TelegramGroupMessenger\\venv"
  StrCpy $3 "$2\\Scripts\\python.exe"
  StrCpy $4 "$INSTDIR\\resources\\app.asar.unpacked\\requirements.txt"

  ; Create venv (idempotent)
  nsExec::ExecToStack 'python -m venv "$2"'
  Pop $0
  Pop $1

  ${If} $0 != 0
    DetailPrint "Failed to create venv ($1). The app can still try installing on first run."
  ${Else}
    ; Ensure pip is available and up to date
    nsExec::ExecToStack '"$3" -m ensurepip --upgrade'
    Pop $0
    Pop $1

    nsExec::ExecToStack '"$3" -m pip install --upgrade pip'
    Pop $0
    Pop $1

    DetailPrint "Installing Python requirements..."
    nsExec::ExecToStack '"$3" -m pip install -r "$4"'
    Pop $0
    Pop $1

    ${If} $0 != 0
      DetailPrint "Failed to install requirements ($1). The app can still try installing on first run."
    ${Else}
      DetailPrint "Python requirements installed successfully."
    ${EndIf}

    ; Persist venv Python path for the app backend wrappers.
    WriteRegStr HKCU "Software\\TelegramGroupMessenger" "VenvPython" "$3"
  ${EndIf}
!macroend
