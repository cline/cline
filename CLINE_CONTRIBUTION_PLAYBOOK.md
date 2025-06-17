# Cline Contribution Playbook: Complete Guide for AI Agents & Teams

This guide provides step-by-step instructions for forking the Cline repository, identifying issues, implementing fixes, and contributing back to the project through pull requests.

## 🎯 Overview

Cline is an open-source AI coding assistant VSCode extension with 45.8k stars and active development. The project welcomes contributions and has a well-defined process for accepting improvements.

**Repository:** https://github.com/cline/cline  
**License:** Apache 2.0 (very permissive for contributions)  
**Language:** TypeScript (VSCode Extension + React WebView)

## 📋 Prerequisites

- GitHub account
- Git installed locally
- Node.js and npm
- VSCode (for testing)
- Basic understanding of TypeScript/React

## 🍴 Step 1: Fork the Repository

### 1.1 Create Fork on GitHub
1. Navigate to https://github.com/cline/cline
2. Click "Fork" button (top-right)
3. Select your GitHub account as destination
4. Optionally rename the fork (e.g., "aai-cline-dev")

### 1.2 Clone Your Fork Locally
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/YOUR_FORK_NAME.git
cd YOUR_FORK_NAME

# Add upstream remote for syncing
git remote add upstream https://github.com/cline/cline.git

# Verify remotes
git remote -v
# Should show:
# origin    https://github.com/YOUR_USERNAME/YOUR_FORK_NAME.git (fetch)
# origin    https://github.com/YOUR_USERNAME/YOUR_FORK_NAME.git (push)
# upstream  https://github.com/cline/cline.git (fetch)
# upstream  https://github.com/cline/cline.git (push)
```

### 1.3 Verify Legal Compliance
```bash
# Confirm Apache 2.0 license is present
head -10 LICENSE

# Verify package.json structure
grep '"name"' package.json
```

## 🔍 Step 2: Identify Issues to Work On

### 2.1 Find Good First Issues
Visit: https://github.com/cline/cline/labels/Good%20First%20Issue

**Current High-Priority Issues (as of June 2025):**

| Issue # | Title | Type | Difficulty |
|---------|-------|------|------------|
| #4238 | Hide the MCP notification popup | UI Enhancement | Easy |
| #4198 | Vertex AI region separation for Plan/Act mode | Provider Bug | Medium |
| #4006 | Assistant responses labeled as "User Message" | UI Bug | Easy |
| #4002 | Add settings to limit terminal output lines | Feature | Medium |
| #3955 | "Discard Changes" not working | Bug Fix | Easy |
| #3742 | Auto-approve sub-options UI bug | UI Bug | Easy |

### 2.2 Issue Selection Criteria
**Choose issues that:**
- Have "Good First Issue" label
- Are not assigned to anyone
- Have clear problem descriptions
- Align with your skills (UI, Backend, Providers, etc.)

### 2.3 Claim an Issue
1. Comment on the issue: "I'd like to work on this issue"
2. Wait for maintainer approval (usually quick for good first issues)
3. Only start work after claiming to avoid duplicate efforts

## 🛠️ Step 3: Development Setup

### 3.1 Install Dependencies
```bash
# Install all dependencies (extension + webview)
npm run install:all

# Verify installation
npm run test
```

### 3.2 Development Environment
```bash
# Open in VSCode
code .

# Install recommended extensions when prompted
# These are required for development
```

### 3.3 Understanding the Codebase
```
cline/
├── src/                    # Core extension (TypeScript)
│   ├── core/              # Main extension logic
│   ├── api/               # API providers
│   └── integrations/      # Tool integrations
├── webview-ui/            # React frontend
│   ├── src/components/    # UI components
│   └── src/context/       # State management
├── docs/                  # Documentation
└── package.json           # Extension manifest
```

## 🔧 Step 4: Implement Your Fix

### 4.1 Create Feature Branch
```bash
# Always sync with upstream first
git fetch upstream
git checkout main
git merge upstream/main
git push origin main

# Create new branch for your work
git checkout -b fix-issue-XXXX
# Example: git checkout -b fix-issue-4238-hide-mcp-popup
```

### 4.2 Development Workflow
```bash
# Make your changes
# Test locally
npm run test

# Format code
npm run format:fix

# Check linting
npm run lint

# Test in VSCode
# Press F5 to launch extension in development mode
```

### 4.3 Example Fix Implementation

**For Issue #4238 (Hide MCP notification popup):**

1. **Locate the component:** Search for MCP notification in `webview-ui/src/components/`
2. **Add setting:** Create a user preference to hide notifications
3. **Implement logic:** Conditionally render based on setting
4. **Test:** Verify popup can be hidden/shown

```typescript
// Example code structure
interface Settings {
  hideMcpNotifications?: boolean
}

const McpNotification = ({ settings }: { settings: Settings }) => {
  if (settings.hideMcpNotifications) {
    return null
  }
  
  return (
    <div className="mcp-notification">
      {/* notification content */}
    </div>
  )
}
```

### 4.4 Create Changeset (for user-facing changes)
```bash
npm run changeset

