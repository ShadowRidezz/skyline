# Skyline's Windows helper. It talks to the app over stdin/stdout, one line per message:
#  - what's playing (Windows media controls: Spotify, browser tabs, Apple Music...), with cover art
#  - play / pause / skip / seek / shuffle / repeat, choosing which app to follow
#  - the system volume and mute
#  - the speaker level ~30x a second, for the music reactions (only while asked)
#  - network and disk numbers (only while asked)
#  - whether a full-screen game or video from another app is in front, so Skyline can rest
# It exits when its input closes, i.e. when Skyline exits.

$CS = @'
using System;
using System.Globalization;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace SkyHelper {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float levelDB, IntPtr ctx);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr ctx);
    [PreserveSig] int GetMasterVolumeLevel(out float levelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint ch, float levelDB, IntPtr ctx);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, IntPtr ctx);
    [PreserveSig] int GetChannelVolumeLevel(uint ch, out float levelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public static class Audio {
    static object Get(Guid iid) {
      var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
      IMMDevice d;
      if (e.GetDefaultAudioEndpoint(0, 1, out d) != 0 || d == null) return null;
      object o;
      if (d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
      return o;
    }
    static IAudioEndpointVolume Vol() { return Get(typeof(IAudioEndpointVolume).GUID) as IAudioEndpointVolume; }
    public static string State() {
      try {
        var v = Vol(); float f; bool m;
        if (v == null || v.GetMasterVolumeLevelScalar(out f) != 0) return "-1 0";
        v.GetMute(out m);
        return ((int)Math.Round(f * 100)).ToString(CultureInfo.InvariantCulture) + (m ? " 1" : " 0");
      } catch { return "-1 0"; }
    }
    public static void SetVolume(int p) {
      try { var v = Vol(); if (v == null) return;
        v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, p)) / 100f, IntPtr.Zero);
        if (p > 0) v.SetMute(false, IntPtr.Zero); } catch { }
    }
    public static void SetMute(bool m) { try { var v = Vol(); if (v != null) v.SetMute(m, IntPtr.Zero); } catch { } }

    public static volatile bool Fast;
    static Thread loop;
    public static void Start() {
      if (loop != null) return;
      loop = new Thread(Loop); loop.IsBackground = true; loop.SetApartmentState(ApartmentState.MTA); loop.Start();
    }
    static void Loop() {
      IAudioMeterInformation meter = null; DateTime opened = DateTime.MinValue, lastBeat = DateTime.MinValue;
      float env = 0, refv = 0.05f, fast = 0, slow = 0; int beats = 0;
      var inv = CultureInfo.InvariantCulture;
      while (true) {
        if (!Fast) { meter = null; Thread.Sleep(250); continue; }
        try {
          if (meter == null || (DateTime.UtcNow - opened).TotalSeconds > 5) {  // follows the default output device
            meter = Get(typeof(IAudioMeterInformation).GUID) as IAudioMeterInformation; opened = DateTime.UtcNow;
          }
          float p = 0;
          if (meter == null || meter.GetPeakValue(out p) != 0) { meter = null; Thread.Sleep(1000); continue; }
          p = Math.Max(0, Math.Min(1, p));
          env = Math.Max(p, env * 0.86f);
          refv = Math.Max(Math.Max(env, refv * 0.997f), 0.03f);  // the loudest recent part = 1, whatever the volume
          fast = fast * 0.6f + p * 0.4f; slow = slow * 0.97f + p * 0.03f;
          if (fast > slow * 1.45f && fast > 0.04f && (DateTime.UtcNow - lastBeat).TotalMilliseconds > 280) { beats++; lastBeat = DateTime.UtcNow; }
          Console.Out.WriteLine("L " + Math.Min(1f, env / refv).ToString("0.000", inv) + " " + beats.ToString(inv));
        } catch { meter = null; Thread.Sleep(1000); }
        Thread.Sleep(33);
      }
    }
  }

  public static class Sys {
    public static string Net() {
      long rx = 0, tx = 0;
      try {
        foreach (var n in NetworkInterface.GetAllNetworkInterfaces()) {
          if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback
              || n.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
          var s = n.GetIPv4Statistics(); rx += s.BytesReceived; tx += s.BytesSent;
        }
      } catch { }
      return rx.ToString(CultureInfo.InvariantCulture) + " " + tx.ToString(CultureInfo.InvariantCulture);
    }
    public static string Disk() {
      try { var d = new DriveInfo(Path.GetPathRoot(Environment.SystemDirectory));
        return d.TotalSize.ToString(CultureInfo.InvariantCulture) + " " + d.AvailableFreeSpace.ToString(CultureInfo.InvariantCulture); }
      catch { return "0 0"; }
    }

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cb; public RECT mon, work; public uint flags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);

    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
    // Minimise a program's visible windows without giving them the focus (e.g. Spotify, after a song link opened it).
    public static int Tuck(string process) {
      var ids = new System.Collections.Generic.HashSet<uint>();
      foreach (var p in System.Diagnostics.Process.GetProcessesByName(process)) ids.Add((uint)p.Id);
      int n = 0;
      EnumWindows((h, x) => {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (ids.Contains(pid) && IsWindowVisible(h) && !IsIconic(h) && GetWindowTextLength(h) > 0) { ShowWindow(h, 7); n++; }   // SW_SHOWMINNOACTIVE
        return true;
      }, IntPtr.Zero);
      return n;
    }

    static volatile int tuckUntil;
    public static void TuckFor(string process, int ms) {
      bool running = Environment.TickCount < tuckUntil;
      tuckUntil = Environment.TickCount + ms;
      if (running) return;
      var t = new Thread(() => { while (Environment.TickCount < tuckUntil) { try { Tuck(process); } catch { } Thread.Sleep(25); } });
      t.IsBackground = true; t.Start();
    }

    // The program whose window is in front (0 when there's none)
    public static uint ForegroundPid() {
      var h = GetForegroundWindow(); if (h == IntPtr.Zero) return 0;
      uint pid; GetWindowThreadProcessId(h, out pid); return pid;
    }
    // Another program's window covers a whole monitor (a game, a full-screen video).
    public static bool FullscreenOther(int ourPid) {
      var h = GetForegroundWindow(); if (h == IntPtr.Zero) return false;
      var sb = new StringBuilder(64); GetClassName(h, sb, 64); var c = sb.ToString();
      if (c == "WorkerW" || c == "Progman" || c == "Shell_TrayWnd") return false;
      uint pid; GetWindowThreadProcessId(h, out pid); if (pid == ourPid) return false;
      RECT r; if (!GetWindowRect(h, out r)) return false;
      var mi = new MONITORINFO(); mi.cb = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      return r.L <= mi.mon.L && r.T <= mi.mon.T && r.R >= mi.mon.R && r.B >= mi.mon.B;
    }
  }
}
'@

