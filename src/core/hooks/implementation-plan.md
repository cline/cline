# Edge Cases & Error Recovery - Implementation Plan

## Current State Analysis

### What's Already Good ✅
1. **Basic timeout handling** - 30s timeout with clear error message in HookProcess.ts
2. **AbortSignal support** - Cancellation infrastructure is in place
3. **Separate stdout/stderr** - Already tracked separately
4. **Context truncation** - 50KB limit exists in hook-factory.ts
5. **Graceful termination** - Basic SIGTERM → SIGKILL flow exists

### What Needs Improvement 🔧

## High Priority Implementations

### 1. Hook Output Size Limits
**File:** `src/core/hooks/HookProcess.ts`

**Current Issue:**
- No limit on stdout/stderr size
- Could cause memory issues or UI freezes with verbose hooks

**Implementation:**
```typescript
// Add constants
const MAX_HOOK_OUTPUT_SIZE = 1024 * 1024 // 1MB total

// Add tracking fields
private stdoutSize = 0
private stderrSize = 0
private outputTruncated = false

// Modify handleOutput to check size
private handleOutput(data: string, ...) {
  const dataSize = Buffer.byteLength(data)
  const currentTotalSize = this.stdoutSize + this.stderrSize
  
  if (currentTotalSize + dataSize > MAX_HOOK_OUTPUT_SIZE) {
    if (!this.outputTruncated) {
      this.outputTruncated = true
      const truncationMsg = '\n\n[Output truncated: exceeded 1MB limit]'
      // Emit truncation warning
      this.emit('line', truncationMsg, stream)
      console.warn(`Hook output exceeded ${MAX_HOOK_OUTPUT_SIZE} bytes`)
    }
    return // Drop further output
  }
  
  // Track size
  if (stream === 'stdout') {
    this.stdoutSize += dataSize
  } else {
    this.stderrSize += dataSize
  }
  
  // Continue with normal processing
  ...
}
```

**Testing:**
- Create test hook that outputs 2MB of data
- Verify truncation at 1MB
- Verify warning message appears
- Check memory usage doesn't spike

### 2. Hook Process Registry & Resource Cleanup
**Files:** 
- New: `src/core/hooks/HookProcessRegistry.ts`
- Modified: `src/core/hooks/HookProcess.ts`
- Modified: `src/extension.ts`

**Current Issue:**
- No centralized tracking of running hooks
- Extension deactivation doesn't kill hooks
- Potential zombie processes

**Implementation:**

**HookProcessRegistry.ts:**
```typescript
export class HookProcessRegistry {
  private static activeProcesses = new Set<HookProcess>()
  
  static register(process: HookProcess): void {
    this.activeProcesses.add(process)
  }
  
  static unregister(process: HookProcess): void {
    this.activeProcesses.delete(process)
  }
  
  static async terminateAll(): Promise<void> {
    const processes = Array.from(this.activeProcesses)
    console.log(`[HookProcessRegistry] Terminating ${processes.length} active hook processes`)
    await Promise.all(processes.map(p => p.terminate()))
    this.activeProcesses.clear()
  }
  
  static getActiveCount(): number {
    return this.activeProcesses.size
  }
}
```

**HookProcess.ts modifications:**
```typescript
import { HookProcessRegistry } from './HookProcessRegistry'

async run(inputJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Register on start
    HookProcessRegistry.register(this)
    
    // ... existing code ...
    
    this.childProcess.on("close", (code, signal) => {
      // Unregister on completion
      HookProcessRegistry.unregister(this)
      // ... rest of close handler
    })
    
    this.childProcess.on("error", (error) => {
      // Unregister on error
      HookProcessRegistry.unregister(this)
      // ... rest of error handler
    })
  })
}
```

**extension.ts modifications:**
```typescript
import { HookProcessRegistry } from './core/hooks/HookProcessRegistry'

export async function deactivate() {
  console.log("[Cline] Extension deactivating, cleaning up resources...")
  
  // Kill any running hooks
  await HookProcessRegistry.terminateAll()
  
  // Clean up hook cache
  const { HookDiscoveryCache } = await import('./core/hooks/HookDiscoveryCache')
  HookDiscoveryCache.getInstance().dispose()
  
  // ... existing cleanup
}
```

**Testing:**
- Start long-running hook (sleep 60s)
- Deactivate extension
- Verify hook process is killed
- Check no zombie processes remain

### 3. Improved Timeout Error Messages
**File:** `src/core/hooks/hook-factory.ts`

**Current Issue:**
- Timeout error is generic
- No context about what hook was doing
- No actionable advice

**Implementation:**
```typescript
// In StdioHookRunner[exec]
catch (error) {
  const stderr = hookProcess.getStderr()
  const exitCode = hookProcess.getExitCode()
  
  // Enhance timeout errors
  if (error instanceof Error && error.message.includes('timed out')) {
    const enhancedMessage = 
      `${this.hookName} hook timed out after ${HOOK_EXECUTION_TIMEOUT_MS}ms.\n\n` +
      `Possible causes:\n` +
      `  - Infinite loop in hook script\n` +
      `  - Network request hanging\n` +
      `  - File I/O operation stuck\n` +
      `  - Heavy computation taking too long\n\n` +
      `Script: ${this.scriptPath}\n\n` +
      `Recommendations:\n` +
      `  1. Check your hook script for infinite loops\n` +
      `  2. Add timeout to any network requests\n` +
      `  3. Use background jobs for long operations\n` +
      `  4. Test your hook script independently`
    
    if (stderr) {
      throw new Error(`${enhancedMessage}\n\nStderr: ${stderr}`)
    }
    throw new Error(enhancedMessage)
  }
  
  // ... existing error handling
}
```

