# Computer Use Plugin

This plugin gives Cline one computer-use entry point for web pages and desktop
applications. It uses Playwright for browser tasks, Peekaboo's semantic
accessibility tools for the macOS desktop, and the bundled pixel backend for
the Windows and Linux desktops.

## Install

From the repository root:

```bash
cline plugin install ./sdk/examples/plugins/computer-use
cline -i "Open Calculator, enter 123, and verify the result"
cline -i "Open https://example.com and inspect the page visually"
```

The first desktop action may trigger operating-system permission prompts.
macOS requires Screen Recording and Accessibility access for the process
hosting Cline.

Browser tasks require Google Chrome to be installed.

The macOS backend runs Peekaboo locally and uses its classic CoreGraphics
capture engine. This avoids ScreenCaptureKit enumeration stalls while retaining
Peekaboo's accessibility inspection and semantic element actions.

## Routing

- Web pages and URLs use Playwright's accessibility snapshots first, with
  screenshots available for visual context, in headed, isolated Chrome.
- Native applications, browser chrome, and system dialogs use the desktop
  backend.
- macOS desktop tasks use Peekaboo by default.
- Windows and Linux/X11 desktop tasks use the bundled pixel backend.

## Platform support

| Platform | Support |
| --- | --- |
| Browser | Playwright visual control in headed, isolated Chrome |
| macOS desktop | Peekaboo accessibility inspection, app/window control, screenshots, and input; Screen Recording and Accessibility permissions required |
| Windows desktop | Bundled pixel backend; experimental screenshots and input in the signed-in desktop session; HiDPI scaling is not yet verified |
| Linux/X11 desktop | Bundled pixel backend when `DISPLAY` is available |
| Linux/Wayland | Not yet supported without an X11/XWayland session |

On macOS, set `CLINE_COMPUTER_USE_BACKEND=portable` before launching Cline to
use the pixel backend instead of Peekaboo.

### Background control on macOS

Peekaboo desktop control is background-only by default. The plugin blocks app
and window focus, foreground input, Space switches, real-pointer movement, and
process-targeted keyboard delivery, because a process target does not identify
which field currently owns keyboard focus. Prefer `see` or `inspect_ui`, then
use `set_value` or `perform_action` on accessibility elements. Element clicks
and scrolls require both an element and its originating snapshot. Image capture
must use `capture_focus: "background"`, `format: "data"`, and a
`max_dimension` no greater than 1,568. All dialog commands are blocked because
Peekaboo auto-focuses their target; `inspect_ui` can inspect dialogs without
that focus path.

Some applications do not accept background input. If foreground control is
essential, explain why and get the user's approval first. The user can then
enable it for that Cline process:

```bash
CLINE_COMPUTER_USE_ALLOW_FOREGROUND=true cline
```

This escape hatch permits the model to activate applications and move the real
macOS pointer for that session.

## Tools

Browser tools are exposed under `computer-use-browser` and desktop tools under
`computer-use-desktop`. Distinct namespaces let the agent choose the appropriate
backend and use both during tasks that cross the browser/desktop boundary.

On macOS, the plugin exposes Peekaboo's bounded native UI tools, including
`permissions`, `see`, `inspect_ui`, `click`, `type`, `app`, and `window`.
Nested AI, browser, video capture, and clipboard tools are blocked by a
fail-closed allowlist. The allowlisted capture tools cannot invoke nested AI or
write to an arbitrary path.

On Windows, Linux/X11, or macOS with the portable override, it exposes:

- `computer_environment`
- `computer_list_displays`
- `computer_screenshot`
- `computer_cursor_position`
- `computer_move`
- `computer_click`
- `computer_drag`
- `computer_scroll`
- `computer_type`
- `computer_key`

Pointer coordinates are pixels relative to the selected display screenshot.
The server converts Retina/HiDPI image coordinates to logical desktop
coordinates before sending input. Captures larger than 1,568 pixels on an edge
or 1.15 megapixels are resized locally before they reach the model, and the
coordinate mapping uses the resized dimensions. This prevents provider-side
image resizing from silently changing the action coordinate space and reduces
image-token cost.

The following snapshot guard applies to the portable backend:
`computer_screenshot` returns a `snapshot_id` valid for 60 seconds by default.
Every mutating tool requires and consumes one snapshot, rejects changed display
geometry, and returns a fresh screenshot with the next `snapshot_id`. This
enforces an observe → one action → observe loop. Set
`CLINE_COMPUTER_USE_SNAPSHOT_TTL_MS` to override the timeout between 5,000
and 300,000 milliseconds.

After each portable desktop action, the server waits 500 milliseconds before
capturing the result so common animations and window transitions can settle.
Set `CLINE_COMPUTER_USE_POST_ACTION_SETTLE_MS` between 0 and 5,000 to tune or
disable that delay.

Desktop control runs in the user's signed-in desktop session; unlike a virtual
machine or container, it is not isolated from personal applications and data.
Use a dedicated OS account or virtual machine for unattended or untrusted
workloads. Playwright's isolated browser context separates browser storage, but
the headed browser window still runs on the local desktop.

Auto-approving computer-use tools grants Cline unattended browser, mouse, and
keyboard control. Keep approval prompts enabled for sensitive or destructive
actions.
