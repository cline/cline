# Cline → Quantrel Integration Plan

**Goal:** Fork Cline and replace all AI providers with Quantrel marketplace integration, allowing users to authenticate once and access 500+ models.

---

## Phase 1: Authentication System Changes

### Current State (Cline)
- Users enter individual API keys for each provider (OpenAI, Anthropic, etc.)
- Keys stored in VS Code settings/secrets
- No centralized authentication

### Target State (Quantrel)
- **Single login** with email/password (Google OAuth)
- JWT token stored in VS Code SecretStorage
- All API calls use same token

### Implementation Steps

#### 1.1 Create Authentication Service

**New File:** `src/services/quantrel/QuantrelAuthService.ts`

```typescript
import * as vscode from 'vscode';

export class QuantrelAuthService {
    private context: vscode.ExtensionContext;
    private token: string | undefined;
    private readonly API_BASE_URL = 'http://localhost:8080/api';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async initialize(): Promise<boolean> {
        this.token = await this.context.secrets.get('quantrel.jwt.token');
        return this.token !== undefined;
    }

    async login(email: string, password: string): Promise<boolean> {
        // Implementation from VSCODE_EXTENSION_SAMPLE_CLIENT.ts
    }

    async logout(): Promise<void> {
        this.token = undefined;
        await this.context.secrets.delete('quantrel.jwt.token');
    }

    getToken(): string | undefined {
        return this.token;
    }

    isAuthenticated(): boolean {
        return this.token !== undefined;
    }
}
```

#### 1.2 Create Login UI

**New File:** `src/integrations/quantrel/QuantrelAuthWebview.ts`

Create a webview panel with:
- Email/password input fields
- "Login with Google" button (opens browser to OAuth flow)
- "Remember me" option
- Error handling and validation

**Features:**
- Show login status in status bar
- Display user email when logged in
- "Switch Account" command
- Auto-refresh token before expiry (7 days)

#### 1.3 Remove Old Authentication Code

**Files to Modify:**
- `src/core/config/*` - Remove API key configuration
- `src/api/providers/*` - Remove individual provider auth
- `package.json` - Remove API key settings

**Settings to Remove:**
```json
// DELETE these from package.json
"anthropic.apiKey": { ... }
"openai.apiKey": { ... }
"openrouter.apiKey": { ... }
// etc.
```

**New Settings to Add:**
```json
"quantrel.baseUrl": {
  "type": "string",
  "default": "http://localhost:8080",
  "description": "Quantrel API base URL"
}
```

#### 1.4 Update Extension Activation

**File:** `src/extension.ts`

```typescript
export async function activate(context: vscode.ExtensionContext) {
    // Initialize Quantrel auth
    const authService = new QuantrelAuthService(context);
    await authService.initialize();

    // Check if authenticated
    if (!authService.isAuthenticated()) {
        // Show login prompt
        vscode.window.showInformationMessage(
            'Login to Quantrel to start using AI features',
            'Login'
        ).then(selection => {
            if (selection === 'Login') {
                vscode.commands.executeCommand('quantrel.login');
            }
        });
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('quantrel.login', async () => {
            // Show login UI
        }),
        vscode.commands.registerCommand('quantrel.logout', async () => {
            await authService.logout();
        })
    );
}
```

---

## Phase 2: Provider System Replacement

### Current State (Cline)
- Multiple provider classes: `AnthropicHandler`, `OpenAIHandler`, etc.
- Each with different API formats
- Hardcoded model lists
- Provider-specific configurations

### Target State (Quantrel)
- **Single provider:** `QuantrelProvider`
- Unified API format (Quantrel backend handles provider differences)
- Dynamic model list from `/api/agents`

### Implementation Steps

#### 2.1 Create Quantrel Provider

**New File:** `src/api/providers/quantrel.ts`

