# send-program.ps1
# Send a program script to Cline for execution
# Usage: .\send-program.ps1 -ProgramFile "script.py" -Wait

param(
    [Parameter(Mandatory=$false)]
    [string]$ProgramFile,

    [Parameter(Mandatory=$false)]
    [string]$CustomCommand,

    [Parameter(Mandatory=$false)]
    [switch]$Wait,

    [Parameter(Mandatory=$false)]
    [int]$Timeout = 120
)

if (-not $ProgramFile -and -not $CustomCommand) {
    Write-Host "Error: Must provide either -ProgramFile or -CustomCommand" -ForegroundColor Red
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\send-program.ps1 -ProgramFile 'script.py' -Wait" -ForegroundColor Cyan
    Write-Host "  .\send-program.ps1 -CustomCommand 'Run the file analyzer.py and show me the results' -Wait" -ForegroundColor Cyan
    Write-Host "  .\send-program.ps1 -CustomCommand 'Create and execute a Python script that calculates fibonacci(10)' -Wait" -ForegroundColor Cyan
    exit 1
}

if ($ProgramFile) {
    if (-not (Test-Path $ProgramFile)) {
        Write-Host "Error: File not found: $ProgramFile" -ForegroundColor Red
        exit 1
    }

    $FileContent = Get-Content -Path $ProgramFile -Raw
    $FileName = Split-Path -Leaf $ProgramFile

    $Command = @"
Execute this program:

File: $FileName
```
$FileContent
```

Please run this program and show me the output.
"@
} else {
    $Command = $CustomCommand
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "SENDING PROGRAM TO CLINE FOR EXECUTION" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if ($Wait) {
    .\Send-ClineMessage.ps1 "$Command" -Wait -Timeout $Timeout
} else {
    .\Send-ClineMessage.ps1 "$Command"
}
