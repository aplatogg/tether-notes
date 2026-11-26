# scripts/backup-supabase-to-c.ps1
# 1-Click & Scheduled CLI Backup for Tether Notes -> C:\Users\<User>\AppData\Local\com.tethernotes.app\backups\
# Usage:
#   1) Run backup immediately:
#      pwsh -File scripts\backup-supabase-to-c.ps1 -Email "your@email.com" -Password "your-password"
#   2) Register automatic Windows Scheduled Task (runs every 30 minutes in background):
#      pwsh -File scripts\backup-supabase-to-c.ps1 -Email "your@email.com" -Password "your-password" -RegisterScheduledTask

param(
  [string]$Email = $env:TETHER_BACKUP_EMAIL,
  [string]$Password = $env:TETHER_BACKUP_PASSWORD,
  [string]$SupabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL,
  [string]$SupabaseAnonKey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY,
  [switch]$RegisterScheduledTask
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.local"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ((-not $SupabaseUrl) -and ($_ -match '^NEXT_PUBLIC_SUPABASE_URL=(.+)$')) {
      $SupabaseUrl = $Matches[1].Trim()
    }
    if ((-not $SupabaseAnonKey) -and ($_ -match '^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$')) {
      $SupabaseAnonKey = $Matches[1].Trim()
    }
    if ((-not $Email) -and ($_ -match '^TETHER_BACKUP_EMAIL=(.+)$')) {
      $Email = $Matches[1].Trim()
    }
    if ((-not $Password) -and ($_ -match '^TETHER_BACKUP_PASSWORD=(.+)$')) {
      $Password = $Matches[1].Trim()
    }
  }
}

$backupDir = Join-Path $env:LOCALAPPDATA "com.tethernotes.app\backups"
if (-not (Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

if ($RegisterScheduledTask) {
  $taskName = "TetherNotes-LocalBackup-C"
  $scriptPath = $MyInvocation.MyCommand.Path
  $action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -WindowStyle Hidden -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description "Auto-sync Tether Notes from Supabase to C:\ AppLocalData backups" -Force | Out-Null
  Write-Output "Registered Windows Scheduled Task '$taskName' (every 30 minutes) -> $backupDir"
}

if ((-not $SupabaseUrl) -or (-not $SupabaseAnonKey)) {
  throw "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
}
if ((-not $Email) -or (-not $Password)) {
  throw "Provide -Email and -Password (or set TETHER_BACKUP_EMAIL and TETHER_BACKUP_PASSWORD in .env.local)."
}

$authRes = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $SupabaseAnonKey; "Content-Type" = "application/json" } `
  -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)

$token = $authRes.access_token
if (-not $token) {
  throw "Supabase login did not return an access_token."
}

$notes = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/notes?select=*&order=updated_at.desc" `
  -Headers @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $token" }

$dateStamp = (Get-Date).ToString("yyyy-MM-dd")
$exportPayload = @{
  version = 1
  exportedAt = (Get-Date).ToUniversalTime().ToString("o")
  count = @($notes).Count
  notes = @($notes)
} | ConvertTo-Json -Depth 10

$livePath = Join-Path $backupDir "tether-notes-live.json"
$dailyPath = Join-Path $backupDir "tether-notes-$dateStamp.json"

Set-Content -Path $livePath -Value $exportPayload -Encoding UTF8
Set-Content -Path $dailyPath -Value $exportPayload -Encoding UTF8

Write-Output "Backed up $(@($notes).Count) notes from Supabase ->"
Write-Output "  Live:  $livePath"
Write-Output "  Daily: $dailyPath"
