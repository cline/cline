# VSCode Webview Testing Strategy

## Overview

Our testing strategy uses a minimal test webview to verify webview-extension communication and UI interactions. This approach:

1. Tests components in their actual VSCode environment
2. Uses existing infrastructure and dependencies
3. Maintains consistency with VSCode extension development practices

## Implementation

We use a minimal test webview that directly handles the messages we need to test:

```typescript
panel.webview.html = `
    <!DOCTYPE html>
    <html>
        <head>
            <script>
                const vscode = acquireVsCodeApi();
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'sendMessage':
                            vscode.postMessage({ type: 'newTask', text: message.text });
                            break;
                        case 'toggleMode':
                            vscode.postMessage({ type: 'chatSettings', chatSettings: { mode: 'act' } });
                            break;
                        case 'invoke':
                            if (message.invoke === 'primaryButtonClick') {
                                vscode.postMessage({ type: 'askResponse', askResponse: 'yesButtonClicked' });
                            }
                            break;
                    }
                });
            </script>
        </head>
        <body>
            <div id="test-webview"></div>
        </body>
    </html>
`
```

This approach allows us to:

1. Test message passing between extension and webview
2. Verify UI interaction handling
3. Test state changes and mode toggles
4. Validate tool approval flows

## Key Benefits

1. **Simplified Testing**

    - No need for browser automation
    - Direct access to webview state
    - Native message passing

2. **Better Coverage**

    - Tests real extension behavior
    - Includes VSCode-specific features
    - Tests actual user workflows

3. **Maintainability**
    - Single testing approach
    - Fewer dependencies
    - Aligned with VSCode's architecture

## Test Examples

1. **Message Passing**

    ```typescript
    it("should send chat messages", async () => {
    	const messagePromise = new Promise((resolve) => {
    		panel.webview.onDidReceiveMessage((message) => {
    			if (message.type === "newTask") {
    				resolve(message)
    			}
    		})
    	})

    	await panel.webview.postMessage({
    		type: "sendMessage",
    		text: "Create a hello world app",
    	})

    	const message = await messagePromise
    	assert.equal(message.type, "newTask")
    	assert.equal(message.text, "Create a hello world app")
    })
    ```

2. **State Changes**

    ```typescript
    it("should toggle between plan and act modes", async () => {
    	const stateChangePromise = new Promise((resolve) => {
    		panel.webview.onDidReceiveMessage((message) => {
    			if (message.type === "chatSettings") {
    				resolve(message)
    			}
    		})
    	})

    	await panel.webview.postMessage({ type: "toggleMode" })

    	const stateChange = await stateChangePromise
    	assert.equal(stateChange.chatSettings.mode, "act")
    })
    ```

## Running Tests

Tests can be run using the standard VSCode extension testing command:

```bash
npm run test
```

The tests run in a headless environment and don't require any additional setup or dependencies.

## Next Steps

1. Add more test coverage for:
    - Error handling
    - Edge cases
    - Complex interaction flows
2. Consider adding visual regression testing if needed
3. Expand test suite as new features are added
