<#
.SYNOPSIS
    Builds the standalone RescueMemory Android APK locally using Capacitor and Gradle.
.DESCRIPTION
    Compiles the frontend production bundle, syncs assets and plugins to the native
    Android project, and builds the debug APK.
#>

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   RescueMemory Android APK Builder      " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $scriptDir "frontend"
$androidDir = Join-Path $frontendDir "android"

# 1. Build frontend bundle
Write-Host "`n[1/3] Building frontend production bundle..." -ForegroundColor Yellow
Push-Location $frontendDir
try {
    npm run build
} finally {
    Pop-Location
}

# 2. Sync Capacitor native Android
Write-Host "`n[2/3] Syncing Capacitor native Android project..." -ForegroundColor Yellow
Push-Location $frontendDir
try {
    npx cap sync android
} finally {
    Pop-Location
}

# 3. Compile Android APK via Gradle
Write-Host "`n[3/3] Compiling Android APK with Gradle..." -ForegroundColor Yellow
Push-Location $androidDir
try {
    if (Test-Path ".\gradlew.bat") {
        .\gradlew.bat assembleDebug
    } else {
        gradle assembleDebug
    }
} finally {
    Pop-Location
}

$apkPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Write-Host "`n=========================================" -ForegroundColor Green
    Write-Host "   APK BUILT SUCCESSFULLY!               " -ForegroundColor Green
    Write-Host "   Location: $apkPath" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
} else {
    Write-Host "`nBuild completed. Open 'frontend/android' in Android Studio to run or sign the APK." -ForegroundColor Cyan
}
