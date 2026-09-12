param([ValidateRange(1,5)][int]$Samples = 3)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$qqProcesses = @(Get-Process -Name QQ -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
if ($qqProcesses.Count -eq 0) {
    [pscustomobject]@{ Application='QQ'; Status='NoMainWindow' } | ConvertTo-Json
    return
}

$reports = foreach ($qqProcess in $qqProcesses) {
    $signature = Get-AuthenticodeSignature -LiteralPath $qqProcess.MainModule.FileName
    $version = $qqProcess.MainModule.FileVersionInfo.FileVersion
    $observations = for ($sample=0; $sample -lt $Samples; $sample++) {
        try {
            $qqProcess.Refresh()
            if ($qqProcess.HasExited -or $qqProcess.MainWindowHandle -eq [IntPtr]::Zero) {
                throw 'TargetWindowUnavailable'
            }
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($qqProcess.MainWindowHandle)
            $condition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Edit
            )
            $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
            $capabilities = @(foreach ($edit in $edits) {
                $current = $edit.Current
                $pattern = $null
                $hasValue = $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)
                [pscustomobject]@{
                    ActualEditType = $current.ControlType -eq [System.Windows.Automation.ControlType]::Edit
                    SameProcess = $current.ProcessId -eq $qqProcess.Id
                    IsPassword = $current.IsPassword
                    IsEnabled = $current.IsEnabled
                    IsFocusable = $current.IsKeyboardFocusable
                    IsOffscreen = $current.IsOffscreen
                    SupportsValue = $hasValue
                    IsReadOnly = if ($hasValue) { $pattern.Current.IsReadOnly } else { $null }
                }
            })
            [pscustomobject]@{ Sample=$sample+1; Status='Observed'; EditCount=$edits.Count; Capabilities=$capabilities }
        } catch {
            [pscustomobject]@{ Sample=$sample+1; Status='Unavailable'; ErrorType=$_.Exception.GetType().FullName }
        }
        if ($sample+1 -lt $Samples) { Start-Sleep -Milliseconds 300 }
    }
    [pscustomobject]@{
        Application='QQ'
        Version=$version
        SignatureStatus=$signature.Status.ToString()
        SignedByTencent=($null -ne $signature.SignerCertificate -and $signature.SignerCertificate.Subject -match 'O=Tencent Technology \(Shenzhen\) Company Limited')
        Samples=@($observations)
        Note='Read-only capabilities; no names, values, titles or screenshots collected. Not authorization to fill.'
    }
}
@($reports) | ConvertTo-Json -Depth 6
