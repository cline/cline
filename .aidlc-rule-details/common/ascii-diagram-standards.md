# ASCII Diagram Standards

## MANDATORY: Use Basic ASCII Only

**CRITICAL**: ALWAYS use basic ASCII characters for diagrams (maximum compatibility).

### ✅ ALLOWED: `+` `-` `|` `^` `v` `<` `>` and alphanumeric text

### ❌ FORBIDDEN: Unicode box-drawing characters
- NO: `┌` `─` `│` `└` `┐` `┘` `├` `┤` `┬` `┴` `┼` `▼` `▲` `►` `◄`
- Reason: Inconsistent rendering across fonts/platforms

## Standard ASCII Diagram Patterns

### CRITICAL: Character Width Rule
**Every line in a box MUST have EXACTLY the same character count (including spaces)**

✅ CORRECT (all lines = 67 chars):
```
+---------------------------------------------------------------+
|                      Component Name                           |
|  Description text here                                        |
+---------------------------------------------------------------+
```

❌ WRONG (inconsistent widths):
```
+---------------------------------------------------------------+
|                      Component Name                           |
|  Description text here                                   |
+---------------------------------------------------------------+
```

### Box Pattern
```
+-----------------------------------------------------+
|                                                     |
|              Calculator Application                 |
|                                                     |
|  Provides basic arithmetic operations for users     |
|  through a web-based interface                      |
|                                                     |
+-----------------------------------------------------+
```

### Nested Boxes
```
+-------------------------------------------------------+
|              Web Server (PHP Runtime)                 |
|  +-------------------------------------------------+  |
|  |  index.php (Monolithic Application)             |  |
|  |  +-------------------------------------------+  |  |
|  |  |  HTML Template (View Layer)               |  |  |
|  |  |  - Form rendering                         |  |  |
|  |  |  - Result display                         |  |  |
|  |  +-------------------------------------------+  |  |
|  +-------------------------------------------------+  |
+-------------------------------------------------------+
```

### Arrows and Connections
```
+----------+
|  Source  |
+----------+
     |
     | HTTP POST
     v
+----------+
|  Target  |
+----------+
```

### Horizontal Flow
```
+-------+     +-------+     +-------+
| Step1 | --> | Step2 | --> | Step3 |
+-------+     +-------+     +-------+
```

### Vertical Flow with Labels
```
User Action Flow:
    |
    v
+----------+
|  Input   |
+----------+
    |
    | validates
    v
+----------+
| Process  |
+----------+
    |
    | returns
    v
+----------+
|  Output  |
+----------+
```

## Validation

Before creating diagrams:
- [ ] Basic ASCII only: `+` `-` `|` `^` `v` `<` `>`
- [ ] No Unicode box-drawing
- [ ] Spaces (not tabs) for alignment
- [ ] Corners use `+`
- [ ] **ALL box lines same character width** (count characters including spaces)
- [ ] Test: Verify corners align vertically in monospace font

## Alternative

For complex diagrams, use Mermaid (see `content-validation.md`)

