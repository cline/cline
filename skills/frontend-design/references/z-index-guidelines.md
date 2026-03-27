# Z-Index Layering Guidelines

## Purpose

This reference provides a standardized z-index hierarchy for complex UI interfaces with overlays, dropdowns, modals, and other layered elements. Following these guidelines prevents stacking context conflicts and ensures consistent layering behavior across the application.

## Z-Index Scale

Use this documented scale for all layered UI elements:

| Layer | Z-Index | Usage | Examples |
|-------|---------|-------|----------|
| **Base** | `0` | Default content | Main content, cards, sections, standard elements |
| **Elevated** | `10` | Slightly elevated UI | Sticky headers, floating action buttons |
| **Dropdown** | `50` | Standard dropdowns | Select menus, basic tooltips, autocomplete |
| **Overlay** | `90` | Modal backdrops | Semi-transparent overlays for modals/drawers |
| **Modal** | `100` | Critical UI elements | TopBar dropdowns, modals, important menus |
| **Toast** | `110` | Notifications | Success/error messages, alerts |
| **Tooltip** | `120` | Contextual help | Help tooltips that appear over everything |

## Implementation Guidelines

### 1. Use Tailwind Arbitrary Values

Always use Tailwind's arbitrary value syntax for custom z-index values:

```tsx
// ✅ Correct
<div className="z-[100]">Modal content</div>
<div className="fixed inset-0 z-[90]">Overlay backdrop</div>

// ❌ Avoid
<div className="z-50">Modal content</div>  // Too low for modals
<div style={{ zIndex: 9999 }}>...</div>    // Arbitrary high number
```

### 2. Component Type Mapping

Apply these z-index values based on component type:

#### TopBar Components
```tsx
// User menu, notifications, language selector
<div className="absolute right-0 top-full z-[100]">
  {/* Dropdown content */}
</div>

// Backdrop overlay
<div className="fixed inset-0 z-[90]" onClick={closeMenu} />
```

#### Modal Components
```tsx
// Modal backdrop
<div className="fixed inset-0 z-[90] bg-black/50" />

// Modal content
<div className="fixed inset-0 z-[100] flex items-center justify-center">
  {/* Modal dialog */}
</div>
```

#### Toast Notifications
```tsx
// Toast container (should appear above modals)
<div className="fixed top-4 right-4 z-[110]">
  {/* Toast message */}
</div>
```

#### Sidebar (Mobile)
```tsx
// Mobile sidebar overlay
<div className="fixed inset-0 z-40 bg-black/60" />

// Mobile sidebar content
<aside className="fixed inset-y-0 left-0 z-50">
  {/* Sidebar content */}
</aside>
```

### 3. Stacking Context Rules

**Critical**: Understand CSS stacking contexts to avoid unexpected behavior:

- Elements with `position: relative/absolute/fixed` and `z-index` create new stacking contexts
- Parent stacking context limits child z-index scope
- Siblings within the same stacking context are compared by z-index

**Example Problem**:
```tsx
// ❌ This won't work as expected
<div className="relative z-10">
  <div className="absolute z-[100]">
    {/* This is still below elements with z-20+ in parent context */}
  </div>
</div>

// ✅ Use fixed positioning for global layers
<div className="fixed z-[100]">
  {/* This respects global z-index hierarchy */}
</div>
```

## Project Documentation

### Create Z-Index Hierarchy Document

For each project, create a `docs/z-index-hierarchy.md` file documenting:

1. **Project-specific z-index scale** (if deviating from standard)
2. **Component inventory** with assigned z-index values
3. **Known exceptions** and their justifications
4. **Migration notes** for updating legacy code

**Template**:
```markdown
# Z-Index Hierarchy

## Scale
[Copy standard scale or define custom]

## Component Reference
- TopBar dropdowns: z-[100]
- Modal overlays: z-[90]
- Modal content: z-[100]
- Toast notifications: z-[110]
- [Add project-specific components]

## Exceptions
- [Component name]: Uses z-[X] because [reason]

## Migration Notes
- [Date]: Updated TopBar from z-50 to z-[100]
```

## Validation Checklist

Before completing UI implementation, verify:

- [ ] **Identify layering elements**: List all dropdowns, modals, overlays, toasts
- [ ] **Assign z-index values**: Use documented scale for each element
- [ ] **Check stacking contexts**: Ensure parent contexts don't limit child z-index
- [ ] **Test interactions**: Verify dropdowns appear above content, modals block interaction
- [ ] **Document decisions**: Add comments explaining z-index choices
- [ ] **Update project docs**: Create or update `docs/z-index-hierarchy.md`

## Common Patterns

### Pattern 1: Dropdown with Backdrop

```tsx
{isOpen && (
  <>
    {/* Backdrop - blocks interaction, closes on click */}
    <div 
      className="fixed inset-0 z-[90]" 
      onClick={() => setIsOpen(false)}
      aria-hidden="true"
    />
    
    {/* Dropdown content - appears above backdrop */}
    <div className="absolute right-0 top-full z-[100] mt-2 w-64 rounded-xl border bg-white shadow-lg">
      {/* Menu items */}
    </div>
  </>
)}
```

### Pattern 2: Modal Dialog

```tsx
{isOpen && (
  <>
    {/* Backdrop with visual overlay */}
    <div className="fixed inset-0 z-[90] bg-black/50" />
    
    {/* Modal container */}
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {/* Modal content */}
      </div>
    </div>
  </>
)}
```

### Pattern 3: Toast Notification

```tsx
{showToast && (
  <div className="fixed top-4 right-4 z-[110] rounded-lg border bg-white px-4 py-3 shadow-lg">
    {message}
  </div>
)}
```

## Troubleshooting

### Problem: Dropdown hidden behind content

**Symptoms**: Dropdown appears but is partially or fully obscured by page content

**Solutions**:
1. Increase dropdown z-index to `z-[100]`
2. Ensure dropdown uses `fixed` or `absolute` positioning
3. Check parent elements don't create limiting stacking contexts
4. Verify content doesn't have higher z-index values

### Problem: Modal doesn't block interaction

**Symptoms**: Can still click elements behind modal

**Solutions**:
1. Add backdrop overlay with `z-[90]`
2. Ensure backdrop covers full viewport: `fixed inset-0`
3. Add `onClick` handler to backdrop to close modal
4. Verify modal content has `z-[100]` (above backdrop)

### Problem: Toast hidden behind modal

**Symptoms**: Toast notification doesn't appear when modal is open

**Solutions**:
1. Increase toast z-index to `z-[110]` (above modals)
2. Ensure toast uses `fixed` positioning
3. Consider toast placement (top-right usually safest)

## Best Practices

1. **Start with documentation**: Define z-index scale before implementation
2. **Use semantic naming**: Comment why each z-index value was chosen
3. **Avoid arbitrary values**: Don't use `z-[9999]` or random high numbers
4. **Test layering**: Verify all combinations (dropdown + modal, toast + modal, etc.)
5. **Document exceptions**: If deviating from scale, explain why
6. **Gradual migration**: Update legacy code incrementally, document progress

## References

- Project z-index documentation: `docs/z-index-hierarchy.md`
- Tailwind z-index docs: https://tailwindcss.com/docs/z-index
- MDN Stacking Context: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context
