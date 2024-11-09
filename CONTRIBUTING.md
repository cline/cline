# Contributing to Cline

Thank you for your interest in contributing to Cline! This guide will help you understand our development process and how you can contribute effectively.

## Table of Contents
- [Development Setup](#development-setup)
- [Code Style Guide](#code-style-guide)
- [Testing Guidelines](#testing-guidelines)
- [Architecture Decisions](#architecture-decisions)
- [Pull Request Process](#pull-request-process)
- [Documentation Guidelines](#documentation-guidelines)

## Development Setup

1. Clone the repository *(Requires [git-lfs](https://git-lfs.com/))*:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Open the project in VSCode:
    ```bash
    code cline
    ```
3. Install dependencies for both extension and webview:
    ```bash
    npm run install:all
    ```
4. Launch by pressing `F5` to open a new VSCode window with the extension loaded.

Note: You may need to install the [esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) if you run into build issues.

## Code Style Guide

### TypeScript Guidelines

1. **Type Safety**
   - Use explicit types for function parameters and returns
   - Avoid `any` type unless absolutely necessary
   - Use interfaces for object shapes
   - Leverage union types for message handling

2. **Naming Conventions**
   - Use PascalCase for class names (e.g., `TerminalManager`, `BrowserSession`)
   - Use camelCase for variables and functions
   - Use ALL_CAPS for constants (e.g., `MAX_IMAGES_PER_MESSAGE`)
   - Use descriptive names that reflect purpose

3. **File Organization**
   - Group related functionality in directories (api, core, integrations)
   - Use index.ts files for clean exports
   - Keep files focused and manageable
   - Follow the established directory structure:
     ```
     src/
     ├── api/          # API provider implementations
     ├── core/         # Core extension functionality
     ├── integrations/ # VSCode integration features
     ├── services/     # Shared services
     └── utils/        # Utility functions
     ```

### React Components

1. **Component Structure**
   - Use functional components with hooks
   - Implement proper prop typing
   - Keep components focused on single responsibility
   - Extract reusable logic into custom hooks

2. **State Management**
   - Use ExtensionStateContext for global state
   - Keep state as local as possible using useState
   - Use useCallback for event handlers
   - Implement useMemo for expensive computations

3. **Performance Optimization**
   - Use virtualization for long lists (Virtuoso)
   - Implement proper memo usage
   - Handle scroll performance
   - Manage re-renders efficiently

4. **Event Handling**
   - Use proper event cleanup
   - Implement debouncing where needed
   - Handle VSCode message passing correctly
   - Manage async operations properly

## Testing Guidelines

### Current Testing Setup

The project currently has a basic test infrastructure that we're working to expand:

1. **Extension Tests**
   ```bash
   npm run test           # Run extension tests
   npm run test:webview   # Run webview tests
   ```

2. **Test Files Location**
   - Extension tests in `src/test/`
   - Webview tests in `webview-ui/src/test/`

3. **Areas to Test**
   - Extension activation
   - Command registration
   - API provider integration
   - Tool execution
   - Message handling

### Future Testing Goals

1. **Coverage Targets**
   - Implement comprehensive test suite
   - Add integration tests
   - Add unit tests for core functionality
   - Implement end-to-end testing

2. **Testing Standards**
   - Write descriptive test names
   - Test error scenarios
   - Mock external dependencies

2. **Coverage Requirements**
   - Minimum 80% coverage for new code
   - Focus on critical paths
   - Test edge cases
   - Include error scenarios

3. **Running Tests**
   ```bash
   npm run test           # Run all tests
   npm run test:watch    # Run tests in watch mode
   npm run test:coverage # Generate coverage report
   ```

### Integration Tests

1. **VSCode Extension Tests**
   - Test extension activation
   - Verify command registration
   - Test webview integration
   - Validate settings management

2. **API Integration Tests**
   - Test provider integrations
   - Verify streaming behavior
   - Test error handling
   - Validate rate limiting

## Architecture Decisions

### Extension Architecture

1. **Core Components**
   - Extension entry point manages activation and commands
   - ClineProvider handles webview and state
   - Core Cline class implements AI assistant logic
   - Tools system provides controlled automation

2. **State Management**
   - Use VSCode extension context for persistence
   - Implement proper cleanup on deactivation
   - Handle state restoration on activation
   - Maintain conversation history

3. **Security Considerations**
   - Implement human-in-the-loop approvals
   - Validate all file operations
   - Sanitize command inputs
   - Secure API key storage

### Tool System Design

1. **Tool Implementation**
   - Each tool must be self-contained
   - Implement proper error handling
   - Provide clear success/failure indicators
   - Document tool capabilities and limitations

2. **Tool Integration**
   - Tools must be approved by user
   - Tools should be atomic operations
   - Implement proper cleanup
   - Handle interruptions gracefully

## Pull Request Process

1. **Before Submitting**
   - Run `npm run compile` to verify build
   - Update documentation if needed
   - Test your changes
   - Follow code style guidelines
   - Add tests for new features
   - Ensure all tests pass


2. **PR Requirements**
   - Clear description of changes
   - Link to related issues
   - Include test coverage plan
   - Update CHANGELOG.md

3. **Review Process**
   - Address review comments
   - Keep PR scope focused
   - Maintain clean commit history
   - Update based on feedback

## Documentation Guidelines

1. **Code Documentation**
   - Use JSDoc for public APIs
   - Document complex logic
   - Keep comments current
   - Include examples

2. **Project Documentation**
   - Update README.md for user-facing changes
   - Maintain project-documentation.md
   - Document architectural decisions
   - Keep CHANGELOG.md updated

3. **Documentation Structure**
   - Clear and concise
   - Include examples
   - Keep formatting consistent
   - Update table of contents

## Getting Help

- Join our [Discord](https://discord.gg/cline) community
- Check existing [issues](https://github.com/cline/cline/issues)
- Review [discussions](https://github.com/cline/cline/discussions)
- Read our [wiki](https://github.com/cline/cline/wiki)

## License

By contributing to Cline, you agree that your contributions will be licensed under the [Apache 2.0 License](./LICENSE).
