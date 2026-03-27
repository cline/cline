# Common Issues

## N+1 Query Problem

```typescript
// N+1 queries - BAD
const posts = await Post.findAll();
for (const post of posts) {
  post.author = await User.findById(post.authorId); // N queries!
}

// Single query with join - GOOD
const posts = await Post.findAll({ include: [User] });

// Or batch load
const posts = await Post.findAll();
const authorIds = posts.map(p => p.authorId);
const authors = await User.findByIds(authorIds);
```

## Missing Error Handling

```typescript
// Unhandled rejection - BAD
const data = await fetch('/api/data').then(r => r.json());

// Proper error handling - GOOD
try {
  const response = await fetch('/api/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
} catch (error) {
  logger.error('Failed to fetch data', { error });
  throw new DataFetchError('Could not load data');
}
```

## Magic Numbers/Strings

```typescript
// Magic number - BAD
if (user.age >= 18) { ... }
setTimeout(fn, 86400000);

// Named constant - GOOD
const MINIMUM_AGE = 18;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

if (user.age >= MINIMUM_AGE) { ... }
setTimeout(fn, ONE_DAY_MS);
```

## Deep Nesting

```typescript
// Deep nesting - BAD
if (user) {
  if (user.isActive) {
    if (user.hasPermission) {
      doSomething();
    }
  }
}

// Early returns - GOOD
if (!user || !user.isActive || !user.hasPermission) {
  return;
}
doSomething();
```

## God Functions

```typescript
// Does too much - BAD
async function processOrder(order) {
  // validate
  // check inventory
  // process payment
  // send email
  // update database
  // log analytics
}

// Single responsibility - GOOD
async function processOrder(order) {
  await validateOrder(order);
  await reserveInventory(order);
  await chargePayment(order);
  await sendConfirmation(order);
}
```

## Mutable Shared State

```typescript
// Shared mutable - BAD
const config = { debug: false };
function enableDebug() {
  config.debug = true;
}

// Immutable pattern - GOOD
function createConfig(overrides = {}) {
  return Object.freeze({ debug: false, ...overrides });
}
```

## Missing Null Checks

```typescript
// Unsafe access - BAD
const name = user.profile.name;

// Safe access - GOOD
const name = user?.profile?.name ?? 'Unknown';
```

## Synchronous File Operations

```typescript
// Blocks event loop - BAD
const data = fs.readFileSync('file.txt');

// Non-blocking - GOOD
const data = await fs.promises.readFile('file.txt');
```

## Quick Reference

| Issue | Impact | Fix |
|-------|--------|-----|
| N+1 queries | Performance | Eager load or batch |
| Missing error handling | Reliability | Try/catch + logging |
| Magic numbers | Maintainability | Named constants |
| Deep nesting | Readability | Early returns |
| God functions | Testability | Single responsibility |
| Mutable shared state | Bugs | Immutable patterns |
| Missing null checks | Crashes | Optional chaining |
| Sync file operations | Performance | Async operations |
