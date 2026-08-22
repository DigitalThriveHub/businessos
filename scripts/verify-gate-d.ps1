param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateD
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$webEnvironmentFile = Join-Path $web ".env.local"

function Assert-LastExitCode {
  param([Parameter(Mandatory = $true)][string]$Step)

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

function Assert-EnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value) -and (Test-Path -LiteralPath $webEnvironmentFile)) {
    $prefix = "$Name="
    $line = Get-Content -LiteralPath $webEnvironmentFile |
      Where-Object { $_.TrimStart().StartsWith($prefix) } |
      Select-Object -Last 1

    if ($line) {
      $value = $line.Trim().Substring($prefix.Length).Trim().Trim('"').Trim("'")
    }
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is required for the live Gate D acceptance run."
  }
}

if (-not (Test-Path -LiteralPath $api) -or -not (Test-Path -LiteralPath $web)) {
  throw "Run this script from an intact BusinessOS project overlay."
}

if ($RequireLiveGateD) {
  @(
    "E2E_USER_EMAIL",
    "E2E_USER_PASSWORD",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET",
    "E2E_PORTAL_USER_EMAIL",
    "E2E_PORTAL_USER_PASSWORD"
  ) | ForEach-Object { Assert-EnvironmentValue -Name $_ }
}

Set-Location $api

npx prettier --write `
  "src/communications/**/*.ts" `
  "src/client-portal/**/*.ts" `
  "src/app.module.ts" `
  "src/main.ts" `
  "src/config/env.validation.ts" `
  "src/notifications/email.service.ts" `
  "src/rbac/default-permissions.ts" `
  "src/rbac/default-roles.ts"
Assert-LastExitCode -Step "API formatting"

npx prisma format
Assert-LastExitCode -Step "Prisma formatting"

npx prisma validate
Assert-LastExitCode -Step "Prisma validation"

npx prisma generate
Assert-LastExitCode -Step "Prisma generation"

npm test -- --runInBand
Assert-LastExitCode -Step "API tests"

npm run build
Assert-LastExitCode -Step "API build"

Set-Location $web

npm run lint
Assert-LastExitCode -Step "Web lint"

npm run build
Assert-LastExitCode -Step "Web build"

npx playwright test `
  e2e/auth-enquiries.spec.ts `
  e2e/case-operations.spec.ts `
  e2e/automation-control.spec.ts `
  e2e/communications.spec.ts `
  e2e/client-portal.spec.ts `
  --project=chromium `
  --list
Assert-LastExitCode -Step "Playwright compilation"

Set-Location $project

npx supabase db push --dry-run --linked
Assert-LastExitCode -Step "Supabase migration dry-run"

if (-not $ApplyMigration) {
  Write-Output "Gate D code gates and migration dry-run passed."
  Write-Output "No remote migration was applied. Re-run with -ApplyMigration when ready."
  exit 0
}

npx supabase db push --linked
Assert-LastExitCode -Step "Gate D migration"

npx supabase migration list --linked
Assert-LastExitCode -Step "Migration verification"

Set-Location $api

"SELECT * FROM private.process_automation_cycle(50);" |
  npx prisma db execute --stdin
Assert-LastExitCode -Step "Automation worker database smoke test"

Set-Location $web

$playwrightExitCode = 1
$playwrightOutput = @()
$previousErrorActionPreference = $ErrorActionPreference
try {
  # Windows PowerShell 5.1 promotes native stderr to ErrorRecord objects.
  # Capture the complete Playwright/Nest output while retaining the real exit code.
  $ErrorActionPreference = "Continue"
  & npx playwright test `
    e2e/auth-enquiries.spec.ts `
    e2e/case-operations.spec.ts `
    e2e/automation-control.spec.ts `
    e2e/communications.spec.ts `
    e2e/client-portal.spec.ts `
    --project=chromium `
    --workers=1 2>&1 | Tee-Object -Variable playwrightOutput

  $playwrightExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

if ($playwrightExitCode -ne 0) {
  throw "Critical browser tests failed with exit code $playwrightExitCode."
}

$playwrightSummary = $playwrightOutput | Out-String
if (
  $RequireLiveGateD -and
  $playwrightSummary -match '(?im)^\s*\d+\s+skipped(?:\s|$)'
) {
  throw "Live Gate D acceptance cannot contain skipped critical browser tests."
}

if ($RequireLiveGateD) {
  Write-Output "Gate D credential preflight and critical browser tests passed with no skips."
} else {
  Write-Warning "Browser tests may contain environment-controlled skips. Do not claim live portal acceptance until -RequireLiveGateD passes with a provisioned staging client."
}

Write-Output "Gate D verification completed successfully."
