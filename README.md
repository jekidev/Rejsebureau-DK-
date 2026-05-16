# Telegram Group Messenger Premium - Professional Installer

This repository is reserved for the customer-facing Windows installer build.

Goal:
- One normal Windows setup file for customers
- GUI installer wizard
- Start Menu shortcut
- optional desktop shortcut
- normal uninstall entry in Windows Apps
- no patch BAT files
- no split downloads
- no installed-app finder
- no temporary license gate

## Expected final output

The build should produce:

```text
Telegram_Group_Messenger_Premium_Setup.exe
```

## Source package

Put the final working application package in:

```text
app-source/
```

The build system will package that application into a normal Windows installer.

## Current status

Repository initialized for installer work.
