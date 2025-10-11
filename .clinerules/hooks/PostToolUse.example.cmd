@echo off
REM PostToolUse Hook Example - Windows Batch Version
REM 
REM This hook runs AFTER a tool is executed. It can:
REM 1. Observe tool results and outcomes
REM 2. Add context for FUTURE tool uses via contextModification
REM 3. Log or track tool usage patterns
REM
REM IMPORTANT: Context injection affects FUTURE AI decisions, not the current tool execution.
REM The tool has already completed when this hook runs.

REM Simple example: Always allow continuation
echo {"shouldContinue": true}

REM To add context based on results, use:
REM echo {"shouldContinue": true, "contextModification": "TOOL_RESULT: Operation completed successfully"}
