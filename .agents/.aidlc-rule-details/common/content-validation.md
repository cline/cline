# Content Validation Rules

## MANDATORY: Content Validation Before File Creation

**CRITICAL**: All generated content MUST be validated before writing to files to prevent parsing errors.

## ASCII Diagram Standards

**CRITICAL**: Before creating ANY file with ASCII diagrams:

1. **LOAD** `common/ascii-diagram-standards.md`
2. **VALIDATE** each diagram:
   - Count characters per line (all lines MUST be same width)
   - Use ONLY: `+` `-` `|` `^` `v` `<` `>` and spaces
   - NO Unicode box-drawing characters
   - Spaces only (NO tabs)
3. **TEST** alignment by verifying box corners align vertically

**See `common/ascii-diagram-standards.md` for patterns and validation checklist.**

## Mermaid Diagram Validation

### Required Validation Steps
1. **Syntax Check**: Validate Mermaid syntax before file creation
2. **Character Escaping**: Ensure special characters are properly escaped
3. **Fallback Content**: Provide text alternative if Mermaid fails validation

### Mermaid Validation Rules
```markdown
## BEFORE creating any file with Mermaid diagrams:

1. Check for invalid characters in node IDs (use alphanumeric + underscore only)
2. Escape special characters in labels: " → \" and ' → \'
3. Validate flowchart syntax: node connections must be valid
4. Test diagram parsing with simple validation

## FALLBACK: If Mermaid validation fails, use text-based workflow representation
```

### Implementation Pattern
```markdown
## Workflow Visualization

### Mermaid Diagram (if syntax valid)
```mermaid
[validated diagram content]
```

### Text Alternative (always include)
```
Phase 1: INCEPTION
- Stage 1: Workspace Detection (COMPLETED)
- Stage 2: Requirements Analysis (COMPLETED)
[continue with text representation]
```

## General Content Validation

### Pre-Creation Validation Checklist
- [ ] Validate embedded code blocks (Mermaid, JSON, YAML)
- [ ] Check special character escaping
- [ ] Verify markdown syntax correctness
- [ ] Test content parsing compatibility
- [ ] Include fallback content for complex elements

### Error Prevention Rules
1. **Always validate before using tools/commands to write files**: Never write unvalidated content
2. **Escape special characters**: Particularly in diagrams and code blocks
3. **Provide alternatives**: Include text versions of visual content
4. **Test syntax**: Validate complex content structures

## Validation Failure Handling

### When Validation Fails
1. **Log the error**: Record what failed validation
2. **Use fallback content**: Switch to text-based alternative
3. **Continue workflow**: Don't block on content validation failures
4. **Inform user**: Mention simplified content was used due to parsing constraints
