# Playwright Skill - Complete API Reference

This document contains the comprehensive Playwright API reference and advanced patterns. For quick-start execution patterns, see [SKILL.md](SKILL.md).

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Core Patterns](#core-patterns)
- [Selectors & Locators](#selectors--locators)
- [Common Actions](#common-actions)
- [Waiting Strategies](#waiting-strategies)
- [Assertions](#assertions)
- [Page Object Model](#page-object-model-pom)
- [Network & API Testing](#network--api-testing)
- [Authentication & Session Management](#authentication--session-management)
- [Visual Testing](#visual-testing)
- [Mobile Testing](#mobile-testing)
- [Debugging](#debugging)
- [Performance Testing](#performance-testing)
- [Parallel Execution](#parallel-execution)
- [Data-Driven Testing](#data-driven-testing)
- [Accessibility Testing](#accessibility-testing)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)
- [Common Patterns & Solutions](#common-patterns--solutions)
- [Troubleshooting](#troubleshooting)

## Installation & Setup

### Prerequisites

Before using this skill, ensure Playwright is available:

```bash
# Check if Playwright is installed
npm list playwright 2>/dev/null || echo "Playwright not installed"

# Install (if needed)
cd ~/.claude/skills/playwright-skill
npm run setup
```

### Basic Configuration

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Core Patterns

### Basic Browser Automation

```javascript
const { chromium } = require('playwright');

(async () => {
  // Launch browser
  const browser = await chromium.launch({
    headless: false,  // Set to true for headless mode
    slowMo: 50       // Slow down operations by 50ms
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  const page = await context.newPage();

  // Navigate
  await page.goto('https://example.com', {
    waitUntil: 'networkidle'  // Wait for network to be idle
  });

  // Your automation here

  await browser.close();
})();
```

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    // Arrange
    const button = page.locator('button[data-testid="submit"]');

    // Act
    await button.click();

    // Assert
    await expect(page).toHaveURL('/success');
    await expect(page.locator('.message')).toHaveText('Success!');
  });
});
```

## Selectors & Locators

### Best Practices for Selectors

```javascript
// PREFERRED: Data attributes (most stable)
await page.locator('[data-testid="submit-button"]').click();
await page.locator('[data-cy="user-input"]').fill('text');

// GOOD: Role-based selectors (accessible)
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
await page.getByRole('heading', { level: 1 }).click();

// GOOD: Text content (for unique text)
await page.getByText('Sign in').click();
await page.getByText(/welcome back/i).click();

// OK: Semantic HTML
await page.locator('button[type="submit"]').click();
await page.locator('input[name="email"]').fill('test@test.com');

// AVOID: Classes and IDs (can change frequently)
await page.locator('.btn-primary').click();  // Avoid
await page.locator('#submit').click();       // Avoid

// LAST RESORT: Complex CSS/XPath
await page.locator('div.container > form > button').click();  // Fragile
```

### Advanced Locator Patterns

```javascript
// Filter and chain locators
const row = page.locator('tr').filter({ hasText: 'John Doe' });
await row.locator('button').click();

// Nth element
await page.locator('button').nth(2).click();

// Combining conditions
await page.locator('button').and(page.locator('[disabled]')).count();

// Parent/child navigation
const cell = page.locator('td').filter({ hasText: 'Active' });
const row = cell.locator('..');
await row.locator('button.edit').click();
```

## Common Actions

### Form Interactions

```javascript
// Text input
await page.getByLabel('Email').fill('user@example.com');
await page.getByPlaceholder('Enter your name').fill('John Doe');

// Clear and type
await page.locator('#username').clear();
await page.locator('#username').type('newuser', { delay: 100 });

// Checkbox
await page.getByLabel('I agree').check();
await page.getByLabel('Subscribe').uncheck();

// Radio button
await page.getByLabel('Option 2').check();

// Select dropdown
await page.selectOption('select#country', 'usa');
await page.selectOption('select#country', { label: 'United States' });
await page.selectOption('select#country', { index: 2 });

// Multi-select
await page.selectOption('select#colors', ['red', 'blue', 'green']);

// File upload
await page.setInputFiles('input[type="file"]', 'path/to/file.pdf');
await page.setInputFiles('input[type="file"]', [
  'file1.pdf',
  'file2.pdf'
]);
```

### Mouse Actions

```javascript
// Click variations
await page.click('button');                          // Left click
await page.click('button', { button: 'right' });    // Right click
await page.dblclick('button');                       // Double click
await page.click('button', { position: { x: 10, y: 10 } });  // Click at position

// Hover
await page.hover('.menu-item');

// Drag and drop
await page.dragAndDrop('#source', '#target');

// Manual drag
await page.locator('#source').hover();
await page.mouse.down();
await page.locator('#target').hover();
await page.mouse.up();
```

### Keyboard Actions

```javascript
// Type with delay
await page.keyboard.type('Hello World', { delay: 100 });

// Key combinations
await page.keyboard.press('Control+A');
await page.keyboard.press('Control+C');
await page.keyboard.press('Control+V');

// Special keys
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.press('Escape');
await page.keyboard.press('ArrowDown');
```

## Waiting Strategies

### Smart Waiting

```javascript
// Wait for element states
await page.locator('button').waitFor({ state: 'visible' });
await page.locator('.spinner').waitFor({ state: 'hidden' });
await page.locator('button').waitFor({ state: 'attached' });
await page.locator('button').waitFor({ state: 'detached' });

// Wait for specific conditions
await page.waitForURL('**/success');
await page.waitForURL(url => url.pathname === '/dashboard');

// Wait for network
await page.waitForLoadState('networkidle');
await page.waitForLoadState('domcontentloaded');

// Wait for function
await page.waitForFunction(() => document.querySelector('.loaded'));
await page.waitForFunction(
  text => document.body.innerText.includes(text),
  'Content loaded'
);

// Wait for response
const responsePromise = page.waitForResponse('**/api/users');
await page.click('button#load-users');
const response = await responsePromise;

// Wait for request
await page.waitForRequest(request =>
  request.url().includes('/api/') && request.method() === 'POST'
);

// Custom timeout
await page.locator('.slow-element').waitFor({
  state: 'visible',
  timeout: 10000  // 10 seconds
});
```

## Assertions

### Common Assertions

```javascript
import { expect } from '@playwright/test';

// Page assertions
await expect(page).toHaveTitle('My App');
await expect(page).toHaveURL('https://example.com/dashboard');
await expect(page).toHaveURL(/.*dashboard/);

// Element visibility
await expect(page.locator('.message')).toBeVisible();
await expect(page.locator('.spinner')).toBeHidden();
await expect(page.locator('button')).toBeEnabled();
await expect(page.locator('input')).toBeDisabled();

// Text content
await expect(page.locator('h1')).toHaveText('Welcome');
await expect(page.locator('.message')).toContainText('success');
await expect(page.locator('.items')).toHaveText(['Item 1', 'Item 2']);

// Input values
await expect(page.locator('input')).toHaveValue('test@example.com');
await expect(page.locator('input')).toBeEmpty();

// Attributes
await expect(page.locator('button')).toHaveAttribute('type', 'submit');
await expect(page.locator('img')).toHaveAttribute('src', /.*\.png/);

// CSS properties
await expect(page.locator('.error')).toHaveCSS('color', 'rgb(255, 0, 0)');

// Count
await expect(page.locator('.item')).toHaveCount(5);

// Checkbox/Radio state
await expect(page.locator('input[type="checkbox"]')).toBeChecked();
```

## Page Object Model (POM)

### Basic Page Object

```javascript
// pages/LoginPage.js
class LoginPage {
  constructor(page) {
    this.page = page;
    this.usernameInput = page.locator('input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('.error-message');
  }

  async navigate() {
    await this.page.goto('/login');
  }

  async login(username, password) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async getErrorMessage() {
    return await this.errorMessage.textContent();
  }
}

// Usage in test
test('login with valid credentials', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login('user@example.com', 'password123');
  await expect(page).toHaveURL('/dashboard');
});
```

## Network & API Testing

### Intercepting Requests

```javascript
// Mock API responses
await page.route('**/api/users', route => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 1, name: 'John' },
      { id: 2, name: 'Jane' }
    ])
  });
});

// Modify requests
await page.route('**/api/**', route => {
  const headers = {
    ...route.request().headers(),
    'X-Custom-Header': 'value'
  };
  route.continue({ headers });
});

// Block resources
await page.route('**/*.{png,jpg,jpeg,gif}', route => route.abort());
```

### Custom Headers via Environment Variables

The skill supports automatic header injection via environment variables:

```bash
# Single header (simple)
PW_HEADER_NAME=X-Automated-By PW_HEADER_VALUE=playwright-skill

# Multiple headers (JSON)
PW_EXTRA_HEADERS='{"X-Automated-By":"playwright-skill","X-Request-ID":"123"}'
```

These headers are automatically applied to all requests when using:
- `helpers.createContext(browser)` - headers merged automatically
- `getContextOptionsWithHeaders(options)` - utility injected by run.js wrapper

**Precedence (highest to lowest):**
1. Headers passed directly in `options.extraHTTPHeaders`
2. Environment variable headers
3. Playwright defaults

**Use case:** Identify automated traffic so your backend can return LLM-optimized responses (e.g., plain text errors instead of styled HTML).

## Visual Testing

### Screenshots

```javascript
// Full page screenshot
await page.screenshot({
  path: 'screenshot.png',
  fullPage: true
});

// Element screenshot
await page.locator('.chart').screenshot({
  path: 'chart.png'
});

// Visual comparison
await expect(page).toHaveScreenshot('homepage.png');
```

## Mobile Testing

```javascript
// Device emulation
const { devices } = require('playwright');
const iPhone = devices['iPhone 12'];

const context = await browser.newContext({
  ...iPhone,
  locale: 'en-US',
  permissions: ['geolocation'],
  geolocation: { latitude: 37.7749, longitude: -122.4194 }
});
```

## Debugging

### Debug Mode

```bash
# Run with inspector
npx playwright test --debug

# Headed mode
npx playwright test --headed

# Slow motion
npx playwright test --headed --slowmo=1000
```

### In-Code Debugging

```javascript
// Pause execution
await page.pause();

// Console logs
page.on('console', msg => console.log('Browser log:', msg.text()));
page.on('pageerror', error => console.log('Page error:', error));
```

## Performance Testing

```javascript
// Measure page load time
const startTime = Date.now();
await page.goto('https://example.com');
const loadTime = Date.now() - startTime;
console.log(`Page loaded in ${loadTime}ms`);
```

## Parallel Execution

```javascript
// Run tests in parallel
test.describe.parallel('Parallel suite', () => {
  test('test 1', async ({ page }) => {
    // Runs in parallel with test 2
  });

  test('test 2', async ({ page }) => {
    // Runs in parallel with test 1
  });
});
```

## Data-Driven Testing

```javascript
// Parameterized tests
const testData = [
  { username: 'user1', password: 'pass1', expected: 'Welcome user1' },
  { username: 'user2', password: 'pass2', expected: 'Welcome user2' },
];

testData.forEach(({ username, password, expected }) => {
  test(`login with ${username}`, async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.message')).toHaveText(expected);
  });
});
```

## Accessibility Testing

```javascript
import { injectAxe, checkA11y } from 'axe-playwright';

test('accessibility check', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  await checkA11y(page);
});
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Playwright Tests
on:
  push:
    branches: [main, master]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright Browsers
        run: npx playwright install --with-deps
      - name: Run tests
        run: npx playwright test
```

## Best Practices

1. **Test Organization** - Use descriptive test names, group related tests
2. **Selector Strategy** - Prefer data-testid attributes, use role-based selectors
3. **Waiting** - Use Playwright's auto-waiting, avoid hard-coded delays
4. **Error Handling** - Add proper error messages, take screenshots on failure
5. **Performance** - Run tests in parallel, reuse authentication state

## Common Patterns & Solutions

### Handling Popups

```javascript
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.click('button.open-popup')
]);
await popup.waitForLoadState();
```

### File Downloads

```javascript
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button.download')
]);
await download.saveAs(`./downloads/${download.suggestedFilename()}`);
```

### iFrames

```javascript
const frame = page.frameLocator('#my-iframe');
await frame.locator('button').click();
```

### Infinite Scroll

```javascript
async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
}
```

## Troubleshooting

### Common Issues

1. **Element not found** - Check if element is in iframe, verify visibility
2. **Timeout errors** - Increase timeout, check network conditions
3. **Flaky tests** - Use proper waiting strategies, mock external dependencies
4. **Authentication issues** - Verify auth state is properly saved

## Quick Reference Commands

```bash
# Run tests
npx playwright test

# Run in headed mode
npx playwright test --headed

# Debug tests
npx playwright test --debug

# Generate code
npx playwright codegen https://example.com

# Show report
npx playwright show-report
```

## Additional Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
- [Best Practices](https://playwright.dev/docs/best-practices)
