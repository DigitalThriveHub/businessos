param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateL
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$apiEnvironment = Join-Path $api ".env"
$webEnvironment = Join-Path $web ".env.local"
$enumMigration = Join-Path $project "supabase\migrations\20260825115000_gate_l_enum_evolution.sql"
$schemaMigration = Join-Path $project "supabase\migrations\20260825120000_gate_l_live_communications_calendar.sql"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { chcp.com 65001 > $null }

function Check([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}

function Import-DotEnvValue([string]$path, [string]$name) {
  if (-not [string]::IsNullOrWhiteSpace(
    [Environment]::GetEnvironmentVariable($name)
  )) { return }
  if (-not (Test-Path -LiteralPath $path)) { return }

  $pattern = "^\s*$([regex]::Escape($name))\s*="
  $line = Get-Content -LiteralPath $path |
    Where-Object { $_ -match $pattern } |
    Select-Object -Last 1
  if (-not $line) { return }

  $value = $line.Substring($line.IndexOf("=") + 1).Trim()
  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Require-Value([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for live Gate L acceptance."
  }
  if ($value -match '(?i)(replace|changeme|your-|example\.(com|co\.uk)|vreplace)') {
    throw "$name still contains a placeholder value."
  }
}

function Assert-ProviderConfiguration {
  Require-Value "GATE_L_PROVIDER_SECRETS_JSON"
  try {
    $providerMap = $env:GATE_L_PROVIDER_SECRETS_JSON | ConvertFrom-Json
  } catch {
    throw "GATE_L_PROVIDER_SECRETS_JSON is not valid JSON."
  }
  if ($null -eq $providerMap -or $providerMap -is [Array]) {
    throw "GATE_L_PROVIDER_SECRETS_JSON must be an object keyed by secret reference."
  }
  $entries = @($providerMap.PSObject.Properties | ForEach-Object { $_.Value })
  if ($entries.Count -lt 2) {
    throw "Live Gate L requires an email/calendar provider and WhatsApp Business."
  }
  $mail = @($entries | Where-Object {
    $_.provider -in @("MICROSOFT_365", "GOOGLE_WORKSPACE")
  })
  $whatsApp = @($entries | Where-Object {
    $_.provider -eq "WHATSAPP_BUSINESS"
  })
  if ($mail.Count -lt 1 -or $whatsApp.Count -lt 1) {
    throw "Configure Microsoft 365 or Google Workspace plus WhatsApp Business."
  }
  foreach ($entry in $entries) {
    if ($entry.provider -eq "MICROSOFT_365") {
      foreach ($field in @(
        "tenantId", "clientId", "clientSecret", "mailboxUserId", "webhookClientState"
      )) {
        if ([string]::IsNullOrWhiteSpace($entry.$field)) {
          throw "The Microsoft 365 secret is missing $field."
        }
      }
    } elseif ($entry.provider -eq "GOOGLE_WORKSPACE") {
      foreach ($field in @(
        "clientId", "clientSecret", "refreshToken", "mailboxAddress",
        "pubsubAudience", "pubsubServiceAccountEmail", "calendarId"
      )) {
        if ([string]::IsNullOrWhiteSpace($entry.$field)) {
          throw "The Google Workspace secret is missing $field."
        }
      }
    } elseif ($entry.provider -eq "WHATSAPP_BUSINESS") {
      foreach ($field in @(
        "graphApiVersion", "accessToken", "appSecret", "phoneNumberId", "verifyToken"
      )) {
        if ([string]::IsNullOrWhiteSpace($entry.$field)) {
          throw "The WhatsApp Business secret is missing $field."
        }
      }
      if ($entry.graphApiVersion -notmatch '^v[1-9][0-9]*\.0$') {
        throw "WhatsApp graphApiVersion must look like vNN.0 and be enabled for the Meta app."
      }
    } else {
      throw "Unsupported provider in GATE_L_PROVIDER_SECRETS_JSON."
    }
  }
  return $entries
}

if ($RequireLiveGateL -and -not $ApplyMigration) {
  throw "RequireLiveGateL also requires ApplyMigration."
}

foreach ($name in @(
  "GATE_L_LIVE_ENABLED",
  "GATE_L_SYNC_ENABLED",
  "GATE_L_PROVIDER_SECRETS_JSON",
  "COMMUNICATION_DELIVERY_ENABLED"
)) { Import-DotEnvValue $apiEnvironment $name }
foreach ($name in @(
  "E2E_CASE_USER_EMAIL",
  "E2E_CASE_USER_PASSWORD",
  "E2E_CASE_USER_TOTP_SECRET",
  "E2E_GATE_L_RECIPIENT_EMAIL",
  "E2E_GATE_L_RECIPIENT_PHONE"
)) { Import-DotEnvValue $webEnvironment $name }

$providerEntries = @()
if ($RequireLiveGateL) {
  foreach ($name in @(
    "GATE_L_LIVE_ENABLED",
    "GATE_L_SYNC_ENABLED",
    "COMMUNICATION_DELIVERY_ENABLED",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET",
    "E2E_GATE_L_RECIPIENT_EMAIL",
    "E2E_GATE_L_RECIPIENT_PHONE"
  )) { Require-Value $name }
  foreach ($flag in @(
    "GATE_L_LIVE_ENABLED", "GATE_L_SYNC_ENABLED", "COMMUNICATION_DELIVERY_ENABLED"
  )) {
    if ([Environment]::GetEnvironmentVariable($flag) -ne "true") {
      throw "$flag must be true for live Gate L acceptance."
    }
  }
  if ($env:E2E_GATE_L_RECIPIENT_EMAIL -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw "E2E_GATE_L_RECIPIENT_EMAIL is invalid."
  }
  if ($env:E2E_GATE_L_RECIPIENT_PHONE -notmatch '^\+[1-9][0-9]{7,14}$') {
    throw "E2E_GATE_L_RECIPIENT_PHONE must be an E.164 test number."
  }
  $providerEntries = @(Assert-ProviderConfiguration)
}

foreach ($path in @($enumMigration, $schemaMigration)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required Gate L migration is missing: $path"
  }
}
$enumSql = Get-Content -LiteralPath $enumMigration -Raw
$schemaSql = Get-Content -LiteralPath $schemaMigration -Raw
if ($enumSql -notmatch "MICROSOFT_365" -or $enumSql -notmatch "EXECUTED") {
  throw "The Gate L enum evolution migration is incomplete."
}
if ($schemaSql -match '(?i)ALTER\s+TYPE.+ADD\s+VALUE') {
  throw "Gate L enum evolution must remain isolated from the schema migration."
}
foreach ($requiredSql in @(
  "provider_connection_configs",
  "business_calendar_events",
  "provider_webhook_receipts",
  "set_provider_connection_status",
  "claim_gate_l_delivery_job",
  "begin_calendar_retry",
  "materialise_approved_ai_draft"
)) {
  if ($schemaSql -notmatch [regex]::Escape($requiredSql)) {
    throw "The Gate L schema migration is missing $requiredSql."
  }
}

Set-Location $project
if (
  (Get-Command git -ErrorAction SilentlyContinue) -and
  (Test-Path -LiteralPath (Join-Path $project ".git"))
) {
  $tracked = @(git ls-files)
  Check "Tracked-file inspection"
  $unsafe = @($tracked | Where-Object {
    ($_ -match '(^|/)\.env($|\.)' -and
      $_ -notmatch '\.(example|sample|template)$') -or
    $_ -match '\.(pem|key|pfx|p12)$' -or
    $_ -match '(^|/)(secrets?|credentials?)(/|$)' -or
    $_ -match '(storage-state|storageState|service-account).*\.json$'
  })
  if ($unsafe.Count -gt 0) {
    $unsafe | ForEach-Object { Write-Error "Tracked secret candidate: $_" }
    throw "Potential secret files are tracked. Remove them before Gate L verification."
  }
}

Write-Output "Checking Gate L API formatting, lint, schema, tests and production build..."
Set-Location $api
npx prettier --check `
  "src/communications/**/*.ts" `
  "src/http/**/*.ts" `
  "src/config/env.validation*.ts" `
  "src/integrations/**/*.ts" `
  "src/automation-control/**/*.ts" `
  "src/app.module.ts" `
  "src/main.ts"
Check "Gate L API formatting"
npx eslint "{src,test}/**/*.ts"
Check "API lint"
npx prisma validate --schema ".\prisma\schema.prisma"
Check "Prisma validation"
npx prisma generate --schema ".\prisma\schema.prisma"
Check "Prisma generation"
npm test -- --runInBand
Check "API tests"
npm run build
Check "API build"
if (-not (Test-Path -LiteralPath (Join-Path $api "dist\main.js"))) {
  throw "API build did not create dist\main.js; production start would fail."
}

Write-Output "Checking Gate L web lint, production build and browser compilation..."
Set-Location $web
npm run lint
Check "Web lint"
$previousNodeEnvironment = $env:NODE_ENV
try {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  npm run build
  Check "Web build"
} finally {
  if ($null -eq $previousNodeEnvironment) {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  } else {
    $env:NODE_ENV = $previousNodeEnvironment
  }
}
npx playwright test `
  e2e/gate-k-governed-personal-ai.spec.ts `
  e2e/gate-l-live-operations.spec.ts `
  --project=chromium --list
Check "Gate K/L browser compilation"

if ($RequireLiveGateL) {
  $secretValues = @()
  foreach ($entry in $providerEntries) {
    foreach ($field in @("clientSecret", "refreshToken", "accessToken", "appSecret")) {
      $value = [string]$entry.$field
      if ($value.Length -ge 12) { $secretValues += $value }
    }
  }
  if ($secretValues.Count -gt 0) {
    $leak = Get-ChildItem (Join-Path $web ".next\static") -Recurse -File |
      Select-String -SimpleMatch -Pattern $secretValues -Quiet
    if ($leak) {
      throw "A provider credential was found in a browser-static build artifact."
    }
  }
}

Write-Output "Checking linked Supabase migration plan..."
Set-Location $project
npx supabase db push --dry-run --linked
Check "Gate L migration dry-run"
if (-not $ApplyMigration) {
  Write-Output "Gate L code gates passed. Migrations and live-provider acceptance were not run."
  exit 0
}

npx supabase db push --linked --yes
Check "Gate L migrations"
$migrationList = @(& npx supabase migration list --linked 2>&1)
Check "Gate L migration listing"
$migrationList | ForEach-Object { Write-Output $_ }
$migrationText = $migrationList -join "`n"
foreach ($version in @("20260825115000", "20260825120000")) {
  if ($migrationText -notmatch $version) {
    throw "Remote migration $version was not confirmed."
  }
}

if (-not $RequireLiveGateL) {
  Write-Output "Gate L migrations applied. Live Microsoft/Google/WhatsApp acceptance was not required."
  exit 0
}

Write-Output "Running real-provider, AAL2 and cross-tenant browser acceptance..."
Set-Location $web
$previousLive = $env:REQUIRE_LIVE_GATE_L
try {
  $env:REQUIRE_LIVE_GATE_L = "1"
  npx playwright test `
    e2e/auth-enquiries.spec.ts `
    e2e/automation-control.spec.ts `
    e2e/communications.spec.ts `
    e2e/client-portal.spec.ts `
    e2e/gate-k-governed-personal-ai.spec.ts `
    e2e/gate-l-live-operations.spec.ts `
    --project=chromium --workers=1
  Check "Gate L live provider and critical browser regression"
} finally {
  if ($null -eq $previousLive) {
    Remove-Item Env:REQUIRE_LIVE_GATE_L -ErrorAction SilentlyContinue
  } else {
    $env:REQUIRE_LIVE_GATE_L = $previousLive
  }
}

Write-Output "Gate L LIVE CERTIFIED: migrations, real email, WhatsApp, calendar, AAL2 and tenant-isolation acceptance passed."
