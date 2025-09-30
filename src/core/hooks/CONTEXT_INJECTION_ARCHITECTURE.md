# Hook Context Injection Architecture

## Executive Summary

This document defines an architecturally mature approach for hook context modification injection, aligned with Cline's existing codebase patterns and designed to provide genuine value without external dependencies.

## Current State Assessment

### Implementation Status
- ✅ Context modification from hooks is injected into `userMessageContent`
- ✅ PreToolUse and PostToolUse hooks execute correctly
- ⚠️ Format uses simple prefix: `[Hook Context - PreToolUse]\n${text}`
- ⚠️ Example hooks are trivial demonstrations
- ⚠️ No clear guidance on practical use cases

### Codebase Context Patterns

Analysis of `src/core/prompts/` reveals consistent patterns:

1. **XML-Style Semantic Tags:**
   ```xml
   <explicit_instructions type="...">
   <error>
   <feedback>
   <file_content path="...">
   <thinking>
   ```

2. **System Message Prefixes:**
   ```
   [NOTE] ...
   [ERROR] ...
   [TASK RESUMPTION] ...
   [[NOTE]] ... (for critical notes)
   ```

3. **Structured Context Sections:**
   ```
   1. Primary Request:
      [Detailed description]
   2. Key Technical Concepts:
      - Concept 1
      - Concept 2
   ```

4. **Hierarchical Organization:**
   - Numbered sections for major topics
   - Bullet points for lists
   - Nested indentation for sub-items

## Architectural Design

### Core Principles

1. **Semantic Structure:** Use XML-like tags that convey meaning
2. **Consistency:** Follow existing codebase formatting patterns
3. **Clarity:** Make hook context easy for LLMs to parse and understand
4. **Purpose-Driven:** Each hook should have a clear, practical purpose
5. **Zero Dependencies:** Hooks should work with standard Unix tools only

### Context Injection Format

#### Current Format (Simplistic)
```
[Hook Context - PreToolUse]
Tool being executed: write_to_file
Workspace context: This is an example hook demonstrating context injection.
```

**Problems:**
- Doesn't follow codebase semantic patterns
- No clear structure for different types of context
- Simple prefix doesn't convey purpose
- Difficult to distinguish from other system messages

#### Proposed Format (Semantic)

```xml
<hook_context source="PreToolUse" type="workspace_rules">
Project: TypeScript React application
Tech Stack: React 18, TypeScript 5.3, Vite
Coding Standards:
- Use functional components with hooks
- Prefer const over let
- Use explicit return types
- Follow existing code patterns in src/
</hook_context>
```

**Advantages:**
- Semantic XML tags match codebase patterns
- Attributes provide metadata (source, type)
- Structured content is LLM-friendly
- Clear separation from other context
- Extensible for different context types

### Context Types

Define specific context types for different purposes:

1. **`workspace_rules`** - Project-specific guidelines and standards
2. **`file_operations`** - Track file modifications for auditing
3. **`security_check`** - Validation results or warnings
4. **`performance`** - Execution timing and metrics
5. **`development_state`** - Git branch, build status, etc.

### Injection Points

#### PreToolUse Context
**Placement:** Before tool execution, in `userMessageContent`
**Purpose:** Provide context that should influence tool behavior
**Examples:**
- Project coding standards
- Security/compliance constraints
- Current development state (git branch, etc.)
- Tool-specific guidance

#### PostToolUse Context
**Placement:** After tool execution, in `userMessageContent`
**Purpose:** Provide feedback about what just happened
**Examples:**
- Audit trail of file modifications
- Performance metrics
- Success/failure details
- Side effects to be aware of

## Implementation Strategy

### Phase 1: Update Context Injection Format

**File:** `src/core/task/ToolExecutor.ts`

**Current Code:**
```typescript
if (preToolUseResult.contextModification) {
    const contextText = preToolUseResult.contextModification.trim()
    if (contextText) {
        this.taskState.userMessageContent.push({
            type: "text",
            text: `[Hook Context - PreToolUse]\n${contextText}`,
        })
    }
}
```

