# E2E fixture hook (Windows): records where it ran and what workspace identity
# it was given, so the test can assert workspace-scoped discovery and cwd.
$ErrorActionPreference = 'Stop'
$hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
$prompt = $hookInput.userPromptSubmit.prompt
@{ cwd = (Get-Location).Path; workspaceRoots = $hookInput.workspaceRoots; prompt = $prompt } | ConvertTo-Json -Compress | Set-Content -Path "hook-ran.json"
$fact = if ($prompt -like "*probe two*") { "HOOK_FACT_BETA" } else { "HOOK_FACT_ALPHA" }
@{ cancel = $false; contextModification = $fact } | ConvertTo-Json -Compress
