# E2E fixture hook (Windows): records where it ran and what workspace identity
# it was given, so the test can assert workspace-scoped discovery and cwd.
$ErrorActionPreference = 'Stop'
$hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
@{ cwd = (Get-Location).Path; workspaceRoots = $hookInput.workspaceRoots } | ConvertTo-Json -Compress | Set-Content -Path "hook-ran.json"
Write-Output '{"cancel": false}'
