# Roo Code Changelog

## [3.17.2] - 2025-05-15

- Revert "Switch to the new Roo message parser" (appears to cause a tool parsing bug)
- Lock the versions of vsce and ovsx

## [3.17.1] - 2025-05-15

- Fix the display of the command to execute during approval
- Fix incorrect reserved tokens calculation on OpenRouter (thanks @daniel-lxs!)

## [3.17.0] - 2025-05-14

- Enable Gemini implicit caching
- Add "when to use" section to mode definitions to enable better orchestration
- Add experimental feature to intelligently condense the task context instead of truncating it
- Fix one of the causes of the gray screen issue (thanks @xyOz-dev!)
- Focus improvements for better UI interactions (thanks Cline!)
- Switch to the new Roo message parser for improved performance (thanks Cline!)
- Enable source maps for improved debugging (thanks @KJ7LNW!)
- Update OpenRouter provider to use provider-specific model info (thanks @daniel-lxs!)
- Fix Requesty cost/token reporting (thanks @dtrugman!)
- Improve command execution UI
- Add more in-app links to relevant documentation
- Update the new task tool description and the ask mode custom instructions in the system prompt
- Add IPC types to roo-code.d.ts
- Add build VSIX workflow to pull requests (thanks @SmartManoj!)
- Improve apply_diff tool to intelligently deduce line numbers (thanks @samhvw8!)
- Fix command validation for shell array indexing (thanks @KJ7LNW!)
- Handle diagnostics that point at a directory URI (thanks @daniel-lxs!)
- Fix "Current ask promise was ignored" error (thanks @zxdvd!)

## [3.16.6] - 2025-05-12

- Restore "Improve provider profile management in the external API"
- Fix to subtask sequencing (thanks @wkordalski!)
- Fix webview terminal output processing error (thanks @KJ7LNW!)
- Fix textarea empty string fallback logic (thanks @elianiva!)

## [3.16.5] - 2025-05-10

- Revert "Improve provider profile management in the external API" until we track down a bug with defaults

## [3.16.4] - 2025-05-09

- Improve provider profile management in the external API
- Enforce provider selection in OpenRouter by using 'only' parameter and disabling fallbacks (thanks @shariqriazz!)
- Fix display issues with long profile names (thanks @cannuri!)
- Prevent terminal focus theft on paste after command execution (thanks @MuriloFP!)
- Save OpenAI compatible custom headers correctly
- Fix race condition when updating prompts (thanks @elianiva!)
- Fix display issues in high contrast themes (thanks @zhangtony239!)
- Fix not being able to use specific providers on Openrouter (thanks @daniel-lxs!)
- Show properly formatted multi-line commands in preview (thanks @KJ7LNW!)
- Handle unsupported language errors gracefully in read_file tool (thanks @KJ7LNW!)
- Enhance focus styles in select-dropdown and fix docs URL (thanks @zhangtony239!)
- Properly handle mode name overflow in UI (thanks @elianiva!)
- Fix project MCP always allow issue (thanks @aheizi!)

## [3.16.3] - 2025-05-08

- Revert Tailwind migration while we fix a few spots
- Add Elixir file extension support in language parser (thanks @pfitz!)

## [3.16.2] - 2025-05-07

- Clarify XML tool use formatting instructions
- Error handling code cleanup (thanks @monkeyDluffy6017!)

## [3.16.1] - 2025-05-07

- Add LiteLLM provider support
- Improve stability by detecting and preventing tool loops
- Add Dutch localization (thanks @Githubguy132010!)
- Add editor name to telemetry for better analytics
- Migrate to Tailwind CSS for improved UI consistency
- Fix footer button wrapping in About section on narrow screens (thanks @ecmasx!)
- Update evals defaults
- Update dependencies to latest versions

## [3.16.0] - 2025-05-06

- Add vertical tab navigation to the settings (thanks @dlab-anton)
- Add Groq and Chutes API providers (thanks @shariqriazz)
- Clickable code references in code block (thanks @KJ7LNW)
- Improve accessibility of ato-approve toggles (thanks @Deon588)
- Requesty provider fixes (thanks @dtrugman)
- Fix migration and persistence of per-mode API profiles (thanks @alasano)
- Fix usage of `path.basename` in the extension webview (thanks @samhvw8)
- Fix display issue of the programming language dropdown in the code block component (thanks @zhangtony239)
- MCP server errors are now captured and shown in a new "Errors" tab (thanks @robertheadley)
- Error logging will no longer break MCP functionality if the server is properly connected (thanks @ksze)
- You can now toggle the `terminal.integrated.inheritEnv` VSCode setting directly for the Roo Code settings (thanks @KJ7LNW)
- Add `gemini-2.5-pro-preview-05-06` to the Vertex and Gemini providers (thanks @zetaloop)
- Ensure evals exercises are up-to-date before running evals (thanks @shariqriazz)
- Lots of general UI improvements (thanks @elianiva)
- Organize provider settings into separate components
- Improved icons and translations for the code block component
- Add support for tests that use ESM libraries
- Move environment detail generation to a separate module
- Enable prompt caching by default for supported Gemini models

## [3.15.5] - 2025-05-05

