# Test Separation Architecture

## Principle

Production code (`app/`) must NEVER contain test-specific logic. All test infrastructure lives in `tests/` directory and is automatically excluded from production builds.

## Core Architecture

```
nextjs/
├── app/                          # ✅ Production code (ZERO contamination)
│   ├── (auth)/login/page.tsx    # Only real OAuth
│   ├── (admin)/                 # Only real auth checks
│   └── api/                     # Only real APIs
│
├── tests/                        # 🧪 Test-only layer (excluded from builds)
│   ├── fixtures/                # Test helpers
│   │   ├── test-auth-helper.ts
│   │   └── mock-providers.tsx
│   │
│   ├── test-api/                # Test-only API routes
│   │   └── auth/route.ts        # /api/test/auth endpoint
│   │
│   └── playwright/              # Playwright config
│       ├── global-setup.ts      # Calls /api/test/auth
│       └── auth.setup.ts
│
└── next.config.js               # Excludes tests/ from production
```

## Directory Structure

### Production Code (`app/`)

**Rules**:
- Contains ONLY production-ready code
- NO demo buttons or test features
- NO mock APIs or test endpoints
- NO `TEST-ONLY` tags or comments
- NO environment-dependent test bypasses

**Examples of FORBIDDEN code in `app/`**:
```typescript
// ❌ WRONG - Demo button in production UI
<button onClick={loginWithDemo}>Try Demo Account</button>

// ❌ WRONG - Mock API in production route
if (process.env.NODE_ENV === 'test') {
  return mockData;
}

// ❌ WRONG - Test-only tag in production code
// ⚠️ TEST-ONLY: This bypasses auth for testing
if (req.headers['x-test-mode']) { ... }
```

### Test Code (`tests/`)

**Rules**:
- Contains ALL test infrastructure
- Test-only API routes
- Test fixtures and helpers
- Playwright configuration
- Auth setup scripts

**Structure**:
```
tests/
├── fixtures/              # Reusable test helpers
│   ├── test-auth-helper.ts
│   ├── mock-providers.tsx
│   └── test-data.ts
│
├── test-api/             # Test-only API routes
│   ├── auth/
│   │   └── route.ts      # POST /api/test/auth
│   └── mock/
│       └── data/route.ts # GET /api/test/mock/data
│
└── playwright/           # Playwright setup
    ├── global-setup.ts   # Auth setup before tests
    └── auth.setup.ts     # Auth state management
```

## Implementation Checklist

### Initial Setup

- [ ] Create `tests/` directory at project root
- [ ] Create subdirectories: `tests/fixtures/`, `tests/test-api/`, `tests/playwright/`
- [ ] Add `tests/.auth/` to `.gitignore`

### Next.js Configuration

- [ ] Update `next.config.js` with webpack config to exclude `tests/` from production builds
- [ ] Add rewrites for `/api/test/*` routes (dev only)
- [ ] Verify production build excludes `tests/` directory

### Test-Only Auth API

- [ ] Create `tests/test-api/auth/route.ts`
- [ ] Add production guard (return 404 in production)
- [ ] Implement role-based test auth (admin, user, guest)
- [ ] Set auth cookies for test sessions

### Playwright Setup

- [ ] Create `tests/playwright/global-setup.ts`
- [ ] Call `/api/test/auth` to authenticate
- [ ] Save auth state to `tests/.auth/admin.json`
- [ ] Update `playwright.config.ts` to use global setup

### Validation

- [ ] Run `next build` and verify no `tests/` code in `.next/`
- [ ] Test `/api/test/auth` returns 200 in dev mode
- [ ] Test `/api/test/auth` returns 404 in production mode
- [ ] Run `validate_test_separation.py` script
- [ ] Verify Playwright tests use test-only auth

## Next.js Build Configuration

### Webpack Config (Exclude tests/ from production)

```javascript
// next.config.js
module.exports = {
  webpack: (config, { isServer, dev }) => {
    if (!dev) {
      // Production: Completely exclude tests/
      config.resolve.alias['@/tests'] = false;
      
      config.module.rules.push({
        test: /tests\//,
        loader: 'ignore-loader'
      });
    }
    return config;
  },
  
  // Route /api/test/* to tests/test-api/* in dev only
  async rewrites() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }
    return [
      {
        source: '/api/test/:path*',
        destination: '/tests/test-api/:path*'
      }
    ];
  }
};
```

## Test-Only Auth API

### Implementation

```typescript
// tests/test-api/auth/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // Production guard
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  
  const { role } = await req.json();
  const token = `test_${role}_${Date.now()}`;
  
  const response = NextResponse.json({ 
    success: true,
    user: { role, email: `test-${role}@example.com` }
  });
  
  response.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 60 * 60
  });
  
  return response;
}
```

### Usage in Tests

```typescript
// tests/playwright/global-setup.ts
import { chromium } from '@playwright/test';

export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Call test-only API (no UI interaction needed)
  await page.goto('http://localhost:3000');
  const response = await page.request.post('http://localhost:3000/api/test/auth', {
    data: { role: 'admin' }
  });
  
  if (!response.ok()) {
    throw new Error('Test auth setup failed');
  }
  
  // Save auth state
  await page.context().storageState({ 
    path: 'tests/.auth/admin.json' 
  });
  
  await browser.close();
}
```

