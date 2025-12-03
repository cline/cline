# Check VSIX contents for webview files
Add-Type -Assembly System.IO.Compression.FileSystem
$vsixPath = "bcline-3.39.2-complete.vsix"

Write-Host "Checking VSIX: $vsixPath" -ForegroundColor Cyan
Write-Host ""

$zip = [System.IO.Compression.ZipFile]::OpenRead($vsixPath)
$allEntries = $zip.Entries

# Check for webview files
$webviewFiles = $allEntries | Where-Object { $_.FullName -match "webview" } | Select-Object -First 10
$webviewCount = ($allEntries | Where-Object { $_.FullName -match "webview" } | Measure-Object).Count

Write-Host "Total files in VSIX: $($allEntries.Count)" -ForegroundColor Yellow
Write-Host "Webview-related files: $webviewCount" -ForegroundColor Yellow
Write-Host ""

if ($webviewCount -gt 0) {
    Write-Host "Sample webview files (first 10):" -ForegroundColor Green
    $webviewFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
} else {
    Write-Host "ERROR: No webview files found in VSIX!" -ForegroundColor Red
    Write-Host "This explains why the webview doesn't open!" -ForegroundColor Red
}

Write-Host ""

# Check for critical files
$criticalFiles = @(
    "extension/dist/extension.js",
    "extension/webview-ui/build/index.html",
    "extension/webview-ui/dist/index.html"
)

Write-Host "Checking critical files:" -ForegroundColor Cyan
foreach ($file in $criticalFiles) {
    $exists = $allEntries | Where-Object { $_.FullName -eq $file }
    if ($exists) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}

$zip.Dispose()
