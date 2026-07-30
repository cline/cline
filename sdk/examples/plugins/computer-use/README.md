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

- Web pages and URLs use Playwright in headed, isolated Chrome.
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

## Tools

Browser tools are exposed under `computer-use-browser` and desktop tools under
`computer-use-desktop`. Distinct namespaces let the agent choose the appropriate
backend and use both during tasks that cross the browser/desktop boundary.

On macOS, the plugin exposes Peekaboo's bounded native UI tools, including
`permissions`, `see`, `inspect_ui`, `click`, `type`, `app`, and `window`.
Nested AI, browser, video capture, and clipboard tools are blocked by a
fail-closed allowlist.

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
coordinates before sending input.

The following snapshot guard applies to the portable backend:
`computer_screenshot` returns a `snapshot_id` valid for 60 seconds by default.
Every mutating tool requires and consumes one snapshot, rejects changed display
geometry, and returns a fresh screenshot with the next `snapshot_id`. This
enforces an observe → one action → observe loop. Set
`CLINE_COMPUTER_USE_SNAPSHOT_TTL_MS` to override the timeout between 5,000
and 300,000 milliseconds.

Auto-approving computer-use tools grants Cline unattended browser, mouse, and
keyboard control. Keep approval prompts enabled for sensitive or destructive
actions.
