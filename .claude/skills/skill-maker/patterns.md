# SKILL.md Patterns

Use imperative/infinitive form throughout.

## Sequential Workflow

For multi-step processes with numbered steps:

```markdown
## Deployment Process

1. Run test suite
   ```bash
   python scripts/test.py
   ```

2. Build container image
   ```bash
   docker build -t app:latest .
   ```

3. Push to registry
   ```bash
   docker push registry.example.com/app:latest
   ```

4. Deploy to cluster
   ```bash
   kubectl apply -f k8s/
   ```

5. Verify health checks pass
```

## Conditional Logic

For decision points with branching paths:

```markdown
## Component Workflow

1. Determine operation type:
   - **Creating new component?** → Follow creation workflow
   - **Modifying existing?** → Follow modification workflow
   - **Deleting?** → Follow deletion workflow

2. **Creation workflow:**
   a. Generate component from template
   b. Add to component index
   c. Create test file
   d. Update documentation

3. **Modification workflow:**
   a. Locate existing component
   b. Apply changes
   c. Update tests
   d. Verify no breaking changes

4. **Deletion workflow:**
   a. Check for dependencies
   b. Remove component
   c. Update index
   d. Remove tests
```

## Quality Standards

Use templates or example patterns:

```markdown
## Code Style

### Function Signatures
```python
def process_order(
    order_id: str,
    items: list[OrderItem],
    *,
    validate: bool = True,
) -> ProcessedOrder:
    """Process an order and return result.

    Args:
        order_id: Unique order identifier
        items: List of items to process
        validate: Whether to validate before processing

    Returns:
        Processed order with status and details

    Raises:
        ValidationError: If validation fails
        ProcessingError: If processing fails
    """
```

### Error Handling
```python
try:
    result = process_order(order_id, items)
except ValidationError as e:
    logger.warning(f"Validation failed: {e}")
    raise
except ProcessingError as e:
    logger.error(f"Processing failed: {e}")
    # Attempt recovery or rollback
```
```

## Reference Pattern

For large reference documents:

```markdown
## Database Schema

Full schema in [references/schema.sql](references/schema.sql).

Key tables:
- `users` - User accounts (search: `CREATE TABLE users`)
- `orders` - Order records (search: `CREATE TABLE orders`)
- `items` - Order line items (search: `CREATE TABLE items`)

Common queries in [references/queries.sql](references/queries.sql).
```

## Script Integration

For executable scripts:

```markdown
## Validation

Before committing, run validation:

```bash
python scripts/validate.py --strict
```

This checks:
- Code formatting
- Type annotations
- Test coverage
- Documentation completeness

Fix any issues before proceeding.
```
