# Cline Privacy Policy

Cline Bot Inc. ("Cline," "we," "our," and/or "us") values the privacy of individuals who use our VS Code extension and related services (collectively, our "Services"). This privacy policy explains how we collect, use, and disclose information from users of our Services.

## Key Points

-   Cline operates entirely client-side as a VS Code extension
-   No code or data is collected, stored, or transmitted to Cline's servers
-   Your data is only sent to your chosen AI provider (e.g., Anthropic, OpenAI) when you explicitly request assistance
-   All processing happens locally on your machine
-   API keys are stored securely in VS Code's built-in settings storage
-   Telemetry is collected anonymously via PostHog if the user opts in

## Information We Process

### A. Information You Provide

-   **API Keys**: When you choose to use certain AI model providers (OpenRouter, Anthropic, OpenAI, etc.), you provide API keys. These are stored securely and locally in your VS Code settings.
-   **Communications**: If you contact us directly (e.g., via Discord or email), we may receive information like your name, email address, and message contents.

### B. Information Processing

Cline functions solely as a client-side VS Code extension that facilitates communication between your editor and your chosen AI model provider:

1. **File Contents**:

    - Only sent to your chosen AI provider when you explicitly request assistance
    - Never stored or transmitted to Cline's servers
    - Only the specific files/content you select are included

2. **Terminal Commands**:

    - Processed entirely locally on your machine
    - Require explicit user confirmation before execution
    - No command history is transmitted to Cline

3. **Browser Integration**:
    - Screenshots and console logs are processed locally
    - Temporary data is cleared after task completion

## Data Security

1. **Local-Only Processing**:

    - All operations happen on your local machine
    - No central servers or data collection
    - No telemetry or usage statistics gathered unless the user opts in
    - No account creation required

2. **API Key Security**:

    - Stored using VS Code's secure settings storage system
    - Never transmitted to Cline's servers
    - You can remove/modify keys at any time

3. **User Control**:
    - Explicit approval required for file changes
    - Terminal commands require confirmation
    - Browser actions need explicit permission
    - You control which AI provider to use

## Communication with AI Providers

When you request assistance:

1. Selected content is sent directly to your chosen AI provider
2. No data passes through Cline's servers
3. Provider's own privacy policy applies to this communication:
    - [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
    - [OpenAI Privacy Policy](https://openai.com/privacy)
    - [OpenRouter Privacy Policy](https://openrouter.ai/privacy)

## Error Handling & Debugging

-   Error logs are processed locally
-   No automatic error reporting to Cline
-   You control what information to include when reporting issues

## Children's Privacy

We do not knowingly collect, maintain, or use personal information from children under 18 years of age, and no part of our Service(s) is directed to children. If you learn that a child has provided us with personal information in violation of this Privacy Policy, then you may alert us at support@cline.bot.

## Changes to Privacy Policy

We will post any changes to this policy on our GitHub repository. Significant changes will be announced in our Discord community.

## Security Concerns & Auditing

-   Cline is open source and available for security audit
-   Our client-side architecture ensures no central point of data collection
-   You can inspect exactly what data is being sent to AI providers
-   Enterprise users can implement additional access controls through VS Code

## Contact Us

For privacy-related questions or concerns:

-   Open an issue on our [GitHub repository](https://github.com/cline/cline)
-   Join our [Discord community](https://discord.gg/cline)
-   Email: support@cline.bot
