$ErrorActionPreference = 'Stop'
$hospitalRoot = Split-Path -Parent $PSScriptRoot
$hospitalUrl = 'http://127.0.0.1:3000'
function Test-HospitalServer {
    try {
        $health = Invoke-RestMethod -Uri "$hospitalUrl/api/health" -TimeoutSec 2
        return $health.status -eq 'ok'
    } catch { return $false }
}
try {
    if (-not (Test-HospitalServer)) {
        $hospitalNode = (Get-Command node.exe -ErrorAction Stop).Source
        $hospitalData = Join-Path $hospitalRoot 'data'
        New-Item -ItemType Directory -Force -Path $hospitalData | Out-Null
        Start-Process -FilePath $hospitalNode -ArgumentList 'server/index.js' -WorkingDirectory $hospitalRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $hospitalData 'server-output.log') -RedirectStandardError (Join-Path $hospitalData 'server-error.log') | Out-Null
        $hospitalReady = $false
        for ($hospitalAttempt = 0; $hospitalAttempt -lt 20; $hospitalAttempt++) {
            if (Test-HospitalServer) { $hospitalReady = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $hospitalReady) { throw 'The hospital server could not start. Check data\server-error.log and ensure port 3000 is available.' }
    }
    Write-Host "Hospital IMS is available at $hospitalUrl"
    Start-Process $hospitalUrl
} catch {
    Write-Host "Unable to open Hospital IMS: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
