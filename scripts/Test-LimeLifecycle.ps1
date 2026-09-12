# Exercises only this project's desktop window; no UIA, clipboard or input injection.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = (Resolve-Path (Join-Path $projectRoot 'target\debug\until-a-lime.exe')).Path
function Get-LimeInstances {
    @(Get-Process -Name 'until-a-lime' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $executable })
}
$instances = Get-LimeInstances
if ($instances.Count -ne 1) { throw 'Start exactly one newly built desktop preview before testing.' }
$originalId = $instances[0].Id
if (-not ('LimeLifecycleWindows' -as [type])) {
    Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LimeLifecycleWindows {
    private delegate bool Callback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    public static IntPtr MainWindow(uint pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((hwnd, data) => {
            uint owner; GetWindowThreadProcessId(hwnd, out owner);
            if (owner == pid) {
                var title = new StringBuilder(256); GetWindowText(hwnd, title, title.Capacity);
                if (title.ToString() == "直到密码变成一颗酸橙 · 开发预览") result = hwnd;
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    public static bool RequestClose(IntPtr hwnd) { return PostMessageW(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@
}
$window = [LimeLifecycleWindows]::MainWindow($originalId)
if ($window -eq [IntPtr]::Zero) { throw 'Expected project main window not found.' }
if (-not [LimeLifecycleWindows]::RequestClose($window)) { throw 'Could not request main-window close.' }
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ([LimeLifecycleWindows]::IsWindowVisible($window) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
if ([LimeLifecycleWindows]::IsWindowVisible($window)) { throw 'Close did not hide the main window.' }
try {
    foreach ($attempt in 1..2) {
        $second = Start-Process -FilePath $executable -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        if (-not $second.WaitForExit(5000)) { throw 'Second launch did not exit within five seconds.' }
        if ($second.ExitCode -ne 0) { throw "Second launch failed: $($second.ExitCode)." }
        $remaining = Get-LimeInstances
        if ($remaining.Count -ne 1 -or $remaining[0].Id -ne $originalId) { throw 'Original single instance was not preserved.' }
        if (-not [LimeLifecycleWindows]::IsWindowVisible($window)) { throw 'Second launch did not restore the hidden main window.' }
    }
    Write-Output 'PASS: main close hides; two repeat launches exit successfully, preserve original PID, and restore the same window.'
    Write-Output 'The app remains running. Vault lock rendering and tray interaction require visual verification.'
} finally {
    # Restore through the public launch flow if an assertion failed while hidden.
    if (-not [LimeLifecycleWindows]::IsWindowVisible($window)) {
        Start-Process -FilePath $executable -WorkingDirectory $projectRoot -WindowStyle Hidden
    }
}
