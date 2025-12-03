# Check Build Progress
Write-Host "=== Build Progress Check ===" -ForegroundColor Cyan
Write-Host ""

$checks = @(
    @{Name="Root node_modules"; Path="node_modules"; Step="Step 2"},
    @{Name="Webview node_modules"; Path="webview-ui\node_modules"; Step="Step 5"},
    @{Name="Generated protos"; Path="src\generated"; Step="Step 6"},
    @{Name="Webview build"; Path="webview-ui\dist"; Step="Step 9"},
    @{Name="Extension build"; Path="dist\extension.js"; Step="Step 10"},
    @{Name="Final VSIX"; Path="bcline-3.39.2-complete.vsix"; Step="Step 11"}
)

$completed = 0
foreach ($check in $checks) {
    if (Test-Path $check.Path) {
        Write-Host "[DONE] " -NoNewline -ForegroundColor Green
        Write-Host "$($check.Name) ($($check.Step))"
        $completed++
    } else {
        Write-Host "[PENDING] " -NoNewline -ForegroundColor Yellow
        Write-Host "$($check.Name) ($($check.Step))" -ForegroundColor Yellow
        Write-Host "  ^ Currently working on this step..." -ForegroundColor Gray
        break
    }
}

Write-Host ""
Write-Host "Progress: $completed / $($checks.Count) steps completed" -ForegroundColor Cyan
$percent = [math]::Round(($completed / $checks.Count) * 100)
Write-Host "Completion: $percent%" -ForegroundColor Cyan

# Estimate remaining time
$remainingSteps = $checks.Count - $completed
if ($remainingSteps -gt 0) {
    $avgTimePerStep = 2  # minutes
    $estimatedMinutes = $remainingSteps * $avgTimePerStep
    Write-Host ""
    Write-Host "Estimated time remaining: $estimatedMinutes-$($estimatedMinutes + 3) minutes" -ForegroundColor Yellow
}
