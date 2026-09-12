param(
    [string[]]$ProcessNames = @('steam', 'QQ', 'Weixin', 'WeChat')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$reports = foreach ($processName in $ProcessNames) {
    $targets = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
    if ($targets.Count -eq 0) {
        [pscustomobject]@{ Application = $processName; Status = 'NotRunning' }
        continue
    }

    $observedWindows = 0
    $failedProcesses = 0
    foreach ($target in $targets) {
        try {
            $condition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
                [int]$target.Id
            )
            $windows = $desktop.FindAll(
                [System.Windows.Automation.TreeScope]::Children, $condition
            )
            if ($windows.Count -eq 0) { continue }
            $observedWindows += $windows.Count

            $version = $null
            try { $version = $target.MainModule.FileVersionInfo.FileVersion } catch {}
            foreach ($window in $windows) {
                $edits = $window.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    (New-Object System.Windows.Automation.PropertyCondition(
                        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                        [System.Windows.Automation.ControlType]::Edit
                    ))
                )
                $passwordCount = 0
                $valuePatternCount = 0
                $focusableCount = 0
                foreach ($edit in $edits) {
                    if ($edit.Current.IsPassword) { $passwordCount++ }
                    if ($edit.Current.IsKeyboardFocusable) { $focusableCount++ }
                    $pattern = $null
                    if ($edit.TryGetCurrentPattern(
                        [System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern
                    )) { $valuePatternCount++ }
                }
                [pscustomobject]@{
                    Application = $processName
                    ProcessId = $target.Id
                    Version = $version
                    Status = 'ObservedWindow'
                    EditControls = $edits.Count
                    PasswordControls = $passwordCount
                    ValuePatternControls = $valuePatternCount
                    FocusableEditControls = $focusableCount
                }
            }
        } catch {
            $failedProcesses++
            # Do not expose exception messages: providers may include UI content.
            [pscustomobject]@{
                Application = $processName
                ProcessId = $target.Id
                Status = 'ProbeFailed'
                ErrorType = $_.Exception.GetType().FullName
            }
        }
    }
    if ($observedWindows -eq 0 -and $failedProcesses -eq 0) {
        [pscustomobject]@{
            Application = $processName
            Status = 'NoAccessibleTopLevelWindow'
            RunningProcesses = $targets.Count
        }
    }
}
@($reports) | ConvertTo-Json -Depth 3
