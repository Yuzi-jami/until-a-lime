param([ValidateSet("Debug", "Release")][string]$Configuration = "Debug")
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot ("target\{0}\until-a-lime.exe" -f $Configuration.ToLowerInvariant())
$bytes = [System.IO.File]::ReadAllBytes($executable)
$pe = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550) { throw 'Not a PE executable.' }
$subsystem = [BitConverter]::ToUInt16($bytes, $pe + 24 + 68)
if ($subsystem -ne 2) { throw "Expected Windows GUI subsystem 2, got $subsystem" }
$file = Get-Item -LiteralPath $executable
[PSCustomObject]@{ Path = $file.FullName; Bytes = $file.Length; Built = $file.LastWriteTime; SHA256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash; Subsystem = $subsystem } | Format-List
Write-Output 'PASS: PE Windows GUI subsystem 2. This does not verify visible windows or session behavior.'
