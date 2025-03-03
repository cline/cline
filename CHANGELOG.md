# Roo Code Changelog

## [3.7.11]

- Don't honor custom max tokens for non thinking models
- Include custom modes in mode switching keyboard shortcut
- Support read-only modes that can run commands

## [3.7.10]

- Add Gemini models on Vertex AI (thanks @ashktn!)
- Keyboard shortcuts to switch modes (thanks @aheizi!)
- Add support for Mermaid diagrams (thanks Cline!)

## [3.7.9]

- Delete task confirmation enhancements
- Smarter context window management
- Prettier thinking blocks
- Fix maxTokens defaults for Claude 3.7 Sonnet models
- Terminal output parsing improvements (thanks @KJ7LNW!)
- UI fix to dropdown hover colors (thanks @SamirSaji!)
- Add support for Claude Sonnet 3.7 thinking via Vertex AI (thanks @lupuletic!)

## [3.7.8]

- Add Vertex AI prompt caching support for Claude models (thanks @aitoroses and @lupuletic!)
- Add gpt-4.5-preview
- Add an advanced feature to customize the system prompt

## [3.7.7]

- Graduate checkpoints out of beta
- Fix enhance prompt button when using Thinking Sonnet
- Add tooltips to make what buttons do more obvious

## [3.7.6]

- Handle really long text better in the in the ChatRow similar to TaskHeader (thanks @joemanley201!)
- Support multiple files in drag-and-drop
- Truncate search_file output to avoid crashing the extension
- Better OpenRouter error handling (no more "Provider Error")
- Add slider to control max output tokens for thinking models

## [3.7.5]

