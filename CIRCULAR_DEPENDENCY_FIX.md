# Circular Dependency Fix for SharedUriHandler

## Problem
Integration tests fail with error:
```
TypeError: Class extends value undefined is not a constructor or null
    at VscodeWebviewProvider.js:37:47
```

This occurs due to a circular dependency introduced by `SharedUriHandler` in commit `0ddef94d`.

## Root Cause
**Circular Dependency Chain:**
1. `src/extension.ts` imports `SharedUriHandler` 
2. `SharedUriHandler` imports `WebviewProvider` from `@/core/webview`
3. `WebviewProvider` creates `Controller` in constructor
4. During test environment, this creates circular dependency causing `WebviewProvider` to be `undefined`

## Solution

### Step 1: Fix SharedUriHandler.ts
Change the import from direct import to type-only import and modify the method signature:

```typescript
// Before:
import { WebviewProvider } from "@/core/webview"

public static async handleUri(uri: vscode.Uri): Promise<boolean> {
    const visibleWebview = WebviewProvider.getVisibleInstance()
    // ...
}

// After:
import type { WebviewProvider } from "@/core/webview"

public static async handleUri(uri: vscode.Uri, visibleWebview?: WebviewProvider): Promise<boolean> {
    if (!visibleWebview) {
        console.warn("SharedUriHandler: No visible webview provided")
        return false
    }
    // ...
}
```

### Step 2: Update extension.ts
Pass the webview instance when calling the handler:

```typescript
// Before:
const handleUri = async (uri: vscode.Uri) => {
    const success = await SharedUriHandler.handleUri(uri)
    if (!success) {
        console.warn("Extension URI handler: Failed to process URI:", uri.toString())
    }
}

// After:
const handleUri = async (uri: vscode.Uri) => {
    const visibleWebview = WebviewProvider.getVisibleInstance()
    const success = await SharedUriHandler.handleUri(uri, visibleWebview)
    if (!success) {
        console.warn("Extension URI handler: Failed to process URI:", uri.toString())
    }
}
```

## Why This Works
- **Type-only imports** (`import type`) don't create runtime dependencies, breaking the circular dependency
- **Dependency injection** makes the code more modular and testable
- The webview instance is obtained where it's actually available (extension context) rather than inside SharedUriHandler

## Files to Modify
1. `src/services/uri/SharedUriHandler.ts` - Change import and method signature
2. `src/extension.ts` - Update handleUri function to pass webview instance

## Test
After applying the fix, run:
```bash
npm run test
```
Both unit tests (62 passing) and integration tests (199 passing) should pass.

## Status
- **Impact**: Integration tests completely broken
- **Severity**: High - blocks CI/CD and development workflow  
- **Solution**: Known and straightforward to implement
- **Compatibility**: No breaking changes to functionality
