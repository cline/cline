@echo off
REM PreToolUse Hook - Advanced Example with Input Parsing
REM This version reads and parses the JSON input from stdin using PowerShell

setlocal enabledelayedexpansion

REM Read all input from stdin using PowerShell
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "[Console]::In.ReadToEnd()"`) do set "INPUT=%%i"

REM Parse JSON and make decisions using PowerShell
REM Note: We use -replace to handle special characters in the input
powershell -NoProfile -Command ^
  "$input = '%INPUT%' -replace \"'\", \"''\"; ^
   try { ^
     $json = $input | ConvertFrom-Json; ^
     $toolName = $json.preToolUse.toolName; ^
     $shouldBlock = $false; ^
     $errorMsg = ''; ^
     $context = ''; ^
     if ($toolName -eq 'write_to_file') { ^
       $path = $json.preToolUse.parameters.path; ^
       if ($path -match '\\.js$') { ^
         $shouldBlock = $true; ^
         $errorMsg = 'Cannot create .js files in TypeScript project'; ^
         $context = 'WORKSPACE_RULES: Use .ts/.tsx extensions only'; ^
       } ^
     } ^
     $output = @{ ^
       shouldContinue = -not $shouldBlock; ^
     }; ^
     if ($errorMsg) { $output.errorMessage = $errorMsg }; ^
     if ($context) { $output.contextModification = $context }; ^
     $output | ConvertTo-Json -Compress; ^
   } catch { ^
     @{ shouldContinue = $true } | ConvertTo-Json -Compress; ^
   }"

endlocal