```typescript
import { ApiHandler, ApiHandlerOptions, ApiStreamChunk } from '../'
import { QuantrelAuthService } from '../../services/quantrel/QuantrelAuthService'

export class QuantrelHandler implements ApiHandler {
    private authService: QuantrelAuthService;
    private baseUrl: string;
    private currentChatId: number | null = null;

    constructor(options: ApiHandlerOptions) {
        this.authService = options.authService;
        this.baseUrl = options.baseUrl || 'http://localhost:8080/api';
    }

    async *createMessage(systemPrompt: string, messages: any[]): AsyncGenerator<ApiStreamChunk> {
        // 1. Create or get chat session
        if (!this.currentChatId) {
            this.currentChatId = await this.createChatSession();
        }

        // 2. Format message for Quantrel API
        const content = this.formatMessages(systemPrompt, messages);

        // 3. Stream response from Quantrel
        const token = this.authService.getToken();
        const response = await fetch(
            `${this.baseUrl}/chats/${this.currentChatId}/messages/stream`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({ content })
            }
        );

        // 4. Parse SSE stream
        yield* this.parseSSEStream(response);
    }

    private async *parseSSEStream(response: Response): AsyncGenerator<ApiStreamChunk> {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.delta) {
                            yield {
                                type: 'text',
                                text: parsed.delta
                            };
                        }

                        if (parsed.done) {
                            yield {
                                type: 'usage',
                                inputTokens: parsed.inputTokens,
                                outputTokens: parsed.outputTokens
                            };
                            return;
                        }
                    } catch (e) {
                        console.error('Failed to parse SSE:', e);
                    }
                }
            }
        }
    }

    private async createChatSession(): Promise<number> {
        const token = this.authService.getToken();
        const response = await fetch(`${this.baseUrl}/chats`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: 'Cline Session' })
        });

        const data = await response.json();
        return data.id;
    }

    getModel(): { id: string, info: any } {
        // Return selected model from Quantrel
        return {
            id: this.selectedModelId,
            info: this.selectedModelInfo
        };
    }
}
```

#### 2.2 Remove Old Provider Code

**Files to DELETE:**
- `src/api/providers/anthropic.ts`
- `src/api/providers/openai.ts`
- `src/api/providers/openrouter.ts`
- `src/api/providers/bedrock.ts`
- `src/api/providers/vertex.ts`
- Any other provider-specific files

**Files to MODIFY:**
- `src/api/index.ts` - Remove imports and exports of old providers
- `src/api/transform/*` - Remove provider-specific transformations

#### 2.3 Update Provider Factory/Router

**File:** `src/api/index.ts` or wherever provider is selected

```typescript
// OLD CODE (DELETE):
switch (provider) {
    case 'anthropic':
        return new AnthropicHandler(options);
    case 'openai':
        return new OpenAIHandler(options);
    // ... etc
}

// NEW CODE:
export function createApiHandler(authService: QuantrelAuthService): ApiHandler {
    return new QuantrelHandler({
        authService,
        baseUrl: vscode.workspace.getConfiguration('quantrel').get('baseUrl')
    });
}
```

---

## Phase 3: Model Selection System

### Current State (Cline)
- Hardcoded model lists per provider
- Static model configurations
- Provider-specific model IDs

### Target State (Quantrel)
- Dynamic model list from `/api/agents`
- 500+ models available
- Search and filter capabilities
- Model details (pricing, capabilities, context window)

### Implementation Steps

#### 3.1 Create Model Service

**New File:** `src/services/quantrel/QuantrelModelService.ts`

```typescript
export interface QuantrelModel {
    id: number;
    modelId: string;
    name: string;
    publisher: string;
    briefDescription: string;
    inputPrice: number;
    outputPrice: number;
    contextWindow: number;
    inputTypes: string[];
    outputTypes: string[];
    tags: string[];
    reasoning: number;
    intelligence: number;
    speed: number;
}

export class QuantrelModelService {
    private authService: QuantrelAuthService;
    private baseUrl: string;
    private cachedModels: QuantrelModel[] = [];

    constructor(authService: QuantrelAuthService) {
        this.authService = authService;
        this.baseUrl = vscode.workspace.getConfiguration('quantrel').get('baseUrl', 'http://localhost:8080');
    }

    async fetchModels(): Promise<QuantrelModel[]> {
        const token = this.authService.getToken();
        const response = await fetch(`${this.baseUrl}/api/agents`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        this.cachedModels = await response.json();
        return this.cachedModels;
    }

    searchModels(query: string): QuantrelModel[] {
        return this.cachedModels.filter(model =>
            model.name.toLowerCase().includes(query.toLowerCase()) ||
            model.publisher.toLowerCase().includes(query.toLowerCase()) ||
            model.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
        );
    }

    filterByCapability(capability: 'reasoning' | 'intelligence' | 'speed', minScore: number): QuantrelModel[] {
        return this.cachedModels.filter(model => model[capability] >= minScore);
    }

    getModelById(modelId: string): QuantrelModel | undefined {
        return this.cachedModels.find(m => m.modelId === modelId);
    }
}
```

