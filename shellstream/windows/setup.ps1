# ShellStream game host on a Windows machine with NVIDIA T4s (e.g. a cloud VM with 2x T4), for the official
# Roblox client or any other Windows game.  Run once, in an elevated PowerShell on that machine:
#
#     powershell -ExecutionPolicy Bypass -File windows\setup.ps1
#
# Before: the NVIDIA driver that makes the T4 a display adapter (your cloud's GRID / virtual-workstation or
# gaming driver), a 1920x1080 desktop, and the ShellStream folder copied to the machine.
# After: ShellStream starts at every logon of this user and streams the desktop over HTTPS with a token.
param(
    [int]$Port = 8765,
    [int]$Fps = 60,
    [int]$EncodeGpu = 1,          # the T4 that encodes (NVENC); the game renders on the display T4 (#0)
    [double]$Fov = 70,            # the game's vertical field of view (Roblox's default camera: 70)
    [string]$PythonVersion = "3.12.7"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # the shellstream folder

# 1. Python ---------------------------------------------------------------------------------------------------
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    $exe = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"
    Invoke-WebRequest "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" -OutFile $exe
    Start-Process $exe -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
$Python = (Get-Command python).Source

# 2. Packages: web server, H.264 (PyAV's FFmpeg, NVENC when the driver has it), DXGI capture, audio, TLS -----------
& $Python -m pip install --upgrade pip
& $Python -m pip install tornado numpy pillow simplejpeg av dxcam mss soundcard cryptography

# 3. Mouse: no pointer acceleration, so one mouse count turns the camera by the same angle every time ------------
#    (the calibrator measures a linear model; Windows' "Enhance pointer precision" bends it).  Applies at next logon.
Set-ItemProperty "HKCU:\Control Panel\Mouse" -Name MouseSpeed -Value "0"
Set-ItemProperty "HKCU:\Control Panel\Mouse" -Name MouseThreshold1 -Value "0"
Set-ItemProperty "HKCU:\Control Panel\Mouse" -Name MouseThreshold2 -Value "0"
Set-ItemProperty "HKCU:\Control Panel\Mouse" -Name MouseSensitivity -Value "10"

# 3b. Audio: Windows Server ships with the audio service disabled.  A VM without any sound device additionally
#     needs a virtual one (see windows/README.md), otherwise the stream is silent.
Set-Service -Name Audiosrv -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name Audiosrv -ErrorAction SilentlyContinue

# 4. Firewall (also open the port in your cloud provider's firewall / security group) ----------------------------
if (-not (Get-NetFirewallRule -DisplayName "ShellStream" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "ShellStream" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}

# 5. Access token: whoever has it controls this machine's mouse and keyboard.  Kept in a file only this user reads.
$Conf = Join-Path $env:USERPROFILE ".shellstream"
New-Item -ItemType Directory -Force -Path $Conf | Out-Null
$TokenFile = Join-Path $Conf "token.txt"
if (-not (Test-Path $TokenFile)) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=") | Set-Content -NoNewline $TokenFile
    icacls $TokenFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
}
$Token = (Get-Content $TokenFile -Raw).Trim()

# 6. Start at logon, in this user's interactive session (DXGI desktop capture needs it) -------------------------
$ServerArgs = "`"$Root\server.py`" --host --audio --tls --address 0.0.0.0 --port $Port --fps $Fps " +
              "--encode-gpu $EncodeGpu --fov $Fov --token `"@$TokenFile`""
$Action = New-ScheduledTaskAction -Execute $Python -Argument $ServerArgs -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "ShellStream" -Action $Action -Trigger $Trigger -Principal $Principal `
    -Settings $Settings -Force | Out-Null

# 7. Leaving Remote Desktop without locking the screen (a locked or disconnected session can't be captured) ------
$Bat = Join-Path ([Environment]::GetFolderPath("Desktop")) "Leave RDP, keep streaming.bat"
@"
@echo off
rem Moves this Remote Desktop session to the console: RDP disconnects, the desktop stays unlocked and streamable.
for /f "skip=1 tokens=3" %%s in ('query user %USERNAME%') do %windir%\System32\tscon.exe %%s /dest:console
"@ | Set-Content -Encoding ASCII $Bat

Write-Host ""
Write-Host "Done.  Log off and on again (or run the 'ShellStream' scheduled task), then open:"
Write-Host "    https://<this machine's public IP>:$Port/?token=$Token"
Write-Host "The browser warns about the self-signed certificate once; the fingerprint is in the server output."
Write-Host "Install and sign in to Roblox from that page (it streams the whole desktop), then play."
Write-Host "Before closing Remote Desktop, run 'Leave RDP, keep streaming' (as administrator) from the desktop."
