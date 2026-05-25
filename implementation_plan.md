# Implementation Plan — Cline UI Changes

## [Overview]
Redesign the chat panel's bottom toolbar and input area to improve UX by consolidating controls into focused popups and upgrading the Plan/Act segmented control.

This plan implements 6 sequential UI changes described in `cline-ui-changes.md` and a working HTML prototype provided by the user (`/Users/raiden/Downloads/files/cline-ui-changes.md` + HTML mockup). All changes are **purely visual/UX** — no logic, state management, API calls, or data sources are modified. All existing functionality is preserved; controls are reorganized into better locations. The work is focused on `webview-ui/src/components/chat/` and its subdirectories. The codebase uses React + TypeScript + styled-components + Tailwind CSS.

**Key design details confirmed by the HTML prototype:**
- Toggle switches use custom CSS (not VSCode checkboxes): `28×16px`, ON=`#2563eb`, OFF=`#2e2e2e`, thumb white/gray
- The `⚖` (Rules) button uses a **custom SVG** balance-scale icon (not `codicon-law`)
- The `+` popup auto-approve accordion is **expanded by default**
- The Git Commits accordion is open by default in the Add Context modal
- Only one accordion can be open at a time in the Add Context modal
- Toggle items render as custom `<label class="toggle">` not `VSCodeCheckbox`

Before coding begins, two setup tasks are required:
1. `git pull` — the local branch is 16 commits behind `origin/main`
2. `npm install` — `cli/node_modules` is nearly empty; root and webview-ui modules appear present

---

## [Types]
Only minor type additions for the new popup components' props interfaces — no global type changes.

New interfaces (all defined inline in their respective component files):
```typescript
// PlusPopup.tsx
interface PlusPopupProps {
  isOpen: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
  onAddContext: () => void         // triggers existing context-button click
  onAddFilesAndImages: () => void  // existing file picker handler
}

// AddContextModal.tsx
interface AddContextModalProps {
  isOpen: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
  onInsertMention: (value: string) => void  // calls existing insertMentionDirectly
}

// ModelSelectorDropdown.tsx
interface ModelSelectorDropdownProps {
  isOpen: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
}
```

No changes to existing `AutoApproveModal`, `ClineRulesToggleModal`, or any shared/proto types.

---

## [Files]

All file changes are within `webview-ui/src/`:

### New files to create
| File | Purpose |
|------|---------|
| `components/chat/toolbar-popups/PlusPopup.tsx` | The `+` popup (Change 3): context/files section + auto-approve accordion |
| `components/chat/toolbar-popups/AddContextModal.tsx` | Add Context modal (Change 4): URL, Problems, Terminal, Git, Folder, File |
| `components/chat/toolbar-popups/ModelSelectorDropdown.tsx` | Model selector inline dropdown (Change 6) |
| `components/chat/toolbar-popups/index.ts` | Barrel export for the three popups |
| `index.css` partial | New CSS custom properties (design tokens) appended to existing `index.css` |

### Existing files to modify
| File | Changes |
|------|---------|
| `components/chat/ChatView.tsx` | **Change 1**: Remove `<AutoApproveBar />` import and JSX usage from footer |
| `components/chat/ChatTextArea.tsx` | **Changes 2, 3, 4, 5, 6**: Redesign bottom toolbar row; wire new popups; restyle Plan/Act switch |
| `components/common/PopupModalContainer.tsx` | **Optional**: Add a variant prop for the new dark popup style (or create a new `DarkPopupContainer` styled component inline in each popup) |
| `webview-ui/src/index.css` | Append new CSS custom property tokens from the spec |

### Files that must NOT be touched
- `components/chat/auto-approve-menu/AutoApproveModal.tsx` — reused as-is inside PlusPopup accordion
- `components/chat/auto-approve-menu/AutoApproveMenuItem.tsx` — reused as-is
- `components/chat/auto-approve-menu/constants.ts` — reused as-is  
- `components/chat/auto-approve-menu/AutoApproveSettingsAPI.ts` — reused as-is
- `components/cline-rules/ClineRulesToggleModal.tsx` — reused as-is (only trigger location changes)
- `hooks/useAutoApproveActions.ts` — unchanged
- All backend/proto files

---

## [Functions]

### New functions

**`PlusPopup.tsx`**
- `PlusPopup(props: PlusPopupProps): JSX.Element` — renders the `+` popup with two sections (context/files) and auto-approve accordion
- `AutoApproveAccordion(): JSX.Element` — internal subcomponent; renders collapsible section embedding existing `AutoApproveModal` content using existing `ACTION_METADATA`, `useAutoApproveActions`, `updateAutoApproveSettings`

**`AddContextModal.tsx`**
- `AddContextModal(props: AddContextModalProps): JSX.Element` — renders URL/Problems/Terminal/Git/Folder/File rows with accordion support
- `GitCommitsAccordion(): JSX.Element` — internal; fetches commits via existing `FileServiceClient.searchCommits()`
- `FolderAccordion(): JSX.Element` — internal; fetches folder list via existing `FileServiceClient` (relative paths)

**`ModelSelectorDropdown.tsx`**
- `ModelSelectorDropdown(props: ModelSelectorDropdownProps): JSX.Element` — renders scrollable model list; on select calls existing `navigateToSettingsModelPicker` or sets model directly via existing state

### Modified functions

