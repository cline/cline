# Edge Cases & Error Recovery Improvement Plan

## Issues Identified in Code Review

### 1. Hook Execution Timeout Handling

**Current Issue:**
- Timeout is hard-coded to 30 seconds
- No distinction between different hook types
- Timeout message could be more informative

**Proposed Solution:**
- Make timeout configurable per hook type (PreToolUse might need different timeout than PostToolUse)
- Add telemetry for timeout frequency to help users adjust settings
- Improve timeout error messages to include:
  - Which hook timed out
  - How long it ran
  - Suggestion to check hook script or increase timeout

**Implementation:**
```typescript
// In HookProcess.ts
interface HookTimeoutConfig {
  defaultTimeout: number
  perHookTimeout?: Record<string, number>
}

// Better error message
throw new Error(
  `Hook '${hookName}' timed out after ${timeout}ms. ` +
  `Check your hook script for infinite loops or long-running operations. ` +
  `You can increase the timeout in settings if needed.`
)
```

### 2. Concurrent Hook Execution

**Current Issue:**
- Multiple hooks can run concurrently (global + workspace hooks)
- No mechanism to detect if one hook's output affects another
- Potential for race conditions in shared resources

**Current Protection:**
- `CombinedHookRunner` runs hooks in parallel with `Promise.all`
- Results are combined after all complete

**Proposed Improvements:**
- Add hook execution ID for tracing
- Log concurrent executions for debugging
- Document that hooks should be stateless and not depend on each other

**Implementation:**
```typescript
// Add execution tracking
class HookExecutionTracker {
  private activeExecutions = new Map<string, Set<string>>()
  
  startExecution(hookName: string, scriptPath: string): string {
    const executionId = `${hookName}-${Date.now()}-${Math.random()}`
    if (!this.activeExecutions.has(hookName)) {
      this.activeExecutions.set(hookName, new Set())
    }
    this.activeExecutions.get(hookName)!.add(executionId)
    
    // Log if multiple executions of same hook
    if (this.activeExecutions.get(hookName)!.size > 1) {
      console.warn(
        `Multiple ${hookName} hooks executing concurrently. ` +
        `Hooks should be stateless and independent.`
      )
    }
    
    return executionId
  }
  
  endExecution(hookName: string, executionId: string): void {
    this.activeExecutions.get(hookName)?.delete(executionId)
  }
}
```

### 3. Hook Output Size Limits

**Current Issue:**
- Context modification is limited to 50KB (good!)
- But hook stdout/stderr has no size limit
- Could overwhelm the UI or cause memory issues

**Proposed Solution:**
- Add max output size limit (e.g., 1MB for stdout + stderr combined)
- Truncate large outputs with clear indication
- Warn users if hook produces excessive output

**Implementation:**
```typescript
// In HookProcess.ts
const MAX_HOOK_OUTPUT_SIZE = 1024 * 1024 // 1MB

class HookProcess {
  private stdoutSize = 0
  private stderrSize = 0
  private outputTruncated = false
  
  private handleStdout(data: string): void {
    this.stdoutSize += Buffer.byteLength(data)
    
    if (this.stdoutSize + this.stderrSize > MAX_HOOK_OUTPUT_SIZE) {
      if (!this.outputTruncated) {
        this.outputTruncated = true
        this.stdout += '\n\n[Output truncated: exceeded 1MB limit]\n'
        console.warn(`Hook output exceeded ${MAX_HOOK_OUTPUT_SIZE} bytes`)
      }
      return
    }
    
    this.stdout += data
    this.emit('line', data, 'stdout')
  }
}
```

### 4. Invalid JSON Handling

**Current Issue:**
- JSON parsing has basic try-catch
- Could provide better feedback about what's wrong
- No validation of required fields

**Proposed Solution:**
- Validate JSON structure against expected schema
- Provide specific error messages about what's missing/wrong
- Include examples of correct format in error messages

