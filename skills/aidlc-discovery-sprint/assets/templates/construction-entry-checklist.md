# CONSTRUCTION Entry Checklist

Before promoting wireframe code to CONSTRUCTION:

## Test Separation Verification

- [ ] All test code is in `tests/` directory
- [ ] No test code in `app/` directory
- [ ] No demo login buttons in production UI
- [ ] No mock API endpoints in production routes
- [ ] `next.config.js` excludes `tests/` from production builds
- [ ] `/api/test/*` routes return 404 in production
- [ ] `tests/.auth/` is in `.gitignore`

## Production Build Verification

- [ ] Run `next build` successfully
- [ ] Inspect `.next/` output for test code (should be none)
- [ ] Run `validate_test_separation.py` (should pass)
- [ ] Test production build locally
- [ ] Verify `/api/test/auth` returns 404 in production mode

## Test Infrastructure Documentation

- [ ] Document test-only APIs in sprint review
- [ ] Document test fixtures in sprint review
- [ ] Document Playwright auth setup
- [ ] Update test README if needed

## Security Audit

- [ ] No hardcoded credentials in production code
- [ ] No test auth tokens in production code
- [ ] No environment-dependent security bypasses
- [ ] All test infrastructure properly isolated

## Validation Script Results

```bash
# Run validation script
python3 .agent/skills/webapp-testing/scripts/validate_test_separation.py .

# Expected output:
# ✅ Tests directory exists: True
# ✅ Next.js config excludes tests: True
# ✅ Test API exists: True
# ✅ Playwright setup exists: True
# ✅ No production contamination detected
```

## Build Verification Commands

```bash
# Production build
cd nextjs
npm run build

# Check build output
ls -la .next/server/app/tests  # Should not exist

# Test production mode
npm start
curl -X POST http://localhost:3000/api/test/auth \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
# Expected: 404 Not Found
```

## Sign-off

**Discovery → CONSTRUCTION promotion approved only if all items checked.**

**Reviewer**: _______________
**Date**: _______________
**Notes**: _______________
