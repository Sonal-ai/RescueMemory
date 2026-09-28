param(
    [switch] $Stop
)

if ($Stop) {
    Get-Process python -ErrorAction SilentlyContinue | Where-Object {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
            $cmd -like "*uvicorn backend.app.main:app*"
        } catch { $false }
    } | Stop-Process -Force
    Write-Host "All rehearsal nodes stopped." -ForegroundColor Yellow
    exit 0
}

Write-Host "Starting RescueMemory Multi-Node Rehearsal Cluster..." -ForegroundColor Cyan

$python = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = '..\.venv\Scripts\python.exe' }
if (-not (Test-Path $python)) { throw "Python not found in .venv" }

# Node A: Survivor on http://localhost:8000
Start-Process -FilePath $python -ArgumentList "-m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --no-access-log" -Environment @{
    NODE_ID = "survivor-a"
    NODE_ROLE = "survivor"
    DATA_DIR = "data/survivor-a"
    MODEL_CACHE = "data/model_cache"
    MESH_SHARED_KEY = "demo-mesh-shared-key"
    RESPONDER_SHARED_KEY = "demo-responder-shared-key"
    NODE_ADMIN_KEY = "demo-node-admin-key"
} -WindowStyle Hidden

# Node B: Volunteer on http://localhost:8001
Start-Process -FilePath $python -ArgumentList "-m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --no-access-log" -Environment @{
    NODE_ID = "volunteer-b"
    NODE_ROLE = "volunteer"
    DATA_DIR = "data/volunteer-b"
    MODEL_CACHE = "data/model_cache"
    CENTRAL_URL = "http://127.0.0.1:8002"
    MESH_SHARED_KEY = "demo-mesh-shared-key"
    RESPONDER_SHARED_KEY = "demo-responder-shared-key"
    NODE_ADMIN_KEY = "demo-node-admin-key"
} -WindowStyle Hidden

# Node C: Central / Command on http://localhost:8002
Start-Process -FilePath $python -ArgumentList "-m uvicorn backend.app.main:app --host 127.0.0.1 --port 8002 --no-access-log" -Environment @{
    NODE_ID = "central-hq"
    NODE_ROLE = "central"
    DATA_DIR = "data/central-hq"
    MODEL_CACHE = "data/model_cache"
    GUIDE_TRUST_KEY = "demo-guide-trust-key"
    MESH_SHARED_KEY = "demo-mesh-shared-key"
    RESPONDER_SHARED_KEY = "demo-responder-shared-key"
    NODE_ADMIN_KEY = "demo-node-admin-key"
} -WindowStyle Hidden

Start-Sleep -Seconds 3

Write-Host "Node A (Survivor Web UI):  http://localhost:8000" -ForegroundColor Green
Write-Host "Node B (Volunteer Web UI): http://localhost:8001" -ForegroundColor Green
Write-Host "Node C (Command Web UI):   http://localhost:8002" -ForegroundColor Green
Write-Host "Run '.\run_rehearsal.ps1 -Stop' to terminate all cluster nodes." -ForegroundColor DarkGray
