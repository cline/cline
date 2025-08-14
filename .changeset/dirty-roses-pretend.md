---
"claude-dev": minor
---

Focus Chain Feature
• Context-aware todo list injection into system prompts based on task state, mode transitions, and reminder intervals
• Dynamic prompt generation with conditional instructions for Plan/Act mode switching and user-edited lists
• FocusChainManager class with file-based persistence, real-time watching, and enhanced TaskHeader UI with progress indicators
• Strategic context inclusion logic: Plan mode transitions, user edits, reminder intervals, and first-time task creation

Deep Planning Slash Command
• New /deep-planning command for structured 4-step implementation planning workflow
• Integration with Focus Chain for automatic progress tracking in created tasks
• Comprehensive prompting system for silent investigation, discussion, plan creation, and task generation

Telemetry
• Focus Chain usage tracking and Deep planning workflow analytics

Feature Flags
• PostHog remote feature flag integration for Focus Chain gradual rollout
