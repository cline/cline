# Computer use plugin

Adds deadline-aware local computer control to Cline through the normal plugin
API. It speaks newline-delimited JSON over TCP to the out-of-tree qbt backend.
It does not start a helper agent and does not enable an Anthropic beta header;
`computer` is an ordinary multimodal Cline tool and works with any selected
model/provider that supports tool calling and image input.

## Install

```bash
cline plugin install ./sdk/examples/plugins/computer-use
```

Start qbt separately, then set its agent port before starting Cline:

```bash
export CLINE_COMPUTER_USE_PORT=12345
cline -i
```

The plugin queries qbt for the native display size during setup. Loading fails
instead of guessing coordinates when the backend is unavailable.

## Deadline scheduling

`computer` waits briefly for each action. If the backend answers before the
deadline, the tool returns the result and screenshot directly. If it does not,
the same call returns a durable job handle immediately. The plugin emits a
session-targeted steer message when that job finishes, and `computer_poll`
returns the final image-bearing result.

```text
computer(...) -> direct screenshot

or

computer(...) -> { jobId, status: "running" }
                 ... completion steer ...
computer_poll({ job_id }) -> final screenshot
```

Only one computer or backend-recovery job may run at a time. This prevents
overlapping pointer/keyboard actions from corrupting screen state.

Tools:

- `computer` — submit an action or `run_sequence`; direct result when fast,
  otherwise a job handle.
- `computer_poll` — retrieve status or the final text and screenshot.
- `computer_list_jobs` — inspect recent jobs.
- `computer_cancel` — stop waiting for an active job. Input already accepted by
  qbt cannot be recalled, so re-screenshot before trusting screen state.
- `computer_restart_backend` — available only when a backend command is
  configured; it uses the same deadline/job behavior.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CLINE_COMPUTER_USE_PORT` | yes | — | qbt agent TCP port |
| `CLINE_COMPUTER_USE_HOST` | no | `127.0.0.1` | qbt host |
| `CLINE_COMPUTER_USE_DEADLINE_MS` | no | `2000` | Direct-result deadline, capped at 10 seconds; `0` always returns a job handle |
| `CLINE_COMPUTER_USE_REQUEST_TIMEOUT_MS` | no | `120000` | Overall backend response timeout |
| `CLINE_COMPUTER_USE_BACKEND_COMMAND` | no | — | Shell command used by `computer_restart_backend` |

Jobs and screenshots are stored under
`$CLINE_DATA_DIR/plugins/computer-use/jobs/<session>/` (or the corresponding
default Cline data directory). Completed results therefore survive plugin
reinitialization. A job still marked `running` after a plugin-process restart is
marked failed because the current qbt protocol cannot reattach to an orphaned
request.

## Backend command ownership

The restart tool probes before launching and never kills a backend it did not
spawn. The launch command runs through the platform shell, so quote paths and
arguments for that shell. The command must make qbt answer the configured host
and port. Starting qbt outside the plugin remains the recommended setup.

## Security

Computer control can click, type, and expose screenshots. Use a dedicated VM or
container with minimal privileges and avoid exposing the unauthenticated qbt
socket outside a trusted local environment.