$ErrorActionPreference = 'Stop'
$skyPid = 0; [void][int]::TryParse([string]$env:SKY_PID, [ref]$skyPid)
function Out-Line([string]$s) { [Console]::Out.WriteLine($s) }
function Emit($o) {
  $j = ConvertTo-Json $o -Compress -Depth 5
  # ASCII only, so the console code page can never mangle a title
  Out-Line ([regex]::Replace($j, '[^\x20-\x7e]', { param($m) '\u{0:x4}' -f [int][char]$m.Value }))
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  # Compiling the C# part takes several seconds: do it once and keep the result next to this script.
  $sha = New-Object Security.Cryptography.SHA1Managed
  $tag = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($CS))).Replace('-', '').Substring(0, 12)
  $dll = Join-Path $PSScriptRoot "SkyHelper-$tag.dll"
  if (-not (Test-Path $dll)) {
    Get-ChildItem -Path $PSScriptRoot -Filter 'SkyHelper-*.dll' | Remove-Item -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $CS -Language CSharp -OutputAssembly $dll -OutputType Library
  }
  Add-Type -Path $dll
  [SkyHelper.Audio]::Start()
} catch { Emit @{ t = 'error'; where = 'native'; msg = [string]$_.Exception.Message }; exit 1 }

$mgr = $null
try {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]
  $II = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  # PowerShell can't call the cover stream's own methods, but .NET's wrapper can read it (via reflection).
  $asRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@($II))
  # (PowerShell names ignore case: these type names must not clash with $p, $s, $m... below)
  $TMgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $TProps = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $TStream = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
  function Await($op, [type]$t) {
    $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
    if ($task.Wait(4000)) { return $task.Result }
    return $null
  }
  $mgr = Await ($TMgr::RequestAsync()) $TMgr
} catch { Emit @{ t = 'error'; where = 'media'; msg = [string]$_.Exception.Message } }
$ErrorActionPreference = 'SilentlyContinue'

