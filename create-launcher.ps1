#Requires -Version 5.0
<#
.SYNOPSIS
    Creates a Windows desktop shortcut that opens Crochet Tapestry Designer
    as a standalone app window (no browser chrome).

.NOTES
    Run via setup.bat, or directly:
        powershell -ExecutionPolicy Bypass -File create-launcher.ps1
#>

$ErrorActionPreference = 'Stop'

$appDir   = $PSScriptRoot
$appFile  = Join-Path $appDir "index.html"
$appUrl   = "file:///" + $appFile.Replace("\", "/")
$iconPath = Join-Path $appDir "app-icon.ico"

Write-Host ""
Write-Host "  Crochet Tapestry Designer -- Launcher Setup" -ForegroundColor Cyan
Write-Host "  --------------------------------------------" -ForegroundColor DarkGray

# --- 1. Generate app icon (3x3 pixel-grid motif, purple palette) -------------

if (-not (Test-Path $iconPath)) {
    Write-Host "  Creating icon..." -ForegroundColor DarkGray
    try {
        Add-Type -AssemblyName System.Drawing

        $size = 256
        $bmp  = New-Object System.Drawing.Bitmap $size, $size
        $g    = [System.Drawing.Graphics]::FromImage($bmp)

        # Purple background
        $bgColor = [System.Drawing.ColorTranslator]::FromHtml("#7c5cbf")
        $bgBrush = New-Object System.Drawing.SolidBrush $bgColor
        $g.FillRectangle($bgBrush, 0, 0, $size, $size)
        $bgBrush.Dispose()

        # Draw 3x3 checkerboard of squares
        $colors = @(
            "#ffffff", "#cba6f7", "#ffffff",
            "#cba6f7", "#ffffff", "#cba6f7",
            "#ffffff", "#cba6f7", "#ffffff"
        )
        $cell   = 60
        $gap    = 8
        $margin = 26

        for ($row = 0; $row -lt 3; $row++) {
            for ($col = 0; $col -lt 3; $col++) {
                $c     = [System.Drawing.ColorTranslator]::FromHtml($colors[$row * 3 + $col])
                $brush = New-Object System.Drawing.SolidBrush $c
                $x     = $margin + $col * ($cell + $gap)
                $y     = $margin + $row * ($cell + $gap)
                $g.FillRectangle($brush, $x, $y, $cell, $cell)
                $brush.Dispose()
            }
        }
        $g.Dispose()

        # Save PNG bytes, then wrap in a minimal ICO container
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $pngBytes = $ms.ToArray()
        $ms.Dispose()

        $fs = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
        $bw = New-Object System.IO.BinaryWriter $fs

        # ICO file header (6 bytes)
        $bw.Write([System.UInt16]0)   # Reserved
        $bw.Write([System.UInt16]1)   # Type: 1 = ICO
        $bw.Write([System.UInt16]1)   # Number of images

        # Image directory entry (16 bytes)
        $bw.Write([System.Byte]0)     # Width  (0 means 256)
        $bw.Write([System.Byte]0)     # Height (0 means 256)
        $bw.Write([System.Byte]0)     # Color count (0 = no palette)
        $bw.Write([System.Byte]0)     # Reserved
        $bw.Write([System.UInt16]1)   # Color planes
        $bw.Write([System.UInt16]32)  # Bits per pixel
        $bw.Write([System.UInt32]$pngBytes.Length)  # Size of image data
        $bw.Write([System.UInt32]22)  # Offset to image data (6 + 16 = 22)

        # Image data (PNG)
        $bw.Write($pngBytes)
        $bw.Close()
        $fs.Close()

        Write-Host "  Icon saved: app-icon.ico" -ForegroundColor DarkGray
    } catch {
        Write-Warning ("  Could not generate icon, shortcut will use browser icon. " + $_.Exception.Message)
        $iconPath = $null
    }
} else {
    Write-Host "  Icon already exists, reusing app-icon.ico" -ForegroundColor DarkGray
}

# --- 2. Find Edge or Chrome --------------------------------------------------

$browserCandidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
    "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$browserPath = $null
foreach ($candidate in $browserCandidates) {
    if (Test-Path $candidate) {
        $browserPath = $candidate
        break
    }
}

if (-not $browserPath) {
    Write-Host ""
    Write-Host "  ERROR: Could not find Microsoft Edge or Google Chrome." -ForegroundColor Red
    Write-Host "  Please install one of these browsers and run setup again." -ForegroundColor Red
    Write-Host ""
    exit 1
}

$browserName = if ($browserPath -like "*msedge*") { "Microsoft Edge" } else { "Google Chrome" }
Write-Host "  Browser: $browserName" -ForegroundColor DarkGray

# --- 3. Create shortcut on Desktop ------------------------------------------

$shortcutName = "Crochet Tapestry Designer"
$desktopPath  = [Environment]::GetFolderPath("Desktop")
$shortcutFile = Join-Path $desktopPath ($shortcutName + ".lnk")

$wshell = New-Object -ComObject WScript.Shell
$sc = $wshell.CreateShortcut($shortcutFile)
$sc.TargetPath       = $browserPath
$sc.Arguments        = "--app=`"$appUrl`" --no-first-run --disable-features=TranslateUI"
$sc.Description      = "Crochet Tapestry Designer"
$sc.WorkingDirectory = $appDir
if ($iconPath -and (Test-Path $iconPath)) {
    $sc.IconLocation = $iconPath + ",0"
}
$sc.Save()

Write-Host ""
Write-Host "  Done! Shortcut created on your Desktop:" -ForegroundColor Green
Write-Host ("    " + $shortcutFile) -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    Pin to taskbar  ->  right-click the desktop icon, choose 'Pin to taskbar'"
Write-Host "    Pin to Start    ->  right-click the desktop icon, choose 'Pin to Start'"
Write-Host ""
Write-Host "  NOTE: If you move the project folder, run setup.bat again." -ForegroundColor DarkYellow
Write-Host ""