# E2E fixture hook (Windows): records where it ran, the workspace identity it
# was given, and the prompt it received, and injects a distinctive fact the
# test asks the mock model about.
$ErrorActionPreference = 'Stop'
$hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
$prompt = ""
if ($hookInput.userPromptSubmit -and $hookInput.userPromptSubmit.prompt) { $prompt = $hookInput.userPromptSubmit.prompt }
@{ cwd = (Get-Location).Path; workspaceRoots = $hookInput.workspaceRoots; prompt = $prompt } | ConvertTo-Json -Compress | Set-Content -Path "hook-ran.json"
Write-Output '{"cancel": false, "contextModification": "HOOK_INJECTED_FACT: the codename is ZEBRA-7."}'
