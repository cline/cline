# Quick Testing Guide - Quantrel Authentication

## 🚀 Quick Start

### Method 1: Test in VS Code Extension

1. **Start Development Mode:**
   ```bash
   cd /Users/ash/Desktop/cline
   npm run dev
   ```

2. **Launch Extension:**
   - Press `F5` in VS Code
   - A new "Extension Development Host" window will open

3. **Test Commands:**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Try these commands:
     - `Quantrel: Login`
     - `Quantrel: Select AI Model`
     - `Quantrel: Logout`

### Method 2: Test with Script

1. **Set your password:**
   ```bash
   export QUANTREL_PASSWORD="your_password_here"
   ```

2. **Run test script:**
   ```bash
   npx tsx src/services/quantrel/test-auth.ts
   ```

---

## 📝 Test Checklist

### Authentication Tests

- [ ] **Login** - Can authenticate with email/password
  - Command: `Quantrel: Login`
  - Enter email: `gdeep.7314@gmail.com`
  - Enter password: (your password)
  - ✅ Should show: "Logged in to Quantrel as {email}"

- [ ] **Token Validation** - Token is validated on startup
  - Restart extension (`Cmd+R` in Extension Development Host)
  - Check Debug Console for: "Quantrel: Authenticated successfully"

- [ ] **Model Fetching** - Can fetch and display models
  - Command: `Quantrel: Select AI Model`
  - ✅ Should show QuickPick with ~50 models
  - ✅ Can search by name (try "Claude", "GPT")
  - ✅ Model details visible (price, context window)

- [ ] **Model Refresh** - Can force refresh model list
  - Command: `Quantrel: Refresh Model List`
  - ✅ Should show progress notification
  - ✅ Should complete without error

- [ ] **Logout** - Can logout successfully
  - Command: `Quantrel: Logout`
  - Confirm logout
  - ✅ Should show: "Logged out from Quantrel"

- [ ] **Logout Persistence** - Tokens cleared after logout
  - After logout, try: `Quantrel: Select AI Model`
  - ✅ Should show error: "Please login to Quantrel first"

---

## 🔍 Debugging

### Check Logs

**Extension Debug Console:**
- Open "Extension Development Host" window
- View > Output > Select "Log (Extension Host)"
- Look for lines starting with "Quantrel:"

**Expected logs:**
```
Quantrel: Authenticated successfully
```
or
```
Quantrel: Not authenticated - user will need to login
```

### Check Stored Secrets

**VS Code SecretStorage is encrypted, but you can verify storage indirectly:**

1. Login to Quantrel
2. Close VS Code completely
3. Reopen VS Code
4. Launch extension again (`F5`)
5. Check logs - should say "Authenticated successfully"

✅ This confirms tokens persisted correctly

### Common Issues

**Issue:** "Quantrel authentication service not initialized"
- **Cause:** Extension failed to start properly
- **Fix:** Check Debug Console for errors during activation

**Issue:** "Login failed: Network error"
- **Cause:** Backend not running or wrong URL
- **Fix:** Check `quantrelBaseUrl` setting (default: http://localhost:8080)
- **Fix:** Verify backend is running: `curl http://localhost:8080/api/agents`

**Issue:** "Session expired. Please login again"
- **Cause:** Token expired or invalid
- **Fix:** Run `Quantrel: Login` again

**Issue:** QuickPick shows no models
- **Cause:** Not authenticated or API error
- **Fix:** Check Debug Console for error messages
- **Fix:** Try `Quantrel: Login` first

---

## 🧪 Test Script Output

**Expected output from `test-auth.ts`:**

```
🧪 Testing Quantrel Authentication

✅ QuantrelAuthService created

📝 Test 1: Login
✅ Login successful!

📝 Test 2: Get User Info
✅ User Info:
   Email: gdeep.7314@gmail.com
   Sub: user:407
   Scope: ROLE_ADMIN
   Expires: 2026-01-12T07:15:14Z

📝 Test 3: Validate Token
✅ Token is valid

📝 Test 4: Fetch Models
✅ Fetched 511 models

📋 Sample Models (first 5):
   1. Claude Sonnet 4.5 (Anthropic)
      Model ID: anthropic/claude-sonnet-4.5
      Price: $3.0/1M in, $15.0/1M out
      Context: 200000 tokens

   2. GPT-4o (OpenAI)
      Model ID: openai/gpt-4o
      Price: $5.0/1M in, $15.0/1M out
      Context: 128000 tokens

   ...

📝 Test 5: Search Models (Claude)
✅ Found 12 Claude models
   - Claude Sonnet 4.5
   - Claude Opus 4
   - Claude Haiku 4

📝 Test 6: Get Recommended Coding Models
✅ Found 45 recommended coding models (top 3):
   - Claude Sonnet 4.5 (Intelligence: 10/10)
   - GPT-4o (Intelligence: 9/10)
   - Claude Opus 4 (Intelligence: 10/10)

📝 Test 7: Logout
✅ Logged out successfully

📝 Test 8: Verify Logout
✅ Not authenticated (logout confirmed)

🎉 All tests passed!
```

---

## 🐛 Known Issues

1. **Model Limit:** QuickPick shows only top 50 models (Quantrel has 500+)
   - **Workaround:** Use search to filter models
   - **Future:** Add pagination or better filtering UI

2. **Login UI:** Uses basic input boxes
   - **Future:** Create proper webview with better UX

3. **No Status Bar:** Can't see login status without running command
   - **Future:** Add status bar item showing auth state

---

## ✅ Success Criteria

Phase 1 is working correctly if:

- ✅ Can login with email/password
- ✅ Tokens stored securely (persist across restarts)
- ✅ Can fetch 500+ models from backend
- ✅ Can search/filter models
- ✅ Can logout and tokens are cleared
- ✅ Auto-refresh timer starts after login

---

## 📞 Need Help?

**Backend Issues:**
- Verify backend is running: `curl http://localhost:8080/api/agents`
- Check backend logs for errors

**Extension Issues:**
- Check Debug Console in Extension Development Host
- Look for "Quantrel:" log lines
- Check for error messages during activation

**Token Issues:**
- Try logout and login again
- Check if token expired (7-day expiration)
- Verify network connection to backend

---

## 🎯 What to Test

### Basic Flow
1. Login → Should succeed
2. Select Model → Should show models
3. Logout → Should clear tokens
4. Select Model → Should ask to login

### Edge Cases
1. Login with wrong password → Should show error
2. Login when already logged in → Should work (refresh tokens)
3. Restart extension while logged in → Should stay logged in
4. Select model before login → Should show error message

### Performance
1. Model fetch should complete in < 2 seconds
2. Login should complete in < 1 second
3. No lag when opening QuickPick

---

Ready to test! 🚀
