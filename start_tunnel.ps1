# Starts Cloudflare Quick Tunnel to expose RescueMemory backend on the internet
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Starting RescueMemory Cloudflare Tunnel" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Check if backend is active on port 8000
$conn = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Host "Port 8000 is not active. Starting backend server..." -ForegroundColor Yellow
    Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000" -NoNewWindow
    Start-Sleep -Seconds 3
}

# 2. Run cloudflared
Write-Host "Launching cloudflared quick tunnel to http://127.0.0.1:8000 ..." -ForegroundColor Cyan
cloudflared tunnel --url http://127.0.0.1:8000
