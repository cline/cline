# Claude Dev VSCode Extension

Thanks to [Claude 3.5 Sonnet's agentic coding capabilities](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf) Claude Dev can handle complex software development tasks step-by-step. With tools that let him read & write files, create entire projects from scratch, and execute terminal commands (after you grant permission), he can assist you in ways that go beyond simple code completion or tech support.

This project was developed for the [Build with Claude June 2024](https://docs.anthropic.com/en/build-with-claude-contest/overview) contest by Anthropic.

## How it works

Claude Dev uses an agentic loop style implementation with chain-of-thought prompting and access to powerful tools that give him the ability to accomplish nearly any task. From building software projects to running system operations, Claude Dev is only limited by your imagination.


### Tools

Claude Dev has access to the following tools:

1. **execute_command**: Execute CLI commands on the system.
2. **list_files**: List all files and directories at the top level of the specified directory.
3. **read_file**: Read the contents of a file at the specified path.
4. **write_to_file**: Write content to a file at the specified path.
5. **ask_followup_question**: Ask the user a question to gather additional information needed to complete a task.
6. **attempt_completion**: Present the result to the user after completing a task.

### Only With Your Permission

Claude always asks for your permission first before any tools are executed or information is sent back to the API. This puts you in control of this agentic loop, every step of the way.

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/e6435441-9400-41c9-98a9-63f75c5d45be)

## Screenshots

### 1. Give Claude Dev any task!

First, I asked Claude Dev to make me a game with loose requirements. He used chain-of-thought `<thinking>` tags to determine what steps he needed to take to accomplish the task.

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/9301195d-3861-46d0-81e9-ce65148476a2)

### 2. Powerful tools to accomplish anything

He used the tools built into the extension, such as creating new files, to build an entire website from scratch.

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/d022f8f4-e857-4373-8f76-d009a0602647)

### 3. Run the project with a click of a button

Claude Dev even offered to run a command that would open it in Chrome for me.

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/9c8b675d-9dcb-4862-a484-3338ef7395fb)

### 4. Finished Product

Finished product. Thanks, Claude Dev!

![image](https://github.com/saoudrizwan/claude-dev/assets/7799382/30774572-abe2-43b3-8bc5-917e115b4def)

## Installation

To install Claude Dev, follow these steps:

1. Clone the repository:
    ```bash
    git clone https://github.com/yourusername/claude-dev.git
    ```
2. Open the project in VSCode:
    ```bash
    code claude-dev
    ```
3. Install the necessary dependencies:
    ```bash
    npm run install:all
    ```
4. Launch the extension:
    - Press `F5` to open a new VSCode window with the extension loaded.

## Contribution

Feel free to contribute to this project by submitting issues and pull requests. Contributions are welcome and appreciated!

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Acknowledgments

Special thanks to Anthropic for hosting the "Build with Claude June 2024" contest and providing the API that powers this extension.