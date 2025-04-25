## For All Settings

1. Add the setting to schema definitions:

    - Add the item to `globalSettingsSchema` in `src/schemas/index.ts`
    - Add the item to `globalSettingsRecord` in `src/schemas/index.ts`
    - Example: `terminalCommandDelay: z.number().optional(),`

2. Add the setting to type definitions:

    - Add the item to `src/exports/types.ts`
    - Add the item to `src/exports/roo-code.d.ts`
    - Add the setting to `src/shared/ExtensionMessage.ts`
    - Add the setting to the WebviewMessage type in `src/shared/WebviewMessage.ts`
    - Example: `terminalCommandDelay?: number | undefined`

3. Add test coverage:
    - Add the setting to mockState in src/core/webview/**tests**/ClineProvider.test.ts
    - Add test cases for setting persistence and state updates
    - Ensure all tests pass before submitting changes

## For Checkbox Settings

1. Add the message type to src/shared/WebviewMessage.ts:

    - Add the setting name to the WebviewMessage type's type union
    - Example: `| "multisearchDiffEnabled"`

2. Add the setting to webview-ui/src/context/ExtensionStateContext.tsx:

    - Add the setting to the ExtensionStateContextType interface
    - Add the setter function to the interface
    - Add the setting to the initial state in useState
    - Add the setting to the contextValue object
    - Example:
        ```typescript
        interface ExtensionStateContextType {
        	multisearchDiffEnabled: boolean
        	setMultisearchDiffEnabled: (value: boolean) => void
        }
        ```

3. Add the setting to src/core/webview/ClineProvider.ts:

    - Add the setting name to the GlobalStateKey type union
    - Add the setting to the Promise.all array in getState
    - Add the setting to the return value in getState with a default value
    - Add the setting to the destructured variables in getStateToPostToWebview
    - Add the setting to the return value in getStateToPostToWebview
    - Add a case in setWebviewMessageListener to handle the setting's message type
    - Example:
        ```typescript
        case "multisearchDiffEnabled":
          await this.updateGlobalState("multisearchDiffEnabled", message.bool)
          await this.postStateToWebview()
          break
        ```

4. Add the checkbox UI to webview-ui/src/components/settings/SettingsView.tsx:

    - Import the setting and its setter from ExtensionStateContext
    - Add the VSCodeCheckbox component with the setting's state and onChange handler
    - Add appropriate labels and description text
    - Example:
        ```typescript
        <VSCodeCheckbox
          checked={multisearchDiffEnabled}
          onChange={(e: any) => setMultisearchDiffEnabled(e.target.checked)}
        >
          <span style={{ fontWeight: "500" }}>Enable multi-search diff matching</span>
        </VSCodeCheckbox>
        ```

5. Add the setting to handleSubmit in webview-ui/src/components/settings/SettingsView.tsx:

    - Add a vscode.postMessage call to send the setting's value when clicking Save
    - This step is critical for persistence - without it, the setting will not be saved when the user clicks Save
    - Example:
        ```typescript
        vscode.postMessage({ type: "multisearchDiffEnabled", bool: multisearchDiffEnabled })
        ```

6. Style Considerations:
    - Use the VSCodeCheckbox component from @vscode/webview-ui-toolkit/react instead of HTML input elements
    - Wrap each checkbox in a div element for proper spacing
    - Use a span with className="font-medium" for the checkbox label inside the VSCodeCheckbox component
    - Place the description in a separate div with className="text-vscode-descriptionForeground text-sm mt-1"
    - Maintain consistent spacing between configuration options
    - Example:
        ```typescript
        <div>
          <VSCodeCheckbox
            checked={terminalPowershellCounter ?? true}
            onChange={(e: any) => setCachedStateField("terminalPowershellCounter", e.target.checked)}
            data-testid="terminal-powershell-counter-checkbox">
            <span className="font-medium">{t("settings:terminal.powershellCounter.label")}</span>
          </VSCodeCheckbox>
          <div className="text-vscode-descriptionForeground text-sm mt-1">
            {t("settings:terminal.powershellCounter.description")}
          </div>
        </div>
        ```

## For Select/Dropdown Settings

1. Add the message type to src/shared/WebviewMessage.ts:

    - Add the setting name to the WebviewMessage type's type union
    - Example: `| "preferredLanguage"`

2. Add the setting to webview-ui/src/context/ExtensionStateContext.tsx:

    - Add the setting to the ExtensionStateContextType interface
    - Add the setter function to the interface
    - Add the setting to the initial state in useState with a default value
    - Add the setting to the contextValue object
    - Example:
        ```typescript
        interface ExtensionStateContextType {
        	preferredLanguage: string
        	setPreferredLanguage: (value: string) => void
        }
        ```

3. Add the setting to src/core/webview/ClineProvider.ts:

    - Add the setting name to the GlobalStateKey type union
    - Add the setting to the Promise.all array in getState
    - Add the setting to the return value in getState with a default value
    - Add the setting to the destructured variables in getStateToPostToWebview
    - Add the setting to the return value in getStateToPostToWebview
    - This step is critical for UI display - without it, the setting will not be displayed in the UI
    - Add a case in setWebviewMessageListener to handle the setting's message type
    - Example:
        ```typescript
        case "preferredLanguage":
          await this.updateGlobalState("preferredLanguage", message.text)
          await this.postStateToWebview()
          break
        ```

