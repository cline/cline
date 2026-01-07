# Changelog

## [3.47.0]

### Added
- Added experimental support for Background Edits (allows editing files in background without opening the diff view)
- Updated free model to MiniMax M2.1 (replacing MiniMax M2)
- Added support for Azure based identity authentication in OpenAI Compatible provider and Azure OpenAI
- Add `supportsReasoning` property to Baseten models

### Fixed

- Prevent expired token usage in authenticated requests
- Exclude binary files without extensions from diffs
- Preserve file endings and trailing newlines
- Fix Cerebras rate limiting
- Fix Auto Compact for Claude Code provider
- Make Workspace and Favorites history filters independent
- Fix remote MCP server connection failures (404 response handling)
- Disable native tool calling for Deepseek 3.2 speciale
- Show notification instead of opening sidebar on update
- Fix Baseten model selector

### Refactored

- Modify prompts for parallel tool usage in Claude and Gemini 3 models

## [3.46.1]

### Fixed

- Remove GLM 4.6 from free models

## [3.46.0]

### Added

- Added GLM 4.7 model
- Enhanced background terminal execution with command tracking, log file output, zombie process prevention (10-minute timeout), and clickable log paths in UI
- Apply Patch tool for GPT-5+ models (replacing current diff edit tools)

### Fixed

- Duplicate error messages during streaming for Diff Edit tool when Parallel Tool Calling is not enabled
- Banner carousel styling and dismiss functionality
- Typos in Gemini system prompt overrides
- Model picker favorites ordering, star toggle, and keyboard navigation for OpenRouter and Vercel AI Gateway providers
- Fetch remote config values from the cache

### Refactored

- Anthropic handler to use metadata for reasoning support
- Bedrock provider to use metadata for reasoning support

## [3.45.1]

- Fixed MCP settings race condition where toggling auto-approve or changing timeout settings would cause the UI to flash and revert

## [3.45.0]

- Added Gemini 3 Flash Preview model

## [3.44.2]

- Polished the model picker UI with checkmarks for selected models, tooltips on Plan/Act tabs, and consistent arrow pointers across all popup modals
- Improved WhatsNew modal responsiveness and cleaned up redundant UI elements
- Fixed GLM models outputting garbled text in thinking tags—reasoning is now properly disabled for these models

## [3.44.1]

- Fixed a critical bug where local MCP servers stopped connecting after v3.42.0—all user-configured stdio-based MCP servers should now work again
- Fixed remotely configured API keys not being extracted correctly for enterprise users
- Added support for dynamic tool instructions that adapt based on runtime context, laying groundwork for future context-aware features

## [3.44.0]

## Added

- Updating minor version to show a proper banner for the release

## [3.43.1]

### Patch Changes

- Fix GLM-4.6 Model reference id

## [3.43.0]

### Added

- GLM-4.6
- kat-coder-pro
- Add parsing of env variable patterns to the mcpconfig.json

### Fixed

- TLS Proxy support issues for VSCode
- Add supportsReasoning flag to OpenAI reasoning models
- Fix thinking not available for some models in the OpenAI provider
- Fix invalid signature field issues when switching between Gemini and Anthropic providers
- Extract OpenRouter model filtering into reusable utility and use it in different model pickers
- Fix a11y for auto approve checkbox
- Improve ModelPickerModal provider list layout

### Refactored

- Migrate WhatsNewModal to new shared dialogue component

## [3.42.0]

### Added

- Expose `getAvailableSlashCommands` rpc endpoint to UI clients
- Made slash command menu and context menu accessible and screenreader-friendly
- Made expanding/collapsing UI components accessible

### Fixed

- Devstral OpenRouter model ID and routing issues
- Incorrect pricing display for Devstral model in the extension

## [3.41.0]

### Added

- OpenAI GPT-5.2
- Devstral-2512 (formerly stealth model "Microwave")
- Improvements to chat modal model picker
- Amazon Nova 2 Lite
- DeepSeek 3.2 to native tool calling allow list
- Responses API support for Codex models in OpenAI provider (requires native tool calling)
- Xmas Special Santa Cline
- Welcome screen UI enhancements

### Fixed

- Initial checkpoint commit now non-blocking for improved responsiveness in large repositories
- Gemini Vertex models erroring when thinking parameters are not supported
- Restrictive file permissions for secrets.json
- Ollama streaming requests not aborting when task is cancelled

### Refactored

- OpenAI provider to centralize temperature configuration and include missing GPT-5 model settings
- OpenAI native handler to use metadata for model capabilities
- Vertex provider to use metadata for model capabilities

## [3.40.2]

- Fix logout on network errors during token refresh (e.g., opening laptop while offline)

## [3.40.1]

- Fix cost calculation display for Anthropic API requests

## [3.40.0]

- Fix highlighted text flashing when task header is collapsed
- Add X-Cerebras-3rd-Party-Integration header to Cerebras API requests
- Add microwave family system prompt configuration
- Remove tooltips from auto approve menu
- Fix Standalone, ensure cwd is the install dir to find resources reliably
- Fix a bug where terminal commands with double quotes are broken when "Terminal Execution Mode" is set to "Background Exec"
- Add support for slash commands anywhere in a message, not just at the beginning. This matches the behavior of @ mentions for a more flexible input experience.
- Add bottom padding to the last message to fix last response text getting cut off by auto approve settings bar.
- Add default thinking level for Gemini 3 Pro models in Gemini provider

## [3.39.2]

- Fix for microwave model and thinking settings

## [3.39.1]

- Fix Openrouter and Cline Provider model info

## [3.39.0]

- Add Explain Changes feature
- Add microwave Stealth model
- Add Tabbed Model Picker with Recommended and Free tabs
- Add support to View remote rules and workflows in the editor
- Enable NTC (Native Tool Calling) by default
- Bug fixes and improvements for LiteLLM provider

## [3.38.3]

- Task export feature now opens the task directory, allowing easy access to the full task files
- Add Grok 4.1 and Grok Code to XAI provider
- Enabled native tool calling for Baseten and Kimi K2 models
- Add thinking level to Gemini 3.0 Pro preview
- Expanded Hooks functionality
- Removed Task Timeline from Task Header
- Bug fix for slash commands
- Bug fixes for Vertex provider
- Bug fixes for thinking/reasoning issues across multiple providers when using native tool calling
- Bug fixes for terminal usage on Windows devices

## [3.38.2]

- Add Claude Opus 4.5

## [3.38.1]

### Fixed

- Fixed handling of 'signature' field in sanitizeAnthropicContentBlock to properly preserve it when thinking is enabled, as required by Anthropic's API.

## [3.38.0]

### Added

- Gemini 3 Pro Preview model
- AquaVoice Avalon model for voice-to-text dictation

### Fixed

- Automatic context truncation when AWS Bedrock token usage rate limits are exceeded
- Removed new_task tool from system prompts, updated slash command prompts, and added helper function for native tool calling validation

## [3.37.1]

- Comprehensive changes to better support GPT 5.1 - System prompt, tools, deep-planning, focus chain, etc.
- Add AGENTS.md support
- feat(models): Add free minimax/mimax-m2 model to the model picker

## [3.37.0]

### Added

- GPT-5.1 with model-specific prompting: tailored system prompts, tool usage, focus chain, and deep-planning optimizations
- Nous Research provider with Hermes 4 model family and custom system prompts
- Switched to Aqua Voice's Avalon model in speech to text transcription
- Added Linux support for speech to text
- Model-family breakouts for deep-planning prompting, laying groundwork for enhanced slash commands
- Expanded HTTP proxy support throughout the codebase
- Improved focus chain prompting for frontier models (Anthropic, OpenAI, Gemini, xAI)

