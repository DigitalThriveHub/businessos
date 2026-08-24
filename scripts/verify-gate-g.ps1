param([switch]$ApplyMigration,[switch]$RequireLiveGateG,[switch]$RequireProductionEvidence)
$ErrorActionPreference="Stop"; $project=Split-Path -Parent $PSScriptRoot; $api=Join-Path $project "apps\api"; $web=Join-Path $project "apps\web"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { chcp.com 65001 > $null }
function Check([string]$step){if($LASTEXITCODE -ne 0){throw "$step failed with exit code $LASTEXITCODE."}}
Set-Location $api
npx prettier --write "src/service-lifecycle/**/*.ts" "src/app.module.ts" "src/rbac/default-permissions.ts" "src/rbac/default-roles.ts"; Check "API formatting"
npx prisma format; Check "Prisma format"; npx prisma validate; Check "Prisma validation"; npx prisma generate; Check "Prisma generation"
npm test -- --runInBand; Check "API tests"; npm run build; Check "API build"
Set-Location $web
npm run lint; Check "Web lint"; npm run build; Check "Web build"
npx playwright test e2e/service-lifecycle.spec.ts e2e/service-lifecycle-end-to-end.spec.ts --project=chromium --list; Check "Gate G browser compilation"
if($RequireProductionEvidence){
  foreach($name in @('RELEASE_SHA','SENTRY_DSN','AXIOM_TOKEN','BACKUP_RESTORE_EVIDENCE_AT')){
    if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))){throw "$name is required for production evidence."}
  }
}
Set-Location $project
npx supabase db push --dry-run --linked; Check "Migration dry-run"
if(-not $ApplyMigration){Write-Output "Gate G code gates passed; migration not applied."; exit 0}
npx supabase db push --linked; Check "Gate G migration"
Set-Location $web
$output=@(); $previous=$ErrorActionPreference; try{$ErrorActionPreference="Continue";& npx playwright test e2e/auth-enquiries.spec.ts e2e/case-operations.spec.ts e2e/automation-control.spec.ts e2e/communications.spec.ts e2e/client-portal.spec.ts e2e/finance.spec.ts e2e/integrations-command-centre.spec.ts e2e/service-lifecycle.spec.ts e2e/service-lifecycle-end-to-end.spec.ts --project=chromium --workers=1 2>&1|Tee-Object -Variable output;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
if($code -ne 0){throw "Gate G critical browser tests failed."}
if($RequireLiveGateG -and (($output|Out-String)-match '(?im)^\s*\d+\s+skipped(?:\s|$)')){throw "Live Gate G acceptance cannot contain skipped tests."}
Write-Output "Gate G verification completed successfully."
