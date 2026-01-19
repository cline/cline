# Adding a Setting to Cline

Add a new user-facing setting (boolean toggle, dropdown, etc.) to Cline.

## Overview

Settings in Cline flow through multiple layers:
1. **Proto definition** → TypeScript generation
2. **Backend state management** → reading, writing, persistence
3. **State broadcasting** → sending to webview
4. **Frontend** → displaying and updating

**Common gotcha**: Forgetting to include the setting in `getStateToPostToWebview()` causes the setting to reset when navigating away from settings or toggling other settings.

## Step 1: Proto Definition

Add the field to both messages in `proto/cline/state.proto`:

1. **GlobalState** (for persistence):
```protobuf
message GlobalState {
  // ... existing fields
  optional bool your_setting = NEXT_NUMBER;
}
```

2. **UpdateSettingsRequest** (for updates from UI):
```protobuf
message UpdateSettingsRequest {
  // ... existing fields
  optional bool your_setting = NEXT_NUMBER;
}
```

Generate TypeScript:
```bash
npm run proto:generate
```

## Step 2: TypeScript Type Definitions

### `src/shared/storage/state-keys.ts`

Add to the `Settings` interface:
```typescript
export interface Settings {
  // ... existing
  yourSetting: boolean
}
```

### `src/shared/ExtensionMessage.ts`

Add to the `ExtensionState` interface:
```typescript
export interface ExtensionState {
  // ... existing
  yourSetting?: boolean
}
```

## Step 3: Backend State Management

### `src/core/storage/utils/state-helpers.ts`

Add reading from storage (with default value):
```typescript
// Near other similar reads (~line 320)
const yourSetting = context.globalState.get<GlobalStateAndSettings["yourSetting"]>("yourSetting")

// In the return object (~line 690)
return {
  // ... existing
  yourSetting: yourSetting ?? false, // default value
}
```

### `src/core/controller/state/updateSettings.ts`

Add handling for the setting update:
```typescript
if (request.yourSetting !== undefined) {
  controller.stateManager.setGlobalState("yourSetting", !!request.yourSetting)
}
```

## Step 4: State Broadcasting (CRITICAL)

### `src/core/controller/index.ts`

**This is the most commonly missed step!**

In `getStateToPostToWebview()`:

1. **Read the setting** (near other similar reads ~line 867):
```typescript
const yourSetting = this.stateManager.getGlobalSettingsKey("yourSetting")
```

2. **Include in return object** (~line 968):
```typescript
return {
  // ... existing
  yourSetting,
}
```

Without this, the setting will appear to save but will reset when the UI refreshes.

## Step 5: Frontend

### `webview-ui/src/context/ExtensionStateContext.tsx`

Add default value in `defaultState`:
```typescript
const defaultState: ExtensionState = {
  // ... existing
  yourSetting: false,
}
```

### UI Component (e.g., `FeatureSettingsSection.tsx`)

1. **Extract from context**:
```typescript
const { yourSetting } = useExtensionState()
```

2. **Render the control**:
```tsx
<VSCodeCheckbox
  checked={yourSetting}
  onChange={(e: any) => {
    const checked = e.target.checked === true
    updateSetting("yourSetting", checked)
  }}>
  Your Setting Label
</VSCodeCheckbox>
```

## Checklist

- [ ] `proto/cline/state.proto` - GlobalState field
- [ ] `proto/cline/state.proto` - UpdateSettingsRequest field
- [ ] `npm run proto:generate`
- [ ] `src/shared/storage/state-keys.ts` - Settings interface
- [ ] `src/shared/ExtensionMessage.ts` - ExtensionState interface
- [ ] `src/core/storage/utils/state-helpers.ts` - read with default
- [ ] `src/core/controller/state/updateSettings.ts` - handle update
- [ ] `src/core/controller/index.ts` - **getStateToPostToWebview()** (read + return)
- [ ] `webview-ui/src/context/ExtensionStateContext.tsx` - default state
- [ ] UI component - display and onChange handler

## Testing

1. Toggle the setting ON
2. Navigate away from settings (e.g., to chat)
3. Return to settings - verify setting is still ON
4. Toggle a DIFFERENT setting
5. Verify your setting didn't reset
6. Reload the window - verify persistence

