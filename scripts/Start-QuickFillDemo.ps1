$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
$cargoPath = if ($cargoCommand) { $cargoCommand.Source } else { Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe' }
Push-Location $projectRoot
try {
    & $cargoPath build --locked -p windows-validation
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed.' }
    $executable = Join-Path $projectRoot 'target\debug\windows-validation.exe'
    # Hide the helper console. The native app explicitly shows its interactive panel.
    $demoProcess = Start-Process -FilePath $executable -ArgumentList '--manual-retry' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    if ($demoProcess.WaitForExit(700)) { throw 'Demo exited early; check whether Ctrl+Alt+Space is occupied.' }
    Write-Output "Quick-fill demo started, PID=$($demoProcess.Id). Hotkey: Ctrl+Alt+Space. Use the panel Exit button to stop."
} finally { Pop-Location }