#### 3.2 Create Model Selection UI

**New File:** `src/integrations/quantrel/QuantrelModelPicker.ts`

QuickPick interface with:
- **Search bar** - Filter models by name/tags
- **Categories** - Group by publisher or use case
- **Model details** - Show pricing, context window, capabilities
- **Favorites** - Save frequently used models
- **Sort options** - By price, speed, intelligence, etc.

```typescript
export async function showModelPicker(
    modelService: QuantrelModelService
): Promise<QuantrelModel | undefined> {
    const models = await modelService.fetchModels();

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = 'Search models (e.g., "Claude", "GPT", "coding")';
    quickPick.items = models.map(model => ({
        label: `$(symbol-class) ${model.name}`,
        description: model.publisher,
        detail: `${model.briefDescription} | $${model.inputPrice}/1M in, $${model.outputPrice}/1M out | ${model.contextWindow.toLocaleString()} tokens`,
        model: model
    }));

    return new Promise((resolve) => {
        quickPick.onDidChangeSelection(selection => {
            resolve(selection[0]?.model);
            quickPick.dispose();
        });
        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });
        quickPick.show();
    });
}
```

#### 3.3 Replace Model Configuration

**Files to MODIFY:**

`package.json` - Remove old model settings:
```json
// DELETE:
"cline.anthropicModels": { ... }
"cline.openaiModels": { ... }

// ADD:
"quantrel.selectedModel": {
  "type": "string",
  "description": "Currently selected Quantrel model ID"
}
```

**Wherever models are accessed:**
```typescript
// OLD CODE (DELETE):
const models = {
    'claude-3-5-sonnet': { ... },
    'gpt-4': { ... }
};

// NEW CODE:
const modelService = new QuantrelModelService(authService);
const models = await modelService.fetchModels();
const selectedModel = await showModelPicker(modelService);
```

---

## Phase 4: Streaming & Response Handling

### Current State (Cline)
- Provider-specific SSE parsing
- Different event formats per provider
- Custom token counting logic

### Target State (Quantrel)
- Unified SSE format from Quantrel
- Standard events: `chunk`, `done`, `error`
- Token counts provided by backend

### Implementation Steps

#### 4.1 Update Stream Parser

**File:** `src/api/providers/quantrel.ts` (continued from Phase 2.1)

Already implemented in the `parseSSEStream` method above.

**Key Changes:**
- Parse Quantrel's SSE format: `data: {"delta": "text", "done": false}`
- Handle `chunk`, `done`, `error` events
- Extract token counts from `done` event
- No custom token counting needed (backend provides it)

#### 4.2 Remove Provider-Specific Parsers

**Files to DELETE/MODIFY:**
- Any SSE parsing specific to Anthropic/OpenAI format
- Token counting utilities (use backend counts)
- Provider-specific error handling

#### 4.3 Update Error Handling

```typescript
private async *parseSSEStream(response: Response): AsyncGenerator<ApiStreamChunk> {
    // ... existing code ...

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            // Handle error events
            if (data.error) {
                throw new Error(data.error);
            }

            // Handle authentication errors
            if (response.status === 401) {
                throw new Error('Session expired. Please login again.');
            }
        } else if (line.startsWith('event: error')) {
            // Handle SSE error events
            throw new Error('Stream error occurred');
        }
    }
}
```

---

## Phase 5: Settings & Configuration

### Settings to Remove

**File:** `package.json` → `contributes.configuration`

```json
// DELETE all provider-specific settings:
"anthropic.apiKey"
"openai.apiKey"
"openrouter.apiKey"
"bedrock.region"
"vertex.projectId"
// ... etc
```

### Settings to Add

