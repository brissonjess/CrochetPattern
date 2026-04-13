@echo off
:: ─────────────────────────────────────────────────────────────
::  Crochet Tapestry Designer — Launcher Setup
::  Double-click this file to create a desktop shortcut.
:: ─────────────────────────────────────────────────────────────

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-launcher.ps1"
pause