- Update @google/genai to 0.12 (includes some streaming completion bug fixes)
- Rendering performance improvements for code blocks in chat (thanks @KJ7LNW)

## [3.15.4] - 2025-05-04

- Fix a nasty bug that would cause Roo Code to hang, particularly in orchestrator mode
- Improve Gemini caching efficiency

## [3.15.3] - 2025-05-02

- Terminal: Fix empty command bug
- Terminal: More robust process killing
- Optimize Gemini prompt caching for OpenRouter
- Chat view performance improvements

## [3.15.2] - 2025-05-02

- Fix terminal performance issues
- Handle Mermaid validation errors
- Add customizable headers for OpenAI-compatible provider (thanks @mark-bradshaw!)
- Add config option to overwrite OpenAI's API base (thanks @GOODBOY008!)
- Fixes to padding and height issues when resizing the sidebar (thanks @zhangtony239!)
- Remove tool groups from orchestrator mode definition
- Add telemetry for title button clicks

## [3.15.1] - 2025-04-30

- Capture stderr in execa-spawned processes
- Play sound only when action needed from the user (thanks @olearycrew)
- Make retries respect the global auto approve checkbox
- Fix a selection mode bug in the history view (thanks @jr)

## [3.15.0] - 2025-04-30

- Add prompt caching to the Google Vertex provider (thanks @ashktn)
- Add a fallback mechanism for executing terminal commands if VSCode terminal shell integration fails
- Improve the UI/UX of code snippets in the chat (thanks @KJ7LNW)
- Add a reasoning effort setting for the OpenAI Compatible provider (thanks @mr-ryan-james)
- Allow terminal commands to be stopped directly from the chat UI
- Adjust chat view padding to accommodate small width layouts (thanks @zhangtony239)
- Fix file mentions for filenames containing spaces
- Improve the auto-approve toggle buttons for some high-contrast VSCode themes
- Offload expensive count token operations to a web worker (thanks @samhvw8)
- Improve support for mult-root workspaces (thanks @snoyiatk)
- Simplify and streamline Roo Code's quick actions
- Allow Roo Code settings to be imported from the welcome screen (thanks @julionav)
- Remove unused types (thanks @wkordalski)
- Improve the performance of mode switching (thanks @dlab-anton)
- Fix importing & exporting of custom modes (thanks @julionav)

## [3.14.3] - 2025-04-25

- Add Boomerang Orchestrator as a built-in mode
- Improve home screen UI
- Make token count estimation more efficient to reduce gray screens
- Revert change to automatically close files after edit until we figure out how to make it work well with diagnostics
- Clean up settings data model
- Omit reasoning params for non-reasoning models
- Clearer documentation for adding settings (thanks @shariqriazz!)
- Fix word wrapping in Roo message title (thanks @zhangtony239!)
- Update default model id for Unbound from claude 3.5 to 3.7 (thanks @pugazhendhi-m!)

## [3.14.2] - 2025-04-24

- Enable prompt caching for Gemini (with some improvements)
- Allow users to turn prompt caching on / off for Gemini 2.5 on OpenRouter
- Compress terminal output with backspace characters (thanks @KJ7LNW)
- Add Russian language (Спасибо @asychin)

## [3.14.1] - 2025-04-24

- Disable Gemini caching while we investigate issues reported by the community.

## [3.14.0] - 2025-04-23

- Add prompt caching for `gemini-2.5-pro-preview-03-25` in the Gemini provider (Vertex and OpenRouter coming soon!)
- Improve the search_and_replace and insert_content tools and bring them out of experimental, and deprecate append_to_file (thanks @samhvw8!)
- Use material icons for files and folders in mentions (thanks @elianiva!)
- Make the list_files tool more efficient and smarter about excluding directories like .git/
- Fix file drag and drop on Windows and when using SSH tunnels (thanks @NyxJae!)
- Correctly revert changes and suggest alternative tools when write_to_file fails on a missing line count
- Allow interpolation of `workspace`, `mode`, `language`, `shell`, and `operatingSystem` into custom system prompt overrides (thanks @daniel-lxs!)
- Fix interpolation bug in the “add to context” code action (thanks @elianiva!)
- Preserve editor state and prevent tab unpinning during diffs (thanks @seedlord!)
- Improvements to icon rendering on Linux (thanks @elianiva!)
- Improvements to Requesty model list fetching (thanks @dtrugman!)
- Fix user feedback not being added to conversation history in API error state, redundant ‘TASK RESUMPTION’ prompts, and error messages not showing after cancelling API requests (thanks @System233!)
- Track tool use errors in evals
- Fix MCP hub error when dragging extension to another sidebar
- Improve display of long MCP tool arguments
- Fix redundant ‘TASK RESUMPTION’ prompts (thanks @System233!)
- Fix bug opening files when editor has no workspace root
- Make the VS Code LM provider show the correct model information (thanks @QuinsZouls!)
- Fixes to make the focusInput command more reliable (thanks @hongzio!)
- Better handling of aftercursor content in context mentions (thanks @elianiva!)
- Support injecting environment variables in MCP config (thanks @NamesMT!)
- Better handling of FakeAI “controller” object (thanks @wkordalski)
- Remove unnecessary calculation from VS Code LM provider (thanks @d-oit!)
- Allow Amazon Bedrock Marketplace ARNs (thanks @mlopezr!)
- Give better loading feedback on chat rows (thanks @elianiva!)
- Performance improvements to task size calculations
- Don’t immediately show a model ID error when changing API providers
- Fix apply_diff edge cases
- Use a more sensible task export icon
- Use path aliases in webview source files
- Display a warning when the system prompt is overridden
- Better progress indicator for apply_diff tools (thanks @qdaxb!)
- Fix terminal carriage return handling for correct progress bar display (thanks @Yikai-Liao!)