**Proposed Code:**
```typescript
if (preToolUseResult.contextModification) {
    const contextText = preToolUseResult.contextModification.trim()
    if (contextText) {
        // Extract context type from first line if specified
        const lines = contextText.split('\n')
        const firstLine = lines[0]
        let contextType = 'general'
        let content = contextText
        
        // Check if first line specifies a type: "TYPE: content"
        const typeMatch = firstLine.match(/^([A-Z_]+):\s*(.*)/)
        if (typeMatch) {
            contextType = typeMatch[1].toLowerCase()
            content = [typeMatch[2], ...lines.slice(1)].filter(l => l.trim()).join('\n')
        }
        
        this.taskState.userMessageContent.push({
            type: "text",
            text: `<hook_context source="PreToolUse" type="${contextType}">\n${content}\n</hook_context>`,
        })
    }
}
```

This approach:
- Maintains backward compatibility (hooks without type prefix still work)
- Allows hooks to specify context type via first line (e.g., "WORKSPACE_RULES: ...")
- Wraps content in semantic XML tags
- Provides metadata via attributes

### Phase 2: Create Practical Example Hooks

Create hooks that demonstrate real value without external dependencies.

#### Example 1: Workspace Context (PreToolUse)
**Purpose:** Inject project-specific guidelines based on file structure
**File:** `.clinerules/hooks/PreToolUse`

```bash
#!/usr/bin/env bash
set -eu

input=$(cat)
tool=$(echo "$input" | jq -r '.preToolUse.toolName // "unknown"')

# Check if this is a file operation
if [[ "$tool" =~ ^(write_to_file|replace_in_file)$ ]]; then
    # Detect project type from files
    context="WORKSPACE_RULES: "
    
    if [ -f "package.json" ]; then
        context+="This is a Node.js project. "
        
        # Check for TypeScript
        if [ -f "tsconfig.json" ]; then
            context+="TypeScript is enabled - use proper types. "
        fi
        
        # Check for React
        if grep -q '"react"' package.json 2>/dev/null; then
            context+="React project - prefer functional components. "
        fi
    fi
    
    # Check for Python
    if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
        context+="Python project - follow PEP 8 style guidelines. "
    fi
    
    # Add coding standards if they exist
    if [ -f ".clinerules/coding-standards.md" ]; then
        context+="See .clinerules/coding-standards.md for project conventions."
    fi
    
    echo "{\"shouldContinue\": true, \"contextModification\": \"$context\"}"
else
    # For non-file operations, no context needed
    echo '{"shouldContinue": true}'
fi
```

#### Example 2: File Operation Audit (PostToolUse)
**Purpose:** Track file modifications for audit trail
**File:** `.clinerules/hooks/PostToolUse`

```bash
#!/usr/bin/env bash
set -eu

input=$(cat)
tool=$(echo "$input" | jq -r '.postToolUse.toolName // "unknown"')
success=$(echo "$input" | jq -r '.postToolUse.success // false')
params=$(echo "$input" | jq -r '.postToolUse.parameters // {}')

# Track file operations
if [[ "$tool" =~ ^(write_to_file|replace_in_file)$ ]] && [ "$success" = "true" ]; then
    path=$(echo "$params" | jq -r '.path // "unknown"')
    
    # Get current git branch if in a git repo
    branch="unknown"
    if git rev-parse --git-dir > /dev/null 2>&1; then
        branch=$(git branch --show-current 2>/dev/null || echo "detached")
    fi
    
    context="FILE_OPERATIONS: Modified $path on branch '$branch'. "
    context+="Remember to test these changes before committing."
    
    echo "{\"shouldContinue\": true, \"contextModification\": \"$context\"}"
else
    # For other tools or failed operations, minimal context
    echo '{"shouldContinue": true}'
fi
```

#### Example 3: Security Check (PreToolUse)
**Purpose:** Warn about potentially dangerous operations
**File:** `.clinerules/hooks/PreToolUse.security`

