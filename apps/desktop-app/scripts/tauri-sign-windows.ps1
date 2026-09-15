# Authenticode-signs one PE file with Azure Trusted Signing via jsign.
#
# Invoked by the Tauri bundler through `bundle > windows > signCommand` (the
# desktop-publish workflow generates a config overlay pointing here), once per
# binary it stages: the main app exe, the code-sidecar external binary, the
# NSIS uninstaller, and the NSIS installer itself.
#
# Requirements (all provided by the desktop-publish Windows job):
# - an azure/login OIDC session (jsign's token comes from `az account get-access-token`)
# - AZURE_TRUSTED_SIGNING_ENDPOINT / _ACCOUNT_NAME / _CERTIFICATE_PROFILE env vars
# - java on PATH (preinstalled on GitHub Windows runners)
#
# Mirrors the CLI pipeline (.github/actions/sign-windows-cli): same jsign
# version and flags, same Microsoft timestamp service. Kept as a standalone
# script so the signing behavior is reviewable in the repo rather than inlined
# in a generated config string.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Path
)

$ErrorActionPreference = "Stop"

$jsignVersion = "7.5"
$jsignSha256 = "602A51C3545A6DC4FB99BD2EA7152B26D1345916D0C93DDFBD5936CB735AF91C"

$endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
$account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
$certProfile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
if (-not $endpoint -or -not $account -or -not $certProfile) {
  throw "Azure Trusted Signing env vars are not set (AZURE_TRUSTED_SIGNING_ENDPOINT/_ACCOUNT_NAME/_CERTIFICATE_PROFILE)"
}

$resolved = (Resolve-Path $Path).Path

# jsign expects the endpoint host; tolerate the portal's trailing-slash form.
$keystore = $endpoint -replace '^https://', '' -replace '/$', ''

$jar = Join-Path $env:RUNNER_TEMP "jsign-$jsignVersion.jar"
if (-not (Test-Path $jar)) {
  Invoke-WebRequest -Uri "https://github.com/ebourg/jsign/releases/download/$jsignVersion/jsign-$jsignVersion.jar" -OutFile $jar
}
$actualHash = (Get-FileHash -Algorithm SHA256 $jar).Hash
if ($actualHash -ne $jsignSha256) {
  Remove-Item $jar -Force
  throw "jsign jar checksum mismatch: expected $jsignSha256, got $actualHash"
}

# Short-lived bearer token from the azure/login OIDC session. Fetched per
# invocation (signCommand runs once per file) so a long Rust build beforehand
# can never leave us with an expired token. Passed to jsign via env, not argv.
$env:JSIGN_STOREPASS = (az account get-access-token --resource https://codesigning.azure.net --query accessToken --output tsv)
if (-not $env:JSIGN_STOREPASS) {
  throw "failed to acquire an Azure access token; is azure/login configured on this job?"
}

Write-Host "Signing $resolved"
java -jar $jar `
  --storetype TRUSTEDSIGNING `
  --keystore $keystore `
  --storepass env:JSIGN_STOREPASS `
  --alias "$account/$certProfile" `
  --alg SHA-256 `
  --tsaurl http://timestamp.acs.microsoft.com `
  --tsmode RFC3161 `
  --replace `
  $resolved
if ($LASTEXITCODE -ne 0) {
  throw "jsign failed for $resolved (exit $LASTEXITCODE)"
}

$signature = Get-AuthenticodeSignature $resolved
if ($signature.Status -ne "Valid") {
  throw "signature verification failed for ${resolved}: $($signature.Status) - $($signature.StatusMessage)"
}
Write-Host "Signed and verified: $resolved ($($signature.SignerCertificate.Subject))"
