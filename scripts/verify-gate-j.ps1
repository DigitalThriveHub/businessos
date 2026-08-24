param([switch]$ApplyMigration, [switch]$RequireLiveGateJ)
$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { chcp.com 65001 > $null }
function Check([string]$step) { if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." } }
function Require-Value([string]$name) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required for the live Gate J acceptance run."
  }
}
function Import-DotEnvValue([string]$path, [string]$name) {
  if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { return }
  if (-not (Test-Path -LiteralPath $path)) { return }
  $pattern = "^\s*$([regex]::Escape($name))\s*="
  $line = Get-Content -LiteralPath $path | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if (-not $line) { return }
  $value = $line.Substring($line.IndexOf("=") + 1).Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}
if ($RequireLiveGateJ) {
  $webEnvironment = Join-Path $web ".env.local"
  $apiEnvironment = Join-Path $api ".env"
  foreach ($name in @("E2E_CASE_USER_EMAIL","E2E_CASE_USER_PASSWORD","E2E_CASE_USER_TOTP_SECRET")) {
    Import-DotEnvValue $webEnvironment $name
  }
  Import-DotEnvValue $apiEnvironment "INTEGRATION_SIGNING_MASTER_SECRET"
  foreach ($name in @("E2E_CASE_USER_EMAIL","E2E_CASE_USER_PASSWORD","E2E_CASE_USER_TOTP_SECRET","INTEGRATION_SIGNING_MASTER_SECRET")) { Require-Value $name }
}

Set-Location $api
npx prettier --write "src/pilot-readiness/**/*.ts" "src/app.module.ts"
Check "API formatting"
npm test -- --runInBand
Check "API tests"
npm run build
Check "API build"

Set-Location $web
npm run lint
Check "Web lint"
$previousNodeEnvironment = $env:NODE_ENV
try {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  npm run build
  Check "Web build"
} finally {
  if ($null -eq $previousNodeEnvironment) { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue } else { $env:NODE_ENV = $previousNodeEnvironment }
}
npx playwright test e2e/pilot-readiness.spec.ts --project=chromium --list
Check "Gate J browser compilation"

Set-Location $project
npx supabase db push --dry-run --linked
Check "Migration dry-run"
if (-not $ApplyMigration) { Write-Output "Gate J code gates passed; migration was not applied."; exit 0 }
npx supabase db push --linked
Check "Gate J migration"

Set-Location $web
$output = @(); $previousErrorAction = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  & npx playwright test `
    e2e/auth-enquiries.spec.ts `
    e2e/case-operations.spec.ts `
    e2e/automation-control.spec.ts `
    e2e/communications.spec.ts `
    e2e/client-portal.spec.ts `
    e2e/finance.spec.ts `
    e2e/integrations-command-centre.spec.ts `
    e2e/service-lifecycle.spec.ts `
    e2e/service-lifecycle-end-to-end.spec.ts `
    e2e/universal-intake.spec.ts `
    e2e/pilot-readiness.spec.ts `
    --project=chromium --workers=1 2>&1 | Tee-Object -Variable output
  $code = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorAction }
if ($code -ne 0) { throw "Gate J critical browser tests failed." }
if ($RequireLiveGateJ -and (($output | Out-String) -match '(?im)^\s*\d+\s+skipped(?:\s|$)')) {
  throw "Live Gate J acceptance cannot contain skipped tests."
}
Write-Output "Gate J verification completed successfully."
