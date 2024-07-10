# Claude Dev VSCode Extension

Thanks to [Claude 3.5 Sonnet's agentic coding capabilities](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf) Claude Dev can handle complex software development tasks step-by-step. With tools that let him read & write files, create entire projects from scratch, and execute terminal commands (after you grant permission), he can assist you in ways that go beyond simple code completion or tech support.

This project was developed for the [Build with Claude June 2024](https://docs.anthropic.com/en/build-with-claude-contest/overview) contest by Anthropic. 

## How it works

### Tools

Claude Dev has access to the following tools:

1. **execute_command**: Execute CLI commands on the system.
2. **list_files**: List all files and directories at the top level of the specified directory.
3. **read_file**: Read the contents of a file at the specified path.
4. **write_to_file**: Write content to a file at the specified path.
5. **ask_followup_question**: Ask the user a question to gather additional information needed to complete a task.
6. **attempt_completion**: Present the result to the user after completing a task.

## Screenshots

### 1. Give Claude Dev any task!

First, I asked Claude Dev to make me a game with loose requirements. He used chain-of-thought `<thinking>` tags to determine what steps he needed to take to accomplish the task.

![Initial Request](https://private-user-images.githubusercontent.com/7799382/347282604-bde1f334-37f7-470a-a717-0b85ee3ca7d9.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MjA1OTM5NDYsIm5iZiI6MTcyMDU5MzY0NiwicGF0aCI6Ii83Nzk5MzgyLzM0NzI4MjYwNC1iZGUxZjMzNC0zN2Y3LTQ3MGEtYTcxNy0wYjg1ZWUzY2E3ZDkucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI0MDcxMCUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNDA3MTBUMDY0MDQ2WiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9NGY3ZTdjOWUwYjRhNzA0YjIwMjk5NTkzOGNiOTQxMzBhZDk1ZmViOWM2NDBhZWM2ODUwNmY4NDhmMmNiYmY0ZCZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmYWN0b3JfaWQ9MCZrZXlfaWQ9MCZyZXBvX2lkPTAifQ.4KHcNzrRBeUF_xn8HTyrAtOxVPllGKmGQPewW255tso)

### 2. Powerful tools to accomplish anything

He used the tools built into the extension, such as creating new files, to build the entire project from scratch.

![Building the Project](https://private-user-images.githubusercontent.com/7799382/347283817-7868672c-0985-4554-828c-e1d31623f49b.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MjA1OTM2MDYsIm5iZiI6MTcyMDU5MzMwNiwicGF0aCI6Ii83Nzk5MzgyLzM0NzI4MzgxNy03ODY4NjcyYy0wOTg1LTQ1NTQtODI4Yy1lMWQzMTYyM2Y0OWIucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI0MDcxMCUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNDA3MTBUMDYzNTA2WiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9ODQ0MGY5YzI2YmFjZjNhM2U0NWM5MGY5NmNjOTQ3MDljZTUyMjczYmRiMGY2MDI4MzhmZWRiZWU5YTc0ZWJjMSZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmYWN0b3JfaWQ9MCZrZXlfaWQ9MCZyZXBvX2lkPTAifQ.cJh44AG3-vImUk6d9Yjl9jSLqS7pjw_x6Hq3FUkLoAQ)

### 3. Run the project with a click of a button

Claude Dev even offered to run a command that would open it in Chrome for me.

![Command Execution](https://private-user-images.githubusercontent.com/7799382/347284221-cb4801ab-d849-4427-a8c9-f28c392fa1aa.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MjA1OTM2NzEsIm5iZiI6MTcyMDU5MzM3MSwicGF0aCI6Ii83Nzk5MzgyLzM0NzI4NDIyMS1jYjQ4MDFhYi1kODQ5LTQ0MjctYThjOS1mMjhjMzkyZmExYWEucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI0MDcxMCUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNDA3MTBUMDYzNjExWiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9NWQ0MDljMGUzNjdmZDM3OWZhMmMwN2JlODUxZjEzNWNiMDYxM2RkZjA4OTQ5ZGRhNmExM2FmOGI1Y2M5MDNkMCZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmYWN0b3JfaWQ9MCZrZXlfaWQ9MCZyZXBvX2lkPTAifQ.XP9vl4aoOrYdOxUwmnW6jeweBwSDgMTpM7gnvUws5Mk)

### 4. Finished Product

Finished product. Thanks, Claude Dev!

![Finished Product](https://private-user-images.githubusercontent.com/7799382/347285749-d875a99c-7830-4792-9e09-31046829e0ef.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MjA1OTM5NDUsIm5iZiI6MTcyMDU5MzY0NSwicGF0aCI6Ii83Nzk5MzgyLzM0NzI4NTc0OS1kODc1YTk5Yy03ODMwLTQ3OTItOWUwOS0zMTA0NjgyOWUwZWYucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI0MDcxMCUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNDA3MTBUMDY0MDQ1WiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9Njc2YWUyYzk4YmM1ZDRjODIyZTk1OGQyOGE2MWIyZDYyYjAxMTc1NjY2MTA3MzQ0MmRiNWI1YzZmNzBkNTE2NCZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmYWN0b3JfaWQ9MCZrZXlfaWQ9MCZyZXBvX2lkPTAifQ.afw1MDwliIqXaJBjDog6_sAtt3BPpMsiuzMOZ6XEzdA)

## Installation

To install Claude-Dev, follow these steps:

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