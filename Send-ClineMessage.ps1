# Send-ClineMessage.ps1
# PowerShell script to send messages to Cline from CLI
# Usage: .\Send-ClineMessage.ps1 "Your message here"
# Usage with wait: .\Send-ClineMessage.ps1 "Your message" -Wait

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Message,

    [Parameter(Mandatory=$false)]
    [switch]$Wait,

    [Parameter(Mandatory=$false)]
    [int]$Timeout = 60
)

$ErrorActionPreference = "Stop"

# Directories
$QueueDir = ".message-queue"
$InboxDir = Join-Path $QueueDir "inbox"
$ResponsesDir = Join-Path $QueueDir "responses"

# Ensure directories exist
if (-not (Test-Path $InboxDir)) {
    New-Item -ItemType Directory -Path $InboxDir -Force | Out-Null
}
if (-not (Test-Path $ResponsesDir)) {
    New-Item -ItemType Directory -Path $ResponsesDir -Force | Out-Null
}

# Create message
$MessageId = [guid]::NewGuid().ToString()
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$MessageObject = @{
    id = $MessageId
    from = "powershell-cli"
    to = "cline"
    timestamp = $Timestamp
    type = "command"
    content = $Message
    metadata = @{}
}

# Save to inbox
$TimestampMs = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds * 1000
$ShortId = $MessageId.Substring(0,8)
$Filename = "${TimestampMs}_${ShortId}.json"
$Filepath = Join-Path $InboxDir $Filename

$json = $MessageObject | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($Filepath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "YOU -> CLINE" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Sent: $Message" -ForegroundColor Green
Write-Host "Message ID: $($MessageId.Substring(0,8))..." -ForegroundColor Gray
Write-Host "Time: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

if (-not $Wait) {
    Write-Host "Message sent successfully!" -ForegroundColor Green
    Write-Host "Use -Wait flag to wait for response" -ForegroundColor Yellow
    exit 0
}

# Wait for response
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "CLINE -> YOU" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Waiting for Cline to respond (timeout: ${Timeout}s)..." -ForegroundColor Yellow
Write-Host ""

$StartTime = Get-Date
$GotStart = $false

while (((Get-Date) - $StartTime).TotalSeconds -lt $Timeout) {
    if (Test-Path $ResponsesDir) {
        $ResponseFiles = Get-ChildItem -Path $ResponsesDir -Filter "*.json" -ErrorAction SilentlyContinue

        foreach ($ResponseFile in $ResponseFiles) {
            try {
                $Response = Get-Content -Path $ResponseFile.FullName -Raw | ConvertFrom-Json

                $ReplyTo = $Response.metadata.replyTo
                if ($ReplyTo -eq $MessageId) {
                    $Content = $Response.content
                    $ResponseTime = $Response.timestamp
                    $Elapsed = ((Get-Date) - $StartTime).TotalSeconds

                    if ($Content -like "Task started:*" -and -not $GotStart) {
                        $GotStart = $true
                        Write-Host "Cline acknowledged (after $([math]::Round($Elapsed, 1))s):" -ForegroundColor Green
                        Write-Host "   Time: $ResponseTime" -ForegroundColor Gray
                        Write-Host "   Status: $Content" -ForegroundColor Cyan
                        Write-Host ""
                    }
                    elseif ($Content -like "Task completed:*") {
                        Write-Host "Cline responded (after $([math]::Round($Elapsed, 1))s):" -ForegroundColor Green
                        Write-Host "   Time: $ResponseTime" -ForegroundColor Gray
                        Write-Host "   Response: $Content" -ForegroundColor White
                        Write-Host ""
                        Write-Host "======================================================================" -ForegroundColor Green
                        Write-Host "CONVERSATION COMPLETE" -ForegroundColor Green
                        Write-Host "======================================================================" -ForegroundColor Green
                        Write-Host ""

                        # Cleanup
                        Remove-Item -Path $ResponseFile.FullName -Force -ErrorAction SilentlyContinue
                        exit 0
                    }
                }
            }
            catch {
                # Skip malformed JSON
            }
        }
    }

    Start-Sleep -Milliseconds 500
}

Write-Host "No response after ${Timeout}s" -ForegroundColor Red
Write-Host "Cline may still be processing. Check VSCode." -ForegroundColor Yellow
Write-Host ""
exit 1
