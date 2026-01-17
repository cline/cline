# Fix Checkbox Toggle When Clicking Adjacent Whitespace

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where checkboxes in Settings toggle when clicking on the empty space beside the checkbox/label, instead of only when clicking directly on the checkbox control or label text.

**Architecture:** The VSCodeCheckbox component from @vscode/webview-ui-toolkit/react allows clicking anywhere in its container to toggle. We need to either: (1) wrap the checkbox in a container with proper click handling, or (2) use event stopping on adjacent elements, or (3) adjust the component structure.

Based on the code analysis, the cleanest approach is to ensure only the checkbox and its direct label trigger the toggle, not surrounding whitespace.

**Tech Stack:** React, TypeScript, @vscode/webview-ui-toolkit

---

## Task 1: Identify and analyze checkbox usage patterns

**Files to examine:**
- `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`
- Other settings sections

**Step 1: Examine current checkbox implementation**

Looking at FeatureSettingsSection.tsx, checkboxes are used like:
```tsx
<VSCodeCheckbox checked={enableCheckpointsSetting} onChange={...}>
    Enable Checkpoints
</VSCodeCheckbox>
```

The VSCodeCheckbox component from the toolkit makes its entire clickable area trigger the toggle. The issue is that the component's click handler covers too much space.

**Step 2: Check if VSCodeCheckbox has a prop to control click behavior**

The VSCodeCheckbox component from @vscode/webview-ui-toolkit uses a standard pattern where clicking the label triggers the checkbox. The issue may be in how the parent container is styled or structured.

---

## Task 2: Implement fix - Option A: Use proper label wrapper

The VSCodeCheckbox component should only trigger when clicking the checkbox itself or its direct label text. Let's check if there's extra whitespace or padding causing the issue.

Looking at the VSCodeCheckbox usage, the children of the component become the label. The issue might be that:
1. There's extra whitespace in the text content
2. The parent container is triggering the event
3. The component itself has a click handler that's too broad

**Step 1: Trim whitespace and ensure tight wrapping**

For each checkbox, ensure there's no unnecessary whitespace around the label text:

Example fix pattern:
```tsx
<VSCodeCheckbox checked={enableCheckpointsSetting} onChange={...}>
    <span className="inline-block">Enable Checkpoints</span>
</VSCodeCheckbox>
```

The `inline-block` span ensures only the text itself is clickable, not surrounding whitespace.

**Step 2: Apply to all affected checkboxes**

This needs to be applied to all checkboxes in the settings sections. The most common/visible ones are in FeatureSettingsSection.tsx.

---

## Task 3: Alternative approach - Stop event propagation

If the inline-block approach doesn't work, we can prevent clicks on the container from propagating.

**Step 1: Add click handler to parent div**

Wrap checkboxes in a div with a click handler that stops propagation for clicks outside the checkbox:

```tsx
<div onClick={(e) => e.stopPropagation()}>
    <VSCodeCheckbox checked={enableCheckpointsSetting} onChange={...}>
        Enable Checkpoints
    </VSCodeCheckbox>
</div>
```

However, this is more invasive. Let's try the simpler approach first.

---

## Task 4: Implement the minimal fix (inline-block labels)

**Files:**
- Modify: `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`

**Step 1: Update checkbox labels to use inline-block spans**

Find each `VSCodeCheckbox` in FeatureSettingsSection.tsx and wrap the label text in an inline-block span.

Example for "Enable Checkpoints" (around line 173-180):
Current:
```tsx
<VSCodeCheckbox
    checked={enableCheckpointsSetting}
    onChange={(e: any) => {
        const checked = e.target.checked === true
        updateSetting("enableCheckpointsSetting", checked)
    }}>
    Enable Checkpoints
</VSCodeCheckbox>
```

Updated:
```tsx
<VSCodeCheckbox
    checked={enableCheckpointsSetting}
    onChange={(e: any) => {
        const checked = e.target.checked === true
        updateSetting("enableCheckpointsSetting", checked)
    }}>
    <span className="inline-block">Enable Checkpoints</span>
</VSCodeCheckbox>
```

**Step 2: Apply to other major checkboxes**

Apply the same pattern to other high-visibility checkboxes:
- "Collapse MCP Responses" (line 204-211)
- "Enable strict plan mode" (line 240-247)
- "Enable Focus Chain" (line 254-261)
- "Enable Auto Compact" (line 316-323)
- "Enable Native Tool Call" (line 351-358)
- "Enable Parallel Tool Calling" (line 365-372)
- "Enable Background Edit" (line 381-388)
- "Enable Multi-Root Workspace" (line 398-405)
- "Enable Hooks" (line 413-420)
- "Enable Skills" (line 437-444)
- "Enable YOLO Mode" (line 457-464)

**Step 3: Run TypeScript compiler**

```bash
npm run compile
```

**Step 4: Run linter**

```bash
npm run lint
```

**Step 5: Run format**

```bash
npm run format:fix
```

**Step 6: Run tests**

```bash
npm run test
```

**Step 7: Commit**

```bash
git add webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx
git commit -m "fix: prevent checkbox toggle when clicking adjacent whitespace

Wrapped checkbox label text in inline-block spans to ensure only
the actual checkbox control and label text are clickable, not the
surrounding whitespace area.

Fixes #6083"
```

**Step 8: Create changeset**

```bash
npm run changeset
```

Select:
- Type: `patch` (bug fix)
- Description: "Fix checkbox click area to prevent toggling on adjacent whitespace"

---

## Testing

**Manual verification:**
1. Open Settings > Features tab
2. Find a checkbox (e.g., "Enable Checkpoints")
3. Click in the empty space beside the checkbox text
4. Verify the checkbox does NOT toggle
5. Click directly on the checkbox or the label text
6. Verify the checkbox DOES toggle

## Related Issues

Fixes #6083

## Notes

If the inline-block approach doesn't fully resolve the issue, the alternative approach is to add event.stopPropagation() to the parent container, but this is more invasive and may have other side effects.