4. Add the select UI to webview-ui/src/components/settings/SettingsView.tsx:

    - Import the setting and its setter from ExtensionStateContext
    - Add the select element with appropriate styling to match VSCode's theme
    - Add options for the dropdown
    - Add appropriate labels and description text
    - Example:
        ```typescript
        <select
          value={preferredLanguage}
          onChange={(e) => setPreferredLanguage(e.target.value)}
          style={{
            width: "100%",
            padding: "4px 8px",
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            border: "1px solid var(--vscode-input-border)",
            borderRadius: "2px"
          }}>
          <option value="English">English</option>
          <option value="Spanish">Spanish</option>
          ...
        </select>
        ```

5. Add the setting to handleSubmit in webview-ui/src/components/settings/SettingsView.tsx:
    - Add a vscode.postMessage call to send the setting's value when clicking Done
    - Example:
        ```typescript
        vscode.postMessage({ type: "preferredLanguage", text: preferredLanguage })
        ```

These steps ensure that:

- The setting's state is properly typed throughout the application
- The setting persists between sessions
- The setting's value is properly synchronized between the webview and extension
- The setting has a proper UI representation in the settings view
- Test coverage is maintained for the new setting

## Adding a New Configuration Item: Summary of Required Changes

To add a new configuration item to the system, the following changes are necessary:

1.  **Feature-Specific Class** (if applicable)

    - For settings that affect specific features (e.g., Terminal, Browser, etc.)
    - Add a static property to store the value
    - Add getter/setter methods to access and modify the value

2.  **Schema Definition**

    - Add the item to globalSettingsSchema in src/schemas/index.ts
    - Add the item to globalSettingsRecord in src/schemas/index.ts

3.  **Type Definitions**

    - Add the item to src/exports/types.ts
    - Add the item to src/exports/roo-code.d.ts
    - Add the item to src/shared/ExtensionMessage.ts
    - Add the item to src/shared/WebviewMessage.ts

4.  **UI Component**

    - Create or update a component in webview-ui/src/components/settings/
    - Add appropriate slider/input controls with min/max/step values
    - Ensure the props are passed correctly to the component in webview-ui/src/components/settings/SettingsView.tsx
    - Update the component's props interface to include the new settings

5.  **Translations**

    - Add label and description in webview-ui/src/i18n/locales/en/settings.json
    - Update all other languages
    - If any language content is changed, synchronize all other languages with that change
    - Translations must be performed within "translation" mode so change modes for that purpose

6.  **State Management**

    - Add the item to the destructuring in SettingsView.tsx
    - Add the item to the handleSubmit function in webview-ui/src/components/settings/SettingsView.tsx
    - Add the item to getStateToPostToWebview in src/core/webview/ClineProvider.ts
    - Add the item to getState in src/core/webview/ClineProvider.ts with appropriate default values
    - Add the item to the initialization in resolveWebviewView in src/core/webview/ClineProvider.ts

7.  **Message Handling**

    - Add a case for the item in src/core/webview/webviewMessageHandler.ts

8.  **Implementation-Specific Logic**

    - Implement any feature-specific behavior triggered by the setting
    - Examples:
        - Environment variables for terminal settings
        - API configuration changes for provider settings
        - UI behavior modifications for display settings

9.  **Testing**

    - Add test cases for the new settings in appropriate test files
    - Verify settings persistence and state updates

10. **Ensuring Settings Persistence Across Reload**

    To ensure settings persist across application reload, several key components must be properly configured:

    1. **Initial State in ExtensionStateContextProvider**:

        - Add the setting to the initial state in the useState call
        - Example:
            ```typescript
            const [state, setState] = useState<ExtensionState>({
            	// existing settings...
            	newSetting: false, // Default value for the new setting
            })
            ```

    2. **State Loading in ClineProvider**:

        - Add the setting to the getState method to load it from storage
        - Example:
            ```typescript
            return {
            	// existing settings...
            	newSetting: stateValues.newSetting ?? false,
            }
            ```

    3. **State Initialization in resolveWebviewView**:

        - Add the setting to the initialization in resolveWebviewView
        - Example:
            ```typescript
            this.getState().then(
            	({
            		// existing settings...
            		newSetting,
            	}) => {
            		// Initialize the setting with its stored value or default
            		FeatureClass.setNewSetting(newSetting ?? false)
            	},
            )
            ```

    4. **State Transmission to Webview**:

        - Add the setting to the getStateToPostToWebview method
        - Example:
            ```typescript
            return {
            	// existing settings...
            	newSetting: newSetting ?? false,
            }
            ```

    5. **Setter Method in ExtensionStateContext**:
        - Add the setter method to the contextValue object
        - Example:
            ```typescript
            const contextValue: ExtensionStateContextType = {
            	// existing properties and methods...
            	setNewSetting: (value) => setState((prevState) => ({ ...prevState, newSetting: value })),
            }
            ```