**`ChatTextArea.tsx` — toolbar JSX block (lines ~1532–1622)**
- Replace the existing bottom bar's `@` button, `+` button, and static model text with new interactive versions
- The `@` button is removed from the toolbar (its functionality moves into `PlusPopup` → "Add Context")
- The `+` button now opens `PlusPopup` instead of directly calling `onSelectFilesAndImages`
- `ModelDisplayButton` styled component gets new hover/active CSS matching the spec
- `SwitchContainer` and `Slider` styled components get new CSS matching the spec's segmented pill design
- Add `const [plusPopupOpen, setPlusPopupOpen] = useState(false)` 
- Add `const [modelDropdownOpen, setModelDropdownOpen] = useState(false)`
- Add `const plusButtonRef = useRef<HTMLButtonElement>(null)`
- Add `const modelButtonRef = useRef<HTMLButtonElement>(null)`

**`ChatView.tsx`**
- Remove line: `import AutoApproveBar from "./auto-approve-menu/AutoApproveBar"`
- Remove JSX: `<AutoApproveBar />`

### Removed / deprecated
- `AutoApproveBar.tsx` — no longer rendered anywhere. File is kept but becomes dead code. Can be deleted in a follow-up cleanup PR.

---

## [Classes]
No class-based components in this codebase — all components are functional. No class changes needed.

The following **styled-components** in `ChatTextArea.tsx` will be modified:

| Styled component | Change |
|-----------------|--------|
| `SwitchContainer` | New CSS: `background: var(--segment-container-bg, #252525)`, `border: var(--segment-container-border, 0.5px solid #333)`, `border-radius: var(--segment-container-radius, 5px)`, `overflow: hidden`, remove existing `border: 1px solid var(--vscode-input-border)` |
| `Slider` | New active state CSS: Plan=`background: var(--segment-plan-active-bg, #78500a)`, Act=`background: var(--segment-act-active-bg, #1d4ed8)` |
| `ModelDisplayButton` | Add hover state: `border: 0.5px solid #333; background: #252525; border-radius: 4px`, active state: `border: 0.5px solid #555; background: #2a2a2a` |

New styled-component **`DarkPopupContainer`** (defined in each new popup file):
```typescript
const DarkPopupContainer = styled.div`
  background: var(--popup-bg, #1c1c1c);
  border: var(--popup-border, 0.5px solid #333);
  border-radius: var(--popup-radius, 10px);
  overflow: hidden;
  position: fixed;
  /* positioning set via inline style from anchor ref */
  z-index: 50;
  animation: popupAppear var(--popup-appear-duration, 0.18s) ease forwards;

  @keyframes popupAppear {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`
```

---

## [Dependencies]
No new npm packages required. All necessary utilities already exist:
- `react-use` (`useClickAway`) — already installed, used in existing modals
- `lucide-react` — already installed for icons
- `styled-components` — already installed
- `FileServiceClient` — already available for git commits and folder listing
- `useExtensionState` — already provides model info, autoApprovalSettings, mode, etc.

---

## [Testing]
No automated tests need to be written for this UI-only change. Manual verification steps after each change:

1. **After Change 1**: Confirm auto-approve row no longer visible in main panel between "View Changes" and "Start New Task"
2. **After Change 2**: Confirm toolbar renders `[ + ] [ ⚖ ] | model ˄ | [ Plan | Act ]` layout; hover states work
3. **After Change 3**: Clicking `+` opens popup; "Add context" and "Add files & images" work; auto-approve accordion expands/collapses; all toggles connect to real state
4. **After Change 4**: Clicking "Add context" in `+` popup opens AddContextModal; accordions work; git commits load; `@` is inserted in main input
5. **After Change 5**: Clicking `⚖` opens Rules/Workflows/Hooks/Skills tabs — existing content unchanged
6. **After Change 6**: Clicking model name opens dropdown; selecting a model updates the display
7. **Regression**: View Changes, Start New Task, task card, checklist row, header icons, keyboard shortcuts, @ mentions, / slash commands, file drag-and-drop all unchanged

---

## [Implementation Order]

Implement changes strictly in this order to minimize risk and make each step independently verifiable:

1. **Setup**: `git pull` then `npm install` to sync and get all deps current
2. **Verify build**: `npm run compile` — confirm clean baseline before any code changes
3. **Add CSS tokens**: Append design tokens to `webview-ui/src/index.css`
4. **Change 1**: Remove `<AutoApproveBar />` from `ChatView.tsx` — simplest change, no new components
5. **Change 2 (Plan/Act + Model label styles only)**: Update `SwitchContainer`, `Slider`, and `ModelDisplayButton` styled-components in `ChatTextArea.tsx` — visual only, no behavior change
6. **Change 3**: Create `PlusPopup.tsx`; wire into `ChatTextArea.tsx` replacing the `+` button behavior
7. **Change 4**: Create `AddContextModal.tsx`; wire as target of "Add context" click in `PlusPopup`
8. **Change 5**: Verify `ClineRulesToggleModal` still works — no code changes needed, just confirm `⚖` (codicon-law) button and popup are intact after toolbar restructuring
9. **Change 6**: Create `ModelSelectorDropdown.tsx`; wire into `ModelDisplayButton` click in `ChatTextArea.tsx`
10. **Full regression test**: Manually test all "What must NOT change" items from the spec
