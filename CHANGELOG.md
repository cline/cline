# Changelog

## [3.8.0]

-   Add 'Add to Cline' as an option when you right-click in a file or the terminal, making it easier to add context to your current task
-   Add 'Fix with Cline' code action - when you see a lightbulb icon in your editor, you can now select 'Fix with Cline' to send the  code and associated errors for Cline to fix. (Cursor users can also use the 'Quick Fix (CMD + .)' menu to see this option)
-   Add Account view to display billing and usage history for Cline account users. You can now keep track of credits used and transaction history right in the extension!
-   Add 'Sort underling provider routing' setting to Cline/OpenRouter allowing you to sort provider used by throughput, price, latency, or the default (combination of price and uptime)
-   Improve rich MCP display with dynamic image loading and support for GIFs
-   Add 'Documentation' menu item to easily access Cline's docs
-   Add OpenRouter's new usage_details feature for more reliable cost reporting 
-   Display total space Cline takes on disk next to 'Delete all Tasks' button in History view
-   Fix 'Context Window Exceeded' error for OpenRouter/Cline Accounts (additional support coming soon)
-   Fix bug where OpenRouter model ID would be set to invalid value
-   Add button to delete MCP servers in a failure state

## [3.7.1]

-   Fix issue with 'See more' button in task header not showing when starting new tasks
-   Fix issue with checkpoints using local git commit hooks

## [3.7.0]

-   Cline now displays selectable options when asking questions or presenting a plan, saving you from having to type out responses!
-   Add support for a `.clinerules/` directory to load multiple files at once (thanks @ryo-ma!)
-   Prevent Cline from reading extremely large files into context that would overload context window
-   Improve checkpoints loading performance and display warning for large projects not suited for checkpoints
-   Add SambaNova API provider (thanks @saad-noodleseed!)
-   Add VPC endpoint option for AWS Bedrock profiles (thanks @minorunara!)
-   Add DeepSeek-R1 to AWS Bedrock (thanks @watany-dev!)

## [3.6.5]

-   Add 'Delete all Task History' button to History view
-   Add toggle to disable model switching between Plan/Act modes in Settings (new users default to disabled)
-   Add temperature option to OpenAI Compatible
-   Add Kotlin support to tree-sitter parser (thanks @fumiya-kume!)

## [3.6.3]

-   Improve QwQ support for Alibaba (thanks @meglinge!) and OpenRouter
-   Improve diff edit prompting to prevent immediately reverting to write_to_file when a model uses search patterns that don't match anything in the file
-   Fix bug where new checkpoints system would revert file changes when switching between tasks
-   Fix issue with incorrect token count for some OpenAI compatible providers

## [3.6.0]

-   Add Cline API as a provider option, allowing new users to sign up and get started with Cline for free
-   Optimize checkpoints with branch-per-task strategy, reducing storage required and first task load times
-   Fix problem with Plan/Act toggle keyboard shortcut not working in Windows (thanks @yt3trees!)
-   Add new Gemini models to GCP Vertex (thanks @shohei-ihaya!) and Claude models AskSage (thanks @swhite24!)
-   Improve OpenRouter/Cline error reporting

## [3.5.1]

-   Add timeout option to MCP servers
-   Add Gemini Flash models to Vertex provider (thanks @jpaodev!)
-   Add prompt caching support for AWS Bedrock provider (thanks @buger!)
-   Add AskSage provider (thanks @swhite24!)

## [3.5.0]

-   Add 'Enable extended thinking' option for Claude 3.7 Sonnet, with ability to set different budgets for Plan and Act modes
-   Add support for rich MCP responses with automatic image previews, website thumbnails, and WolframAlpha visualizations
-   Add language preference option in Advanced Settings
-   Add xAI Provider Integration with support for all Grok models (thanks @andrewmonostate!)
-   Fix issue with Linux XDG pointing to incorrect path for Document folder (thanks @jonatkinson!)

## [3.4.10]