**Testing:**
- Create hook with sleep 60s
- Verify enhanced timeout message appears
- Check recommendations are clear

## Medium Priority Implementations

### 4. Invalid JSON Validation
**File:** `src/core/hooks/hook-factory.ts`

**Current Issue:**
- Basic JSON.parse with try-catch
- No field validation
- Generic error messages

**Implementation:**
```typescript
/**
 * Validates hook output JSON structure
 */
function validateHookOutput(output: any): { valid: boolean; error?: string } {
  // Check shouldContinue field
  if (typeof output.shouldContinue !== 'boolean') {
    return {
      valid: false,
      error: 
        'Invalid hook output: Missing or invalid "shouldContinue" field.\n\n' +
        'Expected: {"shouldContinue": true}\n' +
        'Required: shouldContinue must be a boolean (true or false)\n\n' +
        'Example valid response:\n' +
        JSON.stringify({
          shouldContinue: true,
          contextModification: "Optional context here",
          errorMessage: "Optional error message"
        }, null, 2)
    }
  }
  
  // Check contextModification if present
  if (output.contextModification !== undefined && typeof output.contextModification !== 'string') {
    return {
      valid: false,
      error: 'Invalid hook output: "contextModification" must be a string if provided'
    }
  }
  
  // Check errorMessage if present
  if (output.errorMessage !== undefined && typeof output.errorMessage !== 'string') {
    return {
      valid: false,
      error: 'Invalid hook output: "errorMessage" must be a string if provided'
    }
  }
  
  return { valid: true }
}

// Use in parseJsonOutput:
const parseJsonOutput = (): HookOutput | null => {
  try {
    const outputData = JSON.parse(stdout)
    
    // Validate structure
    const validation = validateHookOutput(outputData)
    if (!validation.valid) {
      // Emit validation error
      if (this.streamCallback) {
        this.streamCallback(`\n❌ ${validation.error}`, 'stderr')
      }
      return null
    }
    
    const output = HookOutput.fromJSON(outputData)
    // ... rest of validation
  } catch (parseError) {
    // Enhanced parse error message
    if (this.streamCallback) {
      this.streamCallback(
        `\n❌ Failed to parse hook JSON output.\n` +
        `Error: ${parseError instanceof Error ? parseError.message : String(parseError)}\n\n` +
        `Stdout:\n${stdout.slice(0, 500)}${stdout.length > 500 ? '...' : ''}`,
        'stderr'
      )
    }
    // ... rest of parse error handling
  }
}
```

**Testing:**
- Hook with missing shouldContinue
- Hook with wrong type for contextModification
- Hook with invalid JSON
- Verify error messages are helpful

### 5. Improved Process Termination
**File:** `src/core/hooks/HookProcess.ts`

**Current Issue:**
- SIGTERM only kills parent, not process tree
- 5s timeout for force kill is long
- No process group handling

**Implementation:**
```typescript
/**
 * Terminate the process and its entire process tree
 */
async terminate(): Promise<void> {
  if (!this.childProcess || this.isCompleted) {
    return
  }
  
  const pid = this.childProcess.pid
  if (!pid) {
    return
  }
  
  try {
    // On Unix, kill process group (negative PID)
    // On Windows, tree-kill package would be better, but SIGTERM works for simple cases
    if (process.platform !== 'win32') {
      // Kill process group with SIGTERM
      process.kill(-pid, 'SIGTERM')
    } else {
      // On Windows, just kill the process
      this.childProcess.kill('SIGTERM')
    }
    
    // Wait up to 2 seconds for graceful shutdown
    const gracefulTimeout = new Promise(resolve => setTimeout(resolve, 2000))
    const processExit = new Promise(resolve => {
      this.childProcess?.once('exit', resolve)
    })
    
    await Promise.race([processExit, gracefulTimeout])
    
    // Force kill if still running
    if (!this.isCompleted) {
      if (process.platform !== 'win32') {
        process.kill(-pid, 'SIGKILL')
      } else {
        this.childProcess?.kill('SIGKILL')
      }
    }
  } catch (error) {
    // Process might already be dead, which is fine
    console.debug(`[HookProcess] Error during termination: ${error}`)
  } finally {
    // Clear timeout regardless
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}
```

**Testing:**
- Hook that spawns child processes
- Verify all children are killed
- Test on both Unix and Windows
- Verify no zombies remain

## Implementation Order

1. ✅ **Hook Output Size Limits** - Prevents memory issues (30 min)
2. ✅ **Hook Process Registry** - Prevents zombie processes (45 min)
3. ✅ **Extension Cleanup** - Ensures proper shutdown (15 min)
4. ✅ **Improved Timeout Messages** - Better UX (20 min)
5. ✅ **JSON Validation** - Better error messages (30 min)
6. ✅ **Improved Termination** - More reliable (30 min)

**Total estimated time: ~3 hours**

## Testing Plan

### Unit Tests
- Output size limiting
- Registry registration/unregistration
- JSON validation edge cases

### Integration Tests
- Long-running hook cancellation
- Extension deactivation cleanup
- Multiple concurrent hooks

### Manual Tests
- Create hooks that:
  - Output 2MB of data
  - Run for 60 seconds
  - Return invalid JSON
  - Spawn child processes
- Verify all improvements work correctly

## Documentation Updates

After implementation:
1. Update hooks README with:
   - 1MB output limit
   - 30s timeout (with note about checking scripts)
   - Proper JSON response format with examples
2. Add troubleshooting section for common errors
3. Update examples to show good practices
