---
"claude-dev": patch
---
fix: improve HistoryViewItem layout to prevent text overflow

Fix layout issues in HistoryViewItem component where long task names were causing layout problems. Changed parent container from `w-full` to `min-w-0` to prevent flex overflow, changed task container from `justify-between` to `items-center` with proper flex layout, added `flex-1 min-w-0` to task text container for proper text truncation, and added `flex-shrink-0` to button container to prevent buttons from being compressed. Long task names now truncate properly with ellipsis instead of overflowing or pushing buttons off-screen, and buttons remain visible and accessible regardless of task name length.