## Verification

### Build Verification

```bash
# Run production build
npm run build

# Verify tests/ is excluded
ls -la .next/server/app/tests  # Should not exist

# Check bundle size (should not include test code)
du -sh .next/
```

### API Verification

```bash
# Dev mode - should work
npm run dev
curl -X POST http://localhost:3000/api/test/auth \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
# Expected: 200 OK with auth cookie

# Production mode - should return 404
npm run build && npm start
curl -X POST http://localhost:3000/api/test/auth \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
# Expected: 404 Not Found
```

### Playwright Verification

```bash
# Run Playwright tests
npx playwright test

# Verify auth state file created
ls -la tests/.auth/admin.json  # Should exist

# Check test results
cat playwright-report/index.html
```

### Automated Validation

```bash
# Run validation script
python3 .agent/skills/webapp-testing/scripts/validate_test_separation.py .

# Expected output:
# ✅ Tests directory exists
# ✅ Next.js config excludes tests
# ✅ Test API exists
# ✅ Playwright setup exists
# ✅ No production contamination detected
```

## Benefits

### ✅ Production Code Purity

1. **Zero contamination**: `app/` directory never contains test code
2. **No demo buttons**: Login page only has real OAuth
3. **No mock APIs**: All APIs in `app/api/` are production-ready
4. **No test guards**: No `if (NODE_ENV === 'test')` checks in production code
5. **Clean git history**: Test changes never touch production files

### ✅ Test Convenience

1. **Simple auth**: Single API call to `/api/test/auth`
2. **No UI interaction**: No need to click demo buttons
3. **Fast setup**: Auth state saved once, reused across tests
4. **Isolated fixtures**: Test helpers in dedicated `tests/fixtures/`
5. **Clear separation**: Easy to find and modify test code

### ✅ Build Safety

1. **Automatic exclusion**: `next build` removes `tests/` directory
2. **Route protection**: `/api/test/*` returns 404 in production
3. **No manual cleanup**: No risk of forgetting to remove test code
4. **Verifiable**: Can inspect build output to confirm no test code

### ✅ Development Experience

1. **Clear boundaries**: `app/` = production, `tests/` = testing
2. **No conflicts**: Test changes don't affect production code reviews
3. **Easy cleanup**: Delete `tests/` directory to remove all test code
4. **Maintainable**: Test infrastructure changes independently

## Anti-Patterns to Avoid

### ❌ Demo Buttons in Production UI

```typescript
// ❌ WRONG - Contaminates production code
<button onClick={loginWithDemo}>Try Demo Master Account</button>

// ✅ CORRECT - No demo buttons in app/
// Use test-only API instead
```

### ❌ Mock APIs in Production Routes

```typescript
// ❌ WRONG - Mock logic in production route
// app/api/data/route.ts
if (process.env.NODE_ENV === 'test') {
  return NextResponse.json(mockData);
}

// ✅ CORRECT - Mock API in test-only route
// tests/test-api/mock/data/route.ts
export async function GET() {
  return NextResponse.json(mockData);
}
```

### ❌ TEST-ONLY Tags in Production Code

```typescript
// ❌ WRONG - Test tag in production code
// ⚠️ TEST-ONLY: Bypass auth for testing
if (req.headers['x-test-mode']) {
  return { authenticated: true };
}

// ✅ CORRECT - Test logic in tests/ directory
// tests/fixtures/test-auth-helper.ts
export function bypassAuth() { ... }
```

### ❌ Environment-Dependent Test Bypasses

```typescript
// ❌ WRONG - Test bypass in production code
if (process.env.NODE_ENV !== 'production') {
  // Skip validation for testing
  return true;
}

// ✅ CORRECT - Test fixture handles this
// tests/fixtures/test-validators.ts
export function skipValidation() { ... }
```

## Troubleshooting

### Issue: Tests fail with "Not found" error

**Cause**: `/api/test/auth` returns 404

**Solution**:
1. Check `next.config.js` has rewrites for `/api/test/*`
2. Verify `tests/test-api/auth/route.ts` exists
3. Ensure running in dev mode (`npm run dev`)

### Issue: Production build includes test code

**Cause**: Webpack config not excluding `tests/`

**Solution**:
1. Check `next.config.js` has webpack config with `ignore-loader`
2. Run `npm run build` and inspect `.next/` directory
3. Verify no `tests/` directory in build output

### Issue: Playwright tests fail with auth errors

**Cause**: Auth state not saved or expired

**Solution**:
1. Check `tests/.auth/admin.json` exists
2. Verify `tests/playwright/global-setup.ts` is configured in `playwright.config.ts`
3. Re-run global setup: `npx playwright test --project=setup`

### Issue: Validation script reports contamination

**Cause**: Test code found in `app/` directory

**Solution**:
1. Review files listed in validation output
2. Move test code to `tests/` directory
3. Remove demo buttons, mock APIs, TEST-ONLY tags
4. Re-run validation script

## References

- Complete specification: `aidlc-docs/meta-knowledge/reviews/test-production-separation-review.md`
- Validation script: `.agent/skills/webapp-testing/scripts/validate_test_separation.py`
- Security review: `aidlc-docs/meta-knowledge/reviews/test-backdoor-security-review.md`
