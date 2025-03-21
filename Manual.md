**Development Setup Guide for Cline VS Code Extension**

**Step 1: Run the Webview Dev Server**

1. Open a new terminal
2. Navigate to the root directory of the Cline project
```bash
cd /path/to/cline
```
3. Run the webview development server
```bash
npm run dev:webview
```
4. Note the server location from the terminal output (typically http://localhost:25463/)
```
➜  Local:   http://localhost:25463/
```
5. Keep this terminal running while developing

**Step 2: Set Up TypeScript Compiler in Watch Mode**
1. Open a second terminal
2. Navigate to the root directory of the Cline project
```bash
cd /path/to/cline
```
3. Start the TypeScript compiler in watch mode
```bash

npm run watch
```
4. Verify success with output similar to:
```
[watch] build started
12:10:10 PM - Found 0 errors. Watching for file changes.
[watch] build finished
```
5. Keep this terminal running while developing

**Step 3: Launch the Extension in VS Code's Debug Mode**
1. In VS Code, ensure the main Cline project is open
2. Click on the "Run and Debug" icon in the sidebar (or press `Ctrl+Shift+D` / `Cmd+Shift+D`)
3. From the dropdown at the top of the Run and Debug sidebar, select "Run Extension"
4. Click the green play button or press `F5`
5. A new VS Code window will open with the extension loaded in development mode
6. Verify in the new window that your extension is loaded by checking for the Cline icon in the activity bar

**Step 4: Test Your Changes**
1. In the new VS Code window, click on the Cline icon in the activity bar
2. Click the settings icon (gear) to configure the extension
3. Select "OpenAI" as the API provider
4. Configure your custom headers:
    - Select a header template from the dropdown, or
    - Expand "Advanced: Custom Headers" and enter your custom headers in JSON format
5. Apply changes and test with your OpenAI-compatible API

**Development Workflow**
1. UI Changes: Edit files in webview-ui/src and they will automatically update in the extension (hot reload)
2. Extension Logic Changes: Edit files in src directory and the TypeScript compiler will automatically rebuild. You'll need to restart the extension (press F5 again) to see these changes.
3. Debugging: Use VS Code's debug console and breakpoints to troubleshoot issues

**Stopping Development Servers**
When finished:
1. In the VS Code debug window, click the stop button or close the window
2. In both terminal windows, press Ctrl+C to stop the servers