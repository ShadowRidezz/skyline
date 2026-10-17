# Publish a Skyline update: builds the installer, then uploads it (with latest.yml and the blockmap) as a GitHub
# release on ShadowRidezz/skyline-releases. Every installed Skyline (yours and your friends') picks it up by itself.
# Needs GH_TOKEN (set once with: setx GH_TOKEN "your token"). Bump "version" in package.json first.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$token = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User"); if (-not $token) { throw "GH_TOKEN isn't set" }
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
$H = @{ Authorization = "Bearer $token"; "User-Agent" = "skyline-release" }
$api = "https://api.github.com/repos/ShadowRidezz/skyline-releases"

node mobile/build.mjs   # (the phone app in docs/, same version; it goes live when the code is pushed)
if ($LASTEXITCODE) { throw "Phone app build failed" }
npx electron-builder --win nsis --publish never
if ($LASTEXITCODE) { throw "Build failed" }

$exe = "dist\Skyline Setup $ver.exe"
if (-not (Test-Path "dist\latest.yml")) { throw "latest.yml wasn't made" }
try { $rel = Invoke-RestMethod "$api/releases/tags/v$ver" -Headers $H } catch { $rel = $null }
if (-not $rel) { $rel = Invoke-RestMethod -Method Post "$api/releases" -Headers $H -ContentType "application/json" -Body (@{ tag_name = "v$ver"; name = "Skyline $ver"; body = "Skyline $ver. Installed copies update by themselves." } | ConvertTo-Json) }
foreach ($f in @($exe, "$exe.blockmap", "dist\latest.yml")) {
  $name = (Split-Path $f -Leaf) -replace ' ', '-'
  $old = $rel.assets | Where-Object { $_.name -eq $name }
  if ($old) { Invoke-RestMethod -Method Delete "$api/releases/assets/$($old.id)" -Headers $H | Out-Null }
  Invoke-RestMethod -Method Post ($rel.upload_url -replace '\{.*\}', "?name=$name") -Headers $H -InFile $f -ContentType "application/octet-stream" | Out-Null
  "uploaded $name"
}
"Published Skyline ${ver}: https://github.com/ShadowRidezz/skyline-releases/releases/tag/v$ver"

# keep the GitHub page current: the version on the README, then push the code (and the phone app in docs/)
# (read and written as UTF-8: Windows PowerShell's default turned "…" into "â€¦" on every release)
$readme = [IO.File]::ReadAllText("$PSScriptRoot\README.md", [Text.Encoding]::UTF8)
$readme = $readme -replace '<!-- version -->.*?<!-- /version -->', "<!-- version -->**Latest version: $ver**<!-- /version -->"
[IO.File]::WriteAllText("$PSScriptRoot\README.md", $readme, (New-Object Text.UTF8Encoding $false))
git add -A
git commit -q -m "Skyline $ver"
git push -q origin HEAD
"Pushed the code and README for $ver"
