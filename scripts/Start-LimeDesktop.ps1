param([ValidateSet("Debug", "Release")][string]$Configuration = "Debug")
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot ("target\{0}\until-a-lime.exe" -f $Configuration.ToLowerInvariant())
if (-not (Test-Path -LiteralPath $executable)) {
    throw ('Build the selected desktop first: npm.cmd run tauri -- build --no-bundle' + $(if ($Configuration -eq 'Debug') { ' --debug' } else { '' }))
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