## [3.13.2] - 2025-04-18

- Allow custom URLs for Gemini provider

## [3.13.1] - 2025-04-18

- Support Gemini 2.5 Flash thinking mode (thanks @monotykamary)
- Make auto-approval toggle on/off states more obvious (thanks @sachasayan)
- Add telemetry for shell integration errors
- Fix the path of files dragging into the chat textarea on Windows (thanks @NyxJae)

## [3.13.0] - 2025-04-17

- UI improvements to task header, chat view, history preview, and welcome view (thanks @sachasayan!)
- Add append_to_file tool for appending content to files (thanks @samhvw8!)
- Add Gemini 2.5 Flash Preview to Gemini and Vertex providers (thanks @nbihan-mediware!)
- Fix image support in Bedrock (thanks @Smartsheet-JB-Brown!)
- Make diff edits more resilient to models passing in incorrect parameters

## [3.12.3] - 2025-04-17

- Fix character escaping issues in Gemini diff edits
- Support dragging and dropping tabs into the chat box (thanks @NyxJae!)
- Make sure slash commands only fire at the beginning of the chat box (thanks @logosstone!)

## [3.12.2] - 2025-04-16

- Add OpenAI o3 & 4o-mini (thanks @PeterDaveHello!)
- Improve file/folder context mention UI (thanks @elianiva!)
- Improve diff error telemetry

## [3.12.1] - 2025-04-16

- Bugfix to Edit button visibility in the select dropdowns

## [3.12.0] - 2025-04-15

- Add xAI provider and expose reasoning effort options for Grok on OpenRouter (thanks Cline!)
- Make diff editing config per-profile and improve pre-diff string normalization
- Make checkpoints faster and more reliable
- Add a search bar to mode and profile select dropdowns (thanks @samhvw8!)
- Add telemetry for code action usage, prompt enhancement usage, and consecutive mistake errors
- Suppress zero cost values in the task header (thanks @do-it!)
- Make JSON parsing safer to avoid crashing the webview on bad input
- Allow users to bind a keyboard shortcut for accepting suggestions or input in the chat view (thanks @axkirillov!)

## [3.11.17] - 2025-04-14

- Improvements to OpenAI cache reporting and cost estimates (thanks @monotykamary and Cline!)
- Visual improvements to the auto-approve toggles (thanks @sachasayan!)
- Bugfix to diff apply logic (thanks @avtc for the test case!) and telemetry to track errors going forward
- Fix race condition in capturing short-running terminal commands (thanks @KJ7LNW!)
- Fix eslint error (thanks @nobu007!)

## [3.11.16] - 2025-04-14

- Add gpt-4.1, gpt-4.1-mini, and gpt-4.1-nano to the OpenAI provider
- Include model ID in environment details and when exporting tasks (thanks @feifei325!)

## [3.11.15] - 2025-04-13

- Add ability to filter task history by workspace (thanks @samhvw8!)
- Fix Node.js version in the .tool-versions file (thanks @bogdan0083!)
- Fix duplicate suggested mentions for open tabs (thanks @samhvw8!)
- Fix Bedrock ARN validation and token expiry issue when using profiles (thanks @vagadiya!)
- Add Anthropic option to pass API token as Authorization header instead of X-Api-Key (thanks @mecab!)
- Better documentation for adding new settings (thanks @KJ7LNW!)
- Localize package.json (thanks @samhvw8!)
- Add option to hide the welcome message and fix the background color for the new profile dialog (thanks @zhangtony239!)
- Restore the focus ring for the VSCodeButton component (thanks @pokutuna!)

## [3.11.14] - 2025-04-11

- Support symbolic links in rules folders to directories and other symbolic links (thanks @taisukeoe!)
- Stronger enforcement of the setting to always read full files instead of doing partial reads

## [3.11.13] - 2025-04-11

- Loads of terminal improvements: command delay, PowerShell counter, and ZSH EOL mark (thanks @KJ7LNW!)
- Add file context tracking system (thanks @samhvw8 and @canvrno!)
- Improved display of diff errors + easy copying for investigation
- Fixes to .vscodeignore (thanks @franekp!)
- Fix a zh-CN translation for model capabilities (thanks @zhangtony239!)
- Rename AWS Bedrock to Amazon Bedrock (thanks @ronyblum!)
- Update extension title and description (thanks @StevenTCramer!)

## [3.11.12] - 2025-04-09

- Make Grok3 streaming work with OpenAI Compatible (thanks @amittell!)
- Tweak diff editing logic to make it more tolerant of model errors

