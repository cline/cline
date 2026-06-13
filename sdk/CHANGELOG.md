# Cline SDK Changelog

## 0.0.47

- Added support for overriding the API base URL
- Added bounded provider-request media budgeting so invalid or oversized media is omitted instead of sending corrupt base64 or unbounded payloads
- Enforced a production singleton Cline Hub so only one hub daemon runs, and a stale hub is respawned after an upgrade
- Allowed plugin chat commands to submit prompts to the agent
- Fixed truncation of structured tool operation result strings so oversized tool output stays within limits
- Stopped echoing the full command text in run_commands tool results

## 0.0.46

- Added support for configured agents as subagent tools
- Centralized OAuth management into the SDK
- Added Vertex GCP settings configuration
- Fixed the Azure Foundry API version for the CLI
- Fixed an error caused by disabled reasoning on Fable 5

## 0.0.45

- Added support for the Claude Fable 5 model
- Fixed MiniMax M3 thinking controls so they route correctly across gateways

## 0.0.44

- Added support for Vertex AI Application Default Credentials (ADC) with tool use
- Added a global auto-update setting for CLI startup updates
- Fixed empty message content replay for Bedrock
- Cleaned up the OpenAI Codex model list

## 0.0.43

- Added the Cline Hub web app for managing and monitoring agent sessions
- Added plugin uninstall support
- Added skills bundled with plugins, including grouping plugin skills in settings and rule contributions from sandboxed plugins
- Added support for global AGENTS rules
- Added Slack socket mode support and bound Discord sessions to individual message authors
- Synced the Fireworks AI model registry and updated the model catalog to current platform offerings
- Routed custom registered handlers through the agent runtime
- Added a CLINE_PLUGIN_IMPORT_TIMEOUT_MS environment override for plugin import timeouts
- Allowed a baseUrl field for Anthropic vendor-type providers
- Fixed SAP AI Core to use the AI SDK community provider
- Fixed the hub daemon to stay alive on runtime abort
- Fixed read-files tool input validation to use a union schema
- Fixed discovery of symlinked SDK skill directories
- Improved Cline provider migration
- Fixed OTEL variable bundling
- Added telemetry for run_commands timeouts

## 0.0.42

- Supports Bedrock bearer API keys, direct IAM credentials, AWS profiles, and the default AWS SDK credential chain
- Routes Z.AI GLM thinking through provider metadata while preserving generic thinking suppression for non-GLM Z.AI custom models