-   Add support for GPT-4.5 preview model

## [3.4.9]

-   Add toggle to let users opt-in to anonymous telemetry and error reporting

## [3.4.6]

-   Add support for Claude 3.7 Sonnet

## [3.4.0]

-   Introducing MCP Marketplace! You can now discover and install the best MCP servers right from within the extension, with new servers added regularly
-   Add mermaid diagram support in Plan mode! You can now see visual representations of mermaid code blocks in chat, and click on them to see an expanded view
-   Use more visual checkpoints indicators after editing files & running commands
-   Create a checkpoint at the beginning of each task to easily revert to the initial state
-   Add 'Terminal' context mention to reference the active terminal's contents
-   Add 'Git Commits' context mention to reference current working changes or specific commits (thanks @mrubens!)
-   Send current textfield contents as additional feedback when toggling from Plan to Act Mode, or when hitting 'Approve' button
-   Add advanced configuration options for OpenAI Compatible (context window, max output, pricing, etc.)
-   Add Alibaba Qwen 2.5 coder models, VL models, and DeepSeek-R1/V3 support
-   Improve support for AWS Bedrock Profiles
-   Fix Mistral provider support for non-codestral models
-   Add advanced setting to disable browser tool
-   Add advanced setting to set chromium executable path for browser tool

## [3.3.2]

-   Fix bug where OpenRouter requests would periodically not return cost/token stats, leading to context window limit errors
-   Make checkpoints more visible and keep track of restored checkpoints

## [3.3.0]

-   Add .clineignore to block Cline from accessing specified file patterns
-   Add keyboard shortcut + tooltips for Plan/Act toggle
-   Fix bug where new files won't show up in files dropdown
-   Add automatic retry for rate limited requests (thanks @ViezeVingertjes!)
-   Adding reasoning_effort support for o3-mini in Advanced Settings
-   Added support for AWS provider profiles using the AWS CLI to make the profile, enabling long lived connections to AWS bedrock
-   Adding Requesty API provider
-   Add Together API provider
-   Add Alibaba Qwen API provider (thanks @aicccode!)

## [3.2.13]

-   Add new gemini models gemini-2.0-flash-lite-preview-02-05 and gemini-2.0-flash-001
-   Add all available Mistral API models (thanks @ViezeVingertjes!)
-   Add LiteLLM API provider support (thanks @him0!)

## [3.2.12]

-   Fix command chaining for Windows users
-   Fix reasoning_content error for OpenAI providers

## [3.2.11]

-   Add OpenAI o3-mini model

## [3.2.10]

-   Improve support for DeepSeek-R1 (deepseek-reasoner) model for OpenRouter, OpenAI-compatible, and DeepSeek direct (thanks @Szpadel!)
-   Show Reasoning tokens for models that support it
-   Fix issues with switching models between Plan/Act modes

## [3.2.6]

-   Save last used API/model when switching between Plan and Act, for users that like to use different models for each mode
-   New Context Window progress bar in the task header to understand increased cost/generation degradation as the context increases
-   Localize READMEs and add language selector for English, Spanish, German, Chinese, and Japanese
-   Add Advanced Settings to remove MCP prompts from requests to save tokens, enable/disable checkpoints for users that don't use git (more coming soon!)
-   Add Gemini 2.0 Flash Thinking experimental model
-   Allow new users to subscribe to mailing list to get notified when new Accounts option is available

## [3.2.5]

-   Use yellow textfield outline in Plan mode to better distinguish from Act mode

## [3.2.3]

-   Add DeepSeek-R1 (deepseek-reasoner) model support with proper parameter handling (thanks @slavakurilyak!)

## [3.2.0]

-   Add Plan/Act mode toggle to let you plan tasks with Cline before letting him get to work
-   Easily switch between API providers and models using a new popup menu under the chat field
-   Add VS Code LM API provider to run models provided by other VS Code extensions (e.g. GitHub Copilot). Shoutout to @julesmons, @RaySinner, and @MrUbens for putting this together!
-   Add on/off toggle for MCP servers to disable them when not in use. Thanks @MrUbens!
-   Add Auto-approve option for individual tools in MCP servers. Thanks @MrUbens!