## [3.11.11] - 2025-04-09

- Fix highlighting interaction with mode/profile dropdowns (thanks @atlasgong!)
- Add the ability to set Host header and legacy OpenAI API in the OpenAI-compatible provider for better proxy support
- Improvements to TypeScript, C++, Go, Java, Python tree-sitter parsers (thanks @KJ7LNW!)
- Fixes to terminal working directory logic (thanks @KJ7LNW!)
- Improve readFileTool XML output format (thanks @KJ7LNW!)
- Add o1-pro support (thanks @arthurauffray!)
- Follow symlinked rules files/directories to allow for more flexible rule setups
- Focus Roo Code in the sidebar when running tasks in the sidebar via the API
- Improve subtasks UI

## [3.11.10] - 2025-04-08

- Fix bug where nested .roo/rules directories are not respected properly (thanks @taisukeoe!)
- Handle long command output more efficiently in the chat row (thanks @samhvw8!)
- Fix cache usage tracking for OpenAI-compatible providers
- Add custom translation instructions for zh-CN (thanks @System233!)
- Code cleanup after making rate-limits per-profile (thanks @ross!)

## [3.11.9] - 2025-04-07

- Rate-limit setting updated to be per-profile (thanks @ross and @olweraltuve!)
- You can now place multiple rules files in the .roo/rules/ and .roo/rules-{mode}/ folders (thanks @upamune!)
- Prevent unnecessary autoscroll when buttons appear (thanks @shtse8!)
- Add Gemini 2.5 Pro Preview to Vertex AI (thanks @nbihan-mediware!)
- Tidy up following ClineProvider refactor (thanks @diarmidmackenzie!)
- Clamp negative line numbers when reading files (thanks @KJ7LNW!)
- Enhance Rust tree-sitter parser with advanced language structures (thanks @KJ7LNW!)
- Persist settings on api.setConfiguration (thanks @gtaylor!)
- Add deep links to settings sections
- Add command to focus Roo Code input field (thanks @axkirillov!)
- Add resize and hover actions to the browser (thanks @SplittyDev!)
- Add resumeTask and isTaskInHistory to the API (thanks @franekp!)
- Fix bug displaying boolean/numeric suggested answers
- Dynamic Vite port detection for webview development (thanks @KJ7LNW!)

## [3.11.8] - 2025-04-05

- Improve combineApiRequests performance to reduce gray screens of death (thanks @kyle-apex!)
- Add searchable dropdown to API config profiles on the settings screen (thanks @samhvw8!)
- Add workspace tracking to history items in preparation for future filtering (thanks @samhvw8!)
- Fix search highlighting UI in history search (thanks @samhvw8!)
- Add support for .roorules and give deprecation warning for .clinerules (thanks @upamune!)
- Fix nodejs version format in .tool-versions file (thanks @upamune!)

## [3.11.7] - 2025-04-04

- Improve file tool context formatting and diff error guidance
- Improve zh-TW localization (thanks @PeterDaveHello!)
- Implement reference counting for McpHub disposal
- Update buttons to be more consistent (thanks @kyle-apex!)
- Improve zh-CN localization (thanks @System233!)

## [3.11.6] - 2025-04-04

- Add the gemini 2.5 pro preview model with upper bound pricing

## [3.11.5] - 2025-04-03

- Add prompt caching for Amazon Bedrock (thanks @Smartsheet-JB-Brown!)
- Add support for configuring the current working directory of MCP servers (thanks @shoopapa!)
- Add profile management functions to API (thanks @gtaylor!)
- Improvements to diff editing functionality, tests, and error messages (thanks @p12tic!)
- Fix for follow-up questions grabbing the focus (thanks @diarmidmackenzie!)
- Show menu buttons when popping the extension out into a new tab (thanks @benny123tw!)

## [3.11.4] - 2025-04-02

- Correctly post state to webview when the current task is cleared (thanks @wkordalski!)
- Fix unit tests to run properly on Windows (thanks @StevenTCramer!)
- Tree-sitter enhancements: TSX, TypeScript, JSON, and Markdown support (thanks @KJ7LNW!)
- Fix issue with line number stripping for deletions in apply_diff
- Update history selection mode button spacing (thanks @kyle-apex!)
- Limit dropdown menu height to 80% of the viewport (thanks @axmo!)
- Update dependencies via `npm audit fix` (thanks @PeterDaveHello!)
- Enable model select when api fails (thanks @kyle-apex!)
- Fix issue where prompts and settings tabs were not scrollable when accessed from dropdown menus
- Update AWS region dropdown menu to the most recent data (thanks @Smartsheet-JB-Brown!)
- Fix prompt enhancement for Bedrock (thanks @Smartsheet-JB-Brown!)
- Allow processes to access the Roo Code API via a unix socket
- Improve zh-TW Traditional Chinese translations (thanks @PeterDaveHello!)
- Add support for Azure AI Inference Service with DeepSeek-V3 model (thanks @thomasjeung!)
- Fix off-by-one error in tree-sitter line numbers
- Remove the experimental unified diff
- Make extension icon more visible in different themes

## [3.11.3] - 2025-03-31

- Revert mention changes in case they're causing performance issues/crashes

