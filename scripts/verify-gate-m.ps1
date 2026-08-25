param(
  [switch]$ApplyMigration,
  [switch]$FreeMode,
  [switch]$RequireLiveGateM
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$apiEnvironment = Join-Path $api ".env"
$webEnvironment = Join-Path $web ".env.local"
$migrationVersion = "20260825150000"
$migration = Join-Path $project "supabase\migrations\${migrationVersion}_gate_m_operational_intelligence.sql"
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

function Require-Value([string]$name, [string]$purpose) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for $purpose."
  }
  if ($value -match '(?i)(replace|changeme|your-|vreplace)') {
    throw "$name still contains a placeholder value."
  }
}

function Assert-PortsAvailable {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    return
  }
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(3000, 4000) })
  if ($listeners.Count -gt 0) {
    $details = ($listeners | ForEach-Object {
      "port $($_.LocalPort) (PID $($_.OwningProcess))"
    }) -join ", "
    throw "Close manually running API/web terminals before browser QA. Active: $details"
  }
}

function Invoke-BrowserSuite(
  [string[]]$arguments,
  [int]$expectedSkipped,
  [string]$label
) {
  $previousErrorAction = $ErrorActionPreference
  $output = @()
  try {
    $ErrorActionPreference = "Continue"
    & npx playwright test @arguments 2>&1 | Tee-Object -Variable output
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0) {
    throw "$label failed."
  }
  $text = $output -join "`n"
  $skipped = 0
  $skipMatch = [regex]::Match($text, '(?im)^\s*(\d+)\s+skipped(?:\s|$)')
  if ($skipMatch.Success) { $skipped = [int]$skipMatch.Groups[1].Value }
  if ($skipped -ne $expectedSkipped) {
    throw "$label expected $expectedSkipped intentional provider skips but found $skipped."
  }
}

if ($RequireLiveGateM -and -not $ApplyMigration) {
  throw "RequireLiveGateM also requires ApplyMigration."
}
if ($RequireLiveGateM -and $FreeMode) {
  throw "FreeMode and RequireLiveGateM are mutually exclusive."
}

foreach ($name in @(
  "DOCUMENT_INTELLIGENCE_ENABLED",
  "DOCUMENT_INTELLIGENCE_MODEL",
  "DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR",
  "DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR",
  "DOCUMENT_SCANNER_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_AGENT_MODEL"
)) { Import-DotEnvValue $apiEnvironment $name }
foreach ($name in @(
  "E2E_CASE_USER_EMAIL",
  "E2E_CASE_USER_PASSWORD",
  "E2E_CASE_USER_TOTP_SECRET",
  "E2E_GATE_M_DOCUMENT_TITLE"
)) { Import-DotEnvValue $webEnvironment $name }

if ($FreeMode -and $env:DOCUMENT_INTELLIGENCE_ENABLED -eq "true") {
  throw "FreeMode requires DOCUMENT_INTELLIGENCE_ENABLED=false (or omitted) in apps\api\.env."
}

if ($RequireLiveGateM) {
  foreach ($name in @(
    "DOCUMENT_INTELLIGENCE_ENABLED",
    "DOCUMENT_SCANNER_ENABLED",
    "OPENAI_API_KEY",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET",
    "E2E_GATE_M_DOCUMENT_TITLE",
    "DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR",
    "DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR"
  )) { Require-Value $name "live Gate M acceptance" }
  if ($env:DOCUMENT_INTELLIGENCE_ENABLED -ne "true") {
    throw "DOCUMENT_INTELLIGENCE_ENABLED must be true for live Gate M acceptance."
  }
  if ($env:DOCUMENT_SCANNER_ENABLED -ne "true") {
    throw "DOCUMENT_SCANNER_ENABLED must be true for live Gate M acceptance."
  }
  if ($env:OPENAI_API_KEY -notmatch '^sk-[A-Za-z0-9_-]{20,}$') {
    throw "OPENAI_API_KEY does not look like a valid server-only project key."
  }
  $model = if ($env:DOCUMENT_INTELLIGENCE_MODEL) {
    $env:DOCUMENT_INTELLIGENCE_MODEL
  } else { $env:OPENAI_AGENT_MODEL }
  if ($model -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$') {
    throw "DOCUMENT_INTELLIGENCE_MODEL or OPENAI_AGENT_MODEL is required."
  }
  foreach ($rate in @(
    "DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR",
    "DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR"
  )) {
    $rateValue = 0
    if (-not [int]::TryParse(
      [Environment]::GetEnvironmentVariable($rate),
      [ref]$rateValue
    ) -or $rateValue -le 0) {
      throw "$rate must be a positive current provider-rate assumption."
    }
  }
}

if (-not (Test-Path -LiteralPath $migration)) {
  throw "Gate M migration is missing: $migration"
}
$sql = Get-Content -LiteralPath $migration -Raw
$functionCount = [regex]::Matches(
  $sql,
  '(?m)^CREATE OR REPLACE FUNCTION '
).Count
$closureCount = [regex]::Matches($sql, '(?m)^\$function\$;').Count
$validEndCount = [regex]::Matches(
  $sql,
  '(?m)^END;\r?\n\$function\$;'
).Count
$brokenEndCount = [regex]::Matches(
  $sql,
  '(?m)^END\r?\n\$function\$;'
).Count
if (
  $functionCount -ne 11 -or $closureCount -ne 11 -or
  $validEndCount -ne 11 -or $brokenEndCount -ne 0 -or
  -not $sql.TrimEnd().EndsWith("COMMIT;")
) {
  throw "Gate M migration function structure is invalid; nothing will be applied."
}
foreach ($requiredSql in @(
  "FORCE ROW LEVEL SECURITY",
  "claim_document_intelligence_job",
  "complete_document_intelligence_job",
  "fail_document_intelligence_job",
  "review_document_intelligence",
  "get_operational_intelligence_dashboard",
  "providerOutputWasAdvisory",
  "ORGANISATION_CONFIGURABLE_BENCHMARKS"
)) {
  if ($sql -notmatch [regex]::Escape($requiredSql)) {
    throw "Gate M migration is missing required control: $requiredSql"
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
    throw "Potential secret files are tracked. Remove them before Gate M verification."
  }
}

