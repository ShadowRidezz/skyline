# Makes the phone app's backgrounds from Skyline's city photos: a tall phone-shaped crop (around each photo's
# focal point) and a small thumbnail, as light JPEGs, into mobile/src/img/bg. Run again after adding photos.
# powershell -File mobile\photos.ps1
Add-Type -AssemblyName System.Drawing
$src = Join-Path $PSScriptRoot "..\renderer\img\photos"
$out = Join-Path $PSScriptRoot "src\img\bg"
New-Item -ItemType Directory -Force $out | Out-Null
$jpg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
function Save($bmp, $path, $q) {
  $p = New-Object Drawing.Imaging.EncoderParameters 1
  $p.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]$q)
  $bmp.Save($path, $jpg, $p)
}
function Crop($img, $w, $h, $fx, $fy) {
  # the largest w:h window inside the photo, centred on the focal point (fx, fy as 0..1), scaled to w x h
  $r = $w / $h
  if ($img.Width / $img.Height -gt $r) { $ch = $img.Height; $cw = [int]($ch * $r) } else { $cw = $img.Width; $ch = [int]($cw / $r) }
  $x = [Math]::Min([Math]::Max(0, [int]($img.Width * $fx - $cw / 2)), $img.Width - $cw)
  $y = [Math]::Min([Math]::Max(0, [int]($img.Height * $fy - $ch / 2)), $img.Height - $ch)
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = "HighQualityBicubic"; $g.SmoothingMode = "HighQuality"; $g.PixelOffsetMode = "HighQuality"
  $g.DrawImage($img, (New-Object Drawing.Rectangle 0, 0, $w, $h), (New-Object Drawing.Rectangle $x, $y, $cw, $ch), [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); return $bmp
}
# name = file, then the focal point (where the city is busiest)
$photos = @{ "your-view" = @(.5, .5); "kanda" = @(.5, .55); "akiba" = @(.5, .55); "kiyosu" = @(.5, .5); "umeda" = @(.5, .5); "osaka" = @(.5, .6); "shinjuku" = @(.5, .55); "seoul" = @(.5, .55); "tokyoair" = @(.5, .5) }
foreach ($n in $photos.Keys) {
  $img = [Drawing.Image]::FromFile((Join-Path $src "$n.jpg"))
  $f = $photos[$n]
  $big = Crop $img 900 1600 $f[0] $f[1]; Save $big (Join-Path $out "$n.jpg") 74; $big.Dispose()
  $th = Crop $img 180 280 $f[0] $f[1]; Save $th (Join-Path $out "$n-s.jpg") 70; $th.Dispose()
  $img.Dispose()
  "$n done"
}
