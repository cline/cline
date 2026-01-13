# Set-ClineModel.ps1
# Switch Cline's OpenRouter model via CLI
# Usage: .\Set-ClineModel.ps1 "anthropic/claude-3.5-sonnet"
# Usage: .\Set-ClineModel.ps1 "google/gemini-2.0-flash-exp:free"

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$ModelId
)

# Use the existing Send-ClineMessage script with the set-model prefix
$scriptPath = Join-Path $PSScriptRoot "Send-ClineMessage.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Send-ClineMessage.ps1 not found at $scriptPath"
    exit 1
}

Write-Host "Switching Cline model to: $ModelId" -ForegroundColor Cyan

& $scriptPath -Message "set-model:$ModelId" -Wait -Timeout 10

Write-Host ""
Write-Host "Common OpenRouter models:" -ForegroundColor Yellow
Write-Host "  anthropic/claude-3.5-sonnet"
Write-Host "  anthropic/claude-3-opus"
Write-Host "  openai/gpt-4o"
Write-Host "  openai/gpt-4-turbo"
Write-Host "  google/gemini-2.0-flash-exp:free"
Write-Host "  google/gemini-pro"
Write-Host "  meta-llama/llama-3.1-405b-instruct"
