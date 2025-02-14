# Release Notes Scripts

This directory contains Python scripts for managing release notes, version bumping, and changelog updates.

## Development Setup

### Prerequisites

- Python 3.10 or higher
- [uv](https://github.com/astral-sh/uv) - Fast Python package installer
  ```bash
  brew install uv
  ```

### Setting Up Development Environment

1. Create and activate a virtual environment:
   ```bash
   cd .github/scripts
   uv venv
   source .venv/bin/activate  # On Unix/macOS
   # or
   .venv\Scripts\activate  # On Windows
   ```

2. Install dependencies:
   ```bash
   uv pip install -r requirements.txt
   ```

### Running Tests

With the virtual environment activated:

```bash
# Run all tests with verbose output
python -m pytest test_*.py -v

# Run tests with coverage report
python -m pytest test_*.py -v --cov=. --cov-report=term-missing

# Run specific test file
python -m pytest test_version_manager.py -v

# Run specific test
python -m pytest test_version_manager.py::TestVersionManager::test_bump_version -v
```

## Scripts Overview

### version_manager.py
Handles version bumping based on changesets. Determines the appropriate version bump (major, minor, patch) based on accumulated changes.

```bash
python version_manager.py --release-type release
python version_manager.py --release-type pre-release
```

### generate_release_notes.py
Generates release notes using OpenRouter's Claude model. Analyzes changesets and git history to create comprehensive release notes.

```bash
python generate_release_notes.py \
  --release-type release \
  --version v3.3.0 \
  --changesets '[{"type":"major","content":"Added new feature"}]'
```

### overwrite_changeset_changelog.py
Updates CHANGELOG.md with new release notes, maintaining proper formatting and structure.

```bash
python overwrite_changeset_changelog.py \
  --version v3.3.0 \
  --content "Release notes content" \
  --changelog-path CHANGELOG.md
```

## Testing

The test suite includes:
- Unit tests for all core functionality
- Mock git commands and file operations
- Edge case handling
- Pre-release to release transitions
- Error scenarios

### Test Files

- `test_version_manager.py`: Tests version bumping logic
- `test_generate_release_notes.py`: Tests release notes generation
- `test_overwrite_changelog.py`: Tests changelog updating

## Environment Variables

When running scripts directly (not through tests):

- `OPENROUTER_API_KEY`: Required for generate_release_notes.py
- `GITHUB_OUTPUT`: Optional, path for GitHub Actions output

## Adding New Tests

1. Create test file following the naming convention `test_*.py`
2. Use pytest fixtures for common setup
3. Mock external dependencies (git commands, file operations)
4. Include both success and error cases
5. Add to existing test suite

Example:
```python
@patch('subprocess.check_output')
def test_new_feature(self, mock_check_output):
    mock_check_output.return_value = "test output".encode()
    result = my_function()
    self.assertEqual(result, expected_value)