## [3.11.2] - 2025-03-31

- Fix bug in loading Requesty key balance
- Fix bug with Bedrock inference profiles
- Update the webview when changing settings via the API
- Refactor webview messages code (thanks @diarmidmackenzie!)

## [3.11.1] - 2025-03-30

- Relax provider profiles schema and add telemetry

## [3.11.0] - 2025-03-30

- Replace single-block-diff with multi-block-diff fast editing strategy
- Support project-level MCP config in .roo/mcp.json (thanks @aheizi!)
- Show OpenRouter and Requesty key balance on the settings screen
- Support import/export of settings
- Add pinning and sorting for API configuration dropdown (thanks @jwcraig!)
- Add Gemini 2.5 Pro to GCP Vertex AI provider (thanks @nbihan-mediware!)
- Smarter retry logic for Gemini
- Fix Gemini command escaping
- Support @-mentions of files with spaces in the name (thanks @samhvw8!)
- Improvements to partial file reads (thanks @KJ7LNW!)
- Fix list_code_definition_names to support files (thanks @KJ7LNW!)
- Refactor tool-calling logic to make the code a lot easier to work with (thanks @diarmidmackenzie, @bramburn, @KJ7LNW, and everyone else who helped!)
- Prioritize “Add to Context” in the code actions and include line numbers (thanks @samhvw8!)
- Add an activation command that other extensions can use to interface with Roo Code (thanks @gtaylor!)
- Preserve language characters in file @-mentions (thanks @aheizi!)
- Browser tool improvements (thanks @afshawnlotfi!)
- Display info about partial reads in the chat row
- Link to the settings page from the auto-approve toolbar
- Link to provider docs from the API options
- Fix switching profiles to ensure only the selected profile is switched (thanks @feifei325!)
- Allow custom o3-mini-<reasoning> model from OpenAI-compatible providers (thanks @snoyiatk!)
- Edit suggested answers before accepting them (thanks @samhvw8!)

## [3.10.5] - 2025-03-25

- Updated value of max tokens for gemini-2.5-pro-03-25 to 65,536 (thanks @linegel!)
- Fix logic around when we fire task completion events

## [3.10.4] - 2025-03-25

- Dynamically fetch instructions for creating/editing custom modes and MCP servers (thanks @diarmidmackenzie!)
- Added Gemini 2.5 Pro model to Google Gemini provider (thanks @samsilveira!)
- Add settings to control whether to auto-approve reads and writes outside of the workspace
- Update UX for chat text area (thanks @chadgauth!)
- Support a custom storage path for tasks (thanks @Chenjiayuan195!)
- Add a New Task command in the Command Palette (thanks @qdaxb!)
- Add R1 support checkbox to Open AI compatible provider to support QWQ (thanks @teddyOOXX!)
- Support test declarations in TypeScript tree-sitter queries (thanks @KJ7LNW!)
- Add Bedrock support for application-inference-profile (thanks @maekawataiki!)
- Rename and migrate global MCP and modes files (thanks @StevenTCramer!)
- Add watchPaths option to McpHub for file change detection (thanks @01Rian!)
- Read image responses from MCP calls (thanks @nevermorec!)
- Add taskCreated event to API and subscribe to Cline events earlier (thanks @wkordalski!)
- Fixes to numeric formatting suffix internationalization (thanks @feifei325!)
- Fix open tab support in the context mention suggestions (thanks @aheizi!)
- Better display of OpenRouter “overloaded” error messages
- Fix browser tool visibility in system prompt preview (thanks @cannuri!)
- Fix the supportsPromptCache value for OpenAI models (thanks @PeterDaveHello!)
- Fix readme links to docs (thanks @kvokka!)
- Run ‘npm audit fix’ on all of our libraries

## [3.10.3] - 2025-03-23

- Update the welcome page to provide 1-click OAuth flows with LLM routers (thanks @dtrugman!)
- Switch to a more direct method of tracking OpenRouter tokens/spend
- Make partial file reads backwards-compatible with custom system prompts and give users more control over the chunk size
- Fix issues where questions and suggestions weren’t showing up for non-streaming models and were hard to read in some themes
- A variety of fixes and improvements to experimental multi-block diff (thanks @KJ7LNW!)
- Fix opacity of drop-down menus in settings (thanks @KJ7LNW!)
- Fix bugs with reading and mentioning binary files like PDFs
- Fix the pricing information for OpenRouter free models (thanks @Jdo300!)
- Fix an issue with our unit tests on Windows (thanks @diarmidmackenzie!)
- Fix a maxTokens issue for the Outbound provider (thanks @pugazhendhi-m!)
- Fix a line number issue with partial file reads (thanks @samhvw8!)

## [3.10.2] - 2025-03-21

- Fixes to context mentions on Windows
- Fixes to German translations (thanks @cannuri!)
- Fixes to telemetry banner internationalization
- Sonnet 3.7 non-thinking now correctly uses 8192 max output tokens

## [3.10.1] - 2025-03-20

- Make the suggested responses optional to not break overriden system prompts

## [3.10.0] - 2025-03-20

