# Roo Cline Changelog

## 2.2.42

### Patch Changes

-   Add a Git section to the context mentions

## [2.2.41]

-   Checkbox to disable streaming for OpenAI-compatible providers

## [2.2.40]

-   Add the Glama provider (thanks @punkpeye!)

## [2.2.39]

-   Add toggle to enable/disable the MCP-related sections of the system prompt (thanks @daniel-lxs!)

## [2.2.38]

-   Add a setting to control the number of terminal output lines to pass to the model when executing commands

## [2.2.36 - 2.2.37]

-   Add a button to delete user messages

## [2.2.35]

-   Allow selection of multiple browser viewport sizes and adjusting screenshot quality

## [2.2.34]

-   Add the DeepSeek provider

## [2.2.33]

-   "Enhance prompt" button (OpenRouter models only for now)
-   Support listing models for OpenAI compatible providers (thanks @samhvw8!)

## [2.2.32]

-   More efficient workspace tracker

## [2.2.31]

-   Improved logic for auto-approving chained commands

## [2.2.30]

-   Fix bug with auto-approving commands

## [2.2.29]

-   Add configurable delay after auto-writes to allow diagnostics to catch up

## [2.2.28]

-   Use createFileSystemWatcher to more reliably update list of files to @-mention

## [2.2.27]

-   Add the current time to the system prompt and improve browser screenshot quality (thanks @libertyteeth!)

## [2.2.26]

-   Tweaks to preferred language (thanks @yongjer)

## [2.2.25]

-   Add a preferred language dropdown

## [2.2.24]

-   Default diff editing to on for new installs

## [2.2.23]

-   Fix context window for gemini-2.0-flash-thinking-exp-1219 (thanks @student20880)

## [2.2.22]

-   Add gemini-2.0-flash-thinking-exp-1219

## [2.2.21]

-   Take predicted file length into account when detecting omissions

## [2.2.20]

-   Make fuzzy diff matching configurable (and default to off)

## [2.2.19]

-   Add experimental option to use a bigger browser (1280x800)

## [2.2.18]

-   More targeted styling fix for Gemini chats

## [2.2.17]

-   Improved regex for auto-execution of chained commands

## [2.2.16]

-   Incorporate Premshay's [PR](https://github.com/RooVetGit/Roo-Cline/pull/60) to add support for Amazon Nova and Meta Llama Models via Bedrock (3, 3.1, 3.2) and unified Bedrock calls using BedrockClient and Bedrock Runtime API

## [2.2.14 - 2.2.15]

-   Make diff editing more robust to transient errors / fix bugs

## [2.2.13]

-   Fixes to sound playing and applying diffs

## [2.2.12]

-   Better support for pure deletion and insertion diffs

## [2.2.11]

-   Added settings checkbox for verbose diff debugging

## [2.2.6 - 2.2.10]

-   More fixes to search/replace diffs

## [2.2.5]

-   Allow MCP servers to be enabled/disabled

## [2.2.4]

-   Tweak the prompt to encourage diff edits when they're enabled

## [2.2.3]

-   Clean up the settings screen

## [2.2.2]

-   Add checkboxes to auto-approve MCP tools

## [2.2.1]

-   Fix another diff editing indentation bug

## [2.2.0]

-   Incorporate MCP changes from Cline 2.2.0

## [2.1.21]

-   Larger text area input + ability to drag images into it

## [2.1.20]

-   Add Gemini 2.0

## [2.1.19]

-   Better error handling for diff editing

## [2.1.18]

-   Diff editing bugfix to handle Windows line endings

## [2.1.17]

-   Switch to search/replace diffs in experimental diff editing mode

## [2.1.16]

-   Allow copying prompts from the history screen

## [2.1.15]

-   Incorporate dbasclpy's [PR](https://github.com/RooVetGit/Roo-Cline/pull/54) to add support for gemini-exp-1206
-   Make it clear that diff editing is very experimental

## [2.1.14]

-   Fix bug where diffs were not being applied correctly and try Aider's [unified diff prompt](https://github.com/Aider-AI/aider/blob/3995accd0ca71cea90ef76d516837f8c2731b9fe/aider/coders/udiff_prompts.py#L75-L105)
-   If diffs are enabled, automatically reject write_to_file commands that lead to truncated output

## [2.1.13]

-   Fix https://github.com/RooVetGit/Roo-Cline/issues/50 where sound effects were not respecting settings

## [2.1.12]

-   Incorporate JoziGila's [PR](https://github.com/cline/cline/pull/158) to add support for editing through diffs

## [2.1.11]

-   Incorporate lloydchang's [PR](https://github.com/RooVetGit/Roo-Cline/pull/42) to add support for OpenRouter compression

## [2.1.10]

-   Incorporate HeavenOSK's [PR](https://github.com/cline/cline/pull/818) to add sound effects to Cline

## [2.1.9]

-   Add instructions for using .clinerules on the settings screen

## [2.1.8]

-   Roo Cline now allows configuration of which commands are allowed without approval!

## [2.1.7]

-   Updated extension icon and metadata

## [2.2.0]

-   Add support for Model Context Protocol (MCP), enabling Cline to use custom tools like web-search tool or GitHub tool
-   Add MCP server management tab accessible via the server icon in the menu bar
-   Add ability for Cline to dynamically create new MCP servers based on user requests (e.g., "add a tool that gets the latest npm docs")

## [2.1.6]

-   Roo Cline now runs in all VSCode-compatible editors

## [2.1.5]

-   Fix bug in browser action approval

## [2.1.4]

-   Roo Cline now can run side-by-side with Cline

## [2.1.3]

-   Roo Cline now allows browser actions without approval when `alwaysAllowBrowser` is true

## [2.1.2]

-   Support for auto-approval of write operations and command execution
-   Support for .clinerules custom instructions