11. **Debugging Settings Persistence Issues**

        If a setting is not persisting across reload, check the following:

        1. **Complete Chain of Persistence**:

            - Verify that the setting is added to all required locations:
                - globalSettingsSchema and globalSettingsRecord in src/schemas/index.ts
            - Initial state in ExtensionStateContextProvider
            - getState method in src/core/webview/ClineProvider.ts
            - getStateToPostToWebview method in src/core/webview/ClineProvider.ts
            - resolveWebviewView method in src/core/webview/ClineProvider.ts (if feature-specific)
            - A break in any part of this chain can prevent persistence

        2. **Default Values Consistency**:

            - Ensure default values are consistent across all locations
            - Inconsistent defaults can cause unexpected behavior

        3. **Message Handling**:

            - Confirm the src/core/webview/webviewMessageHandler.ts has a case for the setting
            - Verify the message type matches what's sent from the UI

        4. **UI Integration**:

            - Check that the setting is included in the handleSubmit function in webview-ui/src/components/settings/SettingsView.tsx
            - Ensure the UI component correctly updates the state

        5. **Type Definitions**:

            - Verify the setting is properly typed in all relevant interfaces
            - Check for typos in property names across different files

        6. **Storage Mechanism**:
            - For complex settings, ensure proper serialization/deserialization
            - Check that the setting is being correctly stored in VSCode's globalState

    These checks help identify and resolve common issues with settings persistence.

12. **Advanced Troubleshooting: The Complete Settings Persistence Chain**

Settings persistence requires a complete chain of state management across multiple components. Understanding this chain is critical for both humans and AI to effectively troubleshoot persistence issues:

1. **Schema Definition (Entry Point)**:

    - Settings must be properly defined in `globalSettingsSchema` and `globalSettingsRecord`
    - Enum values should use proper zod schemas: `z.enum(["value1", "value2"])`
    - Example:

        ```typescript
        // In src/schemas/index.ts
        export const globalSettingsSchema = z.object({
        	// Existing settings...
        	commandRiskLevel: z.enum(["readOnly", "reversibleChanges", "complexChanges"]).optional(),
        })

        const globalSettingsRecord: GlobalSettingsRecord = {
        	// Existing settings...
        	commandRiskLevel: undefined,
        }
        ```

2. **UI Component (User Interaction)**:

    - Must use consistent components (Select vs. select) with other similar settings
    - Must use `setCachedStateField` for state updates, not direct state setting
    - Must generate the correct message type through `vscode.postMessage`
    - Example:
        ```tsx
        // In a settings component
        <Select value={commandRiskLevel} onValueChange={(value) => setCachedStateField("commandRiskLevel", value)}>
        	<SelectTrigger className="w-full">
        		<SelectValue placeholder={t("settings:common.select")} />
        	</SelectTrigger>
        	<SelectContent>
        		<SelectGroup>
        			<SelectItem value="readOnly">{t("label.readOnly")}</SelectItem>
        			{/* Other options... */}
        		</SelectGroup>
        	</SelectContent>
        </Select>
        ```

3. **Message Handler (State Saving)**:

    - Must use correct message type in `src/core/webview/webviewMessageHandler.ts`
    - Must use `updateGlobalState` with properly typed values
    - Must call `postStateToWebview` after updates
    - Example:
        ```typescript
        // In src/core/webview/webviewMessageHandler.ts
        case "commandRiskLevel":
          await updateGlobalState(
            "commandRiskLevel",
            (message.text ?? "readOnly") as "readOnly" | "reversibleChanges" | "complexChanges"
          )
          await provider.postStateToWebview()
          break
        ```

4. **State Retrieval (Reading State)**:

    - In `getState`, state must be properly retrieved from stateValues
    - In `getStateToPostToWebview`, the setting must be in the destructured parameters
    - The setting must be included in the return value
    - Use `contextProxy.getGlobalState` for direct access when needed
    - Example:

        ```typescript
        // In src/core/webview/ClineProvider.ts getStateToPostToWebview
        const {
        	// Other state properties...
        	commandRiskLevel,
        } = await this.getState()

        return {
        	// Other state properties...
        	commandRiskLevel: commandRiskLevel ?? "readOnly",
        }
        ```

5. **Debugging Strategies**:

    - **Follow the State Flow**: Watch the setting's value at each step in the chain
    - **Type Safety**: Ensure the same type is used throughout the chain
    - **Component Consistency**: Use the same pattern as other working settings
    - **Check Return Values**: Ensure the setting is included in all return objects
    - **State vs. Configuration**: Understand when to use state vs. VSCode configuration

6. **Common Pitfalls**:
    - **Type Mismatch**: Using string where an enum is expected
    - **Chain Breaks**: Missing the setting in return objects
    - **UI Inconsistency**: Using different component patterns
    - **DefaultValue Issues**: Inconsistent default values across components
    - **Missing Schema**: Not adding to schema or record definitions

Remember: A break at ANY point in this chain can cause persistence failures. When troubleshooting, systematically check each link in the chain to identify where the issue occurs.