- Suggested responses to questions (thanks samhvw8!)
- Support for reading large files in chunks (thanks samhvw8!)
- More consistent @-mention lookups of files and folders
- Consolidate code actions into a submenu (thanks samhvw8!)
- Fix MCP error logging (thanks aheizi!)
- Improvements to search_files tool formatting and logic (thanks KJ7LNW!)
- Fix changelog formatting in GitHub Releases (thanks pdecat!)
- Add fake provider for integration tests (thanks franekp!)
- Reflect Cross-region inference option in ap-xx region (thanks Yoshino-Yukitaro!)
- Fix bug that was causing task history to be lost when using WSL

## [3.9.2] - 2025-03-19

- Update GitHub Actions workflow to automatically create GitHub Releases (thanks @pdecat!)
- Correctly persist the text-to-speech speed state (thanks @heyseth!)
- Fixes to French translations (thanks @arthurauffray!)
- Optimize build time for local development (thanks @KJ7LNW!)
- VSCode theme fixes for select, dropdown and command components
- Bring back the ability to manually enter a model name in the model picker
- Fix internationalization of the announcement title and the browser

## [3.9.1] - 2025-03-18

- Pass current language to system prompt correctly so Roo thinks and speaks in the selected language

## [3.9.0] - 2025-03-18

- Internationalize Roo Code into Catalan, German, Spanish, French, Hindi, Italian, Japanese, Korean, Polish, Portuguese, Turkish, Vietnamese, Simplified Chinese, and Traditional Chinese (thanks @feifei325!)
- Bring back support for MCP over SSE (thanks @aheizi!)
- Add a text-to-speech option to have Roo talk to you as it works (thanks @heyseth!)
- Choose a specific provider when using OpenRouter (thanks PhunkyBob!)
- Support batch deletion of task history (thanks @aheizi!)
- Internationalize Human Relay, adjust the layout, and make it work on the welcome screen (thanks @NyxJae!)
- Fix shell integration race condition (thanks @KJ7LNW!)
- Fix display updating for Bedrock custom ARNs that are prompt routers (thanks @Smartsheet-JB-Brown!)
- Fix to exclude search highlighting when copying items from task history (thanks @im47cn!)
- Fix context mentions to work with multiple-workspace projects (thanks @teddyOOXX!)
- Fix to task history saving when running multiple Roos (thanks @samhvw8!)
- Improve task deletion when underlying files are missing (thanks @GitlyHallows!)
- Improve support for NixOS & direnv (thanks @wkordalski!)
- Fix wheel scrolling when Roo is opened in editor tabs (thanks @GitlyHallows!)
- Don’t automatically mention the file when using the "Add to context" code action (thanks @qdaxb!)
- Expose task stack in `RooCodeAPI` (thanks @franekp!)
- Give the models visibility into the current task's API cost

## [3.8.6] - 2025-03-13

- Revert SSE MCP support while we debug some config validation issues

## [3.8.5] - 2025-03-12

- Refactor terminal architecture to address critical issues with the current design (thanks @KJ7LNW!)
- MCP over SSE (thanks @aheizi!)
- Support for remote browser connections (thanks @afshawnlotfi!)
- Preserve parent-child relationship when cancelling subtasks (thanks @cannuri!)
- Custom baseUrl for Google AI Studio Gemini (thanks @dqroid!)
- PowerShell-specific command handling (thanks @KJ7LNW!)
- OpenAI-compatible DeepSeek/QwQ reasoning support (thanks @lightrabbit!)
- Anthropic-style prompt caching in the OpenAI-compatible provider (thanks @dleen!)
- Add Deepseek R1 for AWS Bedrock (thanks @ATempsch!)
- Fix MarkdownBlock text color for Dark High Contrast theme (thanks @cannuri!)
- Add gemini-2.0-pro-exp-02-05 model to vertex (thanks @shohei-ihaya!)
- Bring back progress status for multi-diff edits (thanks @qdaxb!)
- Refactor alert dialog styles to use the correct vscode theme (thanks @cannuri!)
- Custom ARNs in AWS Bedrock (thanks @Smartsheet-JB-Brown!)
- Update MCP servers directory path for platform compatibility (thanks @hannesrudolph!)
- Fix browser system prompt inclusion rules (thanks @cannuri!)
- Publish git tags to github from CI (thanks @pdecat!)
- Fixes to OpenAI-style cost calculations (thanks @dtrugman!)
- Fix to allow using an excluded directory as your working directory (thanks @Szpadel!)
- Kotlin language support in list_code_definition_names tool (thanks @kohii!)
- Better handling of diff application errors (thanks @qdaxb!)
- Update Bedrock prices to the latest (thanks @Smartsheet-JB-Brown!)
- Fixes to OpenRouter custom baseUrl support
- Fix usage tracking for SiliconFlow and other providers that include usage on every chunk
- Telemetry for checkpoint save/restore/diff and diff strategies

## [3.8.4] - 2025-03-09

- Roll back multi-diff progress indicator temporarily to fix a double-confirmation in saving edits
- Add an option in the prompts tab to save tokens by disabling the ability to ask Roo to create/edit custom modes for you (thanks @hannesrudolph!)

## [3.8.3] - 2025-03-09

- Fix VS Code LM API model picker truncation issue

