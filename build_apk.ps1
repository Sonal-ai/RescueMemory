Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Building RescueMemory Offline APK locally" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$ROOT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$ANDROID_DIR = Join-Path $FRONTEND_DIR "android"

# 1. Compile React Web Assets
Set-Location $FRONTEND_DIR
Write-Host "`n[1/3] Building Web Distribution..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend build failed"; exit 1 }

# 2. Sync Capacitor Android
Write-Host "`n[2/3] Syncing Capacitor Android Assets..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) { Write-Error "Capacitor sync failed"; exit 1 }

# 3. Configure JDK 21 Environment & Compile APK via Gradle
Set-Location $ANDROID_DIR
$LOCAL_JDK21 = Join-Path $env:USERPROFILE ".jdk-21\jdk-21.0.12.1+1"
if (Test-Path $LOCAL_JDK21) {
    $env:JAVA_HOME = $LOCAL_JDK21
    $env:PATH = "$LOCAL_JDK21\bin;$env:PATH"
    Write-Host "`nUsing verified JDK 21 LTS: $LOCAL_JDK21" -ForegroundColor Cyan
}

Write-Host "`n[3/3] Compiling Debug APK with Gradle..." -ForegroundColor Yellow
.\gradlew.bat assembleDebug --no-daemon
if ($LASTEXITCODE -ne 0) { Write-Error "Gradle build failed"; exit 1 }

$APK_PATH = Join-Path $ANDROID_DIR "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $APK_PATH) {
    Write-Host "`nSUCCESS! APK Generated at:" -ForegroundColor Green
    Write-Host "$APK_PATH" -ForegroundColor White
    explorer.exe /select,$APK_PATH
} else {
    Write-Error "APK file not found after build"
}
