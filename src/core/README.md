# Core Architecture

Extension entry point (extension.ts) -> webview -> controller -> task

```tree
core/
├── webview/      # Manages webview lifecycle
├── controller/   # Handles webview messages and task management
├── task/         # Executes API requests and tool operations
└── ...           # Additional components to help with context, parsing user/assistant messages, etc.
```
