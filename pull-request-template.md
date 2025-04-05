# Add Macro Buttons Feature

## Description
This PR adds customizable macro buttons above the chat input field, allowing users to quickly access frequently used prompts with a single click. The feature leverages existing code in the codebase and follows VSCode's design patterns.

## Changes
- Created a new `MacroButtons` component that displays customizable macro buttons
- Integrated with the existing `MacroManager` class for state management
- Added buttons above the chat input area
- Connected to ExtensionStateContext for state management
- Added unit tests for the new component

## Benefits
- Improves productivity by providing one-click access to commonly used prompts
- Enhances user experience by reducing repetitive typing
- Follows VSCode's accessibility patterns with proper keyboard navigation
- Maintains consistent design language with existing UI elements
- Leverages existing code structures (MacroManager, ExtensionState, etc.)

## Screenshots
[Placeholder for screenshots showing the macro buttons in action]

## Accessibility Considerations
- Buttons use VSCode's native VSCodeButton component which supports keyboard navigation
- All buttons have tooltips showing the full action text for longer prompts
- Disabled state is properly handled during processing
- Follows VSCode's color contrast standards

## Performance Impact
- Minimal impact on performance as the component only renders when macros are defined
- No additional API calls or heavy computations
- Uses efficient rendering patterns with proper React patterns

## Testing
- Added unit tests covering component rendering, button behavior, and message sending
- Created a comprehensive test plan for manual testing
- Verified across different themes and window sizes

## Related Issues
Closes #2692

## Additional Notes
The implementation builds upon the existing architecture for managing macro buttons in the codebase. The UI component is the final piece needed to expose this functionality to users.
