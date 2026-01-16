# Copilot CLI Task Runner with Model Selection
# Usage: .\scripts\copilot-task.ps1 -Task "quick" -Prompt "Fix the bug"
#        .\scripts\copilot-task.ps1 -Task "complex" -Prompt "Analyze the codebase"
#        .\scripts\copilot-task.ps1 -Model opus -Prompt "Deep analysis needed"

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("quick", "balanced", "complex", "cheap")]
    [string]$Task = "balanced",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("haiku", "sonnet", "opus", "gpt5", "gpt5mini")]
    [string]$Model,
    
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Prompt,
    
    [switch]$Silent,
    [switch]$Interactive
)

# Model mapping with cost info
$Models = @{
    "haiku"    = @{ id = "claude-haiku-4.5";    cost = "~0.3x"; speed = "fastest" }
    "sonnet"   = @{ id = "claude-sonnet-4.5";   cost = "1x";    speed = "fast" }
    "opus"     = @{ id = "claude-opus-4.5";     cost = "3x";    speed = "slower" }
    "gpt5"     = @{ id = "gpt-5";               cost = "1x";    speed = "fast" }
    "gpt5mini" = @{ id = "gpt-5-mini";          cost = "~0.5x"; speed = "fastest" }
}

# Task-to-model mapping
$TaskModels = @{
    "quick"    = "haiku"    # Fast, cheap - simple questions, quick fixes
    "balanced" = "sonnet"   # Good balance of speed/quality
    "complex"  = "opus"     # Deep analysis, complex bugs, architecture
    "cheap"    = "haiku"    # Budget mode
}

# Determine which model to use
if ($Model) {
    $SelectedModel = $Model
} else {
    $SelectedModel = $TaskModels[$Task]
}

$ModelInfo = $Models[$SelectedModel]
$ModelId = $ModelInfo.id

# Build command
$cmd = "copilot"
$args = @()

if ($Interactive) {
    $args += "-i"
} else {
    $args += "-p"
}
$args += "`"$Prompt`""
$args += "--model"
$args += $ModelId

if ($Silent) {
    $args += "-s"
}

# Show what we're doing
if (-not $Silent) {
    Write-Host ""
    Write-Host "🤖 Copilot CLI Task Runner" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "Task:   " -NoNewline -ForegroundColor Gray
    Write-Host $Task -ForegroundColor Yellow
    Write-Host "Model:  " -NoNewline -ForegroundColor Gray
    Write-Host "$SelectedModel ($ModelId)" -ForegroundColor Green
    Write-Host "Cost:   " -NoNewline -ForegroundColor Gray
    Write-Host "$($ModelInfo.cost) premium" -ForegroundColor $(if ($ModelInfo.cost -eq "3x") { "Red" } elseif ($ModelInfo.cost -eq "1x") { "Yellow" } else { "Green" })
    Write-Host "Speed:  " -NoNewline -ForegroundColor Gray
    Write-Host $ModelInfo.speed -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
}

# Run copilot
$fullCmd = "$cmd $($args -join ' ')"
Invoke-Expression $fullCmd
