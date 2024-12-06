# Change Log

## [2.1.6]

- Add LM Studio as an API provider option (make sure to start the LM Studio server to use it with the extension!)

## [2.1.5]

- Add support for prompt caching for new Claude model IDs on OpenRouter (e.g. `anthropic/claude-3.5-sonnet-20240620`)

## [2.1.4]

- AWS Bedrock fixes (add missing regions, support for cross-region inference, and older Sonnet model for regions where new model is not available)

## [2.1.3]

- Add support for Claude 3.5 Haiku, 66% cheaper than Sonnet with similar intelligence

## [2.1.2]

- Misc. bug fixes
- Update README with new browser feature

## [2.1.1]

- Add stricter prompt to prevent Cline from editing files during a browser session without first closing the browser

## [2.1.0]

- Cline now uses Anthropic's new "Computer Use" feature to launch a browser, click, type, and scroll. This gives him more autonomy in runtime debugging, end-to-end testing, and even general web use. Try asking "Look up the weather in Colorado" to see it in action! (Available with Claude 3.5 Sonnet v2)

## [2.0.19]

- Fix model info for Claude 3.5 Sonnet v1 on OpenRouter

## [2.0.18]

- Add support for both v1 and v2 of Claude 3.5 Sonnet for GCP Vertex and AWS Bedrock (for cases where the new model is not enabled yet or unavailable in your region)

## [2.0.17]

- Update Anthropic model IDs

## [2.0.16]

- Adjustments to system prompt

## [2.0.15]

- Fix bug where modifying Cline's edits would lead him to try to re-apply the edits
- Fix bug where weaker models would display file contents before using the write_to_file tool
- Fix o1-mini and o1-preview errors when using OpenAI native

## [2.0.14]

- Gracefully cancel requests while stream could be hanging

## [2.0.13]

- Detect code omission and show warning with troubleshooting link

## [2.0.12]

- Keep cursor out of the way during file edit streaming animation

## [2.0.11]

- Adjust prompts around read_file to prevent re-reading files unnecessarily

## [2.0.10]

- More adjustments to system prompt to prevent lazy coding

## [2.0.9]

- Update system prompt to try to prevent Cline from lazy coding (`// rest of code here...`)

## [2.0.8]

- Fix o1-mini and o1-preview for OpenAI
- Fix diff editor not opening sometimes in slow environments like project idx

## [2.0.7]

- Misc. bug fixes

## [2.0.6]

- Update URLs to https://github.com/cline/cline

## [2.0.5]

- Fixed bug where Cline's edits would stream into the active tab when switching tabs during a write_to_file
- Added explanation in task continuation prompt that an interrupted write_to_file reverts the file to its original contents, preventing unnecessary re-reads
- Fixed non-first chunk error handling in case stream fails mid-way through

## [2.0.0]

- New name! Meet Cline, an AI assistant that can use your CLI and Editor
- Responses are now streamed with a yellow text decoration animation to keep track of Cline's progress as he edits files
- New Cancel button to give Cline feedback if he goes off in the wrong direction, giving you more control over tasks
- Re-imagined tool calling prompt resulting in ~40% fewer requests to accomplish tasks + better performance with other models
- Search and use any model with OpenRouter

## [1.9.7]

- Only auto-include error diagnostics after file edits, removed warnings to keep Claude from getting distracted in projects with strict linting rules

## [1.9.6]

- Added support for new Google Gemini models `gemini-1.5-flash-002` and `gemini-1.5-pro-002`
- Updated system prompt to be more lenient when terminal output doesn't stream back properly
- Adjusted system prompt to prevent overuse of the inspect_site tool
- Increased global line height for improved readability

## [1.9.0]

- Claude can now use a browser! This update adds a new `inspect_site` tool that captures screenshots and console logs from websites (including localhost), making it easier for Claude to troubleshoot issues on his own.
- Improved automatic linter/compiler debugging by only sending Claude new errors that result from his edits, rather than reporting all workspace problems.

## [1.8.0]