**Implementation:**
```typescript
function validateHookOutput(output: HookOutput): { valid: boolean; error?: string } {
  if (typeof output.shouldContinue !== 'boolean') {
    return {
      valid: false,
      error: 'Missing required field "shouldContinue" (boolean). Example: {"shouldContinue": true}'
    }
  }
  
  if (output.contextModification !== undefined && typeof output.contextModification !== 'string') {
    return {
      valid: false,
      error: 'Field "contextModification" must be a string if provided'
    }
  }
  
  if (output.errorMessage !== undefined && typeof output.errorMessage !== 'string') {
    return {
      valid: false,
      error: 'Field "errorMessage" must be a string if provided'
    }
  }
  
  return { valid: true }
}
```

### 5. Hook Cancellation

**Current Issue:**
- Cancellation uses AbortSignal (good!)
- But cleanup after cancellation could be more thorough
- No guarantee that child processes are killed

**Proposed Solution:**
- Ensure child process tree is killed (not just parent)
- Clean up any temporary files/resources
- Add timeout for graceful shutdown before force kill

**Implementation:**
```typescript
// In HookProcess.ts
async terminate(): Promise<void> {
  if (!this.process || this.terminated) {
    return
  }
  
  this.terminated = true
  
  // Try graceful shutdown first (SIGTERM)
  try {
    if (this.process.pid) {
      process.kill(-this.process.pid, 'SIGTERM') // Negative PID kills process group
    }
    
    // Wait up to 2 seconds for graceful shutdown
    await Promise.race([
      new Promise(resolve => this.process?.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2000))
    ])
  } catch (error) {
    // Process might already be dead
  }
  
  // Force kill if still running
  if (this.process && !this.process.killed) {
    try {
      if (this.process.pid) {
        process.kill(-this.process.pid, 'SIGKILL')
      }
    } catch (error) {
      // Process already dead, that's fine
    }
  }
}
```

### 6. Resource Cleanup

**Current Issue:**
- File watchers are properly disposed
- But no explicit cleanup of hook processes on extension deactivate

**Proposed Solution:**
- Track all running hook processes globally
- Kill all on extension deactivation
- Add telemetry for hooks that don't complete within reasonable time

**Implementation:**
```typescript
// Global registry
class HookProcessRegistry {
  private static activeProcesses = new Set<HookProcess>()
  
  static register(process: HookProcess): void {
    this.activeProcesses.add(process)
  }
  
  static unregister(process: HookProcess): void {
    this.activeProcesses.delete(process)
  }
  
  static async terminateAll(): Promise<void> {
    const processes = Array.from(this.activeProcesses)
    await Promise.all(processes.map(p => p.terminate()))
    this.activeProcesses.clear()
  }
}

// In extension.ts deactivate()
export async function deactivate() {
  // ... existing cleanup
  
  // Kill any running hooks
  await HookProcessRegistry.terminateAll()
  
  // Clean up hook cache
  HookDiscoveryCache.getInstance().dispose()
}
```

## Implementation Priority

**High Priority (Do First):**
1. Hook output size limits - prevents memory issues
2. Improved timeout error messages - helps users debug
3. Resource cleanup on deactivation - prevents zombie processes

**Medium Priority:**
4. Invalid JSON validation - better error messages
5. Hook cancellation improvements - more reliable

**Low Priority (Nice to Have):**
6. Concurrent execution tracking - mainly for debugging
7. Configurable timeouts - can be added later based on user feedback

## Testing Strategy

For each improvement:
1. Create test hooks that trigger the edge case
2. Verify error messages are clear and actionable
3. Confirm resources are cleaned up properly
4. Test on multiple platforms (Windows, macOS, Linux)

## Documentation Updates

After implementation:
1. Update hooks README with size limits and timeout info
2. Add troubleshooting section for common issues
3. Include examples of good vs. bad hook implementations
4. Document cancellation behavior
