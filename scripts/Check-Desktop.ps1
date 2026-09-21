$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $checks = @('npm.cmd run browser:prepare', 'npm.cmd run format:check', 'npm.cmd test', 'npm.cmd run build', 'cargo fmt --all -- --check', 'cargo clippy -p until-a-lime --locked -- -D warnings', 'cargo test -p until-a-lime --locked')
    foreach ($check in $checks) {
        Write-Output "Checking: $check"
        cmd /c $check
        if ($LASTEXITCODE -ne 0) { throw "Check failed ($LASTEXITCODE): $check" }
    }
} finally { Pop-Location }
