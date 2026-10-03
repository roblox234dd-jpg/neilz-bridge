param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RobloxCaptureWindow {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
if ($ValidateOnly) {
 $width=320; $height=240; $ratio=1.0
 $sample = New-Object System.Drawing.Bitmap([int][Math]::Max(1,[Math]::Round($width*$ratio)),[int][Math]::Max(1,[Math]::Round($height*$ratio)))
 $sampleStream = New-Object System.IO.MemoryStream
 try { $sample.Save($sampleStream,[System.Drawing.Imaging.ImageFormat]::Png); if ($sampleStream.Length -lt 8) { throw 'PNG encoding failed' } }
 finally { $sample.Dispose(); $sampleStream.Dispose() }
 Write-Output 'Capture API and PNG encoding validated without capturing the screen'; exit 0
}
$null = [RobloxCaptureWindow]::SetProcessDPIAware()
$window = [RobloxCaptureWindow]::GetForegroundWindow()
[uint32]$robloxProcessId = 0
$null = [RobloxCaptureWindow]::GetWindowThreadProcessId($window, [ref]$robloxProcessId)
$process = Get-Process -Id $robloxProcessId
if ($process.ProcessName -notin @('RobloxPlayerBeta','RobloxStudioBeta')) { throw 'Bring the Roblox window to the foreground before requesting a screenshot.' }
if ([RobloxCaptureWindow]::IsIconic($window)) { throw 'Roblox is minimized.' }
$rect = New-Object RobloxCaptureWindow+RECT
$origin = New-Object RobloxCaptureWindow+POINT
if (-not [RobloxCaptureWindow]::GetClientRect($window,[ref]$rect) -or -not [RobloxCaptureWindow]::ClientToScreen($window,[ref]$origin)) { throw 'Unable to locate Roblox client area.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 1 -or $height -lt 1 -or $width -gt 8192 -or $height -gt 8192) { throw 'Invalid Roblox window dimensions.' }
$bitmap = $null; $graphics = $null; $scaled = $null; $scaleGraphics = $null; $stream = $null
try {
 $bitmap = New-Object System.Drawing.Bitmap($width,$height)
 $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
 if ([RobloxCaptureWindow]::GetForegroundWindow() -ne $window) { throw 'Foreground window changed; screenshot cancelled.' }
 $graphics.CopyFromScreen($origin.X,$origin.Y,0,0,$bitmap.Size)
 if ([RobloxCaptureWindow]::GetForegroundWindow() -ne $window) { throw 'Foreground window changed; screenshot discarded.' }
 $ratio = [Math]::Min(1.0,1440.0/[Math]::Max($width,$height))
 $scaled = New-Object System.Drawing.Bitmap([int][Math]::Max(1,[Math]::Round($width*$ratio)),[int][Math]::Max(1,[Math]::Round($height*$ratio)))
 $scaleGraphics = [System.Drawing.Graphics]::FromImage($scaled)
 $scaleGraphics.DrawImage($bitmap,0,0,$scaled.Width,$scaled.Height)
 $stream = New-Object System.IO.MemoryStream
 $scaled.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
 $bytes = $stream.ToArray()
 if ($bytes.Length -gt 4MB) { throw 'Screenshot exceeds 4 MiB.' }
 Write-Output ([Convert]::ToBase64String($bytes))
} finally {
 foreach ($resource in @($graphics,$scaleGraphics,$bitmap,$scaled,$stream)) { if ($null -ne $resource) { $resource.Dispose() } }
}
