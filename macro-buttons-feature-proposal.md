# Add Macro Buttons Feature to Cline

## Feature Description

Add a row of customizable macro buttons above the input field in the Cline chat interface. These buttons will allow users to quickly insert common prompts or commands with a single click, enhancing productivity and providing quick access to frequently used actions.

## Use Cases

- Quickly check TASK.md to suggest the next task to work on
- Prepare to start a new task with a standardized prompt
- Generate test cases for recent work
- Document recent changes
- Any other frequently used prompts that users want to save

## Implementation Details

We've already laid much of the groundwork for this feature:

1. Added `MacroButton` interface in `src/shared/ExtensionMessage.ts` (already present)
2. Added `macroButtons` to the `ExtensionState` interface (already present)
3. Built a `MacroManager` class in `src/core/macros/index.ts` with methods for:
   - Getting existing macros
   - Saving macros
   - Adding new macros
   - Updating existing macros
   - Deleting macros
   - Resetting to defaults
   - Opening a UI to manage macros
4. Created default macros:
   - "Check next task"
   - "Prepare to start task"
   - "Test this work"
   - "Document this"
5. Added a `MacroButtons` React component that renders the buttons

The component is designed to:
- Display all configured macro buttons
- Handle clicks to send the associated prompt to the AI
- Include a "Manage" button to open the macro manager
- Visually disable buttons when input is disabled
- Handle overflow with proper wrapping and truncation

## UI/UX Considerations

- Buttons should be compact but easily clickable
- Tooltips show the full text of longer prompts
- Visual consistency with VSCode's design language
- Proper keyboard navigation support
- Responsive layout that works at different widths

## Next Steps

1. Expand the `openMacroManager` method to provide a more robust UI for managing macros, possibly similar to the snippet manager
2. Add ability to reorder macro buttons
3. Consider adding support for categories/folders of macros
4. Add import/export functionality for sharing macro collections

## Screenshots

[Include UI mockups or screenshots of the implementation]