- You can now use '@' in the textarea to add context!
    - @url: Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Claude the latest docs!
    - @problems: Add workspace errors and warnings for Claude to fix, no more back-and-forth about debugging
    - @file: Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)
    - @folder: Adds folder's files all at once to speed up your workflow even more

## [1.7.0]

- Adds problems monitoring to keep Claude updated on linter/compiler/build issues, letting him proactively fix errors on his own! (adding missing imports, fixing type errors, etc.)

## [1.6.5]

- Adds support for OpenAI o1, Azure OpenAI, and Google Gemini (free for up to 15 requests per minute!)
- Task header can now be collapsed to provide more space for viewing conversations
- Adds fuzzy search and sorting to Task History, making it easier to find specific tasks

## [1.6.0]

- Commands now run directly in your terminal thanks to VSCode 1.93's new shell integration updates! Plus a new 'Proceed While Running' button to let Claude continue working while commands run, sending him new output along the way (i.e. letting him react to server errors as he edits files)

## [1.5.27]

- Claude's changes now appear in your file's Timeline, allowing you to easily view a diff of each edit. This is especially helpful if you want to revert to a previous version. No need for git—everything is tracked by VSCode's local history!
- Updated system prompt to keep Claude from re-reading files unnecessarily

## [1.5.19]

- Adds support for OpenAI compatible API providers (e.g. Ollama!)

## [1.5.13]

- New terminal emulator! When Claude runs commands, you can now type directly in the terminal (+ support for Python environments)
- Adds search to Task History

## [1.5.6]

- You can now edit Claude's changes before accepting! When he edits or creates a file, you can modify his changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in the center to undo `// rest of code here` shenanigans)

## [1.5.4]

- Adds support for reading .pdf and .docx files (try "turn my business_plan.docx into a company website")

## [1.5.0]

- Adds new `search_files` tool that lets Claude perform regex searches in your project, making it easy for him to refactor code, address TODOs and FIXMEs, remove dead code, and more!

## [1.4.0]

- Adds "Always allow read-only operations" setting to let Claude read files and view directories without needing approval (off by default)
- Implement sliding window context management to keep tasks going past 200k tokens
- Adds Google Cloud Vertex AI support and updates Claude 3.5 Sonnet max output to 8192 tokens for all providers.
- Improves system prompt to gaurd against lazy edits (less "//rest of code here")

## [1.3.0]

- Adds task history

## [1.2.0]

- Adds support for Prompt Caching to significantly reduce costs and response times (currently only available through Anthropic API for Claude 3.5 Sonnet and Claude 3.0 Haiku)

## [1.1.1]

- Adds option to choose other Claude models (+ GPT-4o, DeepSeek, and Mistral if you use OpenRouter)
- Adds option to add custom instructions to the end of the system prompt

## [1.1.0]

- Paste images in chat to use Claude's vision capabilities and turn mockups into fully functional applications or fix bugs with screenshots

## [1.0.9]

- Add support for OpenRouter and AWS Bedrock

## [1.0.8]

- Shows diff view of new or edited files right in the editor

## [1.0.7]

- Replace `list_files` and `analyze_project` with more explicit `list_files_top_level`, `list_files_recursive`, and `view_source_code_definitions_top_level` to get source code definitions only for files relevant to the task

## [1.0.6]

- Interact with CLI commands by sending messages to stdin and terminating long-running processes like servers
- Export tasks to markdown files (useful as context for future tasks)

## [1.0.5]

- Claude now has context about vscode's visible editors and opened tabs

## [1.0.4]

- Open in the editor (using menu bar or `Claude Dev: Open In New Tab` in command palette) to see how Claude updates your workspace more clearly
- New `analyze_project` tool to help Claude get a comprehensive overview of your project's source code definitions and file structure
- Provide feedback to tool use like terminal commands and file edits
- Updated max output tokens to 8192 so less lazy coding (`// rest of code here...`)
- Added ability to retry failed API requests (helpful for rate limits)
- Quality of life improvements like markdown rendering, memory optimizations, better theme support

## [0.0.6]

- Initial release