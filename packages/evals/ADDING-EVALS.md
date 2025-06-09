# Adding Additional Evals Exercises

This guide explains how to add new coding exercises to the Roo Code evals system. The evals system is a distributed evaluation platform that runs AI coding tasks in isolated VS Code environments to test AI coding capabilities across multiple programming languages.

## Table of Contents

1. [What is an "Eval"?](#what-is-an-eval)
2. [System Overview](#system-overview)
3. [Adding Exercises to Existing Languages](#adding-exercises-to-existing-languages)
4. [Adding Support for New Programming Languages](#adding-support-for-new-programming-languages)

## What is an "Eval"?

An **eval** (evaluation) is fundamentally a coding exercise with a known solution that is expressed as a set of unit tests that must pass in order to prove the correctness of a solution. Each eval consists of:

- **Problem Description**: Clear instructions explaining what needs to be implemented
- **Implementation Stub**: A skeleton file with function signatures but no implementation
- **Unit Tests**: Comprehensive test suite that validates the correctness of the solution
- **Success Criteria**: The AI must implement the solution such that all unit tests pass

The key principle is that the tests define the contract - if all tests pass, the solution is considered correct. This provides an objective, automated way to measure AI coding performance across different programming languages and problem domains.

**Example Flow**:

1. AI receives a problem description (e.g., "implement a function that reverses a string")
2. AI examines the stub implementation and test file
3. AI writes code to make all tests pass
4. System runs tests to verify correctness
5. Success is measured by test pass/fail rate

## System Overview

The evals system consists of several key components:

- **Exercises Repository**: [`Roo-Code-Evals`](https://github.com/RooCodeInc/Roo-Code-Evals) - Contains all exercise definitions
- **Web Interface**: [`apps/web-evals`](../apps/web-evals) - Management interface for creating and monitoring evaluation runs
- **Evals Package**: [`packages/evals`](../packages/evals) - Contains both controller logic for orchestrating evaluation runs and runner container code for executing individual tasks
- **Docker Configuration**: Container definitions for the `controller` and `runner` as well as a Docker Compose file that provisions Postgres and Redis instances required for eval runs.

### Current Language Support

The system currently supports these programming languages:

- **Go** - `go test` for testing
- **Java** - Maven/Gradle for testing
- **JavaScript** - Node.js with Jest/Mocha
- **Python** - pytest for testing
- **Rust** - `cargo test` for testing

## Adding Exercises to Existing Languages

TL;DR - Here's a pull request that adds a new JavaScript eval: https://github.com/RooCodeInc/Roo-Code-Evals/pull/3

### Step 1: Understand the Exercise Structure

Each exercise follows a standardized directory structure:

```
/evals/{language}/{exercise-name}/
├── docs/
│   ├── instructions.md          # Main exercise description
│   └── instructions.append.md   # Additional instructions (optional)
├── {exercise-name}.{ext}        # Implementation stub
├── {exercise-name}_test.{ext}   # Test file
└── {language-specific-files}    # go.mod, package.json, etc.
```

### Step 2: Create Exercise Directory

1. **Clone the evals repository**:

    ```bash
    git clone https://github.com/RooCodeInc/Roo-Code-Evals.git evals
    cd evals
    ```

2. **Create exercise directory**:
    ```bash
    mkdir {language}/{exercise-name}
    cd {language}/{exercise-name}
    ```

### Step 3: Write Exercise Instructions

Create `docs/instructions.md` with a clear problem description:

```markdown
# Instructions

Create an implementation of [problem description].

## Problem Description

[Detailed explanation of what needs to be implemented]

## Examples

- Input: [example input]
- Output: [expected output]

## Constraints

- [Any constraints or requirements]
```

**Example from a simple reverse-string exercise**:

```markdown
# Instructions

Create a function that reverses a string.

## Problem Description

Write a function called `reverse` that takes a string as input and returns the string with its characters in reverse order.

## Examples

- Input: `reverse("hello")` → Output: `"olleh"`
- Input: `reverse("world")` → Output: `"dlrow"`
- Input: `reverse("")` → Output: `""`
- Input: `reverse("a")` → Output: `"a"`

## Constraints

- Input will always be a valid string
- Empty strings should return empty strings
```

### Step 4: Create Implementation Stub

Create the main implementation file with function signatures but no implementation:

**Python example** (`reverse_string.py`):

```python
def reverse(text):
    pass
```

**Go example** (`reverse_string.go`):

```go
package reversestring

// Reverse returns the input string with its characters in reverse order
func Reverse(s string) string {
    // TODO: implement
    return ""
}
```

### Step 5: Write Comprehensive Tests

Create test files that validate the implementation:

**Python example** (`reverse_string_test.py`):

```python
import unittest
from reverse_string import reverse

class ReverseStringTest(unittest.TestCase):
    def test_reverse_hello(self):
        self.assertEqual(reverse("hello"), "olleh")

    def test_reverse_world(self):
        self.assertEqual(reverse("world"), "dlrow")

    def test_reverse_empty_string(self):
        self.assertEqual(reverse(""), "")

    def test_reverse_single_character(self):
        self.assertEqual(reverse("a"), "a")
```

**Go example** (`reverse_string_test.go`):

```go
package reversestring

import "testing"

func TestReverse(t *testing.T) {
    tests := []struct {
        input    string
        expected string
    }{
        {"hello", "olleh"},
        {"world", "dlrow"},
        {"", ""},
        {"a", "a"},
    }

    for _, test := range tests {
        result := Reverse(test.input)
        if result != test.expected {
            t.Errorf("Reverse(%q) = %q, expected %q", test.input, result, test.expected)
        }
    }
}
```

### Step 6: Add Language-Specific Configuration

**For Go exercises**, create `go.mod`:

```go
module reverse-string

go 1.18
```

**For Python exercises**, ensure the parent directory has `pyproject.toml`:

```toml
[project]
name = "python-exercises"
version = "0.1.0"
description = "Python exercises for Roo Code evals"
requires-python = ">=3.9"
dependencies = [
    "pytest>=8.3.5",
]
```

### Step 7: Test Locally

Before committing, test your exercise locally:

**Python**:

```bash
cd python/reverse-string
uv run python3 -m pytest -o markers=task reverse_string_test.py
```

**Go**:

```bash
cd go/reverse-string
go test
```

The tests should **fail** with the stub implementation and **pass** when properly implemented.

## Adding Support for New Programming Languages

Adding a new programming language requires changes to both the evals repository and the main Roo Code repository.

### Step 1: Update Language Configuration

1. **Add language to supported list** in [`packages/evals/src/exercises/index.ts`](../packages/evals/src/exercises/index.ts):

```typescript
export const exerciseLanguages = [
	"go",
	"java",
	"javascript",
	"python",
	"rust",
	"your-new-language", // Add here
] as const
```

### Step 2: Create Language-Specific Prompt

Create `prompts/{language}.md` in the evals repository:

```markdown
Your job is to complete a coding exercise described the markdown files inside the `docs` directory.

A file with the implementation stubbed out has been created for you, along with a test file (the tests should be failing initially).

To successfully complete the exercise, you must pass all the tests in the test file.

To confirm that your solution is correct, run the tests with `{test-command}`. Do not alter the test file; it should be run as-is.

Do not use the "ask_followup_question" tool. Your job isn't done until the tests pass. Don't attempt completion until you run the tests and they pass.

You should start by reading the files in the `docs` directory so that you understand the exercise, and then examine the stubbed out implementation and the test file.
```

Replace `{test-command}` with the appropriate testing command for your language.

### Step 3: Update Docker Configuration

Modify [`packages/evals/Dockerfile.runner`](../packages/evals/Dockerfile.runner) to install the new language runtime:

```dockerfile
# Install your new language runtime
RUN apt update && apt install -y your-language-runtime

# Or for languages that need special installation:
ARG YOUR_LANGUAGE_VERSION=1.0.0
RUN curl -sSL https://install-your-language.sh | sh -s -- --version ${YOUR_LANGUAGE_VERSION}
```

### Step 4: Update Test Runner Integration

If your language requires special test execution, update [`packages/evals/src/cli/runUnitTest.ts`](../packages/evals/src/cli/runUnitTest.ts) to handle the new language's testing framework.

### Step 5: Create Initial Exercises

Create at least 2-3 exercises for the new language following the structure described in the previous section.
