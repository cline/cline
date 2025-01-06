---
# DO NOT TOUCH — Managed by doc writer
ContentId: 9bdc3d4e-e6ba-43d3-bd09-2e127cb63ce7
DateApproved: 12/11/2024

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: A guide to adding AI-powered features to a VS Code extension by using language models and natural language understanding.
---

# Language Model API

The Language Model API enables you to [use the Language Model](/api/references/vscode-api#lm) and integrate AI-powered features and natural language processing in your Visual Studio Code extension.

You can use the Language Model API in different types of extensions. A typical use for this API is in [chat extensions](/api/extension-guides/chat), where you use a language model to interpret the user's request and help provide an answer. However, the use of the Language Model API is not limited to this scenario. You might use a language model in a [language](/api/language-extensions/overview) or [debugger](/api/extension-guides/debugger-extension) extension, or as part of a [command](/api/extension-guides/command) or [task](/api/extension-guides/task-provider) in a custom extension. For example, the Rust extension might use the Language Model to offer default names to improve its rename experience.

The process for using the Language Model API consists of the following steps:

1. Build the language model prompt
1. Send the language model request
1. Interpret the response

The following sections provide more details on how to implement these steps in your extension.

## Links

- [Chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample)
- [LanguageModels API](/api/references/vscode-api#lm)
- [@vscode/prompt-tsx npm package](https://www.npmjs.com/package/@vscode/prompt-tsx)

## Build the language model prompt

To interact with a language model, extensions should first craft their prompt, and then send a request to the language model. You can use prompts to provide instructions to the language model on the broad task that you're using the model for. Prompts can also define the context in which user messages are interpreted.

The Language Model API supports two types of messages when building the language model prompt:

- **User** - used for providing instructions and the user's request
- **Assistant** - used for adding the history of previous language model responses as context to the prompt

> **Note**: Currently, the Language Model API doesn't support the use of system messages.

You can use two approaches for building the language model prompt:

- `LanguageModelChatMessage` - create the prompt by providing one or more messages as strings. You might use this approach if you're just getting started with the Language Model API.
- [`@vscode/prompt-tsx`](https://www.npmjs.com/package/@vscode/prompt-tsx) - declare the prompt by using the TSX syntax.

You can use the `prompt-tsx` library if you want more control over how the language model prompt is composed. For example, the library can help with dynamically adapting the length of the prompt to each language model's context window size. Learn more about [`@vscode/prompt-tsx`](https://www.npmjs.com/package/@vscode/prompt-tsx) or explore the [chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) to get started.

To learn more about the concepts of prompt engineering, we suggest reading OpenAI's excellent [Prompt engineering guidelines](https://platform.openai.com/docs/guides/prompt-engineering).

>**Tip:** take advantage of the rich VS Code extension API to get the most relevant context and include it in your prompt. For example, to include the contents of the active file in the editor.

### Use the `LanguageModelChatMessage` class

The Language Model API provides the `LanguageModelChatMessage` class to represent and create chat messages. You can use the `LanguageModelChatMessage.User` or `LanguageModelChatMessage.Assistant` methods to create user or assistant messages respectively.

In the following example, the first message provides context for the prompt:

- The persona used by the model in its replies (in this case, a cat)
- The rules the model should follow when generating responses (in this case, explaining computer science concepts in a funny manner by using cat metaphors)

The second message then provides the specific request or instruction coming from the user. It determines the specific task to be accomplished, given the context provided by the first message.

```typescript
const craftedPrompt = [
    vscode.LanguageModelChatMessage.User('You are a cat! Think carefully and step by step like a cat would. Your job is to explain computer science concepts in the funny manner of a cat, using cat metaphors. Always start your response by stating what concept you are explaining. Always include code samples.'),
    vscode.LanguageModelChatMessage.User('I want to understand recursion')
];
```

## Send the language model request

Once you've built the prompt for the language model, you first select the language model you want to use with the [`selectChatModels`](/api/references/vscode-api#lm.selectChatModels) method. This method returns an array of language models that match the specified criteria. If you are implementing a chat participant, we recommend that you instead use the model that is passed as part of the `request` object in your chat request handler. This ensures that your extension respects the model that the user chose in the chat model dropdown. Then, you send the request to the language model by using the [`sendRequest`](/api/references/vscode-api#LanguageModelChat) method.

To select the language model, you can specify the following properties: `vendor`, `id`, `family`, or `version`. Use these properties to either broadly match all models of a given vendor or family, or select one specific model by its ID. Learn more about these properties in the [API reference](/api/references/vscode-api#LanguageModelChat).

> **Note**: Currently, `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `o1-mini`, `claude-3.5-sonnet`, `gemini-1.5-pro` are supported for the language model family. If you are unsure what model to use, we recommend `gpt-4o` for it's performance and quality. For interactions directly in the editor, we recommend `gpt-4o-mini` for it's performance.

If there are no models that match the specified criteria, the `selectChatModels` method returns an empty array. Your extension must appropriately handle this case.

The following example shows how to select all `Copilot` models, regardless of the family or version:

```typescript
const models = await vscode.lm.selectChatModels({
  vendor: 'copilot'
});

// No models available
if (models.length === 0) {
  // TODO: handle the case when no models are available
}
```

> **Important**: Copilot's language models require consent from the user before an extension can use them. Consent is implemented as an authentication dialog. Because of that, `selectChatModels` should be called as part of a user-initiated action, such as a command.

After you select a model, you can send a request to the language model by invoking the [`sendRequest`](/api/references/vscode-api#LanguageModelChat) method on the model instance. You pass the [prompt](#build-the-language-model-prompt) you crafted earlier, along with any additional options, and a cancellation token.

When you make a request to the Language Model API, the request might fail. For example, because the model doesn't exist, or the user didn't give consent to use the Language Model API, or because quota limits are exceeded. Use `LanguageModelError` to distinguish between different types of errors.

The following code snippet shows how to make a language model request:

```typescript
try {
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    const request = model.sendRequest(craftedPrompt, {}, token);
} catch (err) {
    // Making the chat request might fail because
    // - model does not exist
    // - user consent not given
    // - quota limits were exceeded
    if (err instanceof vscode.LanguageModelError) {
        console.log(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
            stream.markdown(vscode.l10n.t('I\'m sorry, I can only explain computer science concepts.'));
        }
    } else {
        // add other error handling logic
        throw err;
    }
}
```

## Interpret the response

After you've sent the request, you have to process the response from the language model API. Depending on your usage scenario, you can pass the response directly on to the user, or you can interpret the response and perform extra logic.

The response ([`LanguageModelChatResponse`](/api/references/vscode-api#LanguageModelChatResponse)) from the Language Model API is streaming-based, which enables you to provide a smooth user experience. For example, by reporting results and progress continuously when you use the API in combination with the [Chat API](/api/extension-guides/chat).

Errors might occur while processing the streaming response, such as network connection issues. Make sure to add appropriate error handling in your code to handle these errors.

The following code snippet shows how an extension can register a command, which uses the language model to change all variable names in the active editor with funny cat names. Notice that the extension streams the code back to the editor for a smooth user experience.

```typescript
 vscode.commands.registerTextEditorCommand('cat.namesInEditor', async (textEditor: vscode.TextEditor) => {
    // Replace all variables in active editor with cat names and words

    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    let chatResponse: vscode.LanguageModelChatResponse | undefined;

    const text = textEditor.document.getText();

    const messages = [
        vscode.LanguageModelChatMessage.User(`You are a cat! Think carefully and step by step like a cat would.
        Your job is to replace all variable names in the following code with funny cat variable names. Be creative. IMPORTANT respond just with code. Do not use markdown!`),
        vscode.LanguageModelChatMessage.User(text)
    ];

    try {
        chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            console.log(err.message, err.code, err.cause)
        } else {
            throw err;
        }
        return;
    }

    // Clear the editor content before inserting new content
    await textEditor.edit(edit => {
        const start = new vscode.Position(0, 0);
        const end = new vscode.Position(textEditor.document.lineCount - 1, textEditor.document.lineAt(textEditor.document.lineCount - 1).text.length);
        edit.delete(new vscode.Range(start, end));
    });

    try {
        // Stream the code into the editor as it is coming in from the Language Model
        for await (const fragment of chatResponse.text) {
            await textEditor.edit(edit => {
                const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
                const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
                edit.insert(position, fragment);
            });
        }
    } catch (err) {
        // async response stream may fail, e.g network interruption or server side error
        await textEditor.edit(edit => {
            const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
            const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
            edit.insert(position, (<Error>err).message);
        });
    }
});
```

## Considerations

### Model availability

We don't expect specific models to stay supported forever. When you reference a language model in your extension, make sure to take a "defensive" approach when sending requests to that language model. This means that you should gracefully handle cases where you don't have access to a particular model.

### Choosing the appropriate model

Extension authors can choose which model is the most appropriate for their extension. We recommend using `gpt-4o` for its performance and quality. To get a full list of available models, you can use this code snippet:
```typescript
const allModels = await vscode.lm.selectChatModels(MODEL_SELECTOR);
```
> **Note**: The recommended GPT-4o model has a limit of `64K` tokens. The returned model object from the `selectChatModels` call has a `maxInputTokens` attribute that shows the token limit. These limits will be expanded as we learn more about how extensions are using the language models.

### Rate limiting

Extensions should responsibly use the language model and be aware of rate limiting. VS Code is transparent to the user regarding how extensions are using language models and how many requests each extension is sending and how that influences their respective quotas.

Extensions should not use the Language Model API for integration tests due to rate-limitations. Internally, VS Code uses a dedicated non-production language model for simulation testing, and we are currently thinking how to provide a scalable language model testing solution for extensions.

## Testing your extension

The responses that the Language Model API provides are nondeterministic, which means that you might get a different response for an identical request. This behavior can be challenging for testing your extension.

The part of the extension for building prompts and interpreting language model responses is deterministic, and can thus be unit tested without using an actual language model. However, interacting and getting responses from the language model itself, is nondeterministic and can’t be easily tested. Consider designing your extension code in a modular way to enable you to unit test the specific parts that can be tested.

## Publishing your extension

Once you have created your AI extension, you can publish your extension to the Visual Studio Marketplace:

- Before publishing to the VS Marketplace we recommend that you read the [Microsoft AI tools and practices guidelines](https://www.microsoft.com/en-us/ai/tools-practices). These guidelines provide best practices for the responsible development and use of AI technologies.
- By publishing to the VS Marketplace, your extension is adhering to the [GitHub Copilot extensibility acceptable development and use policy](https://docs.github.com/en/early-access/copilot/github-copilot-extensibility-platform-partnership-plugin-acceptable-development-and-use-policy).
- If your extension already contributes functionality other than using the Language Model API, we recommend that you do not introduce an extension dependency on GitHub Copilot in the [extension manifest](/api/references/extension-manifest). This ensures that extension users that do not use GitHub Copilot can use the non language model functionality without having to install GitHub Copilot. Make sure to have appropriate error handling when accessing language models for this case.
- Upload to the Marketplace as described in [Publishing Extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Related content

- [Build a VS Code chat extension](/api/extension-guides/chat)
- [Learn more about @vscode/prompt-tsx](https://www.npmjs.com/package/@vscode/prompt-tsx)
- [Chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample)
- [GitHub Copilot Trust Center](https://resources.github.com/copilot-trust-center/)

---
# DO NOT TOUCH — Managed by doc writer
ContentId: d9038699-4ffe-485b-b40a-b1260a9973ad
DateApproved: 12/11/2024

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: Tutorial that walks you through creating a VS Code extension that uses the Language Model API to generate AI-powered code annotations.
---

# Tutorial: Generate AI-powered code annotations by using the Language Model API

In this tutorial, You'll learn how to create a VS Code extension to build an AI-powered Code Tutor. You use the Language Model (LM) API to generate suggestions to improve your code and take advantage of the VS Code extension APIs to integrate it seamlessly in the editor as inline annotations that the user can hover over for more information. After you complete this tutorial, you will know how to implement custom AI features in VS Code.

![VS Code displaying custom annotations from GitHub Copilot as annotations](./images/lm-api/code-tutor-annotations-gif.gif)

## Prerequisites

You'll need the following tools and accounts to complete this tutorial:

- [Visual Studio Code](https://code.visualstudio.com/download)
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)
- [Node.js](https://nodejs.org/en/download/)

## Scaffold out the extension

First, use Yeoman and VS Code Extension Generator to scaffold a TypeScript or JavaScript project ready for development.

```bash
npx --package yo --package generator-code -- yo code
```

Select the following options to complete the new extension wizard...

```bash
# ? What type of extension do you want to create? New Extension (TypeScript)
# ? What's the name of your extension? Code Tutor

### Press <Enter> to choose default for all options below ###

# ? What's the identifier of your extension? code-tutor
# ? What's the description of your extension? LEAVE BLANK
# ? Initialize a git repository? Yes
# ? Bundle the source code with webpack? No
# ? Which package manager to use? npm

# ? Do you want to open the new folder with Visual Studio Code? Open with `code`
```

## Modify the package.json file to include the correct commands

The scaffolded project includes a single "helloWorld" command in the `package.json` file. This command is what shows up in the Command Palette when your extension is installed.

```json
"contributes": {
  "commands": [
      {
      "command": "code-tutor.helloWorld",
      "title": "Hello World"
      }
  ]
}
```

Since we're building a Code Tutor extension that will be adding annotations to lines, we'll need a command to allow the user to toggle these annotations on and off. Update the `command` and `title` properties:

```json
"contributes": {
  "commands": [
      {
      "command": "code-tutor.annotate",
      "title": "Toggle Tutor Annotations"
      }
  ]
}
```

While the `package.json` defines the commands and UI elements for an extension, the `src/extension.ts` file is where you put the code that should be executed for those commands.

Open the `src/extension.ts` file and change the `registerCommand` method so that it matches the `command` property in the `package.json` file.

```ts
const disposable = vscode.commands.registerCommand('code-tutor.annotate', () => {
```

Run the extension by pressing `kbstyle(F5)`. This will open a new VS Code instance with the extension installed. Open the Command Palette by pressing `kb(workbench.action.showCommands)`, and search for "tutor". You should see the "Tutor Annotations" command.

![The "Toggle Tutor Annotations" command in the VS Code Command Palette](./images/lm-api/tutor-command-command-palette.png)

If you select the "Tutor Annotations" command, you'll see a "Hello World" notification message.

![The message 'Hello World from Code Tutor' displayed in a notification](./images/lm-api/code-tutor-hello-world.png)

## Implement the "annotate" command

To get our Code Tutor annotations working, we need to send it some code and ask it to provide annotations. We'll do this in three steps:

1. Get the code with line numbers from the current tab the user has open.
2. Send that code to the Language Model API along with a custom prompt that instructs the model on how to provide annotations.
3. Parse the annotations and display them in the editor.

### Step 1: Get the code with line numbers

To get the code from the current tab, we need a reference to the tab that the user has open. We can get that by modifying the `registerCommand` method to be a `registerTextEditorCommand`. The difference between these two commands is that the latter gives us a reference to the tab that the user has open, called the `TextEditor`.

```ts
const disposable = vscode.commands.registerTextEditorCommand('code-tutor.annotate', async (textEditor: vscode.TextEditor) => {
```

Now we can use the `textEditor` reference to get all of the code in the "viewable editor space". This is the code that can be seen on the screen - it does not include code that is either above or below what is in the viewable editor space.

Add the following method directly above the `export function deactivate() { }` line at the bottom of the `extension.ts` file.

```ts
function getVisibleCodeWithLineNumbers(textEditor: vscode.TextEditor) {
  // get the position of the first and last visible lines
  let currentLine = textEditor.visibleRanges[0].start.line;
  const endLine = textEditor.visibleRanges[0].end.line;

  let code = '';

  // get the text from the line at the current position.
  // The line number is 0-based, so we add 1 to it to make it 1-based.
  while (currentLine < endLine) {
    code += `${currentLine + 1}: ${textEditor.document.lineAt(currentLine).text} \n`;
    // move to the next line position
    currentLine++;
  }
  return code;
}
```

This code uses the `visibleRanges` property of the TextEditor to get the position of the lines that are currently visible in the editor. It then starts with the first line position and moves to the last line position, adding each line of code to a string along with the line number. Finally, it returns the string that contains all the viewable code with line numbers.

Now we can call this method from the `code-tutor.annotate` command. Modify the implementation of the command so that it looks like this:

```ts
const disposable = vscode.commands.registerTextEditorCommand('code-tutor.annotate', async (textEditor: vscode.TextEditor) => {

  // Get the code with line numbers from the current editor
  const codeWithLineNumbers = getVisibleCodeWithLineNumbers(textEditor);

});
```

### Step 2: Send code and prompt to language model API

The next step is to call the GitHub Copilot language model and send it the user's code along with instructions to create the annotations.

To do this, we first need to specify which chat model we want to use. We select 4o here because it is a fast and capable model for the kind of interaction we are building.

```ts
const disposable = vscode.commands.registerTextEditorCommand('code-tutor.annotate', async (textEditor: vscode.TextEditor) => {

  // Get the code with line numbers from the current editor
  const codeWithLineNumbers = getVisibleCodeWithLineNumbers(textEditor);

  // select the 4o chat model
  let [model] = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    family: 'gpt-4o',
  });
});
```

We need instructions - or a "prompt" - that will tell the model to create the annotations and what format we want the response to be. Add the following code to the top of the file directly under the imports.

```ts
const ANNOTATION_PROMPT = `You are a code tutor who helps students learn how to write better code. Your job is to evaluate a block of code that the user gives you and then annotate any lines that could be improved with a brief suggestion and the reason why you are making that suggestion. Only make suggestions when you feel the severity is enough that it will impact the readability and maintainability of the code. Be friendly with your suggestions and remember that these are students so they need gentle guidance. Format each suggestion as a single JSON object. It is not necessary to wrap your response in triple backticks. Here is an example of what your response should look like:

{ "line": 1, "suggestion": "I think you should use a for loop instead of a while loop. A for loop is more concise and easier to read." }{ "line": 12, "suggestion": "I think you should use a for loop instead of a while loop. A for loop is more concise and easier to read." }
`;
```

This is a special prompt that instructs the language model on how to generate annotations. It also includes examples for how the model should format its response. These examples (also called, "multi-shot") are what enable us to define what the format the response will be so that we can parse it and display it as annotations.

We pass messages to the model in an array. This array can contain as many messages as you like. In our case, it contains the prompt followed by the users code with line numbers.

```ts
const disposable = vscode.commands.registerTextEditorCommand('code-tutor.annotate', async (textEditor: vscode.TextEditor) => {

  // Get the code with line numbers from the current editor
  const codeWithLineNumbers = getVisibleCodeWithLineNumbers(textEditor);

  // select the 4o chat model
  let [model] = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    family: 'gpt-4o',
  });

  // init the chat message
  const messages = [
    vscode.LanguageModelChatMessage.User(ANNOTATION_PROMPT),
    vscode.LanguageModelChatMessage.User(codeWithLineNumbers),
  ];
});
```

To send the messages to the model, we need to first make sure the selected model is available. This handles cases where the extension is not ready or the user is not signed in to GitHub Copilot. Then we send the messages to the model.

```ts
const disposable = vscode.commands.registerTextEditorCommand('code-tutor.annotate', async (textEditor: vscode.TextEditor) => {

  // Get the code with line numbers from the current editor
  const codeWithLineNumbers = getVisibleCodeWithLineNumbers(textEditor);

  // select the 4o chat model
  let [model] = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    family: 'gpt-4o',
  });

  // init the chat message
  const messages = [
    vscode.LanguageModelChatMessage.User(ANNOTATION_PROMPT),
    vscode.LanguageModelChatMessage.User(codeWithLineNumbers),
  ];

  // make sure the model is available
  if (model) {

    // send the messages array to the model and get the response
    let chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    // handle chat response
    await parseChatResponse(chatResponse, textEditor);
  }
});
```

Chat responses come in as fragments. These fragments usually contain single words, but sometimes they contain just punctuation. In order to display annotations as the response streams in, we want to wait until we have a complete annotation before we display it. Because of the way we have instructed our model to return its response, we know that when we see a closing `}` we have a complete annotation. We can then parse the annotation and display it in the editor.

Add the missing `parseChatResponse` function above the `getVisibleCodeWithLineNumbers` method in the `extension.ts` file.

```ts
async function parseChatResponse(chatResponse: vscode.LanguageModelChatResponse, textEditor: vscode.TextEditor) {
 let accumulatedResponse = "";

 for await (const fragment of chatResponse.text) {
  accumulatedResponse += fragment;

  // if the fragment is a }, we can try to parse the whole line
  if (fragment.includes("}")) {
   try {
    const annotation = JSON.parse(accumulatedResponse);
    applyDecoration(textEditor, annotation.line, annotation.suggestion);
    // reset the accumulator for the next line
    accumulatedResponse = "";
   }
   catch (e) {
    // do nothing
   }
  }
 }
}
```

We need one last method to actually display the annotations. VS Code calls these "decorations". Add the following method above the `parseChatResponse` method in the `extension.ts` file.

```ts
function applyDecoration(editor: vscode.TextEditor, line: number, suggestion: string) {

 const decorationType = vscode.window.createTextEditorDecorationType({
  after: {
   contentText: ` ${suggestion.substring(0, 25) + "..."}`,
   color: "grey",
  },
 });

 // get the end of the line with the specified line number
 const lineLength = editor.document.lineAt(line - 1).text.length;
 const range = new vscode.Range(
  new vscode.Position(line - 1, lineLength),
  new vscode.Position(line - 1, lineLength),
 );

 const decoration = { range: range, hoverMessage: suggestion };

 vscode.window.activeTextEditor?.setDecorations(decorationType, [
  decoration,
 ]);
}
```

This method takes in our parsed annotation from the model and uses it to create a decoration. This is done by first creating a `TextEditorDecorationType` that specifies the appearance of the decoration. In this case, we are just adding a grey annotation and truncating it to 25 characters. We'll show the full message when the user hovers over the message.

We are then setting where the decoration should appear. We need it to be on the line number that was specified in the annotation, and at the end of the line.

Finally, we set the decoration on the active text editor which is what causes the annotation to appear in the editor.

If your extension is still running, restart it by selecting the green arrow from the debug bar. If you closed the debug session, press `kbstyle(F5)` to run the extension. Open a code file in the new VS Code window instance that opens. When you select "Toggle Tutor Annotations" from the Command Palette, you should see the code annotations appear in the editor.

![A code file with annotations from GitHub Copilot](./images/lm-api/code-with-annotations.png)

## Add a button to the editor title bar

You can enable your command to be invoked from places other than the Command Palette. In our case, we can add a button to the top of the current tab that allows the user to easily toggle the annotations.

To do this, modify the "contributes" portion of the `package.json` as follows:

```json
"contributes": {
  "commands": [
    {
      "command": "code-tutor.annotate",
      "title": "Toggle Tutor Annotations",
      "icon": "$(comment)"
    }
  ],
  "menus": {
    "editor/title": [
      {
        "command": "code-tutor.annotate",
        "group": "navigation"
      }
    ]
  }
}
```

This causes a button to appear in the navigation area (right-side) of the editor title bar. The "icon" comes from the [Product Icon Reference](https://code.visualstudio.com/api/references/icons-in-labels).

Restart your extension with the green arrow or press `kbstyle(F5)` if the extension is not already running. You should now see a comment icon that will trigger the "Toggle Tutor Annotations" command.

![A comment icon appears in the title bar of the active tab in VS Code](./images/lm-api/code-tutor-annotations-gif.gif)

## Next Steps

In this tutorial, you learned how to create a VS Code extension that integrates AI into the editor with the language model API. You used the VS Code extension API to get the code from the current tab, sent it to the model with a custom prompt, and then parsed and displayed the model result right in the editor using decorators.

Next, you can extend your Code Tutor extension to [include a chat participant](/api/extension-guides/chat-tutorial) as well which will allow users to interact directly with your extension via the GitHub Copilot chat interface. You can also [explore the full range of API's in VS Code](/api/references/vscode-api) to explore new ways of building custom AI experiences your editor.

You can find the complete source code for this tutorial in the [vscode-extensions-sample repository](https://github.com/microsoft/vscode-extension-samples/tree/main/lm-api-tutorial).

## Related content

- [Language Model API extension guide](/api/extension-guides/language-model)
- [Tutorial: Create a code tutor chat participant with the Chat API](/api/extension-guides/chat-tutorial)
- [VS Code Chat API reference](/api/extension-guides/chat)

---
# DO NOT TOUCH — Managed by doc writer
ContentId: 9bdc3d4e-e6ba-43d3-bd09-2e127cb63ce7
DateApproved: 12/11/2024

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: A guide to adding AI-powered features to a VS Code extension by using language models and natural language understanding.
---

# Language Model API

The Language Model API enables you to [use the Language Model](/api/references/vscode-api#lm) and integrate AI-powered features and natural language processing in your Visual Studio Code extension.

You can use the Language Model API in different types of extensions. A typical use for this API is in [chat extensions](/api/extension-guides/chat), where you use a language model to interpret the user's request and help provide an answer. However, the use of the Language Model API is not limited to this scenario. You might use a language model in a [language](/api/language-extensions/overview) or [debugger](/api/extension-guides/debugger-extension) extension, or as part of a [command](/api/extension-guides/command) or [task](/api/extension-guides/task-provider) in a custom extension. For example, the Rust extension might use the Language Model to offer default names to improve its rename experience.

The process for using the Language Model API consists of the following steps:

1. Build the language model prompt
1. Send the language model request
1. Interpret the response

The following sections provide more details on how to implement these steps in your extension.

## Links

- [Chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample)
- [LanguageModels API](/api/references/vscode-api#lm)
- [@vscode/prompt-tsx npm package](https://www.npmjs.com/package/@vscode/prompt-tsx)

## Build the language model prompt

To interact with a language model, extensions should first craft their prompt, and then send a request to the language model. You can use prompts to provide instructions to the language model on the broad task that you're using the model for. Prompts can also define the context in which user messages are interpreted.

The Language Model API supports two types of messages when building the language model prompt:

- **User** - used for providing instructions and the user's request
- **Assistant** - used for adding the history of previous language model responses as context to the prompt

> **Note**: Currently, the Language Model API doesn't support the use of system messages.

You can use two approaches for building the language model prompt:

- `LanguageModelChatMessage` - create the prompt by providing one or more messages as strings. You might use this approach if you're just getting started with the Language Model API.
- [`@vscode/prompt-tsx`](https://www.npmjs.com/package/@vscode/prompt-tsx) - declare the prompt by using the TSX syntax.

You can use the `prompt-tsx` library if you want more control over how the language model prompt is composed. For example, the library can help with dynamically adapting the length of the prompt to each language model's context window size. Learn more about [`@vscode/prompt-tsx`](https://www.npmjs.com/package/@vscode/prompt-tsx) or explore the [chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) to get started.

To learn more about the concepts of prompt engineering, we suggest reading OpenAI's excellent [Prompt engineering guidelines](https://platform.openai.com/docs/guides/prompt-engineering).

>**Tip:** take advantage of the rich VS Code extension API to get the most relevant context and include it in your prompt. For example, to include the contents of the active file in the editor.

### Use the `LanguageModelChatMessage` class

The Language Model API provides the `LanguageModelChatMessage` class to represent and create chat messages. You can use the `LanguageModelChatMessage.User` or `LanguageModelChatMessage.Assistant` methods to create user or assistant messages respectively.

In the following example, the first message provides context for the prompt:

- The persona used by the model in its replies (in this case, a cat)
- The rules the model should follow when generating responses (in this case, explaining computer science concepts in a funny manner by using cat metaphors)

The second message then provides the specific request or instruction coming from the user. It determines the specific task to be accomplished, given the context provided by the first message.

```typescript
const craftedPrompt = [
    vscode.LanguageModelChatMessage.User('You are a cat! Think carefully and step by step like a cat would. Your job is to explain computer science concepts in the funny manner of a cat, using cat metaphors. Always start your response by stating what concept you are explaining. Always include code samples.'),
    vscode.LanguageModelChatMessage.User('I want to understand recursion')
];
```

## Send the language model request

Once you've built the prompt for the language model, you first select the language model you want to use with the [`selectChatModels`](/api/references/vscode-api#lm.selectChatModels) method. This method returns an array of language models that match the specified criteria. If you are implementing a chat participant, we recommend that you instead use the model that is passed as part of the `request` object in your chat request handler. This ensures that your extension respects the model that the user chose in the chat model dropdown. Then, you send the request to the language model by using the [`sendRequest`](/api/references/vscode-api#LanguageModelChat) method.

To select the language model, you can specify the following properties: `vendor`, `id`, `family`, or `version`. Use these properties to either broadly match all models of a given vendor or family, or select one specific model by its ID. Learn more about these properties in the [API reference](/api/references/vscode-api#LanguageModelChat).

> **Note**: Currently, `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `o1-mini`, `claude-3.5-sonnet`, `gemini-1.5-pro` are supported for the language model family. If you are unsure what model to use, we recommend `gpt-4o` for it's performance and quality. For interactions directly in the editor, we recommend `gpt-4o-mini` for it's performance.

If there are no models that match the specified criteria, the `selectChatModels` method returns an empty array. Your extension must appropriately handle this case.

The following example shows how to select all `Copilot` models, regardless of the family or version:

```typescript
const models = await vscode.lm.selectChatModels({
  vendor: 'copilot'
});

// No models available
if (models.length === 0) {
  // TODO: handle the case when no models are available
}
```

> **Important**: Copilot's language models require consent from the user before an extension can use them. Consent is implemented as an authentication dialog. Because of that, `selectChatModels` should be called as part of a user-initiated action, such as a command.

After you select a model, you can send a request to the language model by invoking the [`sendRequest`](/api/references/vscode-api#LanguageModelChat) method on the model instance. You pass the [prompt](#build-the-language-model-prompt) you crafted earlier, along with any additional options, and a cancellation token.

When you make a request to the Language Model API, the request might fail. For example, because the model doesn't exist, or the user didn't give consent to use the Language Model API, or because quota limits are exceeded. Use `LanguageModelError` to distinguish between different types of errors.

The following code snippet shows how to make a language model request:

```typescript
try {
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    const request = model.sendRequest(craftedPrompt, {}, token);
} catch (err) {
    // Making the chat request might fail because
    // - model does not exist
    // - user consent not given
    // - quota limits were exceeded
    if (err instanceof vscode.LanguageModelError) {
        console.log(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
            stream.markdown(vscode.l10n.t('I\'m sorry, I can only explain computer science concepts.'));
        }
    } else {
        // add other error handling logic
        throw err;
    }
}
```

## Interpret the response

After you've sent the request, you have to process the response from the language model API. Depending on your usage scenario, you can pass the response directly on to the user, or you can interpret the response and perform extra logic.

The response ([`LanguageModelChatResponse`](/api/references/vscode-api#LanguageModelChatResponse)) from the Language Model API is streaming-based, which enables you to provide a smooth user experience. For example, by reporting results and progress continuously when you use the API in combination with the [Chat API](/api/extension-guides/chat).

Errors might occur while processing the streaming response, such as network connection issues. Make sure to add appropriate error handling in your code to handle these errors.

The following code snippet shows how an extension can register a command, which uses the language model to change all variable names in the active editor with funny cat names. Notice that the extension streams the code back to the editor for a smooth user experience.

```typescript
 vscode.commands.registerTextEditorCommand('cat.namesInEditor', async (textEditor: vscode.TextEditor) => {
    // Replace all variables in active editor with cat names and words

    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    let chatResponse: vscode.LanguageModelChatResponse | undefined;

    const text = textEditor.document.getText();

    const messages = [
        vscode.LanguageModelChatMessage.User(`You are a cat! Think carefully and step by step like a cat would.
        Your job is to replace all variable names in the following code with funny cat variable names. Be creative. IMPORTANT respond just with code. Do not use markdown!`),
        vscode.LanguageModelChatMessage.User(text)
    ];

    try {
        chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            console.log(err.message, err.code, err.cause)
        } else {
            throw err;
        }
        return;
    }

    // Clear the editor content before inserting new content
    await textEditor.edit(edit => {
        const start = new vscode.Position(0, 0);
        const end = new vscode.Position(textEditor.document.lineCount - 1, textEditor.document.lineAt(textEditor.document.lineCount - 1).text.length);
        edit.delete(new vscode.Range(start, end));
    });

    try {
        // Stream the code into the editor as it is coming in from the Language Model
        for await (const fragment of chatResponse.text) {
            await textEditor.edit(edit => {
                const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
                const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
                edit.insert(position, fragment);
            });
        }
    } catch (err) {
        // async response stream may fail, e.g network interruption or server side error
        await textEditor.edit(edit => {
            const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
            const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
            edit.insert(position, (<Error>err).message);
        });
    }
});
```

## Considerations

### Model availability

We don't expect specific models to stay supported forever. When you reference a language model in your extension, make sure to take a "defensive" approach when sending requests to that language model. This means that you should gracefully handle cases where you don't have access to a particular model.

### Choosing the appropriate model

Extension authors can choose which model is the most appropriate for their extension. We recommend using `gpt-4o` for its performance and quality. To get a full list of available models, you can use this code snippet:
```typescript
const allModels = await vscode.lm.selectChatModels(MODEL_SELECTOR);
```
> **Note**: The recommended GPT-4o model has a limit of `64K` tokens. The returned model object from the `selectChatModels` call has a `maxInputTokens` attribute that shows the token limit. These limits will be expanded as we learn more about how extensions are using the language models.

### Rate limiting

Extensions should responsibly use the language model and be aware of rate limiting. VS Code is transparent to the user regarding how extensions are using language models and how many requests each extension is sending and how that influences their respective quotas.

Extensions should not use the Language Model API for integration tests due to rate-limitations. Internally, VS Code uses a dedicated non-production language model for simulation testing, and we are currently thinking how to provide a scalable language model testing solution for extensions.

## Testing your extension

The responses that the Language Model API provides are nondeterministic, which means that you might get a different response for an identical request. This behavior can be challenging for testing your extension.

The part of the extension for building prompts and interpreting language model responses is deterministic, and can thus be unit tested without using an actual language model. However, interacting and getting responses from the language model itself, is nondeterministic and can’t be easily tested. Consider designing your extension code in a modular way to enable you to unit test the specific parts that can be tested.

## Publishing your extension

Once you have created your AI extension, you can publish your extension to the Visual Studio Marketplace:

- Before publishing to the VS Marketplace we recommend that you read the [Microsoft AI tools and practices guidelines](https://www.microsoft.com/en-us/ai/tools-practices). These guidelines provide best practices for the responsible development and use of AI technologies.
- By publishing to the VS Marketplace, your extension is adhering to the [GitHub Copilot extensibility acceptable development and use policy](https://docs.github.com/en/early-access/copilot/github-copilot-extensibility-platform-partnership-plugin-acceptable-development-and-use-policy).
- If your extension already contributes functionality other than using the Language Model API, we recommend that you do not introduce an extension dependency on GitHub Copilot in the [extension manifest](/api/references/extension-manifest). This ensures that extension users that do not use GitHub Copilot can use the non language model functionality without having to install GitHub Copilot. Make sure to have appropriate error handling when accessing language models for this case.
- Upload to the Marketplace as described in [Publishing Extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Related content

- [Build a VS Code chat extension](/api/extension-guides/chat)
- [Learn more about @vscode/prompt-tsx](https://www.npmjs.com/package/@vscode/prompt-tsx)
- [Chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample)
- [GitHub Copilot Trust Center](https://resources.github.com/copilot-trust-center/)

---
# DO NOT TOUCH — Managed by doc writer
ContentId: aa6d312f-cbac-4633-8579-64d3cb4d17be
DateApproved: 12/11/2024

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: A guide to creating a language model tool and how to implement tool calling in a chat extension
---

# LanguageModelTool API

In this extension guide, you'll learn how to create a language model tool and how to implement tool calling in a chat extension.

## What is tool calling in an LLM?

Tool calling enables you to extend the functionality of a large language model (LLM) by connecting it to external tools and systems to perform tasks that go beyond text processing.

A language model tool is a function that can be invoked as part of language model request. For example, you might have a function that retrieves information from a database, finds files, or performs some calculation. You can implement a language model tool in your extension, or use publicly available tools from other extensions.

The LLM never actually executes the tool itself, instead the LLM generates the parameters that can be used to call your tool, which your code can then choose how to handle by calling the indicated function. Your extension is always in full control of the tool calling process.

Read more about [function calling](https://platform.openai.com/docs/guides/function-calling) in the OpenAI documentation.

## Why use tool calling?

There are multiple scenarios where you might want to use tool calling in a chat extension. Some examples include:

- **Let the LLM dynamically ask for more context**. For example, you can use a tool to retrieve information from a database, or find relevant files.
- **Let the LLM take some action dynamically**. The LLM itself can't perform calculations or make calls to other systems. For example, use a tool to run a terminal command and return the output to the LLM.
- **Hook up some context/behavior that is contributed by another VS Code extension**. For example, you might have a tool that uses the Git extension to retrieve information about the current repository.

## Tool-calling flow

The tool-calling flow in a chat extension is as follows:

1. Retrieve the list of relevant tools
1. Send the request to the LLM, providing the list of tool definitions to consider
1. The LLM generates a response, which may include one or more requests to invoke a tool
1. Invoke the tool by using the parameter values provided in the LLM response
1. Send another request to the LLM, including the tool results
1. The LLM generates the final user response, which may incorporate tool responses

    If the LLM response includes more requests for tool invocations, repeat steps 4-6 until there are no more tool requests.

### Implement tool calling with the chat extension library

You can use the [`@vscode/chat-extension-utils` library](https://www.npmjs.com/package/@vscode/chat-extension-utils) to simplify the process of calling tools in a chat extension.

Implement tool calling in the `vscode.ChatRequestHandler` function of your [chat participant](/api/extension-guides/chat).

1. Determine the relevant tools for the current chat context. You can access all available tools by using `vscode.lm.tools`.

    The following code snippet shows how to filter the tools to only those that have a specific tag.

    ```ts
    const tools = request.command === 'all' ?
        vscode.lm.tools :
        vscode.lm.tools.filter(tool => tool.tags.includes('chat-tools-sample'));
    ```

1. Send the request and tool definitions to the LLM by using `sendChatParticipantRequest`.

    ```ts
    const libResult = chatUtils.sendChatParticipantRequest(
        request,
        chatContext,
        {
            prompt: 'You are a cat! Answer as a cat.',
            responseStreamOptions: {
                stream,
                references: true,
                responseText: true
            },
            tools
        },
        token);
    ```

    The `ChatHandlerOptions` object has the following properties:

    - `prompt`: (optional) Instructions for the chat participant prompt.
    - `model`: (optional) The model to use for the request. If not specified, the model from the chat context is used.
    - `tools`: (optional) The list of tools to consider for the request.
    - `requestJustification`: (optional) A string that describes why the request is being made.
    - `responseStreamOptions`: (optional) Enable `sendChatParticipantRequest` to stream the response back to VS Code. Optionally, you can also enable references and/or response text.

1. Return the result from the LLM. This might contain error details or tool-calling metadata.

    ```ts
    return await libResult.result;
    ```

The full source code of this [tool-calling sample](https://github.com/microsoft/vscode-extension-samples/blob/main/chat-sample/src/chatUtilsSample.ts) is available in the VS Code Extension Samples repository.

### Implement tool calling yourself

For more advanced scenarios, you can also implement tool calling yourself. Optionally, you can use the `@vscode/prompt-tsx` library for crafting the LLM prompts. By implementing tool calling yourself, you have more control over the tool-calling process. For example, to perform additional validation or to handle tool responses in a specific way before sending them to the LLM.

View the full source code for implementing [tool calling by using prompt-tsx](https://github.com/microsoft/vscode-extension-samples/blob/main/chat-sample/src/toolParticipant.ts) in the VS Code Extension Samples repository.

## Create a language model tool

When calling tools, you can call publicly available language model tools contributed by other extensions, or you can create your own tools. When you create a tool, you can choose whether to register it with the VS Code API, or just use it within your extension as a *private* tool.

When you publish a tool with the VS Code API, that tool is available to all extensions.

### Deciding between registering a tool and using it as a private tool

Register a tool with the VS Code API if:

- The tool makes sense to other extensions, and could be used without special handling for the particular tool
- The extension needs to provide a progress message and confirmation

Use a private tool if:

- The tool can't be made public, for example because it's specific to your company or retrieves non-public data
- The tool requires some special handling and is specific to your extension

### Implement a language model tool

To implement a language model tool:

1. Define the tool in the `contributes` property in the `package.json`

    The following example shows how to define a tool that counts the number of active tabs in a tab group.

    ```json
    "contributes": {
        "languageModelTools": [
            {
                "name": "chat-tools-sample_tabCount",
                "tags": [
                    "editors",
                    "chat-tools-sample"
                ],
                "toolReferenceName": "tabCount",
                "displayName": "Tab Count",
                "modelDescription": "The number of active tabs in a tab group",
                "icon": "$(files)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabGroup": {
                            "type": "number",
                            "description": "The index of the tab group to check. This is optional- if not specified, the active tab group will be checked.",
                            "default": 0
                        }
                    }
                }
            }
        ]
    }
    ```

    A language model tool has the following properties:

    - `name`: The unique name of the tool. This is used to reference the tool in the extension implementation code.
    - `tags`: An array of tags that describe the tool. This is used to filter the list of tools that are relevant for a specific request.
    - `toolReferenceName`: If enabled, the name for users to reference the tool in a chat prompt via `#`.
    - `displayName`: The user-friendly name of the tool, used for displaying in the UI.
    - `modelDescription`: Description of the tool, which can be used by the language model to select it.
    - `icon`: The icon to display for the tool in the UI.
    - `inputSchema`: The JSON schema that describes the input parameters for the tool. This is used by the language model to provide parameter values for the tool invocation.

1. (optional) Register tool with `vscode.lm.registerTool`

    If you want to publish the tool for use by other extensions, you must register the tool with the `vscode.lm.registerTool` API. Provide the name of the tool as you specified it in the `package.json` file.

    ```ts
    export function registerChatTools(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.lm.registerTool('chat-tools-sample_tabCount', new TabCountTool()));
    }
    ```

1. Implement the language model tool by implementing the `vscode.LanguageModelTool<>` interface.

    - Implement `prepareInvocation` to provide a confirmation message for the tool invocation.

        The following example shows how to provide a confirmation message for the tab count tool.

        ```ts
        async prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<ITabCountParameters>,
            _token: vscode.CancellationToken
        ) {
            const confirmationMessages = {
                title: 'Count the number of open tabs',
                message: new vscode.MarkdownString(
                    `Count the number of open tabs?` +
                    (options.input.tabGroup !== undefined
                        ? ` in tab group ${options.input.tabGroup}`
                        : '')
                ),
            };

            return {
                invocationMessage: 'Counting the number of tabs',
                confirmationMessages,
            };
        }
        ```

    - Define an interface that describes the tool input parameters. This interface is used in the `invoke` method.

        The following example shows the interface for the tab count tool.

        ```ts
        export interface ITabCountParameters {
            tabGroup?: number;
        }
        ```

    - Implement `invoke`, which is called when the tool is invoked. It receives the tool input parameters in the `options` parameter.

        The following example shows the implementation of the tab count tool. The result of the tool is an instance of type `vscode.LanguageModelToolResult`.

        ```ts
        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<ITabCountParameters>,
            _token: vscode.CancellationToken
        ) {
            const params = options.input;
            if (typeof params.tabGroup === 'number') {
                const group = vscode.window.tabGroups.all[Math.max(params.tabGroup - 1, 0)];
                const nth =
                    params.tabGroup === 1
                        ? '1st'
                        : params.tabGroup === 2
                            ? '2nd'
                            : params.tabGroup === 3
                                ? '3rd'
                                : `${params.tabGroup}th`;
                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`There are ${group.tabs.length} tabs open in the ${nth} tab group.`)]);
            } else {
                const group = vscode.window.tabGroups.activeTabGroup;
                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`There are ${group.tabs.length} tabs open.`)]);
            }
        }
        ```

View the full source code for implementing a [language model tool](https://github.com/microsoft/vscode-extension-samples/blob/main/chat-sample/src/tools.ts) in the VS Code Extension Samples repository.

## Getting started

- [Chat extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample)

## Related content

- [Get started with the Language Model API](/api/extension-guides/language-model)
- [Build a chat extension](/api/extension-guides/chat)
- [Use Prompt-tsx](/api/extension-guides/prompt-tsx)
- [@vscode/vscode-chat-extension-utils library](https://github.com/microsoft/vscode-chat-extension-utils)

---
# DO NOT TOUCH — Managed by doc writer
ContentId: 05d1e8f8-9bc0-45a4-a8c5-348005fd7ca8
DateApproved: 12/11/2024

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: A guide for how to build language model prompts using the prompt-tsx library
---

# Craft language model prompts

You can build language model prompts by using string concatenation, but it's hard to compose features and make sure your prompts stay within the context window of language models. To overcome these limitations, you can use the [`@vscode/prompt-tsx`](https://github.com/microsoft/vscode-prompt-tsx) library.

The `@vscode/prompt-tsx` library provides the following features:

- **TSX-based prompt rendering**: Compose prompts using TSX components, making them more readable and maintainable
- **Priority-based pruning**: Automatically prune less important parts of prompts to fit within the model's context window
- **Flexible token management**: Use properties like `flexGrow`, `flexReserve`, and `flexBasis` to cooperatively use token budgets
- **Tool integration**: Integrate with VS Code's language model tools API

For a complete overview of all features and detailed usage instructions, refer to the [full README](https://github.com/microsoft/vscode-prompt-tsx/blob/main/README.md).

This article describes practical examples of prompt design with the library. The complete code for these examples can be found in the [prompt-tsx repository](https://github.com/microsoft/vscode-prompt-tsx/tree/main/examples).

## Manage priorities in the conversation history

Including conversation history in your prompt is important as it enables the user to ask follow-up questions to previous messages. However, you want to make sure its priority is treated appropriately because history can grow large over time. We've found that the pattern which makes the most sense is usually to prioritize, in order:

1. The base prompt instructions
2. The current user query
3. The last couple of turns of chat history
4. Any supporting data
5. As much of the remaining history as you can fit

For this reason, split the history into two parts in the prompt, where recent prompt turns are prioritized over general contextual information.

In this library, each TSX node in the tree has a priority that is conceptually similar to a zIndex where a higher number means a higher priority.

### Step 1: Define the HistoryMessages component

To list history messages, define a `HistoryMessages` component. This example provides a good starting point, but you might have to expand it if you deal with more complex data types.

This example uses the `PrioritizedList` helper component, which automatically assigns ascending or descending priorities to each of its children.

```tsx
import {
	UserMessage,
	AssistantMessage,
	PromptElement,
	BasePromptElementProps,
	PrioritizedList,
} from '@vscode/prompt-tsx';
import { ChatContext, ChatRequestTurn, ChatResponseTurn, ChatResponseMarkdownPart } from 'vscode';

interface IHistoryMessagesProps extends BasePromptElementProps {
	history: ChatContext['history'];
}

export class HistoryMessages extends PromptElement<IHistoryMessagesProps> {
	render(): PromptPiece {
		const history: (UserMessage | AssistantMessage)[] = [];
		for (const turn of this.props.history) {
			if (turn instanceof ChatRequestTurn) {
				history.push(<UserMessage>{turn.prompt}</UserMessage>);
			} else if (turn instanceof ChatResponseTurn) {
				history.push(
					<AssistantMessage name={turn.participant}>
						{chatResponseToMarkdown(turn)}
					</AssistantMessage>
				);
			}
		}
		return (
			<PrioritizedList priority={0} descending={false}>
				{history}
			</PrioritizedList>
		);
	}
}
```

### Step 2: Define the Prompt component

Next, define a `MyPrompt` component that includes the base instructions, user query, and history messages with their appropriate priorities. Priority values are local among siblings. Remember that you might want to trim older messages in the history before touching anything else in the prompt, so you need to split up two `<HistoryMessages>` elements:

```tsx
import {
	SystemMessage,
	UserMessage,
	PromptElement,
	BasePromptElementProps,
} from '@vscode/prompt-tsx';

interface IMyPromptProps extends BasePromptElementProps {
	history: ChatContext['history'];
	userQuery: string;
}

export class MyPrompt extends PromptElement<IMyPromptProps> {
	render() {
		return (
			<>
				<SystemMessage priority={100}>
					Here are your base instructions. They have the highest priority because you want to make
					sure they're always included!
				</SystemMessage>
				{/* Older messages in the history have the lowest priority since they're less relevant */}
				<HistoryMessages history={this.props.history.slice(0, -2)} priority={0} />
				{/* The last 2 history messages are preferred over any workspace context you have below */}
				<HistoryMessages history={this.props.history.slice(-2)} priority={80} />
				{/* The user query is right behind the system message in priority */}
				<UserMessage priority={90}>{this.props.userQuery}</UserMessage>
				<UserMessage priority={70}>
					With a slightly lower priority, you can include some contextual data about the workspace
					or files here...
				</UserMessage>
			</>
		);
	}
}
```

Now, all older history messages are pruned before the library tries to prune other elements of the prompt.

### Step 3: Define the History component

To make consumption a little easier, define a `History` component that wraps the history messages and uses the `passPriority` attribute to act as a pass-through container. With `passPriority`, its children are treated as if they are direct children of the containing element for prioritization purposes.

```tsx
import { PromptElement, BasePromptElementProps } from '@vscode/prompt-tsx';

interface IHistoryProps extends BasePromptElementProps {
	history: ChatContext['history'];
	newer: number; // last 2 message priority values
	older: number; // previous message priority values
	passPriority: true; // require this prop be set!
}

export class History extends PromptElement<IHistoryProps> {
	render(): PromptPiece {
		return (
			<>
				<HistoryMessages history={this.props.history.slice(0, -2)} priority={this.props.older} />
				<HistoryMessages history={this.props.history.slice(-2)} priority={this.props.newer} />
			</>
		);
	}
}
```

Now, you can use and reuse this single element to include chat history:

```tsx
<History history={this.props.history} passPriority older={0} newer={80}/>
```

## Grow file contents to fit

In this example, you want to include the contents of all files the user is currently looking at in their prompt. These files could be large, to the point where including all of them would lead to their text being pruned! This example shows how to use the `flexGrow` property to cooperatively size the file contents to fit within the token budget.

### Step 1: Define base instructions and user query

First, you define a `SystemMessage` component that includes the base instructions. This component has the highest priority to ensure it is always included.

```tsx
<SystemMessage priority={100}>Here are your base instructions.</SystemMessage>
```

You then include the user query by using the `UserMessage` component. This component has a high priority to ensure it is included right after the base instructions.

```tsx
<UserMessage priority={90}>{this.props.userQuery}</UserMessage>
```

### Step 2: Include the File Contents

You can now include the file contents by using the `FileContext` component. You assign it a [`flexGrow`](https://github.com/microsoft/vscode-prompt-tsx?tab=readme-ov-file#flex-behavior) value of `1` to ensure it is rendered after the base instructions, user query, and history.

```tsx
<FileContext priority={70} flexGrow={1} files={this.props.files} />
```

With a `flexGrow` value, the element gets any _unused_ token budget in its `PromptSizing` object that's passed into its `render()` and `prepare()` calls. You can read more about the behavior of flex elements in the [prompt-tsx documentation](https://github.com/microsoft/vscode-prompt-tsx?tab=readme-ov-file#flex-behavior).

### Step 3: Include the history

Next, include the history messages using the `History` component that you created previously. This is a little trickier, since you do want some history to be shown, but also want the file contents to take up most the prompt.

Therefore, assign the `History` component a `flexGrow` value of `2` to ensure it is rendered after all other elements, including `<FileContext />`. But, also set a `flexReserve` value of `"/5"` to reserve 1/5th of the total budget for history.

```tsx
<History
	history={this.props.history}
	passPriority
	older={0}
	newer={80}
	flexGrow={2}
	flexReserve="/5"
/>
```

### Step 3: Combine all elements of the prompt

Now, combine all the elements into the `MyPrompt` component.

```tsx
import {
	SystemMessage,
	UserMessage,
	PromptElement,
	BasePromptElementProps,
} from '@vscode/prompt-tsx';
import { History } from './history';

interface IFilesToInclude {
	document: TextDocument;
	line: number;
}

interface IMyPromptProps extends BasePromptElementProps {
	history: ChatContext['history'];
	userQuery: string;
	files: IFilesToInclude[];
}

export class MyPrompt extends PromptElement<IMyPromptProps> {
	render() {
		return (
			<>
				<SystemMessage priority={100}>Here are your base instructions.</SystemMessage>
				<History
					history={this.props.history}
					passPriority
					older={0}
					newer={80}
					flexGrow={2}
					flexReserve="/5"
				/>
				<UserMessage priority={90}>{this.props.userQuery}</UserMessage>
				<FileContext priority={70} flexGrow={1} files={this.props.files} />
			</>
		);
	}
}
```

### Step 4: Define the FileContext component

Finally, define a `FileContext` component that includes the contents of the files the user is currently looking at. Because you used `flexGrow`, you can implement logic that gets as many of the lines around the 'interesting' line for each file by using the information in `PromptSizing`.

For brevity, the implementation logic for `getExpandedFiles` is omitted. You can check it out in the [prompt-tsx repo](https://github.com/microsoft/vscode-prompt-tsx/blob/5501d54a5b9a7608582e8419cd968a82ca317cc9/examples/file-contents.tsx#L103).

```tsx
import { PromptElement, BasePromptElementProps, PromptSizing, PromptPiece } from '@vscode/prompt-tsx';

class FileContext extends PromptElement<{ files: IFilesToInclude[] } & BasePromptElementProps> {
	async render(_state: void, sizing: PromptSizing): Promise<PromptPiece> {
		const files = await this.getExpandedFiles(sizing);
		return <>{files.map(f => f.toString())}</>;
	}

	private async getExpandedFiles(sizing: PromptSizing) {
		// Implementation details are summarized here.
		// Refer to the repo for the complete implementation.
	}
}
```

## Summary

In these examples, you created a `MyPrompt` component that includes base instructions, user query, history messages, and file contents with different priorities. You used `flexGrow` to cooperatively size the file contents to fit within the token budget.

By following this pattern, you can ensure that the most important parts of your prompt are always included, while less important parts are pruned as needed to fit within the model's context window. For the complete implementation details of the `getExpandedFiles` method and the `FileContextTracker` class, refer to the [prompt-tsx repo](https://github.com/microsoft/vscode-prompt-tsx/tree/main/examples).


