# Contributing to Roo Code

We're thrilled you're interested in contributing to Roo Code. Whether you're fixing a bug, adding a feature, or improving our docs, every contribution makes Roo Code smarter! To keep our community vibrant and welcoming, all members must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Join Our Community

We strongly encourage all contributors to join our [Discord community](https://discord.gg/roocode)! Being part of our Discord server helps you:

- Get real-time help and guidance on your contributions
- Connect with other contributors and core team members
- Stay updated on project developments and priorities
- Participate in discussions that shape Roo Code's future
- Find collaboration opportunities with other developers

## Reporting Bugs or Issues

Bug reports help make Roo Code better for everyone! Before creating a new issue, please [search existing ones](https://github.com/RooVetGit/Roo-Code/issues) to avoid duplicates. When you're ready to report a bug, head over to our [issues page](https://github.com/RooVetGit/Roo-Code/issues/new/choose) where you'll find a template to help you with filling out the relevant information.

<blockquote class='warning-note'>
     🔐 <b>Important:</b> If you discover a security vulnerability, please use the <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">Github security tool to report it privately</a>.
</blockquote>

## Deciding What to Work On

Looking for a good first contribution? Check out issues in the "Issue [Unassigned]" section of our [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) Github Project. These are specifically curated for new contributors and areas where we'd love some help!

We also welcome contributions to our [documentation](https://docs.roocode.com/)! Whether it's fixing typos, improving existing guides, or creating new educational content - we'd love to build a community-driven repository of resources that helps everyone get the most out of Roo Code. You can click "Edit this page" on any page to quickly get to the right spot in Github to edit the file, or you can dive directly into https://github.com/RooVetGit/Roo-Code-Docs.

If you're planning to work on a bigger feature, please create a [feature request](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) first so we can discuss whether it aligns with Roo Code's vision. You may also want to check our [Project Roadmap](#project-roadmap) below to see if your idea fits with our strategic direction.

## Project Roadmap

Roo Code has a clear development roadmap that guides our priorities and future direction. Understanding our roadmap can help you:

- Align your contributions with project goals
- Identify areas where your expertise would be most valuable
- Understand the context behind certain design decisions
- Find inspiration for new features that support our vision

Our current roadmap focuses on six key pillars:

### Provider Support

We aim to support as many providers well as we can:

- More versatile "OpenAI Compatible" support
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Enhanced support for Ollama and LM Studio

### Model Support

We want Roo to work as well on as many models as possible, including local models:

- Local model support through custom system prompting and workflows
- Benchmarking evals and test cases

### System Support

We want Roo to run well on everyone's computer:

- Cross platform terminal integration
- Strong and consistent support for Mac, Windows, and Linux

### Documentation

We want comprehensive, accessible documentation for all users and contributors:

- Expanded user guides and tutorials
- Clear API documentation
- Better contributor guidance
- Multilingual documentation resources
- Interactive examples and code samples

### Stability

We want to significantly decrease the number of bugs and increase automated testing:

- Debug logging switch
- "Machine/Task Information" copy button for sending in with bug/support requests

### Internationalization

We want Roo to speak everyone's language:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

We especially welcome contributions that advance our roadmap goals. If you're working on something that aligns with these pillars, please mention it in your PR description.

## Development Setup

1. **Clone** the repo:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Install dependencies**:

```sh
npm run install:all
```

3. **Start the webview (Vite/React app with HMR)**:

```sh
npm run dev
```

4. **Debug**:
   Press `F5` (or **Run** → **Start Debugging**) in VSCode to open a new session with Roo Code loaded.

Changes to the webview will appear immediately. Changes to the core extension will require a restart of the extension host.

Alternatively you can build a .vsix and install it directly in VSCode:

```sh
npm run build
```

A `.vsix` file will appear in the `bin/` directory which can be installed with:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Writing and Submitting Code

Anyone can contribute code to Roo Code, but we ask that you follow these guidelines to ensure your contributions can be smoothly integrated:

1. **Keep Pull Requests Focused**

    - Limit PRs to a single feature or bug fix
    - Split larger changes into smaller, related PRs
    - Break changes into logical commits that can be reviewed independently

2. **Code Quality**

    - All PRs must pass CI checks which include both linting and formatting
    - Address any ESLint warnings or errors before submitting
    - Respond to all feedback from Ellipsis, our automated code review tool
    - Follow TypeScript best practices and maintain type safety

3. **Testing**

    - Add tests for new features
    - Run `npm test` to ensure all tests pass
    - Update existing tests if your changes affect them
    - Include both unit tests and integration tests where appropriate

4. **Commit Guidelines**

    - Write clear, descriptive commit messages
    - Reference relevant issues in commits using #issue-number

5. **Before Submitting**

    - Rebase your branch on the latest main
    - Ensure your branch builds successfully
    - Double-check all tests are passing
    - Review your changes for any debugging code or console logs

6. **Pull Request Description**
    - Clearly describe what your changes do
    - Include steps to test the changes
    - List any breaking changes
    - Add screenshots for UI changes

## Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the same license as the project ([Apache 2.0](LICENSE)).
