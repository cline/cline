# Contributing to Cline

We're thrilled you're interested in contributing to Cline. Whether you're fixing a bug, adding a feature, or improving our docs, every contribution makes Cline smarter! To keep our community vibrant and welcoming, all members must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting Bugs or Issues

Bug reports help make Cline better for everyone! Before creating a new issue, please [search existing ones](https://github.com/cline/cline/issues) to avoid duplicates. When you're ready to report a bug, head over to our [issues page](https://github.com/cline/cline/issues/new/choose) where you'll find a template to help you with filling out the relevant information.

<blockquote class='warning-note'>
     🔐 <b>Important:</b> If you discover a security vulnerability, please use the <a href="https://github.com/cline/cline/security/advisories/new">Github security tool to report it privately</a>.
</blockquote>

## Deciding What to Work On

Looking for a good first contribution? Check out issues labeled ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) or ["help wanted"](https://github.com/cline/cline/labels/help%20wanted). These are specifically curated for new contributors and areas where we'd love some help!

We also welcome contributions to our [documentation](https://github.com/cline/cline/tree/main/docs)! Whether it's fixing typos, improving existing guides, or creating new educational content - we'd love to build a community-driven repository of resources that helps everyone get the most out of Cline. You can start by diving into `/docs` and looking for areas that need improvement.

If you're planning to work on a bigger feature, please create a [feature request](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) first so we can discuss whether it aligns with Cline's vision.

## Development Setup

1. **VS Code Extensions**

    - When opening the project, VS Code will prompt you to install recommended extensions
    - These extensions are required for development - please accept all installation prompts
    - If you dismissed the prompts, you can install them manually from the Extensions panel

2. **Local Development**
    - Run `npm run install:all` to install dependencies
    - Run `npm run test` to run tests locally
    - Before submitting PR, run `npm run format:fix` to format your code

3. **Linux-specific Setup**
    VS Code extension tests on Linux require the following system libraries:

    - `dbus`
    - `libasound2`
    - `libatk-bridge2.0-0`
    - `libatk1.0-0`
    - `libdrm2`
    - `libgbm1`
    - `libgtk-3-0`
    - `libnss3`
    - `libx11-xcb1`
    - `libxcomposite1`
    - `libxdamage1`
    - `libxfixes3`
    - `libxkbfile1`
    - `libxrandr2`
    - `xvfb`

    These libraries provide necessary GUI components and system services for the test environment.

    For example, on Debian-based distributions (e.g., Ubuntu), you can install these libraries using apt:
    ```bash
    sudo apt update
    sudo apt install -y \
      dbus \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbfile1 \
      libxrandr2 \
      xvfb
    ```

    - Run `npm run test:ci` to run tests locally

## Writing and Submitting Code

Anyone can contribute code to Cline, but we ask that you follow these guidelines to ensure your contributions can be smoothly integrated:

1. **Keep Pull Requests Focused**

    - Limit PRs to a single feature or bug fix
    - Split larger changes into smaller, related PRs
    - Break changes into logical commits that can be reviewed independently

2. **Code Quality**

    - Run `npm run lint` to check code style
    - Run `npm run format` to automatically format code
    - All PRs must pass CI checks which include both linting and formatting
    - Address any ESLint warnings or errors before submitting
    - Follow TypeScript best practices and maintain type safety

3. **Testing**

    - Add tests for new features
    - Run `npm test` to ensure all tests pass
    - Update existing tests if your changes affect them
    - Include both unit tests and integration tests where appropriate

4. **Version Management with Changesets**

    - Create a changeset for any user-facing changes using `npm run changeset`
    - Choose the appropriate version bump:
        - `major` for breaking changes (1.0.0 → 2.0.0)
        - `minor` for new features (1.0.0 → 1.1.0)
        - `patch` for bug fixes (1.0.0 → 1.0.1)
    - Write clear, descriptive changeset messages that explain the impact
    - Documentation-only changes don't require changesets

5. **Commit Guidelines**

    - Write clear, descriptive commit messages
    - Use conventional commit format (e.g., "feat:", "fix:", "docs:")
    - Reference relevant issues in commits using #issue-number

6. **Before Submitting**

    - Rebase your branch on the latest main
    - Ensure your branch builds successfully
    - Double-check all tests are passing
    - Review your changes for any debugging code or console logs

7. **Pull Request Description**
    - Clearly describe what your changes do
    - Include steps to test the changes
    - List any breaking changes
    - Add screenshots for UI changes

## Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the same license as the project ([Apache 2.0](LICENSE)).

Remember: Contributing to Cline isn't just about writing code - it's about being part of a community that's shaping the future of AI-assisted development. Let's build something amazing together! 🚀
