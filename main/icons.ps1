# Skyline: big, sharp icons (up to 256 px) for files, shortcuts and Start-menu apps, the way
# Explorer shows them. Reads one path per line on stdin; writes one line back for each:
#   <base64 PNG>   or   -   when there's no icon.
# A path may be "shell:AppsFolder\<AppID>" for a Start-menu app.
$CS = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace SkyIcons {
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }

  public static class Big {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

    public static string Png(string path, int px) {
      Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
      IShellItemImageFactory f;
      if (SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out f) != 0 || f == null) return null;
      IntPtr hb;
      if (f.GetImage(new SIZE { cx = px, cy = px }, 0x1 | 0x4, out hb) != 0 || hb == IntPtr.Zero) return null;   // BIGGERSIZEOK | ICONONLY
      try {
        BITMAP bm; GetObject(hb, Marshal.SizeOf(typeof(BITMAP)), out bm);
        if (bm.bmBits == IntPtr.Zero || bm.bmBitsPixel != 32) { using (var b0 = Image.FromHbitmap(hb)) return Save(b0); }
        int h = Math.Abs(bm.bmHeight);
        using (var b = new Bitmap(bm.bmWidth, h, bm.bmWidthBytes, PixelFormat.Format32bppArgb, bm.bmBits)) {
          var copy = new Bitmap(b);
          if (bm.bmHeight > 0) copy.RotateFlip(RotateFlipType.RotateNoneFlipY);   // bottom-up rows
          // trim fully transparent borders so small icons don't float in empty space
          using (copy) return Save(copy);
        }
      } finally { DeleteObject(hb); }
    }
    static string Save(Image img) { using (var ms = new MemoryStream()) { img.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); } }
  }
}
'@
try {
  Add-Type -AssemblyName System.Drawing
  $sha = [Security.Cryptography.SHA1]::Create()
  $tag = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($CS))).Replace('-', '').Substring(0, 12)
  $dll = Join-Path $PSScriptRoot "SkyIcons-$tag.dll"
  if (-not (Test-Path $dll)) {
    Get-ChildItem -Path $PSScriptRoot -Filter 'SkyIcons-*.dll' | Remove-Item -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $CS -Language CSharp -ReferencedAssemblies System.Drawing -OutputAssembly $dll -OutputType Library
  }
  Add-Type -Path $dll
} catch { [Console]::Out.WriteLine("!" + $_.Exception.Message); exit 1 }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Trim(); if (-not $p) { continue }
  $out = $null
  try { $out = [SkyIcons.Big]::Png($p, 256) } catch {}
  if ($out) { [Console]::Out.WriteLine($out) } else { [Console]::Out.WriteLine('-') }
}
