# Claude Dev API

The Claude Dev extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/claude-dev.d.ts` to your extension's source directory.
2. Include `claude-dev.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const claudeDevExtension = vscode.extensions.getExtension<ClaudeDevAPI>("saoudrizwan.claude-dev")

    if (!claudeDevExtension?.isActive) {
    	throw new Error("Claude Dev extension is not activated")
    }

    const claudeDev = claudeDevExtension.exports

    if (claudeDev) {
    	// Now you can use the API

    	// Set custom instructions
    	await claudeDev.setCustomInstructions("Talk like a pirate")

    	// Get custom instructions
    	const instructions = await claudeDev.getCustomInstructions()
    	console.log("Current custom instructions:", instructions)

    	// Start a new task with an initial message
    	await claudeDev.startNewTask("Hello, Claude! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await claudeDev.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await claudeDev.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await claudeDev.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await claudeDev.pressSecondaryButton()
    } else {
    	console.error("Claude Dev API is not available")
    }
    ```

    **Note:** To ensure that the `saoudrizwan.claude-dev` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "saoudrizwan.claude-dev"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `claude-dev.d.ts` file.