# Choose appropriate version bump:
# - patch: bug fixes (1.0.0 → 1.0.1)
# - minor: new features (1.0.0 → 1.1.0)  
# - major: breaking changes (1.0.0 → 2.0.0)

# Write clear description of changes
```

## 📝 Step 5: Document Your Changes

### 5.1 Commit Messages
Use conventional commit format:
```bash
git add .
git commit -m "fix: hide MCP notification popup when setting enabled

- Add hideMcpNotifications setting to user preferences
- Conditionally render notification based on setting
- Add toggle in settings panel
- Fixes #4238"
```

### 5.2 Test Your Changes
```bash
# Run all tests
npm run test

# Test in development mode
# Press F5 in VSCode to launch extension
# Verify your fix works as expected
```

## 🚀 Step 6: Create Pull Request

### 6.1 Push Your Branch
```bash
git push origin fix-issue-XXXX
```

### 6.2 Create PR on GitHub
1. Go to your fork on GitHub
2. Click "Compare & pull request"
3. Use this template:

```markdown
## Description
Fixes #XXXX - [Brief description of the issue]

## Problem
[Explain what issue this resolves and why it's important]
The MCP notification popup was always visible and couldn't be dismissed, 
causing UI clutter for users who don't need these notifications.

## Solution
[Describe your approach and implementation]
- Added `hideMcpNotifications` setting to user preferences
- Modified `McpNotification` component to conditionally render
- Added toggle control in settings panel
- Maintains backward compatibility (default: show notifications)

## Testing
- [x] Tested locally in development mode
- [x] All tests pass (`npm run test`)
- [x] No linting errors (`npm run lint`)
- [x] Formatted code (`npm run format:fix`)

## Steps to Test
1. Open Cline extension
2. Go to Settings
3. Toggle "Hide MCP Notifications" setting
4. Verify notifications appear/disappear as expected
5. Restart VSCode and verify setting persists

## Breaking Changes
- [ ] None
- [x] This is a non-breaking enhancement

## Changeset
- [x] Created changeset for this user-facing change
```

### 6.3 PR Requirements Checklist
- [ ] References specific issue number (`Fixes #XXXX`)
- [ ] Clear problem description
- [ ] Detailed solution explanation
- [ ] Testing steps provided
- [ ] All CI checks pass
- [ ] Changeset created (if user-facing)
- [ ] No breaking changes (or clearly documented)

## 🔄 Step 7: Handle Review Process

### 7.1 Respond to Feedback
- Address reviewer comments promptly
- Make requested changes in new commits
- Update PR description if scope changes

### 7.2 Keep PR Updated
```bash
# If upstream changes while PR is open
git fetch upstream
git checkout main
git merge upstream/main
git checkout fix-issue-XXXX
git rebase main
git push origin fix-issue-XXXX --force-with-lease
```

## 📊 Step 8: Track Your Contributions

### 8.1 Contribution Metrics
Keep track of:
- Issues claimed and completed
- PRs submitted and merged
- Review feedback and improvements
- Community engagement

### 8.2 Build Reputation
- Start with "Good First Issues"
- Gradually take on more complex problems
- Help review other contributors' PRs
- Participate in discussions

## 🎯 Priority Issues for AI Agents

**Recommended starting points:**

1. **UI/UX Improvements** (Easiest)
   - #4238: Hide MCP notification popup
   - #3742: Auto-approve sub-options UI bug
   - #4006: Fix message labeling

2. **Settings & Configuration** (Medium)
   - #4002: Terminal output line limits
   - #4198: Vertex AI region separation

3. **Bug Fixes** (Medium)
   - #3955: Discard changes functionality
   - Various provider-specific issues

## 🚨 Common Pitfalls to Avoid

1. **Starting work without claiming issue**
2. **Not syncing with upstream before starting**
3. **Making changes without tests**
4. **Forgetting to create changeset**
5. **Not following conventional commit format**
6. **Submitting PR without clear problem description**

## 🏆 Success Metrics

**A successful contribution includes:**
- ✅ Addresses a real user problem
- ✅ Follows project coding standards
- ✅ Includes appropriate tests
- ✅ Has clear documentation
- ✅ Maintains backward compatibility
- ✅ Gets merged into main branch

## 📚 Additional Resources

- **Cline Documentation:** https://docs.cline.bot
- **Contributing Guide:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Discord Community:** https://discord.gg/cline
- **Issue Templates:** https://github.com/cline/cline/issues/new/choose

---

## 🤖 AI Agent Specific Notes

**For AI agents implementing this workflow:**

1. **Always verify issue status** before starting work
2. **Test changes thoroughly** in development environment
3. **Follow exact commit message format** for consistency
4. **Include comprehensive PR descriptions** with problem/solution
5. **Monitor CI/CD pipeline** and fix any failures immediately
6. **Engage respectfully** with maintainers and community

This playbook ensures consistent, high-quality contributions that align with Cline's development standards and community expectations.
