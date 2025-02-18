# Release Notes Scripts

This directory contains Python scripts for managing release notes, version bumping, and changelog updates.

## Development Setup

### Prerequisites

- Python 3.10 or higher
- [uv](https://github.com/astral-sh/uv) - Fast Python package installer
  ```bash
  brew install uv
  ```
- [act](https://github.com/nektos/act) - Run GitHub Actions locally
  ```bash
  brew install act
  ```

### Environment Variables

For local testing, you'll need:
- `OPENROUTER_API_KEY` - Your OpenRouter API key for release notes generation

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
# Run all tests (including integration tests)
python -m pytest test_*.py -v --api-key=your_openrouter_api_key

# Run tests with coverage report
python -m pytest test_*.py -v --cov=. --cov-report=term-missing --api-key=your_openrouter_api_key

# Run specific test file
python -m pytest test_version_manager.py -v

# Run specific test
python -m pytest test_version_manager.py::TestVersionManager::test_bump_version -v

# Run unit tests only (excluding integration tests)
python -m pytest test_*.py -v --ignore=test_integration.py

# Run integration tests only
python -m pytest test_integration.py -v --api-key=your_openrouter_api_key
```

### Integration Testing

The test suite includes integration tests that verify:
1. Complete release flow with OpenRouter API calls
2. Error handling (rate limits, invalid keys)
3. Changelog updates and version management

Integration tests require a valid OpenRouter API key passed via the --api-key parameter. This ensures:
- Real API interactions are tested
- No reliance on environment variables
- Clear separation between unit and integration tests
- Explicit API key management

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
  --changesets '[{"type":"major","content":"Added new feature"}]' \
  --api-key your_openrouter_api_key
```

### overwrite_changeset_changelog.py
Updates CHANGELOG.md with new release notes, maintaining proper formatting and structure.

```bash
python overwrite_changeset_changelog.py \
  --version v3.3.0 \
  --content "Release notes content" \
  --changelog-path CHANGELOG.md
```

## End-to-End Testing

### test-release.sh
Runs the complete release workflow locally using GitHub CLI, exactly as it would run in production:

```bash
# Run a test pre-release
./test-release.sh
```

This script triggers the publish workflow with pre-release mode, allowing you to verify:
- Version bumping from changesets
- Release notes generation
- Changelog updates
- Complete workflow integration

## Testing

The test suite includes:
- Unit tests for all core functionality
- Integration tests with real API calls
- Mock git commands and file operations
- Edge case handling
- Pre-release to release transitions
- Error scenarios

### Test Files

- `test_version_manager.py`: Tests version bumping logic
- `test_generate_release_notes.py`: Tests release notes generation
- `test_overwrite_changelog.py`: Tests changelog updating
- `test_integration.py`: End-to-end integration tests

## Command Line Arguments

### For Tests
- `--api-key`: Required for integration tests. Provides the OpenRouter API key.

### For Scripts
- `--release-type`: Type of release (release or pre-release)
- `--version`: Version number for the release
- `--changesets`: JSON string of changes
- `--content`: Release notes content
- `--changelog-path`: Path to changelog file
- `--github-output`: Optional, path for GitHub Actions output
- `--api-key`: Required for generate_release_notes.py, OpenRouter API key

## Adding New Tests

1. Create test file following the naming convention `test_*.py`
2. Use pytest fixtures for common setup
3. Mock external dependencies (git commands, file operations)
4. Include both success and error cases
5. Add to existing test suite

Example:
```python
def test_new_feature(self):
    # Unit test example
    result = my_function()
    assert result == expected_value

def test_api_integration(self, api_key):
    # Integration test example
    result = my_api_function(api_key=api_key)
    assert result is not None
