# Test Plan for Macro Buttons Feature

## Manual Testing

### Setup Tests
1. **Default Macros Test**
   - Open Cline with a new clean profile
   - Verify default macros appear above the input area when starting a task
   - Expected: Default buttons (Check next task, Prepare to start task, Test this work, Document this) should be visible

2. **Persistence Test**
   - Add a new macro via the Manage button
   - Close and reopen VSCode
   - Verify the added macro is still present
   - Expected: Custom macros should persist between VSCode sessions

### Functional Tests
1. **Button Click Test**
   - Click on a macro button
   - Expected: The macro's action text should be sent as a message to Claude

2. **Disabled State Test**
   - Start a task and wait for Claude to be in the middle of processing (streaming)
   - Verify macro buttons are disabled while input is disabled
   - Expected: All macro buttons should be visually disabled and not clickable

3. **Manage Button Test**
   - Click the "Manage" button
   - Expected: The macro management UI should open
   - Add a new macro using the UI
   - Expected: The new macro should appear in the macro buttons row

4. **Tooltip Test**
   - Hover over a macro button with a long action text
   - Expected: A tooltip should display the full action text

### UI Tests
1. **Overflow Test**
   - Add many macro buttons (10+)
   - Verify buttons wrap appropriately and maintain usability
   - Expected: Buttons should wrap to a new line when they exceed the container width

2. **Responsive Layout Test**
   - Resize the VSCode window to different widths
   - Verify the macro buttons layout adjusts appropriately
   - Expected: Buttons should maintain usability across different window sizes

3. **Theme Compatibility Test**
   - Test with both light and dark VSCode themes
   - Verify buttons maintain proper contrast and visibility
   - Expected: Buttons should be clearly visible in both themes

## Unit Tests

### MacroManager Tests
1. **getMacros Test**
   - Mock VSCode context
   - Call `MacroManager.getMacros(context)`
   - Verify it returns the correct macros from global state or defaults

2. **addMacro Test**
   - Mock VSCode context
   - Call `MacroManager.addMacro(context, newMacro)`
   - Verify it adds the macro and returns the updated list

3. **updateMacro Test**
   - Mock VSCode context with existing macros
   - Call `MacroManager.updateMacro(context, id, updatedMacro)`
   - Verify the specific macro is updated correctly

4. **deleteMacro Test**
   - Mock VSCode context with existing macros
   - Call `MacroManager.deleteMacro(context, id)`
   - Verify the specific macro is removed

### MacroButtons Component Tests
1. **Rendering Test**
   - Render component with mock macros
   - Verify it renders all buttons correctly

2. **Click Handling Test**
   - Mock vscode.postMessage
   - Trigger button click
   - Verify postMessage is called with the correct parameters

3. **Empty State Test**
   - Render component with empty macros array
   - Verify it renders nothing

4. **Disabled State Test**
   - Render component with isInputDisabled=true
   - Verify all buttons have the disabled attribute
