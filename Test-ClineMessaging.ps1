# Test-ClineMessaging.ps1
# Comprehensive test script for BCline messaging system
# Tests the messaging infrastructure and Send-ClineMessage.ps1 client

param(
    [Parameter(Mandatory=$false)]
    [switch]$ShowDetails
)

$ErrorActionPreference = "Stop"
$TestsPassed = 0
$TestsFailed = 0

function Write-TestHeader {
    param([string]$Title)
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Message = ""
    )
    
    if ($Passed) {
        Write-Host "[PASS] $TestName" -ForegroundColor Green
        $script:TestsPassed++
    } else {
        Write-Host "[FAIL] $TestName" -ForegroundColor Red
        if ($Message) {
            Write-Host "  -> $Message" -ForegroundColor Yellow
        }
        $script:TestsFailed++
    }
}

function Test-Prerequisites {
    Write-TestHeader "Testing Prerequisites"
    
    # Test 1: Check if Send-ClineMessage.ps1 exists
    $SendScriptPath = ".\Send-ClineMessage.ps1"
    $exists = Test-Path $SendScriptPath
    Write-TestResult "Send-ClineMessage.ps1 script exists" $exists
    
    if (-not $exists) {
        Write-Host "ERROR: Cannot find Send-ClineMessage.ps1 in current directory" -ForegroundColor Red
        return $false
    }
    
    # Test 2: Verify script is readable
    try {
        $content = Get-Content $SendScriptPath -Raw -ErrorAction Stop
        Write-TestResult "Send-ClineMessage.ps1 is readable" $true
    } catch {
        Write-TestResult "Send-ClineMessage.ps1 is readable" $false $_.Exception.Message
        return $false
    }
    
    # Test 3: Check package.json version
    $PackageJson = ".\package.json"
    if (Test-Path $PackageJson) {
        $package = Get-Content $PackageJson -Raw | ConvertFrom-Json
        $version = $package.version
        Write-Host "   Current BCline version: $version" -ForegroundColor Gray
        Write-TestResult "BCline package.json found" $true
    } else {
        Write-TestResult "package.json found" $false
    }
    
    return $true
}

function Test-MessageQueueDirectories {
    Write-TestHeader "Testing Message Queue Infrastructure"
    
    $QueueDir = ".message-queue"
    $InboxDir = Join-Path $QueueDir "inbox"
    $ResponsesDir = Join-Path $QueueDir "responses"
    $OutboxDir = Join-Path $QueueDir "outbox"
    
    # Test 1: Queue directory exists or can be created
    if (-not (Test-Path $QueueDir)) {
        try {
            New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
            Write-TestResult "Message queue directory created" $true
        } catch {
            Write-TestResult "Message queue directory created" $false $_.Exception.Message
            return $false
        }
    } else {
        Write-TestResult "Message queue directory exists" $true
    }
    
    # Test 2: Inbox directory
    if (-not (Test-Path $InboxDir)) {
        try {
            New-Item -ItemType Directory -Path $InboxDir -Force | Out-Null
            Write-TestResult "Inbox directory created" $true
        } catch {
            Write-TestResult "Inbox directory created" $false $_.Exception.Message
        }
    } else {
        Write-TestResult "Inbox directory exists" $true
    }
    
    # Test 3: Responses directory
    if (-not (Test-Path $ResponsesDir)) {
        try {
            New-Item -ItemType Directory -Path $ResponsesDir -Force | Out-Null
            Write-TestResult "Responses directory created" $true
        } catch {
            Write-TestResult "Responses directory created" $false $_.Exception.Message
        }
    } else {
        Write-TestResult "Responses directory exists" $true
    }
    
    # Test 4: Outbox directory
    if (-not (Test-Path $OutboxDir)) {
        try {
            New-Item -ItemType Directory -Path $OutboxDir -Force | Out-Null
            Write-TestResult "Outbox directory created" $true
        } catch {
            Write-TestResult "Outbox directory created" $false $_.Exception.Message
        }
    } else {
        Write-TestResult "Outbox directory exists" $true
    }
    
    # Test 5: Write permissions
    $testFile = Join-Path $InboxDir "test-write.tmp"
    try {
        "test" | Out-File -FilePath $testFile -Force
        Remove-Item $testFile -Force
        Write-TestResult "Inbox directory is writable" $true
    } catch {
        Write-TestResult "Inbox directory is writable" $false $_.Exception.Message
    }
    
    return $true
}

