# Claude Dev

<p align="center">
  [video]
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev"><strong>Download VSCode Extension</strong></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.youtube.com/@saoudrizwan"><strong>Tutorials (coming soon)</strong></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#contribution"><strong>Make Contribution</strong></a>
</p>

Thanks to [Claude 3.5 Sonnet's agentic coding capabilities](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf) Claude Dev can handle complex software development tasks step-by-step. With tools that let him analyze project source code, read & write files, and execute terminal commands (after you grant permission), he can assist you in ways that go beyond simple code completion or tech support. From building software projects to running system operations, Claude Dev is only limited by your imagination.

While autonomous AI scripts traditionally run in sandboxed environments, Claude Dev offers a human-in-the-loop GUI to supervise every file change and command executed, providing a safe and accessible way to explore the potential of agentic AI.

-   View syntax highlighted file previews and diffs for every change Claude makes
-   Streams command execution output into the chat, so you never have to open a terminal yourself
-   Presents permission buttons (i.e. 'Approve CLI command') before tool use or sending information to the API
-   Keep track of total tokens and API usage cost for the entire task loop and individual requests
-   Set a maximum # of API requests allowed for a task before being prompted for permission to proceed
-   When a task is completed, Claude Dev determines if he can present the result to you with a CLI command like `open -a "Google Chrome" index.html`, which you run with a click of a button

## How it works

Claude Dev uses an agentic loop style implementation with chain-of-thought prompting and access to powerful tools that give him the ability to accomplish nearly any task. Start by providing a task and the agentic loop fires off, where it might use certain tools (with your permission) to accomplish each step in its thought process.

### Tools

Claude Dev has access to the following capabilities:

1. **`execute_command`**: Execute CLI commands on the system
2. **`analyze_project`**: Analyze the project's source code and file structure
3. **`list_files`**: List all file paths at the top level of the specified directory
4. **`read_file`**: Read the contents of a file at the specified path
5. **`write_to_file`**: Write content to a file at the specified path
6. **`ask_followup_question`**: Ask the user a question to gather additional information needed to complete a task
7. **`attempt_completion`**: Present the result to the user after completing a task, potentially with a CLI command to kickoff a demonstration

### Only With Your Permission

Claude always asks for your permission first before any tools are executed or information is sent back to the API. This puts you in control of this agentic loop, every step of the way.

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/e6435441-9400-41c9-98a9-63f75c5d45be)

## Contribution

Feel free to contribute to this project by submitting issues and pull requests. Contributions are welcome and appreciated!
To build Claude Dev locally, follow these steps:

1. Clone the repository:
    ```bash
    git clone https://github.com/saoudrizwan/claude-dev.git
    ```
2. Open the project in VSCode:
    ```bash
    code claude-dev
    ```
3. Install the necessary dependencies for the extension and webview-gui:
    ```bash
    npm run install:all
    ```
4. Launch by pressing `F5` to open a new VSCode window with the extension loaded

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Acknowledgments

Special thanks to Anthropic for providing the API that powers this extension.
