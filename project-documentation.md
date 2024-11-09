# Cline Project Documentation

## Overview
Cline is a VSCode extension that provides an autonomous coding agent capable of creating/editing files, running commands, using the browser, and more with user permission every step of the way. The extension integrates with multiple AI providers and implements a human-in-the-loop approach for safe automation.

## Core Architecture

### Extension Core
- Main extension entry point (`extension.ts`) handling activation and command registration
- ClineProvider managing webview UI and state
- Core Cline class implementing AI assistant logic
- Human-in-the-loop approval system for all operations

### API Integration
- Multiple provider support:
  - Anthropic (Claude 3.5 Sonnet with prompt caching)
  - OpenAI/Azure OpenAI
  - OpenRouter (multi-model support)
  - Google Gemini
  - AWS Bedrock
  - Local models via Ollama
- Stream handling for real-time responses
- Token usage and cost tracking
- Prompt caching system with breakpoint optimization
- Automatic context window management
- Efficient token usage through sliding window conversations

## Tools System

### File Operations
- Create and edit files with diff view
- Read file contents with binary file support
- Search files using regex with context
- List files and directories
- Parse code definitions using tree-sitter
- Automatic directory creation
- File change validation and safety checks
- Timeline tracking for all modifications

### Terminal Integration
- Advanced shell integration with VSCode
- Command execution and output streaming
- Process state management
- Background task handling
- Terminal pooling and reuse
- Output formatting and sanitization
- Error recovery mechanisms
- Shell integration feature detection
- Known Limitations:
  - Shell integration may have formatting issues with commas
  - Some commands may require specific environment setup
  - Background processes require manual termination
  - Output streaming may have delays

### Browser Automation
- Headless browser control via Puppeteer
- Screenshot capture
- Console log monitoring
- Mouse/keyboard interaction
- Navigation and scrolling
- Page state monitoring
- Error handling and recovery
- Session cleanup
- Known Limitations:
  - Fixed viewport size (900x600)
  - Single browser instance at a time
  - Must close browser before using other tools
  - Limited to basic interactions (click, type, scroll)

### Context Management
- Maintains conversation history
- Handles token limits
- Supports prompt caching
- Manages environment details
- Workspace tracking
- Diagnostic monitoring
- Terminal state tracking

## User Interface

### Chat Interface
- Real-time message streaming
- Message grouping and combining
- Expandable/collapsible message rows
- Syntax highlighting for code
- Markdown rendering
- Image thumbnails
- Progress indicators
- Virtual scrolling
- Auto-scrolling with user override

### Message Types
- API Request messages
- Command execution messages
- Tool usage messages
- User feedback messages
- Error messages
- Completion results
- Browser session messages
- File operation messages

### Visual Components
- Syntax highlighting
- Diff view for file changes
- Code accordions
- Terminal output formatting
- Progress indicators
- Status badges
- Browser session previews
- Accessibility support

## Settings Management

### API Configuration
- Multiple provider support
- API key management
- Model selection
- Base URL configuration
- Validation system
- Error handling
- Rate limiting support
- Fallback mechanisms

### User Preferences
- Custom instructions support
- Read-only operation settings
- Theme integration
- State persistence
- Debug options
- Accessibility settings
- Performance tuning

## History Management

### Task History Features
- Chronological task tracking
- Token usage monitoring
- Cost tracking
- Cache performance metrics
- Task metadata storage
- Export capabilities
- Search functionality

### History View
- Virtual scrolling
- Fuzzy search
- Multiple sorting options:
  - Newest/Oldest
  - Most expensive
  - Most tokens used
  - Most relevant
- Task deletion
- Task export
- Task resumption
- State persistence

## State Management

### Persistent Storage
- Settings storage
- Task history
- API configurations
- User preferences
- Conversation state
- Cache management
- Diagnostic history
- Terminal state

### Security Features
- Secure API key storage
- File operation safeguards
- Command execution controls
- Error handling and recovery
- Path normalization
- Content Security Policy
- Input validation
- Output sanitization

## Development Features

### Code Organization
- TypeScript throughout
- Modular architecture
- Clear separation of concerns
- React-based UI
- Comprehensive API abstraction
- Error boundaries
- Performance monitoring
- Testing infrastructure

### Performance Optimizations
- Virtual scrolling
- Message combining
- Prompt caching with the following features:
  - System prompt caching
  - Message history caching
  - Cache breakpoint optimization
  - Automatic cache invalidation
  - Token usage optimization
- Efficient file monitoring
- Resource cleanup
- Tree-sitter caching (planned)
- Memory management
- Token window optimization

## Integration Features

### VSCode Integration
- Command registration
- File system access
- Diagnostic system
- Terminal integration
- Editor integration
- Theme support
- Extension API usage
- Workspace management

### External Tools
- Browser automation (Puppeteer)
- Tree-sitter for code parsing
- Shell integration
- Multiple API providers
- File system operations
- Diagnostic tools
- Performance profiling
- Security scanning

## Error Handling

### Diagnostic Management
- Real-time error tracking
- Error severity filtering
- Diagnostic change detection
- Timeout handling
- Error context preservation
- Recovery mechanisms
- Reporting system
- User notification

### Content Processing
- Binary file handling
- File access error management
- URL fetch error handling
- Content parsing error handling
- Browser automation error recovery
- Terminal output processing
- Input validation
- Output sanitization

## Best Practices

### Code Quality
- TypeScript for type safety
- React for UI components
- Modular architecture
- Clear separation of concerns
- Comprehensive error handling
- Code style consistency
- Documentation standards
- Testing requirements

### Security
- Human-in-the-loop approvals
- Secure API key storage
- File operation safeguards
- Command execution controls
- Path normalization
- Content Security Policy implementation
- Input validation requirements
- Output sanitization standards

### Performance
- Virtual scrolling implementation
- Message combining strategies
- Prompt caching guidelines
- Efficient file monitoring
- Resource cleanup procedures
- Memory management best practices
- Token usage optimization
- Cache management strategies

## Contributing
The project is open source and welcomes contributions. Contributors can:
- Explore open issues
- Submit feature requests
- Join the Discord community
- Share ideas and feedback
- Help improve documentation
- Follow code quality guidelines
- Add test coverage
- Report security issues

## License
Apache 2.0 © 2024 Cline Bot Inc.