## [3.1.10]

-   New icon!

## [3.1.9]

-   Add Mistral API provider with codestral-latest model

## [3.1.7]

-   Add ability to change viewport size and headless mode when Cline asks to launch the browser

## [3.1.6]

-   Fix bug where filepaths with Chinese characters would not show up in context mention menu (thanks @chi-chat!)
-   Update Anthropic model prices (thanks @timoteostewart!)

## [3.1.5]

-   Fix bug where Cline couldn't read "@/" import path aliases from tool results

## [3.1.4]

-   Fix issue where checkpoints would not work for users with git commit signing enabled globally

## [3.1.2]

-   Fix issue where LFS files would be not be ignored when creating checkpoints

## [3.1.0]

-   Added checkpoints: Snapshots of workspace are automatically created whenever Cline uses a tool
    -   Compare changes: Hover over any tool use to see a diff between the snapshot and current workspace state
    -   Restore options: Choose to restore just the task state, just the workspace files, or both
-   New 'See new changes' button appears after task completion, providing an overview of all workspace changes
-   Task header now shows disk space usage with a delete button to help manage snapshot storage

## [3.0.12]

-   Fix DeepSeek API cost reporting (input price is 0 since it's all either a cache read or write, different than how Anthropic reports cache usage)

## [3.0.11]

-   Emphasize auto-formatting done by the editor in file edit responses for more reliable diff editing

## [3.0.10]

-   Add DeepSeek provider to API Provider options
-   Fix context window limit errors for DeepSeek v3

## [3.0.9]

-   Fix bug where DeepSeek v3 would incorrectly escape HTML entities in diff edits

## [3.0.8]

-   Mitigate DeepSeek v3 diff edit errors by adding 'auto-formatting considerations' to system prompt, encouraging model to use updated file contents as reference point for SEARCH blocks

## [3.0.7]

-   Revert to using batched file watcher to fix crash when many files would be created at once

## [3.0.6]

-   Fix bug where some files would be missing in the `@` context mention menu
-   Add Bedrock support in additional regions
-   Diff edit improvements
-   Add OpenRouter's middle-out transform for models that don't use prompt caching (prevents context window limit errors, but cannot be applied to models like Claude since it would continuously break the cache)

## [3.0.4]

-   Fix bug where gemini models would add code block artifacts to the end of text content
-   Fix context mention menu visual issues on light themes

## [3.0.2]

-   Adds block anchor matching for more reliable diff edits (if 3+ lines, first and last line are used as anchors to search for)
-   Add instruction to system prompt to use complete lines in diff edits to work properly with fallback strategies
-   Improves diff edit error handling
-   Adds new Gemini models

## [3.0.0]

-   Cline now uses a search & replace diff based approach when editing large files to prevent code deletion issues.
-   Adds support for a more comprehensive auto-approve configuration, allowing you to specify which tools require approval and which don't.
-   Adds ability to enable system notifications for when Cline needs approval or completes a task.
-   Adds support for a root-level `.clinerules` file that can be used to specify custom instructions for the project.

## [2.2.0]

-   Add support for Model Context Protocol (MCP), enabling Cline to use custom tools like web-search tool or GitHub tool
-   Add MCP server management tab accessible via the server icon in the menu bar
-   Add ability for Cline to dynamically create new MCP servers based on user requests (e.g., "add a tool that gets the latest npm docs")

## [2.1.6]

-   Add LM Studio as an API provider option (make sure to start the LM Studio server to use it with the extension!)

## [2.1.5]

-   Add support for prompt caching for new Claude model IDs on OpenRouter (e.g. `anthropic/claude-3.5-sonnet-20240620`)

## [2.1.4]

-   AWS Bedrock fixes (add missing regions, support for cross-region inference, and older Sonnet model for regions where new model is not available)

## [2.1.3]

-   Add support for Claude 3.5 Haiku, 66% cheaper than Sonnet with similar intelligence

## [2.1.2]

-   Misc. bug fixes
-   Update README with new browser feature

## [2.1.1]

-   Add stricter prompt to prevent Cline from editing files during a browser session without first closing the browser

## [2.1.0]

-   Cline now uses Anthropic's new "Computer Use" feature to launch a browser, click, type, and scroll. This gives him more autonomy in runtime debugging, end-to-end testing, and even general web use. Try asking "Look up the weather in Colorado" to see it in action! (Available with Claude 3.5 Sonnet v2)

## [2.0.19]

-   Fix model info for Claude 3.5 Sonnet v1 on OpenRouter

## [2.0.18]

-   Add support for both v1 and v2 of Claude 3.5 Sonnet for GCP Vertex and AWS Bedrock (for cases where the new model is not enabled yet or unavailable in your region)

## [2.0.17]

-   Update Anthropic model IDs

## [2.0.16]

-   Adjustments to system prompt

## [2.0.15]

-   Fix bug where modifying Cline's edits would lead him to try to re-apply the edits
-   Fix bug where weaker models would display file contents before using the write_to_file tool
-   Fix o1-mini and o1-preview errors when using OpenAI native

## [2.0.14]

-   Gracefully cancel requests while stream could be hanging

## [2.0.13]

-   Detect code omission and show warning with troubleshooting link

## [2.0.12]

-   Keep cursor out of the way during file edit streaming animation

## [2.0.11]

-   Adjust prompts around read_file to prevent re-reading files unnecessarily

## [2.0.10]

-   More adjustments to system prompt to prevent lazy coding

## [2.0.9]

-   Update system prompt to try to prevent Cline from lazy coding (`// rest of code here...`)

## [2.0.8]

-   Fix o1-mini and o1-preview for OpenAI
-   Fix diff editor not opening sometimes in slow environments like project idx

## [2.0.7]

-   Misc. bug fixes

## [2.0.6]

-   Update URLs to https://github.com/cline/cline

## [2.0.5]

-   Fixed bug where Cline's edits would stream into the active tab when switching tabs during a write_to_file
-   Added explanation in task continuation prompt that an interrupted write_to_file reverts the file to its original contents, preventing unnecessary re-reads
-   Fixed non-first chunk error handling in case stream fails mid-way through

## [2.0.0]

-   New name! Meet Cline, an AI assistant that can use your CLI and Editor
-   Responses are now streamed with a yellow text decoration animation to keep track of Cline's progress as he edits files
-   New Cancel button to give Cline feedback if he goes off in the wrong direction, giving you more control over tasks
-   Re-imagined tool calling prompt resulting in ~40% fewer requests to accomplish tasks + better performance with other models
-   Search and use any model with OpenRouter

## [1.9.7]

-   Only auto-include error diagnostics after file edits, removed warnings to keep Claude from getting distracted in projects with strict linting rules

## [1.9.6]

-   Added support for new Google Gemini models `gemini-1.5-flash-002` and `gemini-1.5-pro-002`
-   Updated system prompt to be more lenient when terminal output doesn't stream back properly
-   Adjusted system prompt to prevent overuse of the inspect_site tool
-   Increased global line height for improved readability

## [1.9.0]

-   Claude can now use a browser! This update adds a new `inspect_site` tool that captures screenshots and console logs from websites (including localhost), making it easier for Claude to troubleshoot issues on his own.
-   Improved automatic linter/compiler debugging by only sending Claude new errors that result from his edits, rather than reporting all workspace problems.

## [1.8.0]

-   You can now use '@' in the textarea to add context!
    -   @url: Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Claude the latest docs!
    -   @problems: Add workspace errors and warnings for Claude to fix, no more back-and-forth about debugging
    -   @file: Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)
    -   @folder: Adds folder's files all at once to speed up your workflow even more

