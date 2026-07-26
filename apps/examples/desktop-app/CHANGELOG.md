# Cline Code Desktop Changelog

## 0.0.4

- Start chatting without opening a project folder — the app now supports workspace-free chat sessions.
- New first-run onboarding flow to get you set up on launch.
- Drag and drop files directly onto the chat to attach them.
- Image attachments now display inline in the chat transcript.
- Schedule one-time routines (not just recurring ones), with navigation to jump to a routine's run.
- New custom overlay title bar with in-app navigation.
- Redesigned channel setup as expandable cards.
- Added a setting to replay the new-user experience.
- Cleaner chat markdown rendering, and external links now open correctly in your browser.
- Agent sessions now use agentic compaction by default, keeping long conversations within context more intelligently.
- Fixed the agent not finding `gh` and other CLI tools by resolving your login shell's PATH.
- Headless routines now default to YOLO mode so they can run unattended.
- Fixed request metering for the SAP AI Core provider.

## 0.0.3

- The reasoning section in the chat transcript now reads simply "Thinking" — dropped the redundant status text and brain icon.

## 0.0.2

- First public release of Cline Code for macOS: a desktop app for running and inspecting Cline agent sessions, signed and notarized for Apple Silicon and Intel.
- Automatic updates: the app checks on launch and every 2 hours, downloads new versions in the background, and prompts for a one-click restart. Ignored updates apply on the next launch.
- Download the DMG once from GitHub Releases — every future release arrives automatically.
