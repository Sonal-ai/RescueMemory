param(
    [Parameter(Mandatory = $true)] [string] $NodeId,
    [ValidateSet('survivor', 'volunteer', 'central')] [string] $Role = 'survivor',
    [int] $Port = 8001,
    [string] $CentralUrl = '',
    [switch] $Lan
)

$env:NODE_ID = $NodeId
$env:NODE_ROLE = $Role
$env:DATA_DIR = "data/$NodeId"
$env:MODEL_CACHE = 'data/model_cache'
if ($CentralUrl) { $env:CENTRAL_URL = $CentralUrl }
$hostAddress = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

$python = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $python = '..\.venv\Scripts\python.exe'
}
if (-not (Test-Path $python)) {
    throw 'Python environment not found. Follow the install steps in README.md.'
}

& $python -m uvicorn backend.app.main:app --host $hostAddress --port $Port --no-access-log