Write-Output "Checking Gate M API format, lint, schema, tests and production build..."
Set-Location $api
npx prettier --check `
  "src/operational-intelligence/**/*.ts" `
  "src/config/env.validation*.ts" `
  "src/rbac/default-*.ts" `
  "src/document-scanner/document-scanner.module.ts" `
  "src/app.module.ts"
Check "Gate M API formatting"
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

Write-Output "Checking Gate M web lint, production build and all browser scenarios..."
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
$listOutput = @(& npx playwright test --project=chromium --list 2>&1)
Check "Browser test compilation"
$listOutput | ForEach-Object { Write-Output $_ }
$listText = $listOutput -join "`n"
$totalMatch = [regex]::Match($listText, 'Total:\s+(\d+)\s+tests?')
if (-not $totalMatch.Success -or [int]$totalMatch.Groups[1].Value -lt 23) {
  throw "Expected all 21 prior scenarios plus 2 Gate M scenarios."
}
foreach ($scenario in @(
  "loads the compact role-aware workspaces and rejects another tenant",
  "observes a real provider result without bypassing human review"
)) {
  if ($listText -notmatch [regex]::Escape($scenario)) {
    throw "Gate M browser scenario is missing: $scenario"
  }
}

if ($RequireLiveGateM) {
  $staticPath = Join-Path $web ".next\static"
  $secretLeak = Get-ChildItem -LiteralPath $staticPath -Recurse -File |
    Select-String -SimpleMatch $env:OPENAI_API_KEY -Quiet
  if ($secretLeak) {
    throw "OPENAI_API_KEY was found in a browser-static build artifact."
  }
}

Write-Output "Checking the linked Supabase migration plan..."
Set-Location $project
npx supabase db push --dry-run --linked
Check "Gate M migration dry-run"
if (-not $ApplyMigration) {
  Write-Output "Gate M code gates passed. Migration and browser runtime acceptance were not run."
  exit 0
}

npx supabase db push --linked --yes
Check "Gate M migration"
$previousErrorAction = $ErrorActionPreference
$migrationList = @()
$migrationListExitCode = 1

try {
  $ErrorActionPreference = "Continue"
  $migrationList = @(& npx supabase migration list --linked 2>&1)
  $migrationListExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorAction
}

if ($migrationListExitCode -ne 0) {
  throw "Gate M migration listing failed with exit code $migrationListExitCode."
}
$migrationList | ForEach-Object { Write-Output $_ }
if (($migrationList -join "`n") -notmatch $migrationVersion) {
  throw "Remote Gate M migration $migrationVersion was not confirmed."
}

foreach ($name in @(
  "E2E_CASE_USER_EMAIL",
  "E2E_CASE_USER_PASSWORD",
  "E2E_CASE_USER_TOTP_SECRET"
)) { Require-Value $name "the complete browser regression" }

Assert-PortsAvailable
Write-Output "Running all 23 browser scenarios in provider-safe mode..."
Set-Location $web
$safeOverrides = @{
  "REQUIRE_LIVE_GATE_K" = "0"
  "REQUIRE_LIVE_GATE_L" = "0"
  "REQUIRE_LIVE_GATE_M" = "0"
  "OPENAI_AGENT_ENABLED" = "false"
  "DOCUMENT_INTELLIGENCE_ENABLED" = "false"
  "GATE_L_LIVE_ENABLED" = "false"
  "GATE_L_SYNC_ENABLED" = "false"
  "COMMUNICATION_DELIVERY_ENABLED" = "false"
}
$previousValues = @{}
try {
  foreach ($entry in $safeOverrides.GetEnumerator()) {
    $previousValues[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key)
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
  Invoke-BrowserSuite @("--project=chromium", "--workers=1") 3 `
    "Complete non-provider browser regression"
} finally {
  foreach ($entry in $safeOverrides.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable(
      $entry.Key,
      $previousValues[$entry.Key],
      "Process"
    )
  }
}

if (-not $RequireLiveGateM) {
  if ($FreeMode) {
    Write-Output "Gate M FREE MODE VERIFIED: migration, 20 runtime scenarios and 3 intentional provider skips passed; no AI provider call was enabled."
  } else {
    Write-Output "Gate M migration and non-provider browser regression passed. Live document-provider acceptance was not required."
  }
  exit 0
}

Assert-PortsAvailable
Write-Output "Running real document-provider, AAL2 and tenant-isolation acceptance..."
$previousLive = $env:REQUIRE_LIVE_GATE_M
try {
  $env:REQUIRE_LIVE_GATE_M = "1"
  Invoke-BrowserSuite @(
    "e2e/gate-m-operational-intelligence.spec.ts",
    "--project=chromium",
    "--workers=1"
  ) 0 "Gate M live provider acceptance"
} finally {
  if ($null -eq $previousLive) {
    Remove-Item Env:REQUIRE_LIVE_GATE_M -ErrorAction SilentlyContinue
  } else {
    $env:REQUIRE_LIVE_GATE_M = $previousLive
  }
}

Write-Output "Gate M LIVE ACCEPTANCE PASSED: clean-file provider evidence, AAL2 human control, compact UI and tenant isolation were exercised."
