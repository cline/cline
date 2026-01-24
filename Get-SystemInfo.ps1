<#
.SYNOPSIS
    Displays basic system information.
.DESCRIPTION
    This script retrieves and displays the computer name, operating system version,
    total RAM, and current date/time.
#>

# Get Computer Name
$computerName = $env:COMPUTERNAME

# Get OS Version
$osVersion = (Get-CimInstance -ClassName Win32_OperatingSystem).Version
$osName = (Get-CimInstance -ClassName Win32_OperatingSystem).Caption

# Get Total RAM in GB
$totalRamBytes = (Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory
$totalRamGB = [math]::Round($totalRamBytes / 1GB, 2)

# Get Current Date/Time
$currentDateTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Display the information
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "         System Information             " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Computer Name: $computerName" -ForegroundColor White
Write-Host "OS Version:    $osName $osVersion" -ForegroundColor White
Write-Host "Total RAM:     $totalRamGB GB" -ForegroundColor White
Write-Host "Date/Time:     $currentDateTime" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