$pin = ''          # the app the user chose to follow ('' = whatever Windows picks)
function Pick() {
  if (-not $mgr) { return $null }
  if ($pin) { foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -eq $pin) { return $s } } }
  return $mgr.GetCurrentSession()
}

$stdin = [Console]::OpenStandardInput()
$buf = New-Object byte[] 4096
$read = $stdin.ReadAsync($buf, 0, 4096)
$pending = ''
$last = ''; $artKey = ''; $artTries = 0; $appsLast = ''; $volLast = ''; $fsLast = $null; $fgLast = -1
$tick = 100; $wantSys = $false; $n = 0
Emit @{ t = 'ready' }

while ($true) {
  if ($read.IsCompleted) {
    if ($read.IsFaulted -or $read.IsCanceled -or $read.Result -le 0) { break }
    $pending += [Text.Encoding]::UTF8.GetString($buf, 0, $read.Result)
    $read = $stdin.ReadAsync($buf, 0, 4096)
    while ($pending.Contains("`n")) {
      $i = $pending.IndexOf("`n"); $line = $pending.Substring(0, $i).Trim(); $pending = $pending.Substring($i + 1)
      $parts = $line.Split(' ', 2); $cmd = $parts[0]; $arg = ''; if ($parts.Count -gt 1) { $arg = $parts[1] }
      try {
        switch ($cmd) {
          'meter' { [SkyHelper.Audio]::Fast = ($arg -eq '1') }
          'sys'   { $wantSys = ($arg -eq '1') }
          'procs' {   # the running programs, for play time (cheaper here than starting a new PowerShell every minute)
            $pl = @(Get-CimInstance Win32_Process | ForEach-Object { $_.Name + [char]9 + $_.ExecutablePath + [char]9 + $_.ProcessId + [char]9 + $(if ($_.Name -match '^javaw?\.exe$') { $_.CommandLine } else { '' }) })
            Emit @{ t = 'procs'; id = $arg; list = $pl }
          }
          'vol'   { [SkyHelper.Audio]::SetVolume([int]$arg); $volLast = '' }
          'mute'  { [SkyHelper.Audio]::SetMute($arg -eq '1'); $volLast = '' }
          'pin'   { $pin = $arg; $artKey = ''; $last = '' }
          'refresh' { $last = ''; $artKey = ''; $appsLast = ''; $volLast = '' }
          'tuck'  { $tp = $arg.Split(' '); $ms = 3000; if ($tp.Count -gt 1) { $ms = [int]$tp[1] }; [SkyHelper.Sys]::TuckFor($tp[0], $ms) }
          default {
            $s = Pick
            if ($s) {
              switch ($cmd) {
                'toggle'  { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
                'play'    { $null = Await ($s.TryPlayAsync()) ([bool]) }
                'pause'   { $null = Await ($s.TryPauseAsync()) ([bool]) }
                'next'    { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
                'prev'    { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
                'seek'    { $null = Await ($s.TryChangePlaybackPositionAsync([long]([double]$arg * 10000000))) ([bool]) }
                'shuffle' { $null = Await ($s.TryChangeShuffleActiveAsync($arg -eq '1')) ([bool]) }
                'repeat'  { $null = Await ($s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode][int]$arg)) ([bool]) }
              }
            }
          }
        }
      } catch { }
      $tick = 3   # report the result shortly
    }
  }

  if ($tick -ge 5) {   # about twice a second
    $tick = 0; $n++
    try {
      $o = [ordered]@{ t = 'm'; on = $false }
      $s = Pick
      if ($s) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) $TProps
        $i = $s.GetPlaybackInfo()
        $tl = $s.GetTimelineProperties()
        $c = $i.Controls
        $o.on = $true
        $o.app = [string]$s.SourceAppUserModelId
        $o.title = [string]$p.Title
        $o.artist = [string]$p.Artist
        $o.album = [string]$p.AlbumTitle
        $o.status = [int]$i.PlaybackStatus
        $o.pos = [math]::Round($tl.Position.TotalSeconds, 2)
        $o.dur = [math]::Round($tl.EndTime.TotalSeconds, 2)
        $o.at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        $o.shuffle = $i.IsShuffleActive
        $o.repeat = $null; if ($null -ne $i.AutoRepeatMode) { $o.repeat = [int]$i.AutoRepeatMode }
        $o.can = @{ next = $c.IsNextEnabled; prev = $c.IsPreviousEnabled; seek = $c.IsPlaybackPositionEnabled; shuffle = $c.IsShuffleEnabled; repeat = $c.IsRepeatEnabled; pause = $c.IsPauseEnabled; play = $c.IsPlayEnabled }
        $key = $o.app + '|' + $o.title + '|' + $o.artist
        if ($key -ne $artKey) { $artKey = $key; $artTries = 0 }
        # Apps often publish the cover a moment after the title: keep asking for a few seconds.
        if ($artTries -ge 0 -and $artTries -lt 12 -and $p.Thumbnail) {
          $artTries++
          $st = Await ($p.Thumbnail.OpenReadAsync()) $TStream
          if ($st) {
            $net = $asRead.Invoke($null, @($st)); $ms = New-Object IO.MemoryStream; $net.CopyTo($ms); $net.Dispose()
            if ($ms.Length -gt 0 -and $ms.Length -lt 8MB) { $o.art = [Convert]::ToBase64String($ms.ToArray()); $artTries = -1 }
          }
        }
      }
      $j = ConvertTo-Json $o -Compress -Depth 5
      if ($j -ne $last) { $last = $j; Emit $o }

      if ($n % 6 -eq 1 -and $mgr) {   # every ~3 s: which apps are playing something
        $apps = @()
        foreach ($x in $mgr.GetSessions()) {
          $xp = Await ($x.TryGetMediaPropertiesAsync()) $TProps
          $apps += [ordered]@{ id = [string]$x.SourceAppUserModelId; title = [string]$xp.Title; artist = [string]$xp.Artist; status = [int]$x.GetPlaybackInfo().PlaybackStatus }
        }
        $aj = ConvertTo-Json @($apps) -Compress -Depth 4
        if ($aj -ne $appsLast) { $appsLast = $aj; Emit @{ t = 'apps'; list = @($apps); pin = $pin } }
      }
    } catch { }

    $v = [SkyHelper.Audio]::State()
    if ($v -ne $volLast) { $volLast = $v; $vp = $v.Split(' '); Emit @{ t = 'v'; vol = [int]$vp[0]; muted = ($vp[1] -eq '1') } }

    if ($n % 3 -eq 0) {
      $fs = [SkyHelper.Sys]::FullscreenOther($skyPid)
      if ($fs -ne $fsLast) { $fsLast = $fs; Emit @{ t = 'fs'; on = $fs } }
      $fp = [int][SkyHelper.Sys]::ForegroundPid()
      if ($fp -ne $fgLast) { $fgLast = $fp; Emit @{ t = 'fg'; pid = $fp } }
    }
    if ($wantSys -and $n % 4 -eq 0) {
      $nt = [SkyHelper.Sys]::Net().Split(' '); $dk = [SkyHelper.Sys]::Disk().Split(' ')
      Out-Line ('S ' + $nt[0] + ' ' + $nt[1] + ' ' + $dk[0] + ' ' + $dk[1])
    }
  }
  Start-Sleep -Milliseconds 100
  $tick++
}
