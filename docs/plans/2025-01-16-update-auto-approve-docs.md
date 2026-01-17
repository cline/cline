# Update Auto-Approve Menu Documentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the auto-approve documentation to reflect the new UI where the notification toggle has been moved from General Settings into the auto-approve menu itself.

**Architecture:** Documentation-only change. Update markdown to accurately describe current UI implementation.

**Tech Stack:** Markdown (MDX format)

---

## Task 1: Update auto-approve documentation file

**Files:**
- Modify: `docs/features/auto-approve.mdx`

**Step 1: Update the "Enable notifications" section in the documentation**

The notification toggle has been moved from General Settings into the auto-approve menu itself. The "Configure notification settings" link no longer exists. Update the documentation to reflect this change.

Current relevant section (around line 91-93):
```markdown
## Enable notifications

Auto-approved actions can run for a while, especially long terminal commands. If you enable notifications, Cline can notify you when an auto-approved command has been running for a while and may need attention.
```

This section should be updated to mention that the notification toggle is now directly accessible in the auto-approve menu at the bottom, below a separator line.

**Step 2: Update the Permissions table if needed**

The Permissions table (around line 41-51) currently lists:
```markdown
| Enable notifications | Notifies you about long-running auto-approved commands | Helpful for terminal work |
```

This entry should be updated to clarify that this toggle is now located at the bottom of the auto-approve menu itself.

**Step 3: Remove references to "Configure notification settings" link**

Search for any mentions of "Configure notification settings" in the documentation and remove them, as this link no longer exists.

**Step 4: Run format check**

```bash
npm run format:fix
```

**Step 5: Commit**

```bash
git add docs/features/auto-approve.mdx
git commit -m "docs: update auto-approve menu documentation with new notification toggle location

- Update Enable notifications section to reflect toggle is now in auto-approve menu
- Remove references to Configure notification settings link
- Clarify notification toggle appears at bottom of menu below separator

Fixes #7810"
```

**Step 6: Create changeset**

```bash
npm run changeset
```

Select:
- Type: `patch` (documentation update)
- Description: "Update auto-approve documentation to reflect new notification toggle location in the menu"

---

## Testing

**Manual verification:**
1. Open the updated documentation file
2. Verify the "Enable notifications" section mentions the toggle is in the auto-approve menu
3. Verify there are no references to "Configure notification settings" link
4. Check the formatting looks correct

## Related Issues

Fixes #7810
