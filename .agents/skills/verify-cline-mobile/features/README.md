# Cline mobile flow map

This map lists the current Cloud-only release flows, including failure, cancel, persistence and device-layout cases. Review the release flag before testing; computer pairing and desktop customization are deferred.

## Feature groups

- [Account, onboarding and settings](account-onboarding.md): 30 cases.
- [Repositories and Cloud session lifecycle](workspaces-sessions.md): 20 cases.
- [Composer, model, attachments and voice](composer-input.md): 33 cases.
- [Navigation, sidebar and device layout](navigation-layout.md): 21 cases.
- [Conversation runtime and transcript](conversation-content.md): 20 cases.

## Run contract

- Use one dedicated Luna UI driver per simulator. Preserve user data; clear state only on a simulator created for the run.
- Record revision, installed version/build, device/runtime, preconditions and case ID.
- Capture action logs, UI hierarchy and screenshots in a private directory outside the public repository.
- Mark every case passed, failed, partial, blocked or not run. Deferred features are absence checks.
- Full-case pass requires every listed expectation. Report partial entry-point or device coverage explicitly.
- Use a disposable repository and test sessions for Cloud sends, rename, stop and delete. Existing user work is read-only.
- Account/OAuth state, permissions, active/paused/archived sessions, generated media and controlled failure fixtures are separate prerequisites.
- Device launch, a mocked integration test and a component harness do not establish end-to-end completion.

## Source traceability

The run manifest should retain the source entry and existing test paths for each case. Keep measured results and real identifiers in the private run report, not this map.
