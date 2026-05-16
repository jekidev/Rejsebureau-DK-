!macro customInit
  DetailPrint "Closing old Telegram Group Messenger Premium processes..."
  nsExec::ExecToLog 'taskkill /F /IM "Telegram Group Messenger Premium.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "Telegram Group Messenger.exe" /T'
!macroend
