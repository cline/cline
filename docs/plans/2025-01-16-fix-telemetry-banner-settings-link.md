# Fix Telemetry Banner Settings Link to Open Correct Tab

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the telemetry banner settings button to open the General Settings tab (where telemetry settings are) instead of the default API Configuration tab.

**Architecture:** The `navigateToSettings` function accepts an optional `targetSection` parameter. The telemetry banner needs to pass "general" as the target section to open the correct tab.

**Tech Stack:** React, TypeScript

---

## Task 1: Update TelemetryBanner to pass target section

**Files:**
- Modify: `webview-ui/src/components/common/TelemetryBanner.tsx:17-20`

**Step 1: Update handleOpenSettings callback**

Pass "general" as the targetSection parameter to navigateToSettings.

Current code:
```typescript
const handleOpenSettings = useCallback(() => {
    handleClose()
    navigateToSettings()
}, [handleClose, navigateToSettings])
```

Updated code:
```typescript
const handleOpenSettings = useCallback(() => {
    handleClose()
    navigateToSettings("general") // Open General Settings tab where telemetry setting is
}, [handleClose, navigateToSettings])
```

**Step 2: Run TypeScript compiler**

```bash
npm run compile
```

**Step 3: Run linter**

```bash
npm run lint
```

**Step 4: Run format**

```bash
npm run format:fix
```

**Step 5: Run tests**

```bash
npm run test
```

**Step 6: Commit**

```bash
git add webview-ui/src/components/common/TelemetryBanner.tsx
git commit -m "fix: telemetry banner settings link opens General Settings tab

The settings button in the telemetry popup was opening the default
API Configuration tab instead of the General Settings tab where
the telemetry setting is located.

Fixes #4705"
```

**Step 7: Create changeset**

```bash
npm run changeset
```

Select:
- Type: `patch` (bug fix)
- Description: "Fix telemetry banner settings link to open General Settings tab"

---

## Testing

**Manual verification:**
1. Ensure telemetry is disabled (to see the banner)
2. Click the "settings" link in the telemetry banner
3. Verify the Settings view opens with the "General" tab selected
4. Verify the telemetry setting is visible on that tab

## Related Issues

Fixes #4705
