# Cline+ DAG-Aware Agent — Environment Setup Guide

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [x] Guide is informational; no code changes required

## Prerequisites

Before setting up the development environment, ensure you have the following installed:

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 20+ | Extension runtime |
| npm | 10+ | Package management |
| Python | 3.12+ | DAG analysis engine |
| pip | 24+ | Python package management |
| Git | 2.40+ | Version control |
| VS Code | 1.95+ | Development IDE |

### Verify Prerequisites

```bash
# Check Node.js
node --version
# Expected: v20.x.x or higher

# Check npm
npm --version
# Expected: 10.x.x or higher

# Check Python
python3 --version
# Expected: Python 3.12.x or higher

# Check pip
pip --version
# Expected: pip 24.x or higher

# Check Git
git --version
# Expected: git version 2.40.x or higher

# Check VS Code CLI
code --version
# Expected: 1.95.x or higher
```

## Local Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/cline-dag/cline-dag
cd cline-dag
```

### 2. Install Extension Dependencies

```bash
# Install npm packages
npm install

# Verify installation
npm ls --depth=0
```

### 3. Set Up Python Environment

We recommend using a virtual environment for the DAG engine:

```bash
# Navigate to DAG engine directory
cd dag-engine

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
# Linux/macOS:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Install dependencies with dev extras
pip install -e ".[dev]"

# Verify installation
python -c "from cline_dag import server; print('DAG engine ready')"

# Return to project root
cd ..
```

### 4. Configure VS Code

Create or update `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff"
  },
  "python.defaultInterpreterPath": "${workspaceFolder}/dag-engine/.venv/bin/python",
  "cline-dag.dag.pythonPath": "${workspaceFolder}/dag-engine/.venv/bin/python"
}
```

Create or update `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/dist/**/*.js"
      ],
      "preLaunchTask": "npm: watch"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/dist/test"
      ],
      "outFiles": [
        "${workspaceFolder}/dist/**/*.js"
      ],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

Create or update `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "label": "npm: watch",
      "presentation": {
        "reveal": "never"
      }
    },
    {
      "type": "npm",
      "script": "build",
      "problemMatcher": "$tsc",
      "label": "npm: build"
    }
  ]
}
```

### 5. Environment Variables

Create `.env` file in the project root (do not commit this file):

```bash
# LLM Provider API Keys (set the one you're using)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# Optional: Custom Python path if not using venv
# PYTHON_PATH=/usr/local/bin/python3.12

# Optional: Enable debug logging
# DEBUG=cline-dag:*
```

Create `.env.example` as a template:

```bash
# LLM Provider API Keys
# Set at least one of these based on your preferred provider
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Optional: Custom Python path
# PYTHON_PATH=

# Optional: Enable debug logging
# DEBUG=
```

### 6. Build the Extension

```bash
# Development build with source maps
npm run build

# Watch mode for development
npm run watch
```

### 7. Run Locally

**Option A: VS Code Debug Mode (Recommended)**

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. A new VS Code window opens with the extension loaded
4. Open a test project and try the commands

**Option B: Manual Testing**

```bash
# Package the extension
npm run package

# Install locally
code --install-extension cline-dag-0.1.0.vsix
```

## Running Tests

### TypeScript Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Python Tests

```bash
cd dag-engine

# Activate virtual environment
source .venv/bin/activate

# Run all tests
pytest

# With coverage
pytest --cov=cline_dag --cov-report=html

# Run specific test file
pytest tests/test_python_parser.py

# Verbose output
pytest -v
```

## Code Quality

### Linting

```bash
# TypeScript/JavaScript
npm run lint

# Auto-fix issues
npm run lint:fix

# Python
cd dag-engine && ruff check .

# Auto-fix Python
cd dag-engine && ruff check --fix .
```

### Type Checking

```bash
# TypeScript (via build)
npm run build

# Python
cd dag-engine && mypy cline_dag
```

### Formatting

```bash
# TypeScript/JavaScript
npx prettier --write "src/**/*.{ts,tsx}"

# Python
cd dag-engine && ruff format .
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `npm install` fails with permission errors | Use `npm install --no-optional` or fix npm permissions |
| Python module not found | Ensure virtual environment is activated |
| Extension doesn't activate | Check Output panel for errors; verify build completed |
| DAG engine subprocess crashes | Check stderr output; verify Python version ≥3.12 |
| TypeScript errors in VS Code | Run `npm run build` and restart TS server |
| Import errors in Python | Run `pip install -e ".[dev]"` in dag-engine directory |

### Clearing Caches

```bash
# Node modules
rm -rf node_modules
npm install

# Python cache
cd dag-engine
rm -rf .mypy_cache .pytest_cache .ruff_cache __pycache__
find . -type d -name __pycache__ -exec rm -rf {} +

# VS Code extension host
# Close all Extension Development Host windows
# Delete ~/.vscode/extensions/cline-dag-*
```

### Debugging the DAG Engine

To run the DAG engine standalone for debugging:

```bash
cd dag-engine
source .venv/bin/activate

# Run server manually
python -m cline_dag.server

# Send a test request (in another terminal)
echo '{"jsonrpc":"2.0","id":1,"method":"get_status","params":{}}' | python -m cline_dag.server
```

### VS Code Extension Logs

1. Open the Extension Development Host
2. Open Command Palette (`Ctrl+Shift+P`)
3. Run "Developer: Open Extension Logs Folder"
4. Check logs for the Cline+ extension

## IDE Recommendations

### Recommended VS Code Extensions

- **ESLint** (`dbaeumer.vscode-eslint`) - JavaScript/TypeScript linting
- **Prettier** (`esbenp.prettier-vscode`) - Code formatting
- **Ruff** (`charliermarsh.ruff`) - Python linting and formatting
- **Python** (`ms-python.python`) - Python language support
- **Error Lens** (`usernamehw.errorlens`) - Inline error display

### Recommended Settings

Add to your user settings for optimal development experience:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "python.analysis.typeCheckingMode": "basic"
}
```

---

**Document Version:** 1.0  
**Last Updated:** 28 January 2026
