---
"claude-dev": patch
---

Added checkpointTrackerErrorMessage to HistoryItem - restored with task, prevents re-initialization if timed out before
Never re-init checkpoint tracker if it timed out before
Warning at 7s that it's taking awhile, timeout and give up at 15s
Fixed click to open settings - now opens to correct tab
