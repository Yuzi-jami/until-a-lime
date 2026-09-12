param(
    [int]$TimeoutSeconds = 30,
    [ValidateSet('uia','quickfill')][string]$Mode = 'uia'
)

$ErrorActionPreference = 'Stop'
throw 'Runtime tests suspended after the 2026-09-10 Windows bugcheck. Static compilation remains available. See docs/incident-2026-09-10.md.'
if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 120) {
    throw 'TimeoutSeconds must be between 1 and 120.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
$cargoPath = if ($cargoCommand) { $cargoCommand.Source } else {
    Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
}
if (-not (Test-Path -LiteralPath $cargoPath)) { throw 'Rust / Cargo is not installed.' }

Push-Location $projectRoot
try {
    & $cargoPath build --locked -p windows-validation
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed.' }
    $executable = Join-Path $projectRoot 'target\debug\windows-validation.exe'
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $executable
    $startInfo.Arguments = if ($Mode -eq 'quickfill') { '--quickfill-self-test' } else { '--self-test' }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $testProcess = New-Object System.Diagnostics.Process
    $testProcess.StartInfo = $startInfo
    [void]$testProcess.Start()
    $stdout = $testProcess.StandardOutput.ReadToEndAsync()
    $stderr = $testProcess.StandardError.ReadToEndAsync()
    if (-not $testProcess.WaitForExit($TimeoutSeconds * 1000)) {
        # Kill only this harness and its own fixture child, never other applications.
        & taskkill.exe /PID $testProcess.Id /T /F | Out-Null
        throw 'Validation timed out; the test process tree was terminated.'
    }
    Write-Output $stdout.GetAwaiter().GetResult()
    $errorOutput = $stderr.GetAwaiter().GetResult()
    if ($errorOutput) { Write-Output $errorOutput }
    if ($testProcess.ExitCode -ne 0) { throw 'Windows validation failed.' }
} finally {
    Pop-Location
}