## [1.7.0]

-   Adds problems monitoring to keep Claude updated on linter/compiler/build issues, letting him proactively fix errors on his own! (adding missing imports, fixing type errors, etc.)

## [1.6.5]

-   Adds support for OpenAI o1, Azure OpenAI, and Google Gemini (free for up to 15 requests per minute!)
-   Task header can now be collapsed to provide more space for viewing conversations
-   Adds fuzzy search and sorting to Task History, making it easier to find specific tasks

## [1.6.0]

-   Commands now run directly in your terminal thanks to VSCode 1.93's new shell integration updates! Plus a new 'Proceed While Running' button to let Claude continue working while commands run, sending him new output along the way (i.e. letting him react to server errors as he edits files)

## [1.5.27]

-   Claude's changes now appear in your file's Timeline, allowing you to easily view a diff of each edit. This is especially helpful if you want to revert to a previous version. No need for git—everything is tracked by VSCode's local history!
-   Updated system prompt to keep Claude from re-reading files unnecessarily

## [1.5.19]

-   Adds support for OpenAI compatible API providers (e.g. Ollama!)

## [1.5.13]

-   New terminal emulator! When Claude runs commands, you can now type directly in the terminal (+ support for Python environments)
-   Adds search to Task History

## [1.5.6]

-   You can now edit Claude's changes before accepting! When he edits or creates a file, you can modify his changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in the center to undo `// rest of code here` shenanigans)