## [3.8.2] - 2025-03-08

- Create an auto-approval toggle for subtask creation and completion (thanks @shaybc!)
- Show a progress indicator when using the multi-diff editing strategy (thanks @qdaxb!)
- Add o3-mini support to the OpenAI-compatible provider (thanks @yt3trees!)
- Fix encoding issue where unreadable characters were sometimes getting added to the beginning of files
- Fix issue where settings dropdowns were getting truncated in some cases

## [3.8.1] - 2025-03-07

- Show the reserved output tokens in the context window visualization
- Improve the UI of the configuration profile dropdown (thanks @DeXtroTip!)
- Fix bug where custom temperature could not be unchecked (thanks @System233!)
- Fix bug where decimal prices could not be entered for OpenAI-compatible providers (thanks @System233!)
- Fix bug with enhance prompt on Sonnet 3.7 with a high thinking budget (thanks @moqimoqidea!)
- Fix bug with the context window management for thinking models (thanks @ReadyPlayerEmma!)
- Fix bug where checkpoints were no longer enabled by default
- Add extension and VSCode versions to telemetry

## [3.8.0] - 2025-03-07

- Add opt-in telemetry to help us improve Roo Code faster (thanks Cline!)
- Fix terminal overload / gray screen of death, and other terminal issues
- Add a new experimental diff editing strategy that applies multiple diff edits at once (thanks @qdaxb!)
- Add support for a .rooignore to prevent Roo Code from read/writing certain files, with a setting to also exclude them from search/lists (thanks Cline!)
- Update the new_task tool to return results to the parent task on completion, supporting better orchestration (thanks @shaybc!)
- Support running Roo in multiple editor windows simultaneously (thanks @samhvw8!)
- Make checkpoints asynchronous and exclude more files to speed them up
- Redesign the settings page to make it easier to navigate
- Add credential-based authentication for Vertex AI, enabling users to easily switch between Google Cloud accounts (thanks @eonghk!)
- Update the DeepSeek provider with the correct baseUrl and track caching correctly (thanks @olweraltuve!)
- Add a new “Human Relay” provider that allows you to manually copy information to a Web AI when needed, and then paste the AI's response back into Roo Code (thanks @NyxJae)!
- Add observability for OpenAI providers (thanks @refactorthis!)
- Support speculative decoding for LM Studio local models (thanks @adamwlarson!)
- Improve UI for mode/provider selectors in chat
- Improve styling of the task headers (thanks @monotykamary!)
- Improve context mention path handling on Windows (thanks @samhvw8!)

## [3.7.12] - 2025-03-03

- Expand max tokens of thinking models to 128k, and max thinking budget to over 100k (thanks @monotykamary!)
- Fix issue where keyboard mode switcher wasn't updating API profile (thanks @aheizi!)
- Use the count_tokens API in the Anthropic provider for more accurate context window management
- Default middle-out compression to on for OpenRouter
- Exclude MCP instructions from the prompt if the mode doesn't support MCP
- Add a checkbox to disable the browser tool
- Show a warning if checkpoints are taking too long to load
- Update the warning text for the VS LM API
- Correctly populate the default OpenRouter model on the welcome screen

## [3.7.11] - 2025-03-02

- Don't honor custom max tokens for non thinking models
- Include custom modes in mode switching keyboard shortcut
- Support read-only modes that can run commands

## [3.7.10] - 2025-03-01

- Add Gemini models on Vertex AI (thanks @ashktn!)
- Keyboard shortcuts to switch modes (thanks @aheizi!)
- Add support for Mermaid diagrams (thanks Cline!)

## [3.7.9] - 2025-03-01

- Delete task confirmation enhancements
- Smarter context window management
- Prettier thinking blocks
- Fix maxTokens defaults for Claude 3.7 Sonnet models
- Terminal output parsing improvements (thanks @KJ7LNW!)
- UI fix to dropdown hover colors (thanks @SamirSaji!)
- Add support for Claude Sonnet 3.7 thinking via Vertex AI (thanks @lupuletic!)

## [3.7.8] - 2025-02-27

- Add Vertex AI prompt caching support for Claude models (thanks @aitoroses and @lupuletic!)
- Add gpt-4.5-preview
- Add an advanced feature to customize the system prompt

## [3.7.7] - 2025-02-27

- Graduate checkpoints out of beta
- Fix enhance prompt button when using Thinking Sonnet
- Add tooltips to make what buttons do more obvious

## [3.7.6] - 2025-02-26

- Handle really long text better in the in the ChatRow similar to TaskHeader (thanks @joemanley201!)
- Support multiple files in drag-and-drop
- Truncate search_file output to avoid crashing the extension
- Better OpenRouter error handling (no more "Provider Error")
- Add slider to control max output tokens for thinking models

## [3.7.5] - 2025-02-26