function Test-MessageCreation {
    Write-TestHeader "Testing Message Creation & Format"
    
    $InboxDir = ".message-queue\inbox"
    
    # Clean inbox before test
    Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    
    # Test 1: Create a simple message
    try {
        $output = & .\Send-ClineMessage.ps1 "Test message from automated test" 2>&1
        Write-TestResult "Message sent without errors" $true
    } catch {
        Write-TestResult "Message sent without errors" $false $_.Exception.Message
        return $false
    }
    
    # Test 2: Verify message file was created
    Start-Sleep -Milliseconds 500
    $messageFiles = Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue
    $fileCreated = $messageFiles.Count -gt 0
    Write-TestResult "Message file created in inbox" $fileCreated
    
    if (-not $fileCreated) {
        return $false
    }
    
    # Test 3: Parse and validate message structure
    try {
        $messageFile = $messageFiles[0]
        $message = Get-Content $messageFile.FullName -Raw | ConvertFrom-Json
        
        Write-TestResult "Message is valid JSON" $true
        Write-TestResult "Message has 'id' field" ($null -ne $message.id)
        Write-TestResult "Message has 'from' field" ($message.from -eq "powershell-cli")
        Write-TestResult "Message has 'to' field" ($message.to -eq "cline")
        Write-TestResult "Message has 'type' field" ($message.type -eq "command")
        Write-TestResult "Message has 'content' field" ($null -ne $message.content)
        Write-TestResult "Message has 'timestamp' field" ($null -ne $message.timestamp)
        Write-TestResult "Message has 'metadata' field" ($null -ne $message.metadata)
        
        # Test 4: Filename format
        $filename = $messageFile.Name
        $pattern = '^\d+_[a-f0-9]{8}\.json$'
        $filenameValid = $filename -match $pattern
        Write-TestResult "Message filename follows convention" $filenameValid "Filename: $filename"
        
        if ($ShowDetails) {
            Write-Host ""
            Write-Host "Message Details:" -ForegroundColor Gray
            Write-Host "  ID: $($message.id)" -ForegroundColor Gray
            Write-Host "  Content: $($message.content)" -ForegroundColor Gray
            Write-Host "  Timestamp: $($message.timestamp)" -ForegroundColor Gray
            Write-Host "  Filename: $filename" -ForegroundColor Gray
        }
        
    } catch {
        Write-TestResult "Message parsing and validation" $false $_.Exception.Message
        return $false
    }
    
    # Cleanup
    Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    
    return $true
}

function Test-MessageWithSpecialCharacters {
    Write-TestHeader "Testing Special Characters Handling"
    
    $InboxDir = ".message-queue\inbox"
    Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    
    $testMessages = @(
        "Test with quotes: 'Hello World'",
        "Test with double quotes: Hello",
        "Test with special chars: @#$%"
    )
    
    foreach ($testMsg in $testMessages) {
        try {
            & .\Send-ClineMessage.ps1 $testMsg 2>&1 | Out-Null
            Start-Sleep -Milliseconds 300
            
            $files = Get-ChildItem -Path $InboxDir -Filter "*.json"
            if ($files.Count -gt 0) {
                $message = Get-Content $files[0].FullName -Raw | ConvertFrom-Json
                $contentMatches = $message.content -eq $testMsg
                $displayMsg = $testMsg.Substring(0, [Math]::Min(30, $testMsg.Length))
                Write-TestResult "Special chars: $displayMsg" $contentMatches
                Remove-Item $files[0].FullName -Force
            } else {
                Write-TestResult "Special chars message created" $false
            }
        } catch {
            Write-TestResult "Special chars handling" $false $_.Exception.Message
        }
    }
}