```json
{
  "quantrel.baseUrl": {
    "type": "string",
    "default": "http://localhost:8080",
    "description": "Quantrel API base URL",
    "order": 0
  },
  "quantrel.selectedModel": {
    "type": "string",
    "description": "Currently selected model ID (e.g., 'anthropic/claude-3.5-sonnet')",
    "order": 1
  },
  "quantrel.autoSelectModel": {
    "type": "boolean",
    "default": false,
    "description": "Automatically select best model based on task",
    "order": 2
  },
  "quantrel.showTokenCosts": {
    "type": "boolean",
    "default": true,
    "description": "Show estimated costs for requests",
    "order": 3
  }
}
```

---

## Phase 6: UI/UX Changes

### 6.1 Status Bar Updates

**Current:** Shows API provider name
**New:** Show login status + selected model

```typescript
// Create status bar items
const loginStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
);

const modelStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
);

// Update login status
if (authService.isAuthenticated()) {
    loginStatusBar.text = `$(account) ${userEmail}`;
    loginStatusBar.command = 'quantrel.showAccountMenu';
} else {
    loginStatusBar.text = `$(account) Login to Quantrel`;
    loginStatusBar.command = 'quantrel.login';
}

// Update model status
if (selectedModel) {
    modelStatusBar.text = `$(symbol-class) ${selectedModel.name}`;
    modelStatusBar.command = 'quantrel.selectModel';
}
```

### 6.2 Command Palette Updates

**Commands to REMOVE:**
- "Cline: Set Anthropic API Key"
- "Cline: Set OpenAI API Key"
- etc.

**Commands to ADD:**
```json
{
  "command": "quantrel.login",
  "title": "Quantrel: Login",
  "category": "Quantrel"
},
{
  "command": "quantrel.logout",
  "title": "Quantrel: Logout",
  "category": "Quantrel"
},
{
  "command": "quantrel.selectModel",
  "title": "Quantrel: Select AI Model",
  "category": "Quantrel"
},
{
  "command": "quantrel.viewCredits",
  "title": "Quantrel: View Credits Balance",
  "category": "Quantrel"
},
{
  "command": "quantrel.browseMarketplace",
  "title": "Quantrel: Browse Model Marketplace",
  "category": "Quantrel"
}
```

### 6.3 Welcome/Onboarding Flow

**First-time user experience:**

1. Extension activates → Check if authenticated
2. If not authenticated → Show welcome message
3. "Get Started" button → Opens login webview
4. After login → Show model picker
5. After selecting model → Ready to use!

**File:** `src/integrations/quantrel/QuantrelWelcome.ts`

---

## Phase 7: Error Handling & Edge Cases

### 7.1 Token Expiration Handling

```typescript
export class QuantrelAuthService {
    private tokenExpiryTime: Date | null = null;

    async initialize() {
        this.token = await this.context.secrets.get('quantrel.jwt.token');
        const expiry = await this.context.secrets.get('quantrel.jwt.expiry');

        if (expiry) {
            this.tokenExpiryTime = new Date(expiry);
        }

        // Check if token expired
        if (this.tokenExpiryTime && new Date() > this.tokenExpiryTime) {
            await this.logout();
            return false;
        }

        return this.token !== undefined;
    }

    async refreshTokenIfNeeded(): Promise<void> {
        if (!this.tokenExpiryTime) return;

        // Refresh 1 day before expiry
        const oneDayBeforeExpiry = new Date(this.tokenExpiryTime);
        oneDayBeforeExpiry.setDate(oneDayBeforeExpiry.getDate() - 1);

        if (new Date() > oneDayBeforeExpiry) {
            // Prompt user to re-login
            const result = await vscode.window.showWarningMessage(
                'Your Quantrel session will expire soon. Please login again.',
                'Login Now',
                'Remind Me Later'
            );

            if (result === 'Login Now') {
                await vscode.commands.executeCommand('quantrel.login');
            }
        }
    }
}
```

### 7.2 Network Error Handling

```typescript
async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: {
                ...options?.headers,
                'Authorization': `Bearer ${this.token}`
            }
        });

        if (response.status === 401) {
            // Token invalid
            await this.logout();
            throw new Error('Session expired. Please login again.');
        }

        if (response.status === 403) {
            throw new Error('Insufficient credits. Please top up your account.');
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Request failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error('Cannot connect to Quantrel backend. Is it running?');
        }
        throw error;
    }
}
```

### 7.3 Insufficient Credits Handling