- Fix context window truncation math (see [#1173](https://github.com/RooVetGit/Roo-Code/issues/1173))
- Fix various issues with the model picker (thanks @System233!)
- Fix model input / output cost parsing (thanks @System233!)
- Add drag-and-drop for files
- Enable the "Thinking Budget" slider for Claude 3.7 Sonnet on OpenRouter

## [3.7.4]

- Fix a bug that prevented the "Thinking" setting from properly updating when switching profiles.

## [3.7.3]

- Support for ["Thinking"](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) Sonnet 3.7 when using the Anthropic provider.

## [3.7.2]

- Fix computer use and prompt caching for OpenRouter's `anthropic/claude-3.7-sonnet:beta` (thanks @cte!)
- Fix sliding window calculations for Sonnet 3.7 that were causing a context window overflow (thanks @cte!)
- Encourage diff editing more strongly in the system prompt (thanks @hannesrudolph!)

## [3.7.1]

- Add AWS Bedrock support for Sonnet 3.7 and update some defaults to Sonnet 3.7 instead of 3.5

## [3.7.0]

- Introducing Roo Code 3.7, with support for the new Claude Sonnet 3.7. Because who cares about skipping version numbers anymore? Thanks @lupuletic and @cte for the PRs!

## [3.3.26]

- Adjust the default prompt for Debug mode to focus more on diagnosis and to require user confirmation before moving on to implementation

## [3.3.25]

- Add a "Debug" mode that specializes in debugging tricky problems (thanks [Ted Werbel](https://x.com/tedx_ai/status/1891514191179309457) and [Carlos E. Perez](https://x.com/IntuitMachine/status/1891516362486337739)!)
- Add an experimental "Power Steering" option to significantly improve adherence to role definitions and custom instructions

## [3.3.24]

- Fixed a bug with region selection preventing AWS Bedrock profiles from being saved (thanks @oprstchn!)
- Updated the price of gpt-4o (thanks @marvijo-code!)

## [3.3.23]

- Handle errors more gracefully when reading custom instructions from files (thanks @joemanley201!)
- Bug fix to hitting "Done" on settings page with unsaved changes (thanks @System233!)

## [3.3.22]

- Improve the Provider Settings configuration with clear Save buttons and warnings about unsaved changes (thanks @System233!)
- Correctly parse `<think>` reasoning tags from Ollama models (thanks @System233!)
- Add support for setting custom preferred languages on the Prompts tab, as well as adding Catalan to the list of languages (thanks @alarno!)
- Add a button to delete MCP servers (thanks @hannesrudolph!)
- Fix a bug where the button to copy the system prompt preview always copied the Code mode version
- Fix a bug where the .roomodes file was not automatically created when adding custom modes from the Prompts tab
- Allow setting a wildcard (`*`) to auto-approve all command execution (use with caution!)

## [3.3.21]

- Fix input box revert issue and configuration loss during profile switch (thanks @System233!)
- Fix default preferred language for zh-cn and zh-tw (thanks @System233!)
- Fix Mistral integration (thanks @d-oit!)
- Feature to mention `@terminal` to pull terminal output into context (thanks Cline!)
- Fix system prompt to make sure Roo knows about all available modes
- Enable streaming mode for OpenAI o1

## [3.3.20]

- Support project-specific custom modes in a .roomodes file
- Add more Mistral models (thanks @d-oit and @bramburn!)
- By popular request, make it so Ask mode can't write to Markdown files and is purely for chatting with
- Add a setting to control the number of open editor tabs to tell the model about (665 is probably too many!)
- Fix race condition bug with entering API key on the welcome screen

## [3.3.19]

- Fix a bug where aborting in the middle of file writes would not revert the write
- Honor the VS Code theme for dialog backgrounds
- Make it possible to clear out the default custom instructions for built-in modes
- Add a help button that links to our new documentation site (which we would love help from the community to improve!)
- Switch checkpoints logic to use a shadow git repository to work around issues with hot reloads and polluting existing repositories (thanks Cline for the inspiration!)

## [3.3.18]

- Add a per-API-configuration model temperature setting (thanks @joemanley201!)
- Add retries for fetching usage stats from OpenRouter (thanks @jcbdev!)
- Fix bug where disabled MCP servers would not show up in the settings on initialization (thanks @MuriloFP!)
- Add the Requesty provider and clean up a lot of shared model picker code (thanks @samhvw8!)
- Add a button on the Prompts tab to copy the full system prompt to the clipboard (thanks @mamertofabian!)
- Fix issue where Ollama/LMStudio URLs would flicker back to previous while entering them in settings
- Fix logic error where automatic retries were waiting twice as long as intended
- Rework the checkpoints code to avoid conflicts with file locks on Windows (sorry for the hassle!)

## [3.3.17]

- Fix the restore checkpoint popover
- Unset git config that was previously set incorrectly by the checkpoints feature

## [3.3.16]

- Support Volcano Ark platform through the OpenAI-compatible provider
- Fix jumpiness while entering API config by updating on blur instead of input
- Add tooltips on checkpoint actions and fix an issue where checkpoints were overwriting existing git name/email settings - thanks for the feedback!

## [3.3.15]

- Improvements to MCP initialization and server restarts (thanks @MuriloFP and @hannesrudolph!)
- Add a copy button to the recent tasks (thanks @hannesrudolph!)
- Improve the user experience for adding a new API profile
- Another significant fix to API profile switching on the settings screen
- Opt-in experimental version of checkpoints in the advanced settings

## [3.3.14]

- Should have skipped floor 13 like an elevator. This fixes the broken 3.3.13 release by reverting some changes to the deployment scripts.

## [3.3.13]

- Ensure the DeepSeek r1 model works with Ollama (thanks @sammcj!)
- Enable context menu commands in the terminal (thanks @samhvw8!)
- Improve sliding window truncation strategy for models that do not support prompt caching (thanks @nissa-seru!)
- First step of a more fundamental fix to the bugs around switching API profiles. If you've been having issues with this please try again and let us know if works any better! More to come soon, including fixing the laggy text entry in provider settings.

## [3.3.12]

- Bug fix to changing a mode's API configuration on the prompts tab
- Add new Gemini models

## [3.3.11]

- Safer shell profile path check to avoid an error on Windows
- Autocomplete for slash commands

## [3.3.10]

- Add shortcuts to the currently open tabs in the "Add File" section of @-mentions (thanks @olup!)
- Fix pricing for o1-mini (thanks @hesara!)
- Fix context window size calculation (thanks @MuriloFP!)
- Improvements to experimental unified diff strategy and selection logic in code actions (thanks @nissa-seru!)
- Enable markdown formatting in o3 and o1 (thanks @nissa-seru!)
- Improved terminal shell detection logic (thanks @canvrno for the original and @nissa-seru for the port!)
- Fix occasional errors when switching between API profiles (thanks @samhvw8!)
- Visual improvements to the list of modes on the prompts tab
- Fix double-scrollbar in provider dropdown
- Visual cleanup to the list of modes on the prompts tab
- Improvements to the default prompts for Architect and Ask mode
- Allow switching between modes with slash messages like `/ask why is the sky blue?`

## [3.3.9]

- Add o3-mini-high and o3-mini-low

## [3.3.8]

- Fix o3-mini in the Glama provider (thanks @Punkpeye!)
- Add the option to omit instructions for creating MCP servers from the system prompt (thanks @samhvw8!)
- Fix a bug where renaming API profiles without actually changing the name would delete them (thanks @samhvw8!)

## [3.3.7]

- Support for o3-mini (thanks @shpigunov!)
- Code Action improvements to allow selecting code and adding it to context, plus bug fixes (thanks @samhvw8!)
- Ability to include a message when approving or rejecting tool use (thanks @napter!)
- Improvements to chat input box styling (thanks @psv2522!)
- Capture reasoning from more variants of DeepSeek R1 (thanks @Szpadel!)
- Use an exponential backoff for API retries (if delay after first error is 5s, delay after second consecutive error will be 10s, then 20s, etc)
- Add a slider in advanced settings to enable rate limiting requests to avoid overloading providers (i.e. wait at least 10 seconds between API requests)
- Prompt tweaks to make Roo better at creating new custom modes for you

## [3.3.6]

- Add a "new task" tool that allows Roo to start new tasks with an initial message and mode
- Fix a bug that was preventing the use of qwen-max and potentially other OpenAI-compatible providers (thanks @Szpadel!)
- Add support for perplexity/sonar-reasoning (thanks @Szpadel!)
- Visual fixes to dropdowns (thanks @psv2522!)
- Add the [Unbound](https://getunbound.ai/) provider (thanks @vigneshsubbiah16!)

## [3.3.5]

- Make information about the conversation's context window usage visible in the task header for humans and in the environment for models (thanks @MuriloFP!)
- Add checkboxes to auto-approve mode switch requests (thanks @MuriloFP!)
- Add new experimental editing tools `insert_content` (for inserting blocks of text at a line number) and `search_and_replace` (for replacing all instances of a phrase or regex) to complement diff editing and whole file editing (thanks @samhvw8!)
- Improved DeepSeek R1 support by capturing reasoning from DeepSeek API as well as more OpenRouter variants, not using system messages, and fixing a crash on empty chunks. Still depends on the DeepSeek API staying up but we'll be in a better place when it does! (thanks @Szpadel!)

## [3.3.4]

- Add per-server MCP network timeout configuration ranging from 15 seconds to an hour
- Speed up diff editing (thanks @hannesrudolph and @KyleHerndon!)
- Add option to perform explain/improve/fix code actions either in the existing task or a new task (thanks @samhvw8!)

## [3.3.3]

- Throw errors sooner when a mode tries to write a restricted file
- Styling improvements to the mode/configuration dropdowns (thanks @psv2522!)

## [3.3.2]

- Add a dropdown to select the API configuration for a mode in the Prompts tab
- Fix bug where always allow wasn't showing up for MCP tools
- Improve OpenRouter DeepSeek-R1 integration by setting temperature to the recommended 0.6 and displaying the reasoning output (thanks @Szpadel - it's really fascinating to watch!)
- Allow specifying a custom OpenRouter base URL (thanks @dairui1!)
- Make the UI for nested settings nicer (thanks @PretzelVector!)

## [3.3.1]

- Fix issue where the terminal management system was creating unnecessary new terminals (thanks @evan-fannin!)
- Fix bug where the saved API provider for a mode wasn't being selected after a mode switch command

## [3.3.0]

- Native VS Code code actions support with quick fixes and refactoring options
- Modes can now request to switch to other modes when needed
- Ask and Architect modes can now edit markdown files
- Custom modes can now be restricted to specific file patterns (for example, a technical writer who can only edit markdown files 👋)
- Support for configuring the Bedrock provider with AWS Profiles
- New Roo Code community Discord at https://roocode.com/discord!

## [3.2.8]

- Fixed bug opening custom modes settings JSON
- Reverts provider key entry back to checking onInput instead of onChange to hopefully address issues entering API keys (thanks @samhvw8!)
- Added explicit checkbox to use Azure for OpenAI compatible providers (thanks @samhvw8!)
- Fixed Glama usage reporting (thanks @punkpeye!)
- Added Llama 3.3 70B Instruct model to the AWS Bedrock provider options (thanks @Premshay!)

## [3.2.7]

- Fix bug creating new configuration profiles

## [3.2.6]

- Fix bug with role definition overrides for built-in modes

## [3.2.5]

- Added gemini flash thinking 01-21 model and a few visual fixes (thanks @monotykamary!)

## [3.2.4]

- Only allow use of the diff tool if it's enabled in settings

## [3.2.3]

- Fix bug where language selector wasn't working

## [3.2.0 - 3.2.2]

- **Name Change From Roo Cline to Roo Code:** We're excited to announce our new name! After growing beyond 50,000 installations, we've rebranded from Roo Cline to Roo Code to better reflect our identity as we chart our own course.

- **Custom Modes:** Create your own personas for Roo Code! While our built-in modes (Code, Architect, Ask) are still here, you can now shape entirely new ones:
    - Define custom prompts
    - Choose which tools each mode can access
    - Create specialized assistants for any workflow
    - Just type "Create a new mode for <X>" or visit the Prompts tab in the top menu to get started

Join us at https://www.reddit.com/r/RooCode to share your custom modes and be part of our next chapter!

## [3.1.7]

- DeepSeek-R1 support (thanks @philipnext!)
- Experimental new unified diff algorithm can be enabled in settings (thanks @daniel-lxs!)
- More fixes to configuration profiles (thanks @samhvw8!)

## [3.1.6]

- Add Mistral (thanks Cline!)
- Fix bug with VSCode LM configuration profile saving (thanks @samhvw8!)

## [3.1.4 - 3.1.5]

- Bug fixes to the auto approve menu

## [3.1.3]

- Add auto-approve chat bar (thanks Cline!)
- Fix bug with VS Code Language Models integration

## [3.1.2]

- Experimental support for VS Code Language Models including Copilot (thanks @RaySinner / @julesmons!)
- Fix bug related to configuration profile switching (thanks @samhvw8!)
- Improvements to fuzzy search in mentions, history, and model lists (thanks @samhvw8!)
- PKCE support for Glama (thanks @punkpeye!)
- Use 'developer' message for o1 system prompt

## [3.1.1]

- Visual fixes to chat input and settings for the light+ themes

## [3.1.0]

- You can now customize the role definition and instructions for each chat mode (Code, Architect, and Ask), either through the new Prompts tab in the top menu or mode-specific .clinerules-mode files. Prompt Enhancements have also been revamped: the "Enhance Prompt" button now works with any provider and API configuration, giving you the ability to craft messages with fully customizable prompts for even better results.
- Add a button to copy markdown out of the chat

## [3.0.3]

- Update required vscode engine to ^1.84.0 to match cline

## [3.0.2]

- A couple more tiny tweaks to the button alignment in the chat input

## [3.0.1]

- Fix the reddit link and a small visual glitch in the chat input

## [3.0.0]

- This release adds chat modes! Now you can ask Roo Code questions about system architecture or the codebase without immediately jumping into writing code. You can even assign different API configuration profiles to each mode if you prefer to use different models for thinking vs coding. Would love feedback in the new Roo Code Reddit! https://www.reddit.com/r/RooCode

## [2.2.46]

- Only parse @-mentions in user input (not in files)

## [2.2.45]

- Save different API configurations to quickly switch between providers and settings (thanks @samhvw8!)

## [2.2.44]

- Automatically retry failed API requests with a configurable delay (thanks @RaySinner!)

## [2.2.43]

- Allow deleting single messages or all subsequent messages

## [2.2.42]

- Add a Git section to the context mentions

## [2.2.41]

- Checkbox to disable streaming for OpenAI-compatible providers

## [2.2.40]

- Add the Glama provider (thanks @punkpeye!)

## [2.2.39]

- Add toggle to enable/disable the MCP-related sections of the system prompt (thanks @daniel-lxs!)

## [2.2.38]

- Add a setting to control the number of terminal output lines to pass to the model when executing commands

## [2.2.36 - 2.2.37]

- Add a button to delete user messages

## [2.2.35]

- Allow selection of multiple browser viewport sizes and adjusting screenshot quality

## [2.2.34]

- Add the DeepSeek provider

## [2.2.33]

- "Enhance prompt" button (OpenRouter models only for now)
- Support listing models for OpenAI compatible providers (thanks @samhvw8!)

## [2.2.32]

- More efficient workspace tracker

## [2.2.31]

- Improved logic for auto-approving chained commands

## [2.2.30]

- Fix bug with auto-approving commands

## [2.2.29]

- Add configurable delay after auto-writes to allow diagnostics to catch up

## [2.2.28]

- Use createFileSystemWatcher to more reliably update list of files to @-mention

## [2.2.27]

- Add the current time to the system prompt and improve browser screenshot quality (thanks @libertyteeth!)

## [2.2.26]

- Tweaks to preferred language (thanks @yongjer)

## [2.2.25]

- Add a preferred language dropdown

## [2.2.24]

- Default diff editing to on for new installs

## [2.2.23]

- Fix context window for gemini-2.0-flash-thinking-exp-1219 (thanks @student20880)

## [2.2.22]

- Add gemini-2.0-flash-thinking-exp-1219

## [2.2.21]

- Take predicted file length into account when detecting omissions

## [2.2.20]

- Make fuzzy diff matching configurable (and default to off)

## [2.2.19]

- Add experimental option to use a bigger browser (1280x800)

## [2.2.18]

- More targeted styling fix for Gemini chats

## [2.2.17]

- Improved regex for auto-execution of chained commands

## [2.2.16]

- Incorporate Premshay's [PR](https://github.com/RooVetGit/Roo-Cline/pull/60) to add support for Amazon Nova and Meta Llama Models via Bedrock (3, 3.1, 3.2) and unified Bedrock calls using BedrockClient and Bedrock Runtime API

## [2.2.14 - 2.2.15]

- Make diff editing more robust to transient errors / fix bugs

## [2.2.13]

- Fixes to sound playing and applying diffs

## [2.2.12]

- Better support for pure deletion and insertion diffs

## [2.2.11]

- Added settings checkbox for verbose diff debugging

## [2.2.6 - 2.2.10]

- More fixes to search/replace diffs

## [2.2.5]

- Allow MCP servers to be enabled/disabled

## [2.2.4]

- Tweak the prompt to encourage diff edits when they're enabled

## [2.2.3]

- Clean up the settings screen

## [2.2.2]

- Add checkboxes to auto-approve MCP tools

## [2.2.1]

- Fix another diff editing indentation bug

## [2.2.0]

- Incorporate MCP changes from Cline 2.2.0

## [2.1.21]

- Larger text area input + ability to drag images into it

## [2.1.20]

- Add Gemini 2.0

## [2.1.19]

- Better error handling for diff editing

## [2.1.18]

- Diff editing bugfix to handle Windows line endings

## [2.1.17]

- Switch to search/replace diffs in experimental diff editing mode

## [2.1.16]

- Allow copying prompts from the history screen

## [2.1.15]

- Incorporate dbasclpy's [PR](https://github.com/RooVetGit/Roo-Cline/pull/54) to add support for gemini-exp-1206
- Make it clear that diff editing is very experimental

## [2.1.14]

- Fix bug where diffs were not being applied correctly and try Aider's [unified diff prompt](https://github.com/Aider-AI/aider/blob/3995accd0ca71cea90ef76d516837f8c2731b9fe/aider/coders/udiff_prompts.py#L75-L105)
- If diffs are enabled, automatically reject write_to_file commands that lead to truncated output

## [2.1.13]

- Fix https://github.com/RooVetGit/Roo-Cline/issues/50 where sound effects were not respecting settings

## [2.1.12]

- Incorporate JoziGila's [PR](https://github.com/cline/cline/pull/158) to add support for editing through diffs

## [2.1.11]

- Incorporate lloydchang's [PR](https://github.com/RooVetGit/Roo-Cline/pull/42) to add support for OpenRouter compression

## [2.1.10]

- Incorporate HeavenOSK's [PR](https://github.com/cline/cline/pull/818) to add sound effects to Cline

## [2.1.9]

- Add instructions for using .clinerules on the settings screen

## [2.1.8]

- Roo Cline now allows configuration of which commands are allowed without approval!

## [2.1.7]

- Updated extension icon and metadata

## [2.2.0]

- Add support for Model Context Protocol (MCP), enabling Cline to use custom tools like web-search tool or GitHub tool
- Add MCP server management tab accessible via the server icon in the menu bar
- Add ability for Cline to dynamically create new MCP servers based on user requests (e.g., "add a tool that gets the latest npm docs")

## [2.1.6]

- Roo Cline now runs in all VSCode-compatible editors

## [2.1.5]

- Fix bug in browser action approval

## [2.1.4]

- Roo Cline now can run side-by-side with Cline

## [2.1.3]

- Roo Cline now allows browser actions without approval when `alwaysAllowBrowser` is true

## [2.1.2]

- Support for auto-approval of write operations and command execution
- Support for .clinerules custom instructions