```bash
#!/usr/bin/env bash
set -eu

input=$(cat)
tool=$(echo "$input" | jq -r '.preToolUse.toolName // "unknown"')
params=$(echo "$input" | jq -r '.postToolUse.parameters // {}')

# Security checks for file operations
if [[ "$tool" =~ ^(write_to_file|replace_in_file)$ ]]; then
    path=$(echo "$params" | jq -r '.path // ""')
    
    # Check for sensitive file patterns
    if [[ "$path" =~ \.(env|key|pem|p12|pfx|secret|credential)$ ]]; then
        context="SECURITY_CHECK: Modifying sensitive file: $path. "
        context+="Ensure no secrets are committed. "
        context+="Consider using environment variables instead."
        echo "{\"shouldContinue\": true, \"contextModification\": \"$context\"}"
        exit 0
    fi
fi

# Check for dangerous commands
if [ "$tool" = "execute_command" ]; then
    command=$(echo "$params" | jq -r '.command // ""')
    
    # Warn about destructive commands
    if [[ "$command" =~ rm\ +-rf|sudo|chmod\ +777|>\ +/dev/ ]]; then
        context="SECURITY_CHECK: Potentially dangerous command detected. "
        context+="Command: $command. "
        context+="Review carefully before approval."
        echo "{\"shouldContinue\": true, \"contextModification\": \"$context\"}"
        exit 0
    fi
fi

# No security concerns
echo '{"shouldContinue": true}'
```

### Phase 3: Documentation Updates

Update documentation to explain:
1. New context injection format
2. How to specify context types
3. Best practices for hook authors
4. Examples of practical hooks

## Benefits of New Architecture

### For LLMs
1. **Better Parsing:** Semantic tags are easier to identify and extract
2. **Clear Attribution:** `source` attribute shows where context came from
3. **Type Awareness:** `type` attribute indicates context purpose
4. **Structured Content:** Organized format improves comprehension

### For Users
1. **Practical Examples:** Hooks that provide real value out-of-the-box
2. **No Dependencies:** Work with standard Unix tools (bash, jq, git)
3. **Extensible:** Easy to add custom context types
4. **Clear Purpose:** Each hook has a documented use case

### For Developers
1. **Consistent Patterns:** Follows existing codebase conventions
2. **Type Safety:** Context types can be validated
3. **Maintainable:** Clear separation of concerns
4. **Testable:** Structured format easier to test

## Migration Path

### Backward Compatibility
The proposed implementation maintains backward compatibility:
- Hooks without type prefix still work
- Old format `[Hook Context - ...]` still valid
- No breaking changes to existing hooks

### Recommended Upgrade Path
1. Deploy new context injection format
2. Update example hooks
3. Document new patterns
4. Users can migrate hooks at their pace

## Testing Strategy

### Unit Tests
1. Test context type extraction
2. Test XML formatting
3. Test backward compatibility
4. Test empty/invalid context handling

### Integration Tests
1. Test hooks in actual task execution
2. Verify LLM receives formatted context
3. Test multiple hooks combining context
4. Verify context appears in API requests

### Example Test Cases
```typescript
describe('Hook Context Injection', () => {
    it('formats context with type prefix', () => {
        const input = 'WORKSPACE_RULES: Use TypeScript'
        const result = formatHookContext(input, 'PreToolUse')
        expect(result).to.equal(
            '<hook_context source="PreToolUse" type="workspace_rules">\n' +
            'Use TypeScript\n' +
            '</hook_context>'
        )
    })
    
    it('handles context without type', () => {
        const input = 'Some context'
        const result = formatHookContext(input, 'PreToolUse')
        expect(result).to.equal(
            '<hook_context source="PreToolUse" type="general">\n' +
            'Some context\n' +
            '</hook_context>'
        )
    })
})
```

## Future Enhancements

### Potential Extensions
1. **Multiple Context Sections:** Allow hooks to return structured JSON with multiple context types
2. **Context Priority:** Add priority levels for different contexts
3. **Conditional Display:** Show context only for relevant tools
4. **Context Aggregation:** Combine multiple hooks' contexts more intelligently
5. **UI Visualization:** Show hook context in API request disclosure

### Advanced Hook Patterns
1. **Stateful Hooks:** Track state across multiple executions
2. **Async Hooks:** Support asynchronous operations
3. **Hook Chaining:** Allow hooks to call other hooks
4. **Context Templates:** Predefined templates for common patterns

## Conclusion

This architecture provides:
- ✅ Semantic structure aligned with codebase patterns
- ✅ Practical, dependency-free example hooks
- ✅ Clear guidance for hook authors
- ✅ Extensible framework for future enhancements
- ✅ Backward compatibility with existing hooks
- ✅ Improved LLM context comprehension

The proposed changes are minimal but impactful, transforming context injection from a proof-of-concept into a production-ready feature that provides genuine value to users.
