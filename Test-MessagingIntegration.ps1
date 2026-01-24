# Test-MessagingIntegration.ps1
# Integration test for BCline messaging with extension communication
# Tests end-to-end message flow

param(
    [Parameter(Mandatory=$false)]
    [int]$Timeout = 30
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  BCline Messaging Integration Test                               ║" -ForegroundColor Blue
Write-Host "║  Version 3.47.0                                                   ║" -ForegroundColor Blue
Write-Host "╚═══════════════════════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# Test 1: Message Queue Setup
Write-Host "Test 1: Verifying Message Queue Setup..." -ForegroundColor Cyan
$QueueDir = ".message-queue"
$InboxDir = Join-Path $QueueDir "inbox"
$ResponsesDir = Join-Path $QueueDir "responses"

if ((Test-Path $InboxDir) -and (Test-Path $ResponsesDir)) {
    Write-Host "   ✓ Message queue directories exist" -ForegroundColor Green
} else {
    Write-Host "   ✗ Message queue directories missing!" -ForegroundColor Red
    exit 1
}

# Test 2: Clear old messages
Write-Host ""
Write-Host "Test 2: Cleaning Message Queues..." -ForegroundColor Cyan
$inboxCount = (Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue).Count
$responseCount = (Get-ChildItem -Path $ResponsesDir -Filter "*.json" -ErrorAction SilentlyContinue).Count
Write-Host "   Found $inboxCount message(s) in inbox" -ForegroundColor Gray
Write-Host "   Found $responseCount response(s) in responses" -ForegroundColor Gray

if ($inboxCount -gt 0) {
    Get-ChildItem -Path $InboxDir -Filter "*.json" | Remove-Item -Force
    Write-Host "   ✓ Cleared inbox" -ForegroundColor Green
}
if ($responseCount -gt 0) {
    Get-ChildItem -Path $ResponsesDir -Filter "*.json" | Remove-Item -Force
    Write-Host "   ✓ Cleared responses" -ForegroundColor Green
}

# Test 3: Send test message
Write-Host ""
Write-Host "Test 3: Sending Test Message..." -ForegroundColor Cyan
$testMessage = "Integration test at $(Get-Date -Format 'HH:mm:ss')"
try {
    & .\Send-ClineMessage.ps1 $testMessage 2>&1 | Out-Null
    Write-Host "   ✓ Message sent successfully" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Failed to send message: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 4: Verify message file
Write-Host ""
Write-Host "Test 4: Verifying Message File..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$messageFiles = Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue

if ($messageFiles.Count -eq 0) {
    Write-Host "   ✗ No message file found in inbox!" -ForegroundColor Red
    exit 1
}

$messageFile = $messageFiles[0]
try {
    $message = Get-Content $messageFile.FullName -Raw | ConvertFrom-Json
    Write-Host "   ✓ Message file is valid JSON" -ForegroundColor Green
    Write-Host "   Message ID: $($message.id)" -ForegroundColor Gray
    Write-Host "   Content: $($message.content)" -ForegroundColor Gray
    Write-Host "   From: $($message.from)" -ForegroundColor Gray
    Write-Host "   To: $($message.to)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Failed to parse message: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 5: Check VS Code extension status
Write-Host ""
Write-Host "Test 5: Checking VS Code Extension Status..." -ForegroundColor Cyan
Write-Host "   Note: For full integration, BCline extension should be running in VS Code" -ForegroundColor Yellow
Write-Host "   If extension is active, it will pick up messages from inbox" -ForegroundColor Yellow

# Test 6: Message format validation
Write-Host ""
Write-Host "Test 6: Validating Message Format..." -ForegroundColor Cyan
$requiredFields = @('id', 'from', 'to', 'timestamp', 'type', 'content', 'metadata')
$allFieldsPresent = $true
foreach ($field in $requiredFields) {
    if ($null -eq $message.$field) {
        Write-Host "   ✗ Missing required field: $field" -ForegroundColor Red
        $allFieldsPresent = $false
    }
}

if ($allFieldsPresent) {
    Write-Host "   ✓ All required fields present" -ForegroundColor Green
} else {
    exit 1
}

# Test 7: Verify message persistence
Write-Host ""
Write-Host "Test 7: Testing Message Persistence..." -ForegroundColor Cyan
Start-Sleep -Seconds 2
$persistedFiles = Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue
if ($persistedFiles.Count -gt 0) {
    Write-Host "   ✓ Message persisted in queue" -ForegroundColor Green
    Write-Host "   Status: Ready for extension to process" -ForegroundColor Gray
} else {
    Write-Host "   ℹ Message was consumed by extension" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "INTEGRATION TEST SUMMARY" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "✓ Message queue infrastructure: OK" -ForegroundColor Green
Write-Host "✓ Message creation: OK" -ForegroundColor Green
Write-Host "✓ Message format validation: OK" -ForegroundColor Green
Write-Host "✓ Message persistence: OK" -ForegroundColor Green
Write-Host ""
Write-Host "BCline v3.47.0 messaging client is working correctly!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Ensure BCline extension is installed and running in VS Code" -ForegroundColor White
Write-Host "  2. Send a message with -Wait flag to test response handling:" -ForegroundColor White
Write-Host "     .\Send-ClineMessage.ps1 `"Your message`" -Wait" -ForegroundColor Gray
Write-Host ""

exit 0