### Fixed

- Duplicate tool results prevention through existence checking
- XML entity escaping in model content processor
- Commit message generation in command palette
- OpenAI Compatible provider temperature parameter type conversion

## Documentation

- Added missing proto generation step in CONTRIBUTING.md
- New `npm run dev` script for streamlined terminal workflow (fixes #7335)

## [3.36.1]

- fix: remove native tool calling support from Gemini and XAI provider due to invalid tool names issues
- fix: disable native tool callings for grok code models
- Add MCP tool usage to GLM
- Removes reasoning_details content field from Anthropic providers

## [3.36.0]

- Add: Hooks allow you to inject custom logic into Cline's workflow
- Add: new provider AIhubmix
- Add: Use http_proxy, https_proxy and no_proxy in JetBrains
- Fix: Oca Token Refresh logic
- Fix: issues where assistant message with empty content is added to conversation history
- Fix: bug where the checkbox shows in the model selector dropdown
- Fix: Switch from defaultUserAgentProvider to customUserAgent for Bedrock
- Fix: support for `<think>` tags for better compatibility with open-source models
- Fix: refinements to the GLM-4.6 system prompt

## [3.35.1]

- Add: Hicap API integration as provider
- Fix: enable Add Header button in OpenAICompatibleProvider UI
- Fix: Remove orphaned tool_results after truncation and empty content field issues in native tool call
- Fix: render model description in markdown

## [3.35.0]

- Add native tool calling support with configurable setting.
- Auto-approve is now always-on with a redesigned expanding menu. Settings simplified and notifications moved to General Settings.
- added zai-glm-4.6 as a Cerebras model
- Created GPT5 family specific system prompt template
- Fix: show reasoning budget slider to models with valid thinking config
- Requesty base URL, and API key fixes
- Delete all Auth Tokens when logging out
- Support for <think> tags for models that prefer that over <thinking>

## [3.34.1]

- Added support for MiniMax provider with MiniMax-M2 model
- Remove Cline/code-supernova-1-million model
- Changes to allow users to manually enter model names (eg. presets) when using OpenRouter

## [3.34.0]

- Cline Teams is now free through 2025 for unlimited users. Includes Jetbrains, RBAC, centralized billing and more.
- Use the “exacto” versions of GLM-4.6, Kimi-K2, and Qwen3-Coder in the Cline provider for the best balance of cost, speed, accuracy and tool-calling.

## [3.33.1]

- Fix CLI installation copy text

## [3.33.0]

- Added Cline CLI (Preview)
- Added Subagent support (Experimental)
- Added Multi-Root Workspaces support (Enable in feature settings)
- Add auto-retry with exponential backof for failed API requests

## [3.32.8]

- Add Claude Haiku 4.5 support

## [3.32.7]

- Add JP and Global inference profile options to AWS Bedrock
- Adding Improvements to VSCode multi root workspaces
- Added markdown support to focus chain text, allowing the model to display more interesting focus chains

## [3.32.6]

- Add experimental support for VSCode multi root workspaces
- Add Claude Sonnet 4.5 to Claude Code provider
- Add Glm 4.6 to Z AI provider

## [3.32.5]

- Improve thinking budget slider UI to take up less space
- Fix Vercel provider cost note and sign-up url
- Fix repeated API error 400 in SAP AI Core provider
- Add us-west-1 to Amazon Bedrock regions
- Fix OCA provider refresh logic

## [3.32.4]

- Add 1m context window support to Claude Sonnet 4.5
- Add Claude Sonnet 4.5 to GCP Vertex
- Add prompt caching support for OpenRouter accidental `anthropic/claude-4.5-sonnet` model ID

## [3.32.3]

- Add Claude Sonnet 4.5 to Bedrock provider
- Add Alert banner for new Claude Sonnet 4.5 model

## [3.32.2]

- Add Claude Sonnet 4.5 to Cline/OpenRouter/Anthropic providers
- Add /task deep link handler

## [3.32.1]

- Preserve reasoning traces for Cline/OpenRouter/Anthropic providers to maintain conversation integrity
- Add automatically retry on rate limit errors with SAP AI Core provider
- Fix Cline accounts using stale id token at refresh response
- Minor UI improvements to Settings and Task Header

## [3.32.0]

- Added the new code-supernova-1-million stealth model, available for free and delivering a 1 million token context window
- Changes to inform Cline about commands that are available on your system

## [3.31.1]

- Version bump

## [3.31.0]

- UI Improvements: New task header and focus chain design to take up less space for a cleaner experience
- Voice Mode: Experimental feature that must be enabled in settings for hands-free coding
- YOLO Mode: Enable in settings to let Cline approve all actions and automatically switch between plan/act mode
- Fix Oracle Code Assist provider issues

## [3.30.3]

- Add Oracle Code Assist provider

## [3.30.2]

- Fix UI tests

## [3.30.1]

- Fix model list not being updated in time for user to use shortcut button to update model to stealth model
- Fix flicker issue when switching modes
- Fix Sticky header in settings view overlaping with content on scroll
- Add experimental yolo mode feature that disables all user approvals and automatically executes a task and navigates through plan to act mode until the task is complete

## [3.30.0]

- Add code-supernova stealth model

## [3.29.2]

- Fix: Reverted change that caused formatting issues
- Fix: Moonshot - Pass max_tokens value to provider

## [3.29.1]

- Changeset bump + Announcement banner update

## [3.29.0]

- Updated Baseten provider to fetch models from server
- Fix: Updated insufficient balance URL for easy Cline balance top-ups
- Accessibility: Improvements to screen readers in MCP, Cline Rules, workflows, and history views.

## [3.28.4]

- Fix bug where some Windows machines had API request hanging
- Fix bug where 'Proceed while running' action button would be disabled after running an interactive command
- Fix prompt cache info not being displayed in History

## [3.28.3]

- Fixed issue with start new task button
- Feature to generate commit message for staged changes, with unstaged as fallback

## [3.28.2]

- Fix for focus chain settings

## [3.28.1]

- Requesty: use base URL to get models and API keys
- Removed focus chain feature flag

## [3.28.0]

- Synchronized Task History: Real-time task history synchronization across all Cline instances
- Optimized GPT-5 Integration: Fine-tuned system prompts for improved performance with GPT-5 model family
- Deep Planning Improvements: Optimized prompts for Windows/PowerShell environments and dependency exclusion
- Streamlined UI Experience: ESC key navigation, cleaner approve/reject buttons, and improved editor panel focus
- Smart Provider Search: Improved search functionality in API provider dropdown for faster model selection
- Added per-provider thinking tokens configurability
- Added Ollama custom prompt options
- Enhanced SAP AI Core Provider: Orchestration mode support and improved model visibility
- Added Dify.ai API Integration
- SambaNova Updates: Added DeepSeek-V3.1 model
- Better Gemini rate limit handling
- OpenAI Reasoning Effort: Minimal reasoning effort configuration for OpenAI models
- Fixed LiteLLM Caching: Anthropic caching compatibility when using LiteLLM
- Fixed Ollama default endpoint connections
- Fixed AutoApprove menu overflow
- Fixed extended thinking token issue with Anthropic models
- Fixed issue with slash commands removing text from prompt

## [3.27.2]

- Remove `grok-code-fast-1` promotion deadline

## [3.27.1]

- Add new Kimi K2 model to groq and moonshot providers

## [3.27.0]

- Fix `grok-code-fast-1` model information
- Add call to action for trying free `grok-code-fast-1` in Announcement banner

## [3.26.7]

- Add 200k context window variant for Claude Sonnet 4 to OpenRouter and Cline providers

## [3.26.6]

- Add free Grok Coder model to Cline provider for users looking for a fast, free coding model option
- Fix GPT-5 models not respecting auto-compact setting when enabled, improving context window management
- Fix provider retry attempts not showing proper user feedback during rate limiting scenarios
- Improve markdown and code block styling to automatically adapt when switching VS Code themes

## [3.26.5]

- fix (provider/vercel-ai-gateway): reduce model list load frequency in settings view
- Fix OVSX publish command to resolve deployment failure

## [3.26.4]

- Update nebius ai studio models
- Update sap provider - support reasoning effort for open ai models
- Fix Claude 4 image input in SAP AI Core Provider

## [3.26.3]

- Add compact system prompt option for LM Studio and Ollama models, optimized for smaller context windows (8k or less)
- Add token usage tracking for LM Studio models to better monitor API consumption
- Add "Use compact prompt" checkbox in LM Studio provider settings
- Fix "Unexpected API Response" bug with gpt-5

## [3.26.2]

- Improve OpenRouter model parsing to show reasoning budget sliders for all models that support thinking, not just Claude models
- Fix OpenRouter context window error handling to properly extract error codes from error messages, resolving "Unexpected API Response" errors with GPT-5 on Cline provider
- Fix GPT-5 context window configuration for OpenAI/OpenRouter/Cline providers to use correct 272K limit
- Remove max tokens configuration from Sonic Alpha model
- Add Go language support to deep-planning feature (Thanks @yuvalman!)
- Fix typo in Focus Chain settings page (Thanks @joyceerhl!)

## [3.26.1]

- Add Vercel AI Gateway as a new API provider option (Thanks @joshualipman123!)
- Improve SAP AI Core provider to show deployed and undeployed models in the UI (Thanks @yuvalman!)
- Fix Fireworks provider configuration and functionality (Thanks @ershang-fireworks!)
- Add telemetry tracking for MCP tool usage to help improve the extension
- Improve telemetry tracking for rules and workflow usage analytics
- Set Plan mode to use strict mode by default for better planning results

## [3.26.0]

- Add Z AI as a new API provider with GLM-4.5 and GLM-4.5 Air models, offering competitive performance with cost-effective pricing especially for Chinese language tasks (Thanks @jues!)
- Add Cline Sonic Alpha model - experimental advanced model with 262K context window for complex coding tasks
- Add support for LM Studio local models from v0 API endpoint with configurable max tokens
- Fix Ollama context window configuration not being used in requests

## [3.25.3]

- Fix bug where 'Enable checkpoints' and 'Disable MCP Marketplace' settings would be reset to default on reload
- Move the position of the focus chain edit button when a scrollbar is present. Make the pencil icon bigger and better centered.

## [3.25.2]

- Fix attempt_completion showing twice in chat due to partial logic not being handled correctly
- Fix OpenRouter showing cline credits error after 402 response

## [3.25.1]

- Fix attempt_completion command showing twice in chat view when updating progress checklist
- Fix bug where announcement banner could not be dismissed
- Add GPT-OSS models to AWS Bedrock

## [3.25.0]

- **Focus Chain:** Automatically creates and maintains todo lists as you work with Cline, breaking down complex tasks into manageable steps with real-time progress tracking
- **Auto Compact:** Intelligently manages conversation context to prevent token limit errors by automatically compacting older messages while preserving important context
- **Deep Planning:** New `/deep-planning` slash command for structured 4-step implementation planning that integrates with Focus Chain for automatic progress tracking
- Add support for 200k context window for Claude Sonnet 4 in OpenRouter and Cline providers
- Add option to configure custom base URL for Requesty provider

## [3.24.0]

- Add OpenAI GPT-5 Chat(gpt-5-chat-latest)
- Add custom browser arguments setting to allow passing flags to the Chrome executable for better headless compatibility.
- Add 1m context window model support for claude sonnet 4
- Fis the API Keys URL for Requesty
- Set gpt5 max tokens to 8_192 to fix 'context window exceeded' error
- Fix issue where fallback request to retrieve cost was not using correct auth token
- Add OpenAI context window exceeded error handling
- Calibrate input token counts when using anthropic models of sap ai core provider

## [3.23.0]

- Add caching support for Bedrock inferences using SAP AI Core and minor refactor
- Improve visibility for mode switch background color on different themes
- Fix terminal commands putting webview in blocked state

## [3.22.0]

- Implemented a retry strategy for Cerebras to handle rate limit issues due to its generation speed
- Add support for GPT-5 models to SAP AI Core Provider
- Support sending context to active webview when editor panels are opened.
- Fix bug where running out of credits on Cline accounts would show '402 empty body' response instead of 'buy credits' component
- Fix LiteLLM Proxy Provider Cost Tracking

## [3.21.0]

- Add support for GPT-5 model family including GPT-5, GPT-5 Mini, and GPT-5 Nano with prompt caching support and set GPT-5 as the new default model
- Add "Take a Tour" button for new users to easily access the VSCode walkthrough and improve onboarding experience
- Enhance plan mode response handling with better exploration parameter support

## [3.20.13]

- Fix prompt caching support for Opus 4.1 on OpenRouter/Cline

## [3.20.12]

- Add Claude Opus 4.1 model support to AWS Bedrock provider (Thanks @omercelik!)
- Fix prompt caching and extended thinking support for Claude Opus 4.1 in Anthropic provider

## [3.20.11]

Add gpt-oss-120b as a Cerebras model
Add Opus 4.1 through Claude Code

## [3.20.10]

- Add OpenAI's new open-source models (GPT-OSS-120B and GPT-OSS-20B) to Hugging Face and Groq providers

## [3.20.9]

- Add support for Claude Opus 4.1 model in Anthropic provider
- Add Baseten as a new API provider with support for DeepSeek, Llama, and Kimi K2 models (Thanks @AlexKer!)
- Fix error messages not clearing from UI when retrying failed tasks
- Fix chat input box positioning issues

## [3.20.8]

- Add navbar tooltips on hover

## [3.20.7]

- Fix circular dependency that affect the github workflow Tests / test (pull_request)

## [3.20.6]

- Fix login check on extension restart

## [3.20.5]

- Fix authentication persistence issues that could cause users to be logged out unexpectedly

## [3.20.4]

- Add new Cerebras models
- Update rate limits for existing Cerebras models
- Fix for delete task dialog

## [3.20.3]

- Add Huawei Cloud MaaS Provider (Thanks @ddling!)
- Add Cerebras Qwen 3 235B instruct model (Thanks @kevint-cerebras!)
- Add DeepSeek R1 0528 support under Hugging Face (Thanks @0ne0rZer0!)
- Fix Global Rules directory documentation for Linux/WSL systems
- Fix token counting when using VSCode LM API provider
- Fix input field stealing focus issue by only focusing on visible and active editor panels
- Fix duplicate tool registration for claude4-experimental
- Trim input value for URL fields

## [3.20.2]

- Fixed issue with sap ai core client credentials storage
- Fix Qwen Api option inconsistency between UI and API layer
- Fix credit balance out of sync issue on account switching
- Fix Claude Code CLAUDE_CODE_MAX_OUTPUT_TOKENS
- Fix cursor state after restoring files to be disabled after checked out
- Fix issue where checkpointing blocked UI

## [3.20.1]

- Fix for files being deleted when switching modes or closing tasks

## [3.20.0]

- Add account balance display for all organization members, allowing non-admin users to view their organization's credit balance and add credits

## [3.19.8]

- Add Claude Code support on Windows with improved system prompt handling to fix E2BIG errors (Thanks @BarreiroT!)
- Improve Cerebras provider with updated model selection (Qwen and Llama 3.3 70B only) and increased context window for Qwen 3 32B from 16K to 64K tokens
- Improve Cerebras Qwen model performance by removing thinking tokens from model input
- Add robust checkpoint timeout handling with early warning at 7 seconds and timeout at 15 seconds to prevent hanging on large repositories
- Fix MCP servers incorrectly starting when disabled in configuration (Thanks @mohanraj-r!)
- Refactor Git commit message generation with streaming support and improved module organization
- Fix settings navigation to open correct tab when accessing from checkpoint warnings

## [3.19.7]

- Add Hugging Face as a new API provider with support for their inference API models
- Improve Claude Code error messages with better guidance for common setup issues (Thanks @BarreiroT!)
- Fix authentication sync issues when using multiple VSCode windows

## [3.19.6]

- Improve Kimi K2 model provider routing with additional provider options for better availability and performance
- Fixed terminal bug where Cline failed to capture output of certain fast-running commands
- Fixed bug with increasing auto approved number of requests not resetting the counter mid-task

## [3.19.5]

- Add Groq as a new API provider with support for all Groq models including Kimi-K2
- Add user role display in organization UI for Cline account users
- Fix message dialogs not showing option buttons properly
- Fix authentication issues when using multiple VSCode windows

## [3.19.4]

- Add ability to choose Chinese endpoint for Moonshot provider

## [3.19.3]

- Add Moonshot AI provider

## [3.19.2]

- Show request ID in error messages returned by Cline Accounts API to help debug user reported issues

## [3.19.1]

- Fix documentation

## [3.19.0]

- Add Kimi-K2 as a recommended model in the Cline Provider, and route to Together/Groq for 131k context window and high throughput
- Added API Key support for Bedrock integration

## [3.18.14]

- Fix bug where Cline account users logged in with invalid token would not be shown as logged out in webview presentation layer

## [3.18.13]

- Fix authentication issue where Cline accounts users would keep getting logged out or seeing 'Unexpected API response' errors

## [3.18.12]

- Fix flaky organization switching behavior in Cline provider that caused UI inconsistencies and double loading
- Fix insufficient credits error display to properly show error messages when account balance is too low
- Improve credit balance validation and error handling for Cline provider requests

## [3.18.11]

- Fix authentication issues with Cline provider by ensuring the client always uses the latest auth token

## [3.18.10]

- Update recommended fast & cheap model to Grok 4 in OpenRouter model picker
- Fix Gemini 2.5 Pro thinking budget slider and add support for Gemini 2.5 Flash Lite Preview model (Thanks @arafatkatze!)

## [3.18.9]

- Fix streaming reliability issues with Cline provider that could cause connection problems during long conversations
- Fix authentication error handling for Cline provider to show clearer error messages when not signed in and prevent recursive failed requests
- Remove incorrect pricing display for SAP AI Core provider since it uses non-USD "Capacity Units" that cannot be directly converted (Thanks @ncryptedV1!)

## [3.18.8]

- Update pricing for Grok 3 model because the promotion ended

## [3.18.7]

- Remove promotional "free" messaging for Grok 3 model in UI

## [3.18.6]

- Update request header to include `"ai-client-type": "Cline"` to SAP Api Provider
- Add organization accounts

## [3.18.5]

- Fix Plan/Act mode persistence across sessions and multi-workspace conflicts
- Improve provider switching performance by 18x (from 550ms to 30ms) with batched storage operations
- Improve SAP AI Core provider model organization and fix exception handling (Thanks @schardosin!)

## [3.18.4]

- Add support for Gemini 2.5 Pro and Flash to SAP AI Core Provider
- Fix logging in with Cline account not getting past welcome screen

## [3.18.3]

- Improve Cerebras Qwen model performance by removing thinking tokens from model input (Thanks @kevint-cerebras!)
- Improve Claude Code provider with better error handling and performance optimizations (Thanks @BarreiroT!)

## [3.18.2]

- Fix issue where terminal output would not be captured if shell integration fails by falling back to capturing the terminal content.
- Add confirmation popup when deleting tasks
- Add support for Claude Sonnet 4 and Opus 4 model in SAP AI Core provider (Thanks @lizzzcai!)
- Add support for `litellm_session_id` to group requests in a single session (Thanks @jorgegarciarey!)
- Add "Thinking Budget" customization for Claude Code (Thanks @BarreiroT!)
- Fix issue where the extension would use the user's environment variables for authentication when using Claude Code (Thanks @BarreiroT!)

## [3.18.1]

- Add support for Claude 4 Sonnet in SAP AI Core provider (Thanks @GTxx!)
- Fix ENAMETOOLONG error when using Claude Code provider with long conversation histories (Thanks @BarreiroT!)
- Remove Gemini CLI provider because Google asked us to
- Fix bug with "Delete All Tasks" functionality

## [3.18.0]

- Optimized Cline to work with the Claude 4 family of models, resulting in improved performance, reliability, and new capabilities
- Added a new Gemini CLI provider that allows you to use your local Gemini CLI authentication to access Gemini models for free (Thanks @google-gemini!)
- Optimized Cline to work with the Gemini 2.5 family of models
- Updated the default and recommended model to Claude 4 Sonnet for the best performance
- Fix race condition in Plan/Act mode switching
- Improve robustness of search and replace parsing

## [3.17.16]

- Fix Claude Code provider error handling for incomplete messages during long-running tasks (Thanks @BarreiroT!)
- Add taskId as metadata to LiteLLM API requests for better request tracing (Thanks @jorgegarciarey!)

## [3.17.15]

- Fix LiteLLM provider to properly respect selected model IDs when switching between Plan and Act modes (Thanks @sammcj!)
- Fix chat input being cleared when switching between Plan/Act modes without sending a message (Thanks @BarreiroT!)
- Fix MCP server name display to avoid showing "undefined" for SSE servers, preventing tool/resource invocation failures (Thanks @ramybenaroya!)
- Fix AWS Bedrock provider by removing deprecated custom model encoding (Thanks @watany-dev!)
- Fix timeline tooltips for followup messages and improve color retrieval code (Thanks @char8x!)
- Improve accessibility by making task header buttons properly announced by screen readers (Thanks @yncat!)
- Improve accessibility by adding proper state reporting for Plan/Act mode switch for screen readers (Thanks @yncat!)
- Prevent reading development environment variables from user's environment (Thanks @BarreiroT!)

## [3.17.14]

- Add Claude Code as a new API provider, allowing integration with Anthropic's Claude Code CLI tool and Claude Max Plan (Thanks @BarreiroT!)
- Add SAP AI Core as a new API provider with support for Claude and GPT models (Thanks @schardosin!)
- Add configurable default terminal profile setting, allowing users to specify which terminal Cline should use (Thanks @valinha!)
- Add terminal output size constraint setting to limit how much terminal output is processed
- Add MCP Rich Display settings to the settings page for persistent configuration (Thanks @Vl4diC0de!)
- Improve copy button functionality with refactored reusable components (Thanks @shouhanzen!)
- Improve AWS Bedrock provider by removing deprecated dependency and using standard AWS SDK (Thanks @watany-dev!)
- Fix list_files tool to properly return files when targeting hidden directories
- Fix search and replace edge case that could cause file deletion, making the algorithm more lenient for models using different diff formats
- Fix task restoration issues that could occur when resuming interrupted tasks
- Fix checkpoint saving to properly track all file changes
- Improve file context warnings to reduce diff edit errors when resuming restored tasks
- Clear chat input when switching between Plan/Act modes within a task
- Exclude .clinerules files from checkpoint tracking

## [3.17.13]

- Add Thinking UX for Gemini models, providing visual feedback during model reasoning
- Add support for Notifications MCP integration with Cline
- Add prompt caching indicator for Grok 3 models
- Sort MCP marketplace by newest listings by default for easier discovery of recent servers
- Update O3 model family pricing to reflect latest OpenAI rates
- Remove '-beta' suffix from Grok model identifiers
- Fix AWS Bedrock provider by removing deprecated Anthropic-Bedrock SDK (Thanks @watany-dev!)
- Fix menu display issue for terminal timeout settings
- Improve chat input field styling and behavior

## [3.17.12]

- **Free Grok Model Available!** Access Grok 3 completely free through the Cline provider
- Add collapsible MCP response panels to keep conversations focused on the main AI responses while still allowing access to detailed MCP output (Thanks @valinha!)
- Prioritize active files (open tabs) at the top of the file context menu when using @ mentions (Thanks @abeatrix!)
- Fix context menu to properly default to "File" option instead of incorrectly selecting "Git Commits"
- Fix diff editing to handle out-of-order SEARCH/REPLACE blocks, improving reliability with models that don't follow strict ordering
- Fix telemetry warning popup appearing repeatedly for users who have telemetry disabled

## [3.17.11]

- Add support for Gemini 2.5 Pro Preview 06-05 model to Vertex AI and Google Gemini providers

## [3.17.10]

- Add support for Qwen 3 series models with thinking mode options (Thanks @Jonny-china!)
- Add new AskSage models: Claude 4 Sonnet, Claude 4 Opus, GPT 4.1, Gemini 2.5 Pro (Thanks @swhite24!)
- Add VSCode walkthrough to help new users get started with Cline
- Add support for streamable MCP servers
- Improve Ollama model selection with filterable dropdown instead of radio buttons (Thanks @paulgear!)
- Add setting to disable aggressive terminal reuse to help users experiencing task lockout issues
- Fix settings dialog applying changes even when cancel button is clicked

## [3.17.9]

- Aligning Cline to work with Claude 4 model family (Experimental)
- Add task timeline scrolling feature
- Add support for uploading CSV and XLSX files for data analysis and processing
- Add stable Grok-3 models to xAI provider (grok-3, grok-3-fast, grok-3-mini, grok-3-mini-fast) and update default model from grok-3-beta to grok-3 (Thanks @PeterDaveHello!)
- Add new models to Vertex AI provider
- Add new model to Nebius AI Studio
- Remove hard-coded temperature from LM Studio API requests and add support for reasoning_content in LM Studio responses
- Display delay information when retrying API calls for better user feedback
- Fix AWS Bedrock credential caching issue where externally updated credentials (e.g., by AWS Identity Manager) were not detected, requiring extension restart (Thanks @DaveFres!)
- Fix search tool overloading conversation with massive outputs by setting maximum byte limit for responses
- Fix checkpoints functionality
- Fix token counting for xAI provider
- Fix Ollama provider issues
- Fix window title display for Windows users
- Improve chat box UI

## [3.17.8]

- Fix bug where terminal would get stuck and output "capture failure"

## [3.17.7]

- Fix diff editing reliability for Claude 4 family models by adding constraints to prevent errors with large replacements

## [3.17.6]

- Add Cerebras as a new API provider with 5 high-performance models including reasoning-capable models (Thanks @kevint-cerebras!)
- Add support for uploading various file types (XML, JSON, TXT, LOG, MD, DOCX, IPYNB, PDF) alongside images
- Add improved onboarding experience for new users with guided setup
- Add prompt cache indicator for Gemini 2.5 Flash models
- Update SambaNova provider with new model list and documentation links (Thanks @luisfucros!)
- Fix diff editing support for Claude 4 family of models
- Improve telemetry and analytics for better user experience insights

## [3.17.5]

- Fix issue with Claude 4 models where after several conversation turns, it would start making invalid diff edits

## [3.17.4]

- Fix thinking budget slider for Claude 4

## [3.17.3]

- Fix diff edit errors with Claude 4 models

## [3.17.2]

- Add support for Claude 4 models (Sonnet 4 and Opus 4) in AWS Bedrock and Vertex AI providers
- Add support for global workflows, allowing workflows to be shared across workspaces with local workflows taking precedence
- Fix settings page z-index UI issues that caused display problems
- Fix AWS Bedrock environment variable handling to properly restore process.env after API calls (Thanks @DaveFres!)

## [3.17.1]

- Add prompt caching for Claude 4 models on Cline and OpenRouter providers
- Increase max tokens for Claude Opus 4 from 4096 to 8192

## [3.17.0]

- Add support for Anthropic Claude Sonnet 4 and Claude Opus 4 in both Anthropic and Vertex providers
- Add integration with Nebius AI Studio as a new provider (Thanks @Aktsvigun!)
- Add custom highlight and hotkey suggestion when the assistant prompts to switch to Act mode
- Update settings page design, now split into tabs for easier navigation (Thanks Yellow Bat @dlab-anton, and Roo Team!)
- Fix MCP Server configuration bug
- Fix model listing for Requesty provider
- Move all advanced settings to settings page

## [3.16.3]

- Add devstral-small-2505 to the Mistral model list, a new specialized coding model from Mistral AI (Thanks @BarreiroT!)
- Add documentation links to rules & workflows UI
- Add support for Streameable HTTP Transport for MCPs (Thanks @alejandropta!)
- Improve error handling for Mistral SDK API

## [3.16.2]

- Add support for Gemini 2.5 Flash Preview 05-20 model to Vertex AI provider with massive 1M token context window (Thanks @omercelik!)
- Add keyboard shortcut (Cmd+') to quickly focus Cline from anywhere in VS Code
- Add lightbulb actions for selected text with options to "Add to Cline", "Explain with Cline", and "Improve with Cline"
- Automatically focus Cline window after extension updates

## [3.16.1]

- Add Enable auto approve toggle switch, allowing users to easily turn auto-approve functionality on or off without losing their action settings
- Improve Gemini retry handling with better UI feedback, showing retry progress during API request attempts
- Fix memory leak issue that could occur during long sessions with multiple tasks
- Improve UI for Gemini model retry attempts with clearer status updates
- Fix quick actions functionality in auto-approve settings
- Update UI styling for auto-approve menu items to conserve space

## [3.16.0]

- Add new workflow feature allowing users to create and manage workflow files that can be injected into conversations via slash commands
- Add collapsible recent task list, allowing users to hide their task history when sharing their screen (Thanks @cosmix!)
- Add global endpoint option for Vertex AI users, providing higher availability and reducing 429 errors (Thanks @soniqua!)
- Add detection for new users to display special components and guidance
- Add Tailwind CSS IntelliSense to the recommended extensions list
- Fix eternal loading states when the last message is a checkpoint (Thanks @BarreiroT!)
- Improve settings organization by migrating VSCode Advanced settings to Settings Webview

## [3.15.5]

- Fix inefficient memory management in the task timeline
- Fix Gemini rate limitation response not being handled properly (Thanks @BarreiroT!)

## [3.15.4]

- Add gemini model back to vertex provider
- Add gemini telemetry
- Add filtering for tasks tied to the current workspace

## [3.15.3]

- Add Fireworks API Provider
- Fix minor visual issues with auto-approve menu
- Fix one instance of terminal not getting output
- Fix 'Chrome was launched but debug port is not responding' error

## [3.15.2]

- Added details to auto approve menu and more sensible default controls
- Add detailed configuration options for LiteLLM provider
- Add webview telemetry for users who have opted in to telemetry
- Update Gemini in OpenRouter/Cline providers to use implicit caching
- Fix freezing issues during rendering of large streaming text
- Fix grey screen webview crashes by releasing memory after every diff edit
- Fix breaking out of diff auto-scroll
- Fix IME composition Enter auto‑sending edited message

## [3.15.1]

- Fix bug where PowerShell commands weren't given enough time before giving up and showing an error

## [3.15.0]

- Add Task Timeline visualization to tasks (Thanks eomcaleb!)
- Add cache to ui for OpenAi provider
- Add FeatureFlagProvider service for the Node.js extension side
- Add copy buttons to task header and assistant messages
- Add a more simplified home header was added
- Add ability to favorite a task, allowing it to be kept when clearing all tasks
- Add npm script for issue creation (Thanks DaveFres!)
- Add confirmation dialog to Delete All History button
- Add ability to allow the user to type their next message into the chat while Cline is taking action
- Add ability to generate commit message via cline (Thanks zapp88!)
- Add improvements to caching for gemini models on OpenRouter and Cline providers
- Add improvements to allow scrolling the file being edited.
- Add ui for windsurf and cursor rules
- Add mistral medium-3 model
- Add option to collect events to send them in a bundle to avoid sending too many events
- Add support to quote a previous message in chat
- Add support for Gemini Implicit Caching
- Add support for batch selection and deletion of tasks in history (Thanks danix800!)
- Update change suggested models
- Update fetch cache details from generation endpoint
- Update converted docs to Mintlify
- Update the isOminiModel to include o4-mini model (Thanks PeterDaveHello!)
- Update file size that can be read by Cline, allowing larger files
- Update defaults for bedrock API models (Thanks Watany!)
- Update to extend ReasoningEffort to non-o3-mini reasoning models for all providers (Thanks PeterDaveHello!)
- Update to give error when a user tries to upload an image larger than 7500x7500 pixels
- Update announcement so that previous updates are in a dropdown
- Update UI for auto approve with favorited settings
- Fix bug where certain terminal commands would lock you out of a task
- Fix only initialize posthog in the webview if the user has opted into telemetry
- Fix bug where autocapture was on for front-end telemetry
- Fix for markdown copy excessively escaping characters (Thanks weshoke!)
- Fix an issue where loading never finished when using an application inference profile for the model ID (Thanks WinterYukky!)

## [3.14.1]

- Disables autocaptures when initializing feature flags

## [3.14.0]

- Add support for custom model ID in AWS Bedrock provider, enabling use of Application Inference Profile (Thanks @clicube!)
- Add more robust caching & cache tracking for gemini & vertex providers
- Add support for LaTeX rendering
- Add support for custom API request timeout. Timeouts were 15-30s, but can now be configured via settings for OpenRouter/Cline & Ollama (Thanks @WingsDrafterwork!)
- Add truncation notice when truncating manually
- Add a timeout setting for the terminal connection, allowing users to set a time to wait for terminal startup
- Add copy button to code blocks
- Add copy button to markdown blocks (Thanks @weshoke!)
- Add checkpoints to more messages
- Add slash command to create a new rules file (/newrule)
- Add cache ui for open router and cline provider
- Add Amazon Nova Premier model to Bedrock (Thanks @watany!)
- Add support for cursorrules and windsurfrules
- Add support for batch history deletion (Thanks @danix800!)
- Improve Drag & Drop experience
- Create clinerules folder when creating new rule if it's needed
- Enable pricing calculation for gemini and vertex providers
- Refactor message handling to not show the MCP View of the server modal
- Migrate the addRemoteServer to protobus (Thanks @DaveFres!)
- Update task header to be expanded by default
- Update Gemini cache TTL time to 15 minutes
- Fix race condition in terminal command usage
- Fix to correctly handle `import.meta.url`, avoiding leading slash in pathname for Windows (Thanks @DaveFres!)
- Fix @withRetry() decoration syntax error when running extension locally (Thanks @DaveFres!)
- Fix for git commit mentions in repos with no git commits
- Fix cost calculation (Thanks @BarreiroT!)

## [3.13.3]

- Add download counts to MCP marketplace items
- Add `/compact` command
- Add prompt caching to gemini models in cline / openrouter providers
- Add tooltips to bottom row menu

## [3.13.2]

- Add Gemini 2.5 Flash model to Vertex and Gemini Providers (Thanks monotykamary!)
- Add Caching to gemini provider (Thanks arafatkatze!)
- Add thinking budget support to Gemini Models (Thanks monotykamary!)
- Add !include .file directive support for .clineignore (Thanks watany-dev!)
- Improve slash command functionality
- Improve prompting for new task tool
- Fix o1 temperature being passed to the azure api (Thanks treeleaves30760!)
- Fix to make "add new rule file" button functional
- Fix Ollama provider timeout, allowing for a larger loading time (Thanks suvarchal!)
- Fix Non-UTF-8 File Handling: Improve Encoding Detection to Prevent Garbled Text and Binary Misclassification (Thanks yt3trees!)
- Fix settings to not reset by changing providers
- Fix terminal outputs missing commas
- Fix terminal errors caused by starting non-alphanumeric outputs
- Fix auto approve settings becoming unset
- Fix Mermaid syntax error in documentation (Thanks tuki0918!)
- Remove supportsComputerUse restriction and support browser use through any model that supports images (Thanks arafatkatze!)

## [3.13.1]

- Fix bug where task cancellation during thinking stream would result in error state

## [3.13.0]

- Add Cline rules popover under the chat field, allowing you to easily add, enable & disable workspace level or global rule files
- Add new slash command menu letting you type “/“ to do quick actions like creating new tasks
- Add ability to edit past messages, with options to restore your workspace back to that point
- Allow sending a message when selecting an option provided by the question or plan tool
- Add command to jump to Cline's chat input
- Add support for OpenAI o3 & 4o-mini (Thanks @PeterDaveHello and @arafatkatze!)
- Add baseURL option for Google Gemini provider (Thanks @owengo and @olivierhub!)
- Add support for Azure's DeepSeek model. (Thanks @yt3trees!)
- Add ability for models that support it to receive image responses from MCP servers (Thanks @rikaaa0928!)
- Improve search and replace diff editing by making it more flexible with models that fail to follow structured output instructions. (Thanks @chi-cat!)
- Add detection of Ctrl+C termination in terminal, improving output reading issues
- Fix issue where some commands with large output would cause UI to freeze
- Fix token usage tracking issues with vertex provider (Thanks @mzsima!)
- Fix issue with xAI reasoning content not being parsed (Thanks @mrubens!)

## [3.12.3]

- Add copy button to MermaidBlock component (Thanks @cacosub7!)
- Add the ability to fetch from global cline rules files
- Add icon to indicate when a file outside of the users workspace is edited

## [3.12.2]

- Add gpt-4.1

## [3.12.1]

- Use visual checkpoint indicator to make it clear when checkpoints are created
- Big shoutout to @samuel871211 for numerous code quality improvements, refactoring contributions, and webview performance improvements!
- Use improved context manager

## [3.12.0]

- Add favorite toggles for models when using the Cline & OpenRouter providers
- Add auto-approve options for edits/reads outside of the workspace
- Improve diff editing animation for large files
- Add indicator showing number of diff edits when Cline edits a file
- Add streaming support and reasoning effort option to xAI's Grok 3 Mini
- Add settings button to MCP popover to easily modify installed servers
- Fix bug where browser tool actions would show unparsed results in the chat view
- Fix issue with new checkpoints popover hiding too quickly
- Fix duplicate checkpoints bug
- Improve Ollama provider with retry mechanism, timeout handling, and improved error handling (thanks suvarchal!)

## [3.11.0]

- Redesign checkpoint UI to declutter chat view by using a subtle indicator line that expands to a popover on hover, with a new date indicator for when it was created
- Add support for xAI's provider's Grok 3 models
- Add more robust error tracking for users opted in to telemetry (thank you for helping us make Cline better!)

## [3.10.1]

- Add CMD+' keyboard shortcut to add selected text to Cline
- Cline now auto focuses the text field when using 'Add to Cline' shortcut
- Add new 'Create New Task' tool to let Cline start a new task autonomously!
- Fix Mermaid diagram issues
- Fix Gemini provider cost calculation to take new tiered pricing structure into account

## [3.10.0]

- Add setting to let browser tool use local Chrome via remote debugging, enabling session-based browsing. Replaces sessionless Chromium, unlocking debugging and productivity workflows tied to your real browser state.
- Add new auto-approve option to approve _ALL_ commands (use at your own risk!)
- Add modal in the chat area to more easily enable or disable MCP servers
- Add drag and drop of file/folders into cline chat (Thanks eljapi!)
- Add prompt caching for LiteLLM + Claude (Thanks sammcj!)
- Add Improved context management
- Fix MCP auto approve toggle issues being out of sync with settings

## [3.9.2]

- Add recommended models for Cline provider
- Add ability to detect when user edits files manually so Cline knows to re-read, leading to reduced diff edit errors
- Add improvements to file mention searching for faster searching
- Add scoring logic to file mentions to sort and exclude results based on relevance
- Add Support for Bytedance Doubao (Thanks Tunixer!)
- Fix to prevent duplicate BOM (Thanks bamps53!)

## [3.9.1]

- Add Gemini 2.5 Pro Preview 03-25 to Google Provider

## [3.9.0]

- Add Enable extended thinking for LiteLLM provider (Thanks @jorgegarciarey!)
- Add a tab for configuring local MCP Servers
- Fix issue with DeepSeek API provider token counting + context management
- Fix issues with checkpoints hanging under certain conditions

## [3.8.6]

- Add UI for adding remote servers
- Add Mentions Feature Guide and update related documentation
- Fix bug where menu would open in sidebar and open tab
- Fix issue with Cline accounts not showing user info in popout tabs
- Fix bug where menu buttons wouldn't open view in sidebar

## [3.8.5]

- Add support for remote MCP Servers using SSE
- Add gemini-2.5-pro-exp-03-25 to Vertex AI (thanks @arri-cc!)
- Add access to history, mcp, and new task buttons in popout view
- Add task feedback telemetry (thumbs up/down on task completion)
- Add toggle disabled for remote servers
- Move the MCP Restart and Delete buttons and add an auto-approve all toggle
- Update Requestly UX for model selection (thanks @arafatkatze!)
- Add escape for html content for gemini when running commands
- Improve search and replace edit failure behaviors

## [3.8.4]

- Add Sambanova Deepseek-V3-0324
- Add cost calculation support for LiteLLM provider
- Fix bug where Cline would use plan_mode_response bug without response parameter

## [3.8.3]

- Add support for SambaNova QwQ-32B model
- Add OpenAI "dynamic" model chatgpt-4o-latest
- Add Amazon Nova models to AWS Bedrock
- Improve file handling for NextJS folder naming (fixes issues with parentheses in folder names)
- Add Gemini 2.5 Pro to Google AI Studio available models
- Handle "input too large" errors for Anthropic
- Fix "See more" not showing up for tasks after task un-fold
- Fix gpt-4.5-preview's supportsPromptCache value to true

## [3.8.2]

- Fix bug where switching to plan/act would result in VS Code LM/OpenRouter model being reset

## [3.8.0]

- Add 'Add to Cline' as an option when you right-click in a file or the terminal, making it easier to add context to your current task
- Add 'Fix with Cline' code action - when you see a lightbulb icon in your editor, you can now select 'Fix with Cline' to send the code and associated errors for Cline to fix. (Cursor users can also use the 'Quick Fix (CMD + .)' menu to see this option)
- Add Account view to display billing and usage history for Cline account users. You can now keep track of credits used and transaction history right in the extension!
- Add 'Sort underling provider routing' setting to Cline/OpenRouter allowing you to sort provider used by throughput, price, latency, or the default (combination of price and uptime)
- Improve rich MCP display with dynamic image loading and support for GIFs
- Add 'Documentation' menu item to easily access Cline's docs
- Add OpenRouter's new usage_details feature for more reliable cost reporting
- Display total space Cline takes on disk next to 'Delete all Tasks' button in History view
- Fix 'Context Window Exceeded' error for OpenRouter/Cline Accounts (additional support coming soon)
- Fix bug where OpenRouter model ID would be set to invalid value
- Add button to delete MCP servers in a failure state

## [3.7.1]

- Fix issue with 'See more' button in task header not showing when starting new tasks
- Fix issue with checkpoints using local git commit hooks

## [3.7.0]

- Cline now displays selectable options when asking questions or presenting a plan, saving you from having to type out responses!
- Add support for a `.clinerules/` directory to load multiple files at once (thanks @ryo-ma!)
- Prevent Cline from reading extremely large files into context that would overload context window
- Improve checkpoints loading performance and display warning for large projects not suited for checkpoints
- Add SambaNova API provider (thanks @saad-noodleseed!)
- Add VPC endpoint option for AWS Bedrock profiles (thanks @minorunara!)
- Add DeepSeek-R1 to AWS Bedrock (thanks @watany-dev!)

## [3.6.5]

- Add 'Delete all Task History' button to History view
- Add toggle to disable model switching between Plan/Act modes in Settings (new users default to disabled)
- Add temperature option to OpenAI Compatible
- Add Kotlin support to tree-sitter parser (thanks @fumiya-kume!)

## [3.6.3]

- Improve QwQ support for Alibaba (thanks @meglinge!) and OpenRouter
- Improve diff edit prompting to prevent immediately reverting to write_to_file when a model uses search patterns that don't match anything in the file
- Fix bug where new checkpoints system would revert file changes when switching between tasks
- Fix issue with incorrect token count for some OpenAI compatible providers

## [3.6.0]

- Add Cline API as a provider option, allowing new users to sign up and get started with Cline for free
- Optimize checkpoints with branch-per-task strategy, reducing storage required and first task load times
- Fix problem with Plan/Act toggle keyboard shortcut not working in Windows (thanks @yt3trees!)
- Add new Gemini models to GCP Vertex (thanks @shohei-ihaya!) and Claude models AskSage (thanks @swhite24!)
- Improve OpenRouter/Cline error reporting

## [3.5.1]

- Add timeout option to MCP servers
- Add Gemini Flash models to Vertex provider (thanks @jpaodev!)
- Add prompt caching support for AWS Bedrock provider (thanks @buger!)
- Add AskSage provider (thanks @swhite24!)

## [3.5.0]

- Add 'Enable extended thinking' option for Claude 3.7 Sonnet, with ability to set different budgets for Plan and Act modes
- Add support for rich MCP responses with automatic image previews, website thumbnails, and WolframAlpha visualizations
- Add language preference option in Advanced Settings
- Add xAI Provider Integration with support for all Grok models (thanks @andrewmonostate!)
- Fix issue with Linux XDG pointing to incorrect path for Document folder (thanks @jonatkinson!)

## [3.4.10]

- Add support for GPT-4.5 preview model

## [3.4.9]

- Add toggle to let users opt-in to anonymous telemetry and error reporting

## [3.4.6]

- Add support for Claude 3.7 Sonnet

## [3.4.0]

- Introducing MCP Marketplace! You can now discover and install the best MCP servers right from within the extension, with new servers added regularly
- Add mermaid diagram support in Plan mode! You can now see visual representations of mermaid code blocks in chat, and click on them to see an expanded view
- Use more visual checkpoints indicators after editing files & running commands
- Create a checkpoint at the beginning of each task to easily revert to the initial state
- Add 'Terminal' context mention to reference the active terminal's contents
- Add 'Git Commits' context mention to reference current working changes or specific commits (thanks @mrubens!)
- Send current textfield contents as additional feedback when toggling from Plan to Act Mode, or when hitting 'Approve' button
- Add advanced configuration options for OpenAI Compatible (context window, max output, pricing, etc.)
- Add Alibaba Qwen 2.5 coder models, VL models, and DeepSeek-R1/V3 support
- Improve support for AWS Bedrock Profiles
- Fix Mistral provider support for non-codestral models
- Add advanced setting to disable browser tool
- Add advanced setting to set chromium executable path for browser tool

## [3.3.2]

- Fix bug where OpenRouter requests would periodically not return cost/token stats, leading to context window limit errors
- Make checkpoints more visible and keep track of restored checkpoints

## [3.3.0]

- Add .clineignore to block Cline from accessing specified file patterns
- Add keyboard shortcut + tooltips for Plan/Act toggle
- Fix bug where new files won't show up in files dropdown
- Add automatic retry for rate limited requests (thanks @ViezeVingertjes!)
- Adding reasoning_effort support for o3-mini in Advanced Settings
- Added support for AWS provider profiles using the AWS CLI to make the profile, enabling long lived connections to AWS bedrock
- Adding Requesty API provider
- Add Together API provider
- Add Alibaba Qwen API provider (thanks @aicccode!)

## [3.2.13]

- Add new gemini models gemini-2.0-flash-lite-preview-02-05 and gemini-2.0-flash-001
- Add all available Mistral API models (thanks @ViezeVingertjes!)
- Add LiteLLM API provider support (thanks @him0!)

## [3.2.12]

- Fix command chaining for Windows users
- Fix reasoning_content error for OpenAI providers

## [3.2.11]

- Add OpenAI o3-mini model

## [3.2.10]

- Improve support for DeepSeek-R1 (deepseek-reasoner) model for OpenRouter, OpenAI-compatible, and DeepSeek direct (thanks @Szpadel!)
- Show Reasoning tokens for models that support it
- Fix issues with switching models between Plan/Act modes

## [3.2.6]

- Save last used API/model when switching between Plan and Act, for users that like to use different models for each mode
- New Context Window progress bar in the task header to understand increased cost/generation degradation as the context increases
- Localize READMEs and add language selector for English, Spanish, German, Chinese, and Japanese
- Add Advanced Settings to remove MCP prompts from requests to save tokens, enable/disable checkpoints for users that don't use git (more coming soon!)
- Add Gemini 2.0 Flash Thinking experimental model
- Allow new users to subscribe to mailing list to get notified when new Accounts option is available

## [3.2.5]

- Use yellow textfield outline in Plan mode to better distinguish from Act mode

## [3.2.3]

- Add DeepSeek-R1 (deepseek-reasoner) model support with proper parameter handling (thanks @slavakurilyak!)

## [3.2.0]

- Add Plan/Act mode toggle to let you plan tasks with Cline before letting him get to work
- Easily switch between API providers and models using a new popup menu under the chat field
- Add VS Code LM API provider to run models provided by other VS Code extensions (e.g. GitHub Copilot). Shoutout to @julesmons, @RaySinner, and @MrUbens for putting this together!
- Add on/off toggle for MCP servers to disable them when not in use. Thanks @MrUbens!
- Add Auto-approve option for individual tools in MCP servers. Thanks @MrUbens!

## [3.1.10]

- New icon!

## [3.1.9]

- Add Mistral API provider with codestral-latest model

## [3.1.7]

- Add ability to change viewport size and headless mode when Cline asks to launch the browser

## [3.1.6]

- Fix bug where filepaths with Chinese characters would not show up in context mention menu (thanks @chi-chat!)
- Update Anthropic model prices (thanks @timoteostewart!)

## [3.1.5]

- Fix bug where Cline couldn't read "@/" import path aliases from tool results

## [3.1.4]

- Fix issue where checkpoints would not work for users with git commit signing enabled globally

## [3.1.2]

- Fix issue where LFS files would be not be ignored when creating checkpoints

## [3.1.0]

- Added checkpoints: Snapshots of workspace are automatically created whenever Cline uses a tool
- Compare changes: Hover over any tool use to see a diff between the snapshot and current workspace state
- Restore options: Choose to restore just the task state, just the workspace files, or both
- New 'See new changes' button appears after task completion, providing an overview of all workspace changes
- Task header now shows disk space usage with a delete button to help manage snapshot storage

## [3.0.12]

- Fix DeepSeek API cost reporting (input price is 0 since it's all either a cache read or write, different than how Anthropic reports cache usage)

## [3.0.11]

- Emphasize auto-formatting done by the editor in file edit responses for more reliable diff editing

## [3.0.10]

- Add DeepSeek provider to API Provider options
- Fix context window limit errors for DeepSeek v3

## [3.0.9]

- Fix bug where DeepSeek v3 would incorrectly escape HTML entities in diff edits

## [3.0.8]

- Mitigate DeepSeek v3 diff edit errors by adding 'auto-formatting considerations' to system prompt, encouraging model to use updated file contents as reference point for SEARCH blocks

## [3.0.7]

- Revert to using batched file watcher to fix crash when many files would be created at once

## [3.0.6]

- Fix bug where some files would be missing in the `@` context mention menu
- Add Bedrock support in additional regions
- Diff edit improvements
- Add OpenRouter's middle-out transform for models that don't use prompt caching (prevents context window limit errors, but cannot be applied to models like Claude since it would continuously break the cache)

## [3.0.4]

- Fix bug where gemini models would add code block artifacts to the end of text content
- Fix context mention menu visual issues on light themes

## [3.0.2]

- Adds block anchor matching for more reliable diff edits (if 3+ lines, first and last line are used as anchors to search for)
- Add instruction to system prompt to use complete lines in diff edits to work properly with fallback strategies
- Improves diff edit error handling
- Adds new Gemini models

## [3.0.0]

- Cline now uses a search & replace diff based approach when editing large files to prevent code deletion issues.
- Adds support for a more comprehensive auto-approve configuration, allowing you to specify which tools require approval and which don't.
- Adds ability to enable system notifications for when Cline needs approval or completes a task.
- Adds support for a root-level `.clinerules` file that can be used to specify custom instructions for the project.

## [2.2.0]

- Add support for Model Context Protocol (MCP), enabling Cline to use custom tools like web-search tool or GitHub tool
- Add MCP server management tab accessible via the server icon in the menu bar
- Add ability for Cline to dynamically create new MCP servers based on user requests (e.g., "add a tool that gets the latest npm docs")

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
- Improves system prompt to guard against lazy edits (less "//rest of code here")

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