- Fix context window truncation math (see [#1173](https://github.com/RooVetGit/Roo-Code/issues/1173))
- Fix various issues with the model picker (thanks @System233!)
- Fix model input / output cost parsing (thanks @System233!)
- Add drag-and-drop for files
- Enable the "Thinking Budget" slider for Claude 3.7 Sonnet on OpenRouter

## [3.7.4] - 2025-02-25

- Fix a bug that prevented the "Thinking" setting from properly updating when switching profiles.

## [3.7.3] - 2025-02-25

- Support for ["Thinking"](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) Sonnet 3.7 when using the Anthropic provider.

## [3.7.2] - 2025-02-24

- Fix computer use and prompt caching for OpenRouter's `anthropic/claude-3.7-sonnet:beta` (thanks @cte!)
- Fix sliding window calculations for Sonnet 3.7 that were causing a context window overflow (thanks @cte!)
- Encourage diff editing more strongly in the system prompt (thanks @hannesrudolph!)

## [3.7.1] - 2025-02-24

- Add AWS Bedrock support for Sonnet 3.7 and update some defaults to Sonnet 3.7 instead of 3.5

## [3.7.0] - 2025-02-24

- Introducing Roo Code 3.7, with support for the new Claude Sonnet 3.7. Because who cares about skipping version numbers anymore? Thanks @lupuletic and @cte for the PRs!

## [3.3.26] - 2025-02-27

- Adjust the default prompt for Debug mode to focus more on diagnosis and to require user confirmation before moving on to implementation

## [3.3.25] - 2025-02-21

- Add a "Debug" mode that specializes in debugging tricky problems (thanks [Ted Werbel](https://x.com/tedx_ai/status/1891514191179309457) and [Carlos E. Perez](https://x.com/IntuitMachine/status/1891516362486337739)!)
- Add an experimental "Power Steering" option to significantly improve adherence to role definitions and custom instructions

## [3.3.24] - 2025-02-20

- Fixed a bug with region selection preventing AWS Bedrock profiles from being saved (thanks @oprstchn!)
- Updated the price of gpt-4o (thanks @marvijo-code!)

## [3.3.23] - 2025-02-20

- Handle errors more gracefully when reading custom instructions from files (thanks @joemanley201!)
- Bug fix to hitting "Done" on settings page with unsaved changes (thanks @System233!)

## [3.3.22] - 2025-02-20

- Improve the Provider Settings configuration with clear Save buttons and warnings about unsaved changes (thanks @System233!)
- Correctly parse `<think>` reasoning tags from Ollama models (thanks @System233!)
- Add support for setting custom preferred languages on the Prompts tab, as well as adding Catalan to the list of languages (thanks @alarno!)
- Add a button to delete MCP servers (thanks @hannesrudolph!)
- Fix a bug where the button to copy the system prompt preview always copied the Code mode version
- Fix a bug where the .roomodes file was not automatically created when adding custom modes from the Prompts tab
- Allow setting a wildcard (`*`) to auto-approve all command execution (use with caution!)

## [3.3.21] - 2025-02-17

- Fix input box revert issue and configuration loss during profile switch (thanks @System233!)
- Fix default preferred language for zh-cn and zh-tw (thanks @System233!)
- Fix Mistral integration (thanks @d-oit!)
- Feature to mention `@terminal` to pull terminal output into context (thanks Cline!)
- Fix system prompt to make sure Roo knows about all available modes
- Enable streaming mode for OpenAI o1

## [3.3.20] - 2025-02-14

- Support project-specific custom modes in a .roomodes file
- Add more Mistral models (thanks @d-oit and @bramburn!)
- By popular request, make it so Ask mode can't write to Markdown files and is purely for chatting with
- Add a setting to control the number of open editor tabs to tell the model about (665 is probably too many!)
- Fix race condition bug with entering API key on the welcome screen

## [3.3.19] - 2025-02-12

- Fix a bug where aborting in the middle of file writes would not revert the write
- Honor the VS Code theme for dialog backgrounds
- Make it possible to clear out the default custom instructions for built-in modes
- Add a help button that links to our new documentation site (which we would love help from the community to improve!)
- Switch checkpoints logic to use a shadow git repository to work around issues with hot reloads and polluting existing repositories (thanks Cline for the inspiration!)

## [3.3.18] - 2025-02-11

- Add a per-API-configuration model temperature setting (thanks @joemanley201!)
- Add retries for fetching usage stats from OpenRouter (thanks @jcbdev!)
- Fix bug where disabled MCP servers would not show up in the settings on initialization (thanks @MuriloFP!)
- Add the Requesty provider and clean up a lot of shared model picker code (thanks @samhvw8!)
- Add a button on the Prompts tab to copy the full system prompt to the clipboard (thanks @mamertofabian!)
- Fix issue where Ollama/LMStudio URLs would flicker back to previous while entering them in settings
- Fix logic error where automatic retries were waiting twice as long as intended
- Rework the checkpoints code to avoid conflicts with file locks on Windows (sorry for the hassle!)

## [3.3.17] - 2025-02-09

- Fix the restore checkpoint popover
- Unset git config that was previously set incorrectly by the checkpoints feature

## [3.3.16] - 2025-02-09

- Support Volcano Ark platform through the OpenAI-compatible provider
- Fix jumpiness while entering API config by updating on blur instead of input
- Add tooltips on checkpoint actions and fix an issue where checkpoints were overwriting existing git name/email settings - thanks for the feedback!

## [3.3.15] - 2025-02-08

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
