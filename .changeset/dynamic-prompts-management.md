---
"@cline/cline": minor
---

Add dynamic system prompts management system that allows users to create, manage, and switch between custom system prompts through a VSCode settings interface.

### Features
- File-based prompt storage in `~/.cline/system-prompts/`
- Simple `.active` file tracking system
- Clean UI integration in Settings > Custom Prompts
- Two options: Cline Default or custom prompts
- Comprehensive documentation and examples

### Changes
- Core Logic: Rewrote SystemPromptsManager with .active file approach
- API Controllers: Added handlers for list, activate, and open folder operations
- UI Integration: New CustomPromptsSection component with proper message passing
- Communication: Extended ExtensionMessage type for custom prompts
- Documentation: Complete README with examples and troubleshooting

### Security & Performance
- File system access with proper validation and path traversal prevention
- Input sanitization and size limits (100KB max)
- 500ms caching for prompt scanning and lazy loading
- Graceful error handling with fallback to default
- No breaking changes to existing API
