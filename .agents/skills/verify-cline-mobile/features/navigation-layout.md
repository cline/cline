# Navigation, sidebar and device layout

Verification cases for the current Cloud-only iOS app. These are required observable behaviors, not claims of completed E2E coverage.

## Sub-features

- **NAV-01 — Home sidebar button**.
- **NAV-02 — Chat sidebar button**.
- **NAV-03 — Right swipe**.
- **NAV-04 — Search history**.
- **NAV-05 — New from sidebar**.
- **NAV-06 — Settings entry points**.
- **NAV-07 — History refresh and offline**.
- **NAV-08 — Unread and current markers**.
- **LAYOUT-01 — Portrait compact phone**.
- **LAYOUT-02 — Landscape both directions**.
- **LAYOUT-03 — Rotation mid-interaction**.
- **LAYOUT-04 — Large screen split layout**.
- **LAYOUT-05 — Large text and VoiceOver**.
- **LAYOUT-06 — Reduced motion**.
- **LAYOUT-07 — Offline launch and recovery**.
- **LAYOUT-08 — Locked device and Keychain**.
- **NAV-09 — New session from chat header**.
- **RELEASE-01 — Private TestFlight invitation and install**.
- **RELEASE-02 — Upgrade preserves account and preferences**.
- **RELEASE-03 — Standalone launch without development host**.
- **RELEASE-04 — Cold-launch icon and splash**.

## How to get to it (user POV)

Open All sessions from Home/chat, Collapse sidebar or backdrop to close, Settings from either entry point. Rotate with keyboard and searchable sheets open.

## Driving it with Maestro

Preconditions: run the skill doctor against the intended full app and use a private evidence directory. Select the cases whose fixtures are available; record unavailable fixtures as blocked.

### NAV-01 — Home sidebar button

**Preconditions:** Signed-in Home

**Actions:** Tap All sessions, then Collapse sidebar.

**Prove:** History drawer opens from the left and returns to the same Home draft.

### NAV-02 — Chat sidebar button

**Preconditions:** Existing accessible chat

**Actions:** Tap All sessions; select the current conversation.

**Prove:** Returns to the same session and transcript, without creating a session.

### NAV-03 — Right swipe

**Preconditions:** Home and an existing chat

**Actions:** Swipe right from the content edge; dismiss with backdrop and left swipe.

**Prove:** Opens and closes history, never starts a new session.

### NAV-04 — Search history

**Preconditions:** At least two named sessions

**Actions:** Search a known title, a no-match string, then clear search.

**Prove:** Results filter correctly; empty state is clear; clearing restores all rows.

### NAV-05 — New from sidebar

**Preconditions:** Existing chat with disposable draft

**Actions:** Open sidebar and tap New.

**Prove:** Shows new-session composer; no server session exists until submission.

### NAV-06 — Settings entry points

**Preconditions:** Home and open sidebar

**Actions:** Open Settings from Home header and sidebar; use Back each time.

**Prove:** Both reach the same settings and return without duplicating routes.

### NAV-07 — History refresh and offline

**Preconditions:** Previously loaded session list

**Actions:** Refresh history online, interrupt connection, then retry.

**Prove:** Last successful rows remain visible with actionable failure; recovery updates status.

### NAV-08 — Unread and current markers

**Preconditions:** Two test sessions; one receives a new response

**Actions:** View the other session, then reopen the updated one.

**Prove:** Unread indication and active-row highlight follow the actual conversation.

### LAYOUT-01 — Portrait compact phone

**Preconditions:** Small supported iPhone simulator

**Actions:** Drive Home/sidebar/pickers/settings/chat with keyboard open and closed.

**Prove:** No clipped primary actions, horizontal overflow or unusably tall prompt area.

### LAYOUT-02 — Landscape both directions

**Preconditions:** Supported iPhone simulator

**Actions:** Rotate Home, chat, sidebar and every sheet into both landscape directions.

**Prove:** Safe areas respected; drawer does not consume permanent chat width; actions remain reachable.

### LAYOUT-03 — Rotation mid-interaction

**Preconditions:** Typed draft and open searchable sheet

**Actions:** Rotate while typing/searching, during loading, and with rename modal open.

**Prove:** Text and selection survive; sheets settle once; no stale invisible overlay intercepts input.

### LAYOUT-04 — Large screen split layout

**Preconditions:** Available iPad or large simulator

**Actions:** Open/close sidebar and change available window width.

**Prove:** Inline/drawer transitions follow width; usable content is preserved. No invented future device claim.

### LAYOUT-05 — Large text and VoiceOver

**Preconditions:** Device accessibility settings

**Actions:** Increase text size, navigate labels and modal focus, activate main controls.

**Prove:** Critical labels/actions remain understandable and reachable; modal focus stays contained.

### LAYOUT-06 — Reduced motion

**Preconditions:** Reduce Motion enabled

**Actions:** Open/close drawer, keyboard and media overlays.

**Prove:** State changes remain clear and functional without unnecessary animation.

### LAYOUT-07 — Offline launch and recovery

**Preconditions:** Saved authenticated test state

**Actions:** Launch without network, then restore connectivity.

**Prove:** No false sign-out solely due to transport failure; retry succeeds and saved data remains.

### LAYOUT-08 — Locked device and Keychain

**Preconditions:** Physical test iPhone

**Actions:** Lock during background, unlock and return to app.

**Prove:** Credentials remain accessible after unlock; no false repeated authentication or silent credential fallback.

### NAV-09 — New session from chat header

**Preconditions:** Existing accessible chat with empty draft

**Actions:** Tap New session in chat header, then open sidebar and return to original conversation.

**Prove:** New-session composer appears without creating a server session; original conversation remains intact.

### RELEASE-01 — Private TestFlight invitation and install

**Preconditions:** Invited test account and uploaded processed build

**Actions:** Open invitation on iPhone; accept in TestFlight; install the intended version.

**Prove:** Correct app icon and version install; access is invite-only with no public link or App Store release.

### RELEASE-02 — Upgrade preserves account and preferences

**Preconditions:** Previous installed beta with saved account and preferences

**Actions:** Update through TestFlight and launch without clearing data.

**Prove:** Existing sign-in, model/repo preferences and accessible history remain; no unnecessary onboarding or second login.

### RELEASE-03 — Standalone launch without development host

**Preconditions:** Physical iPhone with installed Release/TestFlight app

**Actions:** Disconnect USB and stop local development processes; launch over normal internet.

**Prove:** Cloud app starts and functions without Metro or a connected computer.

### RELEASE-04 — Cold-launch icon and splash

**Preconditions:** Clean and returning-user test devices

**Actions:** Observe app icon, cold launch, signed-in and signed-out transitions.

**Prove:** Cline icon is present; themed splash transitions without unrelated loading text or a false sign-in flash.

## Gotchas

One UI driver owns each simulator. A screenshot alone cannot prove swipe, animation timing or draft preservation. Test both landscape directions and record actual hardware/runtime.

Run all distinct entry points named above. Evidence must include the actions and resulting state. Track pass/fail/partial/blocked/not-run separately; an automated unit test is not a substitute for this user path.
