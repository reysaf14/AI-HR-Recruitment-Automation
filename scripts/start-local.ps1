$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$localEnvPath = Join-Path $projectRoot 'config\.env.local'
$localN8nFolder = Join-Path $projectRoot '.n8n-local'

if (-not (Test-Path -LiteralPath $localEnvPath)) {
  throw "File konfigurasi lokal tidak ditemukan: $localEnvPath"
}

foreach ($line in Get-Content -LiteralPath $localEnvPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) { continue }
  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim()
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

$env:N8N_USER_FOLDER = $localN8nFolder
New-Item -ItemType Directory -Path $localN8nFolder -Force | Out-Null

Write-Host "Starting local n8n with data folder: $localN8nFolder"
Write-Host "Open: http://localhost:$($env:N8N_PORT)"
Write-Host "LLM key configured: $([bool]$env:LLM_API_KEY)"

n8n start
