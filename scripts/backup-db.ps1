$ErrorActionPreference = "Stop"

$raw = Get-Content .env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=\s*"?([^"]+)"?' }
if (-not $raw) { throw "DATABASE_URL tidak ditemukan di .env" }
$url = [Uri]($raw -replace '^\s*DATABASE_URL\s*=\s*"?([^"]+)"?', '$1')
$user = [Uri]::UnescapeDataString($url.UserInfo.Split(":", 2)[0])
$pass = if ($url.UserInfo.Contains(":")) { [Uri]::UnescapeDataString($url.UserInfo.Split(":", 2)[1]) } else { "" }
$hostName = $url.Host
$port = if ($url.IsDefaultPort) { 3306 } else { $url.Port }
$database = $url.AbsolutePath.Trim("/")

if (-not $database) { throw "Nama database tidak ditemukan di DATABASE_URL" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Path "backups" -Force | Out-Null
$target = Join-Path "backups" "keuangan-$stamp.sql"

$env:MYSQL_PWD = $pass
try {
  $mysqldump = Get-Command mysqldump -ErrorAction SilentlyContinue
  if ($mysqldump) {
    $lines = & $mysqldump.Source --host=$hostName --port=$port --user=$user --single-transaction --routines --triggers $database
  } else {
    $lines = docker compose exec -T -e MYSQL_PWD=$pass mysql mysqldump --user=$user --single-transaction --routines --triggers $database
  }
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}

[IO.File]::WriteAllLines((Join-Path (Get-Location) $target), $lines, [Text.UTF8Encoding]::new($false))
Write-Host "Backup tersimpan di $target"