## [1.5.4]

-   Adds support for reading .pdf and .docx files (try "turn my business_plan.docx into a company website")

## [1.5.0]

-   Adds new `search_files` tool that lets Claude perform regex searches in your project, making it easy for him to refactor code, address TODOs and FIXMEs, remove dead code, and more!

## [1.4.0]

-   Adds "Always allow read-only operations" setting to let Claude read files and view directories without needing approval (off by default)
-   Implement sliding window context management to keep tasks going past 200k tokens
-   Adds Google Cloud Vertex AI support and updates Claude 3.5 Sonnet max output to 8192 tokens for all providers.
-   Improves system prompt to gaurd against lazy edits (less "//rest of code here")

## [1.3.0]

-   Adds task history

## [1.2.0]

-   Adds support for Prompt Caching to significantly reduce costs and response times (currently only available through Anthropic API for Claude 3.5 Sonnet and Claude 3.0 Haiku)

## [1.1.1]

-   Adds option to choose other Claude models (+ GPT-4o, DeepSeek, and Mistral if you use OpenRouter)
-   Adds option to add custom instructions to the end of the system prompt

## [1.1.0]

-   Paste images in chat to use Claude's vision capabilities and turn mockups into fully functional applications or fix bugs with screenshots

## [1.0.9]

-   Add support for OpenRouter and AWS Bedrock

## [1.0.8]

-   Shows diff view of new or edited files right in the editor

## [1.0.7]

-   Replace `list_files` and `analyze_project` with more explicit `list_files_top_level`, `list_files_recursive`, and `view_source_code_definitions_top_level` to get source code definitions only for files relevant to the task

## [1.0.6]

-   Interact with CLI commands by sending messages to stdin and terminating long-running processes like servers
-   Export tasks to markdown files (useful as context for future tasks)

## [1.0.5]

-   Claude now has context about vscode's visible editors and opened tabs

## [1.0.4]

-   Open in the editor (using menu bar or `Claude Dev: Open In New Tab` in command palette) to see how Claude updates your workspace more clearly
-   New `analyze_project` tool to help Claude get a comprehensive overview of your project's source code definitions and file structure
-   Provide feedback to tool use like terminal commands and file edits
-   Updated max output tokens to 8192 so less lazy coding (`// rest of code here...`)
-   Added ability to retry failed API requests (helpful for rate limits)
-   Quality of life improvements like markdown rendering, memory optimizations, better theme support

## [0.0.6]

-   Initial release
