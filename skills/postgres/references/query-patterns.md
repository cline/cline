---
title: SQL Query Patterns
description: Common SQL anti-patterns and optimized alternatives
tags: postgres, sql, query-optimization, n-plus-one, pagination
---

# SQL Query Patterns

## Query Structure

**SELECT specific columns** — avoids fetching unnecessary data and enables covering indexes:
```sql
-- Bad:
SELECT * FROM user WHERE status = 'active';
-- Good:
SELECT id, name, email FROM user WHERE status = 'active';
```

**Subqueries → JOINs** — correlated subqueries re-execute per row:
```sql
-- Bad
SELECT id, (SELECT COUNT(*) FROM order WHERE order.user_id = user.id) FROM user;
-- Good
SELECT u.id, COUNT(o.id) FROM user u LEFT JOIN order o ON o.user_id = u.id GROUP BY u.id;
```

**Always LIMIT unbounded queries** — prevent runaway result sets:
```sql
SELECT id, message FROM log WHERE level = 'error' ORDER BY created_at DESC LIMIT 100;
```

**Avoid functions on indexed columns (SARGable)** — functions prevent index usage unless a functional index exists:
```sql
-- Bad: Full table scan
SELECT * FROM user WHERE date_trunc('day', created_at) = '2023-01-01';
-- Good: Index scan
SELECT * FROM user WHERE created_at >= '2023-01-01' AND created_at < '2023-01-02';
```

## N+1 Detection

**Queries inside loops → batch with ANY/IN:**
```python
# Bad
for uid in user_ids:
    cursor.execute("SELECT name FROM user WHERE id = %s", (uid,))
# Good (Postgres specific)
cursor.execute("SELECT id, name FROM user WHERE id = ANY(%s)", (list(user_ids),))
# Good (Standard SQL)
# cursor.execute("SELECT id, name FROM user WHERE id IN %s", (tuple(user_ids),))
```

**ORM lazy loading → eager loading:**
```python
# Bad: N+1 — each iteration fires a query
for user in User.query.all():
    print(user.posts)
# Good
users = User.query.options(joinedload(User.posts)).all()
```

## Query Rewrites

**UNION → UNION ALL** — skip deduplication when duplicates are impossible or acceptable.

**IN subquery → EXISTS** — EXISTS short-circuits on first match:
```sql
SELECT id, name FROM user u
WHERE EXISTS (SELECT 1 FROM order o WHERE o.user_id = u.id AND o.total > 100);
```

**OFFSET → cursor pagination** — OFFSET scans and discards rows, degrading at depth:
```sql
-- Bad: OFFSET 10000 scans 10020 rows
SELECT id, title FROM article ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
-- Good: cursor-based (requires index on (created_at DESC, id DESC))
SELECT id, title FROM article
WHERE (created_at, id) < ('2025-06-15T12:00:00Z', 987654)
ORDER BY created_at DESC, id DESC LIMIT 20;
```
