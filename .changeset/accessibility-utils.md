---
"claude-dev": patch
---

Add accessibility utilities and enable navbar in VS Code

- Add focusManagement.ts with useModal, useFocusTrap, useFocusRestoration hooks
- Add interactiveProps.ts with button prop factories and keyboard handlers
- Add useListboxNavigation.ts for keyboard navigation in lists
- Enable navbar in VS Code (showNavbar: true)
- Convert div elements to semantic button elements for accessibility
- Add ARIA attributes to interactive components