```typescript
// Show credits balance and prompt to top up
async handleInsufficientCredits() {
    const credits = await this.getCreditsBalance();

    const result = await vscode.window.showErrorMessage(
        `Insufficient credits. Current balance: $${credits.balance}`,
        'Top Up',
        'View Pricing'
    );

    if (result === 'Top Up') {
        vscode.env.openExternal(vscode.Uri.parse('https://quantrel.app/billing'));
    } else if (result === 'View Pricing') {
        vscode.env.openExternal(vscode.Uri.parse('https://quantrel.app/pricing'));
    }
}
```

---

## Phase 8: Testing Strategy

### 8.1 Unit Tests

**New test files to create:**

- `src/test/quantrel/QuantrelAuthService.test.ts`
- `src/test/quantrel/QuantrelProvider.test.ts`
- `src/test/quantrel/QuantrelModelService.test.ts`

**Mock Quantrel API responses:**

```typescript
const mockFetch = jest.fn();
global.fetch = mockFetch;

mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
        token: 'mock-jwt-token',
        expiresIn: 604800
    })
});
```

### 8.2 Integration Tests

**Test scenarios:**
1. ✅ Login flow works end-to-end
2. ✅ Model list fetches correctly
3. ✅ Chat session creation
4. ✅ Message streaming works
5. ✅ Token refresh logic
6. ✅ Error handling (401, 403, network errors)

### 8.3 Manual Testing Checklist

- [ ] Install extension
- [ ] First-time setup flow
- [ ] Login with email/password
- [ ] Login with Google OAuth
- [ ] Select a model from marketplace
- [ ] Send a simple message
- [ ] Test streaming response
- [ ] Test code generation
- [ ] Test file editing commands
- [ ] Logout and re-login
- [ ] Token expiration handling
- [ ] Network error scenarios
- [ ] Insufficient credits scenario

---

## Phase 9: Migration Guide for Existing Users

### 9.1 Migration Notice

Show on first launch after update:

```
Cline has been upgraded to use Quantrel!

What's New:
✨ Access to 500+ AI models in one place
🔐 Single login - no more managing multiple API keys
💰 Pay-as-you-go pricing across all models

Get Started:
1. Login to your Quantrel account (or create one)
2. Select your preferred AI model
3. Start coding!

[Get Started] [Learn More]
```

### 9.2 Settings Migration

```typescript
async function migrateOldSettings(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('cline');

    // Check if user has old API keys
    const hasAnthropicKey = config.get('anthropic.apiKey');
    const hasOpenAIKey = config.get('openai.apiKey');

    if (hasAnthropicKey || hasOpenAIKey) {
        const result = await vscode.window.showInformationMessage(
            'Detected old API key configuration. Quantrel now handles all API keys centrally.',
            'Clear Old Keys',
            'Keep for Now'
        );

        if (result === 'Clear Old Keys') {
            // Clear old settings
            await config.update('anthropic.apiKey', undefined, true);
            await config.update('openai.apiKey', undefined, true);
        }
    }
}
```

---

## Phase 10: Documentation Updates

### 10.1 README Updates

**File:** `README.md`

Update sections:
- **Setup** → Replace API key instructions with "Login to Quantrel"
- **Features** → Highlight marketplace access
- **Configuration** → Document new settings
- **Screenshots** → Show new UI

### 10.2 Create Quantrel-specific Docs

**New File:** `docs/QUANTREL_SETUP.md`

Content:
- How to create a Quantrel account
- How to login from extension
- How to browse and select models
- How to manage credits
- Pricing information
- FAQ

### 10.3 Update CHANGELOG

```markdown
## [2.0.0] - 2025-XX-XX

### Major Changes
- **BREAKING:** Replaced individual AI provider integrations with Quantrel marketplace
- Single authentication system - no more managing multiple API keys
- Access to 500+ AI models from one interface

### Added
- Quantrel authentication (email/password + Google OAuth)
- Dynamic model marketplace with search and filters
- Real-time credit balance display
- Unified streaming interface

### Removed
- Direct API key configuration for Anthropic, OpenAI, etc.
- Provider-specific settings

### Migration
See MIGRATION.md for upgrading from 1.x
```

---

## Implementation Order (Recommended)

### Week 1: Foundation
1. ✅ Phase 1: Authentication System (Days 1-3)
2. ✅ Phase 2: Provider Replacement (Days 4-5)
3. ✅ Test basic chat flow (Days 6-7)

