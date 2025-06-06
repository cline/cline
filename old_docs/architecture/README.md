# Cline Extension Architecture

This directory contains architectural documentation for the Cline VSCode extension.

## Extension Architecture Diagram

The [extension-architecture.mmd](./extension-architecture.mmd) file contains a Mermaid diagram showing the high-level architecture of the Cline extension. The diagram illustrates:

1. **Core Extension**
   - Extension entry point and main classes
   - State management through VSCode's global state and secrets storage
   - Core business logic in the Cline class

2. **Webview UI**
   - React-based user interface
   - State management through ExtensionStateContext
   - Component hierarchy

3. **Storage**
   - Task-specific storage for history and state
   - Git-based checkpoint system for file changes

4. **Data Flow**
   - Core extension data flow between components
   - Webview UI data flow
   - Bidirectional communication between core and webview

## Viewing the Diagram

To view the diagram:
1. Install a Mermaid diagram viewer extension in VSCode
2. Open extension-architecture.mmd
3. Use the extension's preview feature to render the diagram

You can also view the diagram on GitHub, which has built-in Mermaid rendering support.

## Color Scheme

The diagram uses a high-contrast color scheme for better visibility:
- Pink (#ff0066): Global state and secrets storage components
- Blue (#0066ff): Extension state context
- Green (#00cc66): Cline provider
- All components use white text for maximum readability
