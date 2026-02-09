# Bundled Resources

## Scripts (`scripts/`)

Executable Python or Bash files for deterministic tasks.

**When to use:**
- Same code repeatedly rewritten
- Deterministic reliability needed
- Exact sequences required

**Guidelines:**
- Test all scripts by running them before packaging
- Scripts can be executed without loading into context
- Use for build, deploy, migrate, validate operations

**Example structure:**
```
scripts/
├── validate.py      # Validate configuration
├── migrate.py       # Run database migrations
└── generate.py      # Generate boilerplate code
```

**Reference in SKILL.md:**
```markdown
## Validation

Run validation before deployment:
```bash
python scripts/validate.py --config config.yaml
```
```

## References (`references/`)

Documentation loaded only when Claude determines it's needed.

**When to use:**
- Database schemas
- API documentation
- Domain knowledge
- Detailed workflows

**Guidelines:**
- For large files (>10k words), include grep search patterns in SKILL.md
- Avoid duplication with SKILL.md - information lives in one place
- Structure for searchability

**Example structure:**
```
references/
├── api-schema.yaml      # OpenAPI spec
├── database-schema.sql  # Table definitions
└── domain-glossary.md   # Business terms
```

**Reference in SKILL.md:**
```markdown
## API Reference

For endpoint details, see [references/api-schema.yaml](references/api-schema.yaml).

Key endpoints to search for:
- `POST /users` - User creation
- `GET /orders` - Order listing
```

## Assets (`assets/`)

Templates, images, boilerplate used in output - not loaded into context.

**When to use:**
- File templates to fill in
- Images, logos, fonts for generated output
- Boilerplate code structures
- Configuration file templates

**Example structure:**
```
assets/
├── templates/
│   ├── component.tsx.template
│   └── test.py.template
├── images/
│   └── logo.png
└── config/
    └── default.yaml
```

**Reference in SKILL.md:**
```markdown
## Component Creation

Use the template at `assets/templates/component.tsx.template` as starting point.
Replace placeholders:
- `{{COMPONENT_NAME}}` - PascalCase component name
- `{{PROPS_INTERFACE}}` - TypeScript props interface
```

## Planning Reusable Contents

For each concrete usage example, ask:

1. **Scripts**: What code would I write repeatedly? What requires exact sequences?
2. **References**: What information would I re-discover each time?
3. **Assets**: What templates or files accelerate output creation?
