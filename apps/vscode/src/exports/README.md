# BedrockCoder API

The BedrockCoder extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/bedrockCoder.d.ts` to your extension's source directory.
2. Include `bedrockCoder.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const bedrockCoderExtension = vscode.extensions.getExtension<BedrockCoderAPI>("fffalexgo.bedrock-coder")

    if (!bedrockCoderExtension?.isActive) {
		throw new Error("BedrockCoder extension is not activated")
    }

    const bedrockCoder = bedrockCoderExtension.exports

    if (bedrockCoder) {
    	// Now you can use the API

    	// Start a new task with an initial message
		await bedrockCoder.startNewTask("Hello, BedrockCoder! Let's make a new project...")

    	// Start a new task with an initial message and images
		await bedrockCoder.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
		await bedrockCoder.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
		await bedrockCoder.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
		await bedrockCoder.pressSecondaryButton()
    } else {
		console.error("BedrockCoder API is not available")
    }
    ```

    **Note:** To ensure that the `fffalexgo.bedrock-coder` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "fffalexgo.bedrock-coder"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `bedrockCoder.d.ts` file.
