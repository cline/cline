@echo off
REM PreToolUse Hook Example - Windows Batch Version
REM 
REM This hook runs BEFORE a tool is executed. It can:
REM 1. Block execution by returning {"shouldContinue": false}
REM 2. Add context for FUTURE tool uses via contextModification
REM 3. Validate tool parameters
REM
REM IMPORTANT: Context injection affects FUTURE AI decisions, not the current tool execution.

REM Simple example: Always allow execution with workspace context
echo {"shouldContinue": true, "contextModification": "WORKSPACE_RULES: This is a TypeScript project. Use .ts/.tsx extensions for new files."}

REM To block execution, use:
REM echo {"shouldContinue": false, "errorMessage": "Operation not allowed"}