### Week 2: Core Features
4. ✅ Phase 3: Model Selection (Days 1-2)
5. ✅ Phase 4: Streaming (Days 3-4)
6. ✅ Phase 5: Settings (Day 5)
7. ✅ Testing (Days 6-7)

### Week 3: Polish
8. ✅ Phase 6: UI/UX (Days 1-3)
9. ✅ Phase 7: Error Handling (Days 4-5)
10. ✅ Phase 10: Documentation (Days 6-7)

### Week 4: Launch Prep
11. ✅ Phase 8: Comprehensive Testing
12. ✅ Phase 9: Migration Guide
13. ✅ Beta testing with real users
14. ✅ Final polish and bug fixes

---

## File Structure Summary

### New Files to Create
```
src/
├── services/
│   └── quantrel/
│       ├── QuantrelAuthService.ts       [Phase 1]
│       └── QuantrelModelService.ts      [Phase 3]
├── api/
│   └── providers/
│       └── quantrel.ts                  [Phase 2]
├── integrations/
│   └── quantrel/
│       ├── QuantrelAuthWebview.ts       [Phase 1]
│       ├── QuantrelModelPicker.ts       [Phase 3]
│       └── QuantrelWelcome.ts           [Phase 6]
└── test/
    └── quantrel/
        ├── QuantrelAuthService.test.ts  [Phase 8]
        ├── QuantrelProvider.test.ts     [Phase 8]
        └── QuantrelModelService.test.ts [Phase 8]

docs/
└── QUANTREL_SETUP.md                    [Phase 10]
```

### Files to Delete
```
src/
└── api/
    └── providers/
        ├── anthropic.ts
        ├── openai.ts
        ├── openrouter.ts
        ├── bedrock.ts
        └── vertex.ts
```

### Files to Modify
```
src/
├── extension.ts              [Phase 1: Add auth initialization]
├── api/index.ts              [Phase 2: Remove old provider references]
package.json                  [Phases 1,3,5,6: Update settings & commands]
README.md                     [Phase 10: Update documentation]
CHANGELOG.md                  [Phase 10: Document changes]
```

---

## Success Criteria

### Must Have
- [x] User can login with email/password
- [x] JWT token stored securely in VS Code
- [x] All chat functionality works through Quantrel API
- [x] Model selection from marketplace works
- [x] Streaming responses display correctly
- [x] Token expiration handled gracefully
- [x] Credits balance visible
- [x] All Cline features (code editing, terminal, etc.) still work

### Should Have
- [ ] Google OAuth login
- [ ] Model search and filtering
- [ ] Cost estimation before requests
- [ ] Favorite models
- [ ] Auto-refresh token
- [ ] Migration guide for existing users

### Nice to Have
- [ ] Model recommendations based on task
- [ ] Usage analytics dashboard
- [ ] Model performance comparison
- [ ] Credits usage alerts
- [ ] Team/organization support

---

## Risk Mitigation

### Risk 1: Breaking Changes for Existing Users
**Mitigation:**
- Clear migration guide
- Show helpful errors with migration instructions
- Option to keep using old version

### Risk 2: Backend Downtime
**Mitigation:**
- Show clear error messages
- Implement retry logic
- Cache model list locally

### Risk 3: Token Security
**Mitigation:**
- Use VS Code SecretStorage API (encrypted)
- Never log tokens
- Clear tokens on logout
- Short expiration times

### Risk 4: Performance Issues
**Mitigation:**
- Cache model list (refresh hourly)
- Stream responses incrementally
- Lazy-load model details
- Debounce search queries

---

## Questions to Resolve

1. **Model Selection Persistence:** Should selected model be per-workspace or global?
2. **Multi-Account Support:** Do we need to support multiple Quantrel accounts?
3. **Offline Mode:** What happens when backend is unreachable?
4. **Rate Limiting:** How do we handle Quantrel API rate limits?
5. **Telemetry:** What usage data should we collect (with user consent)?

---

## Next Steps

1. ✅ Review this plan with team
2. ✅ Set up development environment
3. ✅ Create feature branch: `feat/quantrel-integration`
4. ✅ Start with Phase 1 (Authentication)
5. ✅ Daily standups to track progress
6. ✅ Weekly demo to stakeholders

---

**Let's build this! 🚀**
