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

Peekaboo 4.2.2's MCP server and the plugin policy are background-only. The
plugin blocks app, window, menu, dialog, Space, and Dock mutations; foreground
input; real-pointer movement; generic accessibility actions; clipboard access;
and unbound raw key or chord delivery. `app`, `window`, `space`, `dock`, and
`menu` allow only their `list` actions.

Use `inspect_ui` with `web_focus: false`, then bind every `click`, `scroll`,
`set_value`, and `type` to the explicit snapshot it returns. Typing also
requires the target element ID. Clicks must be single primary-button element
actions. Scrolls must target an element with
`smooth: false` and `delay: 0`; Peekaboo then uses its background-only
Accessibility or exact-window route. Use `verify_state` without its optional
final screenshot for stable semantic verification. Image capture must use
`capture_focus: "background"`, `format: "data"`, and an explicit
`max_dimension` no greater than 1,568. `see` is not exposed; keeping observation
split between non-focusing `inspect_ui` and bounded `image` avoids implicit web
focus and oversized screenshots.

Some applications do not accept background input. If foreground control is
essential, stop and explain why. The user must explicitly select the portable
pixel backend for a new Cline process:

```bash
CLINE_COMPUTER_USE_BACKEND=portable cline
```

The portable backend controls the real macOS pointer and keyboard and can take
over the foreground session. The plugin never switches to it silently.

## Tools

Browser tools are exposed under `computer-use-browser` and desktop tools under
`computer-use-desktop`. Distinct namespaces let the agent choose the appropriate
backend and use both during tasks that cross the browser/desktop boundary.
Playwright's `browser_run_code_unsafe` (RCE-equivalent server-process code
execution), `browser_file_upload`, and `browser_drop` (local workspace/output
file reads sent to a page) are hard-blocked in the plugin's `beforeTool` hook.

On macOS, the plugin exposes only Peekaboo's bounded background UI tools:
`permissions`, `inspect_ui`, `image`, `click`, `scroll`, `set_value`, `type`,
`verify_state`, and the read-only list modes of `app`, `window`, `menu`, `space`,
and `dock`. Nested AI, browser, video capture, clipboard, raw key, pointer,
generic action, dialog, and long-sleep tools are blocked by a fail-closed
allowlist. Capture tools cannot invoke nested AI or write to an arbitrary path.

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
