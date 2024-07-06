
# Icon library
This repo uses https://github.com/microsoft/vscode-codicons
https://microsoft.github.io/vscode-codicons/dist/codicon.html


# Styling VSCode Webview UI Toolkit Components

## Understanding Styling Constraints

When working with the VSCode Webview UI Toolkit, it's important to understand the styling constraints imposed by the underlying architecture. The toolkit uses Microsoft's FAST framework, which utilizes Shadow DOM for component encapsulation. This approach ensures consistency with VSCode's design language but introduces some limitations in custom styling.

### Key Points:

- **Shadow DOM Encapsulation**: The toolkit components use Shadow DOM, which encapsulates the internal structure of components. This means that traditional CSS selectors cannot directly target elements within the component.

- **Wrapper vs. Shadow Element**: When you apply styles to a toolkit component, you're typically styling the wrapper element, not the shadow element inside. This can lead to unexpected results if you're trying to modify the internal appearance of a component.

- **Use Props for Behavior Modification**: Instead of relying on custom styles, you should primarily use the props provided by the toolkit components to modify their behavior and appearance. This ensures consistency with VSCode's design language and prevents potential conflicts.

- **Limited Direct Styling**: While it's possible to style some internal elements using the `::part()` pseudo-element selector, this approach is not officially supported or documented by the toolkit. Using it may lead to inconsistencies with VSCode's native UI.

## Best Practices

1. **Stick to Provided Props**: Whenever possible, use the props and attributes provided by the toolkit components to customize their appearance and behavior.

2. **Avoid Custom Styles**: Refrain from applying custom styles that significantly alter the appearance of toolkit components. This helps maintain consistency with VSCode's native UI.

3. **Use Wrapper Styles Carefully**: If you need to apply styles, focus on the wrapper element (e.g., positioning, margins) rather than trying to modify the internal shadow elements.

### Sources
- https://github.com/microsoft/vscode-webview-ui-toolkit/issues/376#issuecomment-1191881962
- https://github.com/microsoft/vscode-webview-ui-toolkit/issues/550#issuecomment-2148407785


# claude-dev README

This is the README for your extension "claude-dev". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**

# React + Create React App + Webview UI Toolkit webview extension

https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

# Extension commands

A quick run down of some of the important commands that can be run when at the root of the project.

```
npm run install:all      Install package dependencies for both the extension and React webview source code.
npm run start:webview    Runs the React webview source code in development mode. Open http://localhost:3000 to view it in the browser.
npm run build:webview    Build React webview source code. Must be executed before compiling or running the extension.
npm run compile          Compile VS Code extension
```

# Extension development cycle

The intended development cycle of this React-based webview extension is slightly different than that of other VS Code extensions.

Due to the fact that the `webview-ui` directory holds a self-contained React application we get to take advantage of some of the perks that that enables. In particular,

- UI development and iteration cycles can happen much more quickly by using Create React App (CRA)
- Dependency management and project configuration is hugely simplified

## UI development cycle

Since we can take advantage of the much faster CRA dev server, it is encouraged to begin developing webview UI by running the `npm run start:webview` command and then editing the code in the `webview-ui/src` directory.

_Tip: Open the command palette and run the `Simple Browser` command and fill in `http://localhost:3000/` when prompted. This will open a simple browser environment right inside VS Code._

### Message passing
If you need to implement message passing between the webview context and extension context via the VS Code API, a helpful utility is provided in the `webview-ui/src/utilities/vscode.ts` file.

This file contains a utility wrapper around the `acquireVsCodeApi()` function, which enables message passing and state management between the webview and extension contexts.

This utility also enables webview code to be run in the CRA dev server by using native web browser features that mock the functionality enabled by acquireVsCodeApi. This means you can keep building your webview UI with the CRA dev server even when using the VS Code API.

### Move to traditional extension development
Once you're ready to start building other parts of your extension, simply shift to a development model where you run the `npm run build:webview` command as you make changes, press `F5` to compile your extension and open a new Extension Development Host window. Inside the host window, open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and type `Hello World (React + CRA): Show`.

## Dependency management and project configuration

As mentioned above, the `webview-ui` directory holds a self-contained and isolated React application meaning you can (for the most part) treat the development of your webview UI in the same way you would treat the development of a regular React application.

To install webview-specific dependencies simply navigate (i.e. `cd`) into the `webview-ui` directory and install any packages you need or set up any React specific configurations you want.

# Extension structure

This section provides a quick introduction into how this sample extension is organized and structured.

The two most important directories to take note of are the following:

- `src`: Contains all of the extension source code
- `webview-ui`: Contains all of the webview UI source code

## `src` directory

The `src` directory contains all of the extension-related source code and can be thought of as containing the "backend" code/logic for the entire extension. Inside of this directory you'll find the:

- `panels` directory
- `utilities` directory
- `extension.ts` file

The `panels` directory contains all of the webview-related code that will be executed within the extension context. It can be thought of as the place where all of the "backend" code for each webview panel is contained.

This directory will typically contain individual TypeScript or JavaScript files that contain a class which manages the state and behavior of a given webview panel. Each class is usually in charge of:

- Creating and rendering the webview panel
- Properly cleaning up and disposing of webview resources when the panel is closed
- Setting message listeners so data can be passed between the webview and extension
- Setting the initial HTML markdown of the webview panel
- Other custom logic and behavior related to webview panel management

As the name might suggest, the `utilties` directory contains all of the extension utility functions that make setting up and managing an extension easier. In this case, it contains `getUri.ts` which contains a helper function which will get the webview URI of a given file or resource.

Finally, `extension.ts` is where all the logic for activating and deactiving the extension usually live. This is also the place where extension commands are registered.

## `webview-ui` directory

The `webview-ui` directory contains all of the React-based webview source code and can be thought of as containing the "frontend" code/logic for the extension webview.

This directory is special because it contains a full-blown React application which was created using the TypeScript [Create React App](https://create-react-app.dev/) template. As a result, `webview-ui` contains its own `package.json`, `node_modules`, `tsconfig.json`, and so on––separate from the `hello-world` extension in the root directory.

This strays a bit from other extension structures, in that you'll usually find the extension and webview dependencies, configurations, and source code more closely integrated or combined with each other.

However, in this case, there are some unique benefits and reasons for why this sample extension does not follow those patterns such as easier management of conflicting dependencies and configurations, as well as the ability to use the CRA dev server, which drastically improves the speed of developing your webview UI, versus recompiling your extension code every time you make a change to the webview.
