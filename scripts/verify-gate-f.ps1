param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateF
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

chcp.com 65001 > $null
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$wordpressPlugin = Join-Path $project "integrations\wordpress\businessos-secure-intake\businessos-secure-intake.php"
$apiEnvironmentFile = Join-Path $api ".env"
$webEnvironmentFile = Join-Path $web ".env.local"

function Assert-LastExitCode {
  param([Parameter(Mandatory = $true)][string]$Step)

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

function Read-EnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Files
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    return $value
  }

  foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $prefix = "$Name="
    $line = Get-Content -LiteralPath $file |
      Where-Object { $_.TrimStart().StartsWith($prefix) } |
      Select-Object -Last 1
    if ($line) {
      $value = $line.Trim().Substring($prefix.Length).Trim().Trim('"').Trim("'")
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    }
  }

  return $null
}

function Assert-EnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Files
  )

  $value = Read-EnvironmentValue -Name $Name -Files $Files
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is required for the live Gate F acceptance run."
  }
}

if (-not (Test-Path -LiteralPath $api) -or -not (Test-Path -LiteralPath $web)) {
  throw "Run this script from an intact BusinessOS project overlay."
}

if (-not (Test-Path -LiteralPath $wordpressPlugin)) {
  throw "The Gate F WordPress secure-intake plugin is missing."
}

$php = Get-Command php -ErrorAction SilentlyContinue
if ($php) {
  & $php.Source -l $wordpressPlugin
  Assert-LastExitCode -Step "WordPress connector PHP syntax"
} else {
  Write-Warning "PHP CLI is unavailable; run php -l against the WordPress connector on the staging host before activation."
}

if ($RequireLiveGateF) {
  @(
    "E2E_USER_EMAIL",
    "E2E_USER_PASSWORD",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET",
    "E2E_PORTAL_USER_EMAIL",
    "E2E_PORTAL_USER_PASSWORD"
  ) | ForEach-Object {
    Assert-EnvironmentValue -Name $_ -Files @($webEnvironmentFile)
  }

  @(
    "DATABASE_URL",
    "TRUST_PROXY_HOPS",
    "WEB_APP_URL",
    "INTEGRATION_SIGNING_MASTER_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PLATFORM_ACCOUNT_ID",
    "STRIPE_API_VERSION"
  ) | ForEach-Object {
    Assert-EnvironmentValue -Name $_ -Files @($apiEnvironmentFile)
  }
}

Set-Location $api

npx prettier --write `
  "src/integrations/**/*.ts" `
  "src/payments/**/*.ts" `
  "src/command-centre/**/*.ts" `
  "src/config/env.validation.ts" `
  "src/config/env.validation.spec.ts" `
  "src/main.ts" `
  "src/app.module.ts" `
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

$criticalSpecs = @(
  "e2e/auth-enquiries.spec.ts",
  "e2e/case-operations.spec.ts",
  "e2e/automation-control.spec.ts",
  "e2e/communications.spec.ts",
  "e2e/client-portal.spec.ts",
  "e2e/finance.spec.ts",
  "e2e/integrations-command-centre.spec.ts"
)

npx playwright test $criticalSpecs --project=chromium --list
Assert-LastExitCode -Step "Playwright compilation"

Set-Location $project

npx supabase db push --dry-run --linked
Assert-LastExitCode -Step "Supabase migration dry-run"

if (-not $ApplyMigration) {
  Write-Output "Gate F code gates and migration dry-run passed."
  Write-Output "No remote migration was applied. Re-run with -ApplyMigration when ready."
  exit 0
}

npx supabase db push --linked
Assert-LastExitCode -Step "Gate F migration"

npx supabase migration list --linked
Assert-LastExitCode -Step "Migration verification"

Set-Location $web

$playwrightExitCode = 1
$playwrightOutput = @()
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  & npx playwright test $criticalSpecs `
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
  $RequireLiveGateF -and
  $playwrightSummary -match '(?im)^\s*\d+\s+skipped(?:\s|$)'
) {
  throw "Live Gate F acceptance cannot contain skipped critical browser tests."
}

if ($RequireLiveGateF) {
  Write-Output "Gate F credential preflight and critical browser tests passed with no skips."
} else {
  Write-Warning "Browser tests may contain environment-controlled skips. Do not claim live Gate F acceptance until -RequireLiveGateF passes."
}

Write-Output "Gate F verification completed successfully."
Write-Output "Complete the Stripe test-mode settlement and production controls in docs\GATE-F-ACCEPTANCE.md before production approval."
