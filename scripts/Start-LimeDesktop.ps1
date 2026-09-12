$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'target\debug\until-a-lime.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    throw 'Build the desktop preview first: npm run tauri -- build --debug --no-bundle'
}
$appProcess = Start-Process -FilePath $executable -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
if ($appProcess.WaitForExit(1500)) {
    if ($appProcess.ExitCode -ne 0) { throw "Desktop preview exited with code $($appProcess.ExitCode)." }
    $existing = Get-Process -Name 'until-a-lime' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $executable -and $_.Id -ne $appProcess.Id } |
        Select-Object -First 1
    if (-not $existing) { throw 'Desktop preview exited without a running application instance.' }
    Write-Output "Existing Lime desktop preview activated. PID=$($existing.Id). Local vault development build."
    return
}
Write-Output "Lime desktop preview started. PID=$($appProcess.Id). Local vault development build."
