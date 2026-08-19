# Networking & Proxy Support

To ensure Cline works correctly in all environments (VSCode, JetBrains, CLI) and with various network configurations (especially corporate proxies), strictly follow these guidelines for all network activity.

In extension code, do NOT use the global `fetch` or a default `axios` instance. (Note, `shared/net.ts` is exempt from these rules because it sets up the fetch wrappers.) In Webview code, you SHOULD use global `fetch`.

Global `fetch` and default `axios` do not automatically pick up proxy configurations in all environments (specifically JetBrains and CLI). You MUST use the provided utilities in `@/shared/net` which handle proxy agent configuration. In the webview, the browser/embedder handles proxies.

## Guidelines

### 1. Using `fetch`

Instead of `fetch(...)`, import the proxy-aware wrapper:

```typescript
import { fetch } from '@/shared/net'

// Usage is identical to global fetch
const response = await fetch('https://api.example.com/data')
```

### 2. Using `axios`

When using `axios`, you must apply the settings from `getAxiosSettings()`:

```typescript
import axios from 'axios'
import { getAxiosSettings } from '@/shared/net'

const response = await axios.get('https://api.example.com/data', {
  headers: { 'Authorization': '...' },
  ...getAxiosSettings() // <--- CRITICAL: Injects the proxy agent if needed
})
```

### 3. Third-Party Clients (OpenAI, Ollama, etc.)

Most API client libraries allow you to customize the `fetch` implementation. You **MUST** pass the proxy-aware `fetch` to these clients.

**Example (OpenAI):**
```typescript
import OpenAI from "openai"
import { fetch } from "@/shared/net"

this.client = new OpenAI({
  apiKey: '...',
  fetch, // <--- CRITICAL: Pass our fetch wrapper
})
```

### 4. Tests

Use `mockFetchForTesting` to mock the underlying fetch implementation.

**Example (callback):**

```
import { mockFetchForTesting } from "@/shared/net"

...
  let mockFetch = ...
  mockFetchForTesting(mockFetch, () => {
    // This calls mockFetch
    fetch('https://foo.example').then(...)
  })
  // Original fetch is restored immediately when the call returns.
```

**Example (Promise):**

```
import { mockFetchForTesting } from "@/shared/net"

...
  let mockFetch = ...
  await mockFetchForTesting(mockFetch, async () => {
    await ...
    // This calls mockFetch
    await fetch('https://foo.example')
    ...
  })
  // Original fetch is restored when the Promise from the callback settles
```

## Verification

If you are adding a new network call or integration:
1.  Check `@/shared/net.ts` is imported.
2.  Ensure `fetch` or `getAxiosSettings` is being used.
3.  Verify that third-party clients are configured to use the custom fetch.