function Test-ConcurrentMessages {
    Write-TestHeader "Testing Concurrent Message Handling"
    
    $InboxDir = ".message-queue\inbox"
    Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    
    # Send multiple messages rapidly
    $jobs = @()
    for ($i = 1; $i -le 5; $i++) {
        $jobs += Start-Job -ScriptBlock {
            param($path, $msg)
            & $path $msg
        } -ArgumentList (Resolve-Path ".\Send-ClineMessage.ps1").Path, "Concurrent test message $i"
    }
    
    # Wait for jobs
    $jobs | Wait-Job -Timeout 10 | Out-Null
    $jobs | Remove-Job -Force
    
    Start-Sleep -Milliseconds 1000
    
    # Verify all messages were created
    $messageFiles = Get-ChildItem -Path $InboxDir -Filter "*.json"
    $allCreated = $messageFiles.Count -eq 5
    Write-TestResult "All 5 concurrent messages created" $allCreated "Found: $($messageFiles.Count)"
    
    # Verify unique message IDs
    if ($messageFiles.Count -gt 0) {
        $ids = @()
        foreach ($file in $messageFiles) {
            $msg = Get-Content $file.FullName -Raw | ConvertFrom-Json
            $ids += $msg.id
        }
        $uniqueIds = ($ids | Select-Object -Unique).Count
        $allUnique = $uniqueIds -eq $messageFiles.Count
        Write-TestResult "All message IDs are unique" $allUnique "Unique: $uniqueIds / Total: $($messageFiles.Count)"
    }
    
    # Cleanup
    Get-ChildItem -Path $InboxDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
}

function Show-Summary {
    Write-TestHeader "Test Summary"
    
    $total = $TestsPassed + $TestsFailed
    $successRate = if ($total -gt 0) { [math]::Round(($TestsPassed / $total) * 100, 1) } else { 0 }
    
    Write-Host "Total Tests: $total" -ForegroundColor White
    Write-Host "Passed:      $TestsPassed" -ForegroundColor Green
    $failedColor = if ($TestsFailed -gt 0) { "Red" } else { "Green" }
    Write-Host "Failed:      $TestsFailed" -ForegroundColor $failedColor
    $rateColor = if ($successRate -ge 90) { "Green" } elseif ($successRate -ge 70) { "Yellow" } else { "Red" }
    Write-Host "Success Rate: $successRate%" -ForegroundColor $rateColor
    Write-Host ""
    
    if ($TestsFailed -eq 0) {
        Write-Host "[OK] ALL TESTS PASSED!" -ForegroundColor Green
        Write-Host "[OK] BCline messaging system is working correctly" -ForegroundColor Green
    } else {
        Write-Host "[!!] SOME TESTS FAILED" -ForegroundColor Red
        Write-Host "  Please review the failures above" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Main execution
Write-Host ""
Write-Host "+====================================================================+" -ForegroundColor Blue
Write-Host "|  BCline Messaging System Test Suite                                |" -ForegroundColor Blue
Write-Host "|  Automated Testing Framework                                       |" -ForegroundColor Blue
Write-Host "+====================================================================+" -ForegroundColor Blue
Write-Host ""
Write-Host "Starting comprehensive tests..." -ForegroundColor White
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "Timestamp: $timestamp" -ForegroundColor Gray
Write-Host ""

# Run all tests
$continue = Test-Prerequisites
if ($continue) {
    Test-MessageQueueDirectories
    Test-MessageCreation
    Test-MessageWithSpecialCharacters
    Test-ConcurrentMessages
}

# Show summary
Show-Summary

# Exit with appropriate code
if ($TestsFailed -eq 0) {
    exit 0
} else {
    exit 1
}
