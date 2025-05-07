**English** • [Català](locales/ca/CONTRIBUTING.md) • [Deutsch](locales/de/CONTRIBUTING.md) • [Español](locales/es/CONTRIBUTING.md) • [Français](locales/fr/CONTRIBUTING.md) • [हिंदी](locales/hi/CONTRIBUTING.md) • [Italiano](locales/it/CONTRIBUTING.md) • [Nederlands](locales/nl/CONTRIBUTING.md) • [Русский](locales/ru/CONTRIBUTING.md)

[日本語](locales/ja/CONTRIBUTING.md) • [한국어](locales/ko/CONTRIBUTING.md) • [Polski](locales/pl/CONTRIBUTING.md) • [Português (BR)](locales/pt-BR/CONTRIBUTING.md) • [Türkçe](locales/tr/CONTRIBUTING.md) • [Tiếng Việt](locales/vi/CONTRIBUTING.md) • [简体中文](locales/zh-CN/CONTRIBUTING.md) • [繁體中文](locales/zh-TW/CONTRIBUTING.md)

# Contributing to Roo Code

Roo Code is a community-driven project, and we highly value every contribution. To ensure a smooth and effective process for everyone, **we operate on an "[Issue-First](#2-key-principle-issue-first-approach)" basis.** This means all work should be linked to a GitHub Issue _before_ a Pull Request is submitted (see our [PR Policy](#pull-request-pr-policy) for details). Please read this guide carefully to understand how to contribute.
This guide outlines how to contribute to Roo Code, whether you're fixing bugs, adding features, or improving documentation.

## Table of Contents

- [I. Before You Contribute](#i-before-you-contribute)
    - [1. Code of Conduct](#1-code-of-conduct)
    - [2. Understand the Project Roadmap](#2-understand-the-project-roadmap)
        - [Provider Support](#provider-support)
        - [Model Support](#model-support)
        - [System Support](#system-support)
        - [Documentation](#documentation)
        - [Stability](#stability)
        - [Internationalization](#internationalization)
    - [3. Join the Roo Code Community](#3-join-the-roo-code-community)
- [II. Finding & Planning Your Contribution](#ii-finding--planning-your-contribution)
    - [1. Types of Contributions](#1-types-of-contributions)
    - [2. Key Principle: Issue-First Approach](#2-key-principle-issue-first-approach)
    - [3. Deciding What to Work On](#3-deciding-what-to-work-on)
    - [4. Reporting Bugs or Issues](#4-reporting-bugs-or-issues)
- [III. Development & Submission Process](#iii-development--submission-process)
    - [1. Development Setup](#1-development-setup)
    - [2. Writing Code Guidelines](#2-writing-code-guidelines)
    - [3. Submitting Code: Pull Request (PR) Process](#3-submitting-code-pull-request-pr-process)
        - [Draft Pull Requests](#draft-pull-requests)
        - [Pull Request Description](#pull-request-description)
        - [Pull Request (PR) Policy](#pull-request-pr-policy)
            - [Objective](#objective)
            - [Issue-First Approach](#issue-first-approach)
            - [Conditions for Open PRs](#conditions-for-open-prs)
            - [Procedure](#procedure)
            - [Responsibilities](#responsibilities)
- [IV. Legal](#iv-legal)
    - [Contribution Agreement](#contribution-agreement)

## I. Before You Contribute

First, familiarize yourself with our community standards and project direction.

### 1. Code of Conduct

All contributors must adhere to our [Code of Conduct](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md). Please read it before contributing.

### 2. Understand the Project Roadmap

Roo Code has a clear development roadmap that guides our priorities and future direction. Understanding our roadmap can help you:

- Align your contributions with project goals
- Identify areas where your expertise would be most valuable
- Understand the context behind certain design decisions
- Find inspiration for new features that support our vision

Our current roadmap focuses on six key pillars:

#### Provider Support

We aim to support as many providers well as we can:

- More versatile "OpenAI Compatible" support
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Enhanced support for Ollama and LM Studio

#### Model Support

We want Roo to work as well on as many models as possible, including local models:

- Local model support through custom system prompting and workflows
- Benchmarking evals and test cases

#### System Support

We want Roo to run well on everyone's computer:

- Cross platform terminal integration
- Strong and consistent support for Mac, Windows, and Linux

#### Documentation

We want comprehensive, accessible documentation for all users and contributors:

- Expanded user guides and tutorials
- Clear API documentation
- Better contributor guidance
- Multilingual documentation resources
- Interactive examples and code samples

#### Stability

We want to significantly decrease the number of bugs and increase automated testing:

- Debug logging switch
- "Machine/Task Information" copy button for sending in with bug/support requests

#### Internationalization

We want Roo to speak everyone's language:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

We especially welcome contributions that advance our roadmap goals. If you're working on something that aligns with these pillars, please mention it in your PR description.

### 3. Join the Roo Code Community

Connecting with the Roo Code community is a great way to get started:

- **Primary Method**:
    1.  Join the [Roo Code Discord community](https://discord.gg/roocode).
    2.  Once joined, send a direct message (DM) to **Hannes Rudolph** (Discord username: `hrudolph`) to discuss your interest and get guidance.
- **Alternative for Experienced Contributors**: If you're comfortable with an issue-first approach, you can engage directly through GitHub by following the [Kanban board](https://github.com/orgs/RooVetGit/projects/1) and communicating via issues and pull requests.

## II. Finding & Planning Your Contribution

Identify what you'd like to work on and how to approach it.

### 1. Types of Contributions

We welcome various contributions:

- **Bug Fixes**: Addressing issues in existing code.
- **New Features**: Adding new functionality.
- **Documentation**: Improving guides, examples, or fixing typos.

### 2. Key Principle: Issue-First Approach

**All contributions must start with a GitHub Issue.** This is a critical step to ensure alignment and prevent wasted effort.

- **Find or Create an Issue**:
    - Before starting any work, search [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) to see if an issue for your intended contribution already exists.
    - If it exists and is unassigned, comment on the issue to express your interest in taking it on. A maintainer will then assign it to you.
    - If no issue exists, create a new one using the appropriate template on our [issues page](https://github.com/RooVetGit/Roo-Code/issues/new/choose):
        - For bugs, use the "Bug Report" template.
        - For new features, use the "Detailed Feature Proposal" template. Await approval from a maintainer (especially @hannesrudolph) before proceeding with implementation.
        - **Note**: General ideas or preliminary discussions for features can start in [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Once an idea is more concrete, a "Detailed Feature Proposal" issue should be created.
- **Claiming and Assignment**:
    - Clearly state your intention to work on an issue by commenting on it.
    - Wait for a maintainer to officially assign the issue to you in GitHub. This prevents multiple people from working on the same thing.
- **Consequences of Not Following**:
    - Pull Requests (PRs) submitted without a corresponding, pre-approved, and assigned issue may be closed without a full review. This policy is in place to ensure contributions align with project priorities and to respect the time of both contributors and maintainers.

This approach helps us track work, ensure changes are desired, and coordinate efforts effectively.

### 3. Deciding What to Work On

- **Good First Issues**: Check the "Issue [Unassigned]" section of our [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) GitHub Project.
- **Documentation**: While this `CONTRIBUTING.md` is the primary guide for code contributions, if you're interested in contributing to other documentation (like user guides or API docs), please check the [Roo Code Docs repository](https://github.com/RooVetGit/Roo-Code-Docs) or inquire in the Discord community.
- **Proposing New Features**:
    1.  **Initial Idea/Discussion**: For broad or initial feature ideas, start a conversation in [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Formal Proposal**: For specific, actionable feature proposals ready for consideration and potential approval, create a "Detailed Feature Proposal" issue using the template on our [issues page](https://github.com/RooVetGit/Roo-Code/issues/new/choose). This is a key part of our **Issue-First Approach**.

### 4. Reporting Bugs or Issues

If you find a bug:

1.  **Search Existing Issues**: Check [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) for duplicates.
2.  **Create a New Issue**: If unique, use the "Bug Report" template on our [issues page](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Security Vulnerabilities**: If you discover a security vulnerability, please report it privately using [GitHub's security advisory tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Do not create a public issue for security vulnerabilities.

## III. Development & Submission Process

Follow these steps for coding and submitting your work.

### 1. Development Setup

1.  **Fork & Clone**:
    - Fork the repository on GitHub.
    - Clone your fork locally: `git clone https://github.com/YOUR_USERNAME/Roo-Code.git`
2.  **Install Dependencies**: `npm run install:all`
3.  **Run Webview (Dev Mode)**: `npm run dev` (for Vite/React app with HMR)
4.  **Debug Extension**: Press `F5` in VS Code (or **Run** → **Start Debugging**) to open a new Extension Development Host window with Roo Code loaded.

Webview changes (in `webview-ui`) will appear immediately with Hot Module Replacement. Changes to the core extension (in `src`) will require a restart of the Extension Development Host.

Alternatively, to build and install a `.vsix` package:

```sh
npm run build
code --install-extension bin/roo-cline-<version>.vsix
```

(Replace `<version>` with the actual version number from the built file).

### 2. Writing Code Guidelines

- **Focused PRs**: One feature/bug fix per PR.
- **Code Quality**:
    - Pass CI checks (linting, formatting).
    - Address ESLint warnings or errors (`npm run lint`).
    - Respond to feedback from automated code review tools (e.g., Ellipsis, if configured).
    - Follow TypeScript best practices and maintain type safety.
- **Testing**:
    - Add tests for new features.
    - Run `npm test` to ensure all tests pass.
    - Update existing tests if your changes affect them.
- **Commit Messages**:
    - Write clear, descriptive commit messages.
    - Reference relevant issues in commits using `#issue-number` (e.g., `Fixes #123`).
- **Pre-Submission Checklist (before creating a PR)**:
    - Rebase your branch on the latest `main` from the upstream repository.
    - Ensure your code builds successfully (`npm run build`).
    - Double-check all tests are passing (`npm test`).
    - Remove any debugging code or `console.log` statements.

### 3. Submitting Code: Pull Request (PR) Process

#### Draft Pull Requests

Use Draft PRs for work that is not yet ready for full review but for which you'd like to:

- Run automated checks (CI).
- Get early feedback from maintainers or other contributors.
- Signal that the work is in progress.

Mark a PR as "Ready for Review" only when all checks are passing and you believe it meets the criteria outlined in the "Writing Code Guidelines" and "Pull Request Description" sections.

#### Pull Request Description

Your PR description must be comprehensive and follow the structure provided by our [Pull Request Template](.github/pull_request_template.md). Key elements include:

- A link to the approved GitHub Issue it addresses.
- A clear description of the changes made and their purpose.
- Detailed steps to test the changes.
- A list of any breaking changes.
- **For UI changes, provide clear before-and-after screenshots or videos.**
- **Crucially, state whether your PR necessitates updates to user-facing documentation. If so, specify which documents or sections are affected.**

#### Pull Request (PR) Policy

##### Objective

Maintain a clean, focused, and actionable PR backlog.

##### Issue-First Approach

- **Required**: Before starting work, ensure there is an existing, approved, and assigned GitHub Issue (either a "Bug Report" or a "Detailed Feature Proposal"). (See "Key Principle: Issue-First Approach" under "II. Finding & Planning Your Contribution" for full details).
- **Approval**: Issues, especially "Detailed Feature Proposals" or those involving significant changes, must be reviewed and approved by maintainers (particularly @hannesrudolph) _before_ coding begins.
- **Reference**: PRs must explicitly reference these pre-approved issues in their description.
- **Consequences**: Failure to follow this process may result in your PR being closed without a full review.

##### Conditions for Open PRs

- **Ready for Merge**: Passes all CI tests, aligns with the project roadmap (if applicable), is linked to an approved and assigned issue, has clear documentation/comments, includes clear before-and-after images or videos for any UI changes.
- **To be Closed**: Unresolved CI test failures, significant merge conflicts, misalignment with project goals, or prolonged inactivity (e.g., >30 days without updates after feedback).

##### Procedure

1.  **Issue Qualification & Assignment**: @hannesrudolph (or other maintainers) reviews new and existing issues to ensure they align with the project and follow the "Issue-First Approach." Issues ready for work are assigned.
2.  **Initial PR Triage (Daily)**: Maintainers conduct a quick daily review of incoming PRs to filter for urgency or critical issues.
3.  **Thorough PR Review (Weekly - Mondays, or as capacity allows)**: Maintainers perform a more in-depth review of PRs to assess readiness, alignment with an approved issue, and overall quality.
4.  **Detailed Feedback & Iteration**: Based on the thorough review, maintainers provide feedback (Approve, Request Changes, or Reject). Contributors are expected to respond to feedback and iterate as needed.
5.  **Decision Stage**: Approved PRs are merged. PRs with unresolvable issues or misalignment may be closed with a clear explanation.
6.  **Follow-up**: Authors of closed PRs are encouraged to address feedback and open new ones if issues are resolved or project direction shifts.

##### Responsibilities

- **Issue Qualification & Process Adherence (@hannesrudolph & Maintainers)**: Ensure all contributions adhere to the "Issue-First Approach" by reviewing, qualifying, and assigning issues. Guide contributors on process.
- **Maintainers (Dev Team)**: Conduct initial and thorough PR reviews, provide technical feedback, make approval/rejection decisions, and merge PRs.
- **Contributors**: Ensure PRs are linked to an approved and assigned issue, meet quality guidelines, and respond promptly to feedback.

This policy ensures clarity and efficient integration.

## IV. Legal

### Contribution Agreement

By submitting a pull request, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE) (or the project's current license, if different), the same as the project.
