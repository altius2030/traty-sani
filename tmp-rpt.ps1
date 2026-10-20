# Open report and screenshot. Temp file, ASCII only.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class UIX {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.ProcessName -ne "electron" } |
  ForEach-Object { [UIX]::ShowWindow($_.MainWindowHandle, 6) | Out-Null }

$ids = (Get-Process electron).Id
$script:w = $null
$cb = [UIX+CB]{
  param($h, $l)
  $pid2 = 0
  [UIX]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ($ids -contains $pid2 -and [UIX]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [UIX]::GetWindowText($h, $sb, 256) | Out-Null
    if ($sb.Length -gt 0) {
      $r = New-Object UIX+RECT
      [UIX]::GetWindowRect($h, [ref]$r) | Out-Null
      $ww = $r.R - $r.L; $hh = $r.B - $r.T
      if ($ww -gt 900 -and $hh -gt 600) { $script:w = @{ H=$h; L=$r.L; T=$r.T; W=$ww; Ht=$hh } }
    }
  }
  return $true
}
[UIX]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if (-not $script:w) { Write-Output "WINDOW NOT FOUND"; exit 1 }
$w = $script:w
function Focus {
  [UIX]::ShowWindow($w.H, 9) | Out-Null
  [UIX]::BringWindowToTop($w.H) | Out-Null
  [UIX]::SetForegroundWindow($w.H) | Out-Null
  Start-Sleep -Milliseconds 600
}
function Tap($ox, $oy) {
  [UIX]::SetCursorPos($w.L + $ox, $w.T + $oy) | Out-Null
  Start-Sleep -Milliseconds 500
  [UIX]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 200
  [UIX]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 1800
}
function Snap($name) {
  $out = "C:\Users\user\AppData\Local\Temp\opencode\$name.png"
  $bmp = New-Object System.Drawing.Bitmap $w.W, $w.Ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($w.L, $w.T, 0, 0, $bmp.Size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "SHOT $name"
}
Focus
Tap 44 18      # File
Tap 112 157    # Report
Snap "rpt1_main"
Write-Output "DONE"