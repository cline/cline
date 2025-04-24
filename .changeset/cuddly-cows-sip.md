---
"roo-cline": patch
---

I introduced a new method `processCarriageReturns` in `TerminalProcess.ts` to process carriage returns (\r) in terminal output. This method splits the output into lines, handles each line with carriage returns (\r) by retaining only the content after the last carriage return (\r), and preserves escape sequences to avoid breaking terminal formatting. The method is called within `getUnretrievedOutput` to ensure output is processed before being displayed. Additionally, I added comprehensive test cases in `TerminalProcess.test.ts` under a new `describe("processCarriageReturns", ...)` block to validate various scenarios, including basic progress bars, multiple lines with mixed carriage returns (\r) and line feeds (\n), and ANSI escape sequences.

Key implementation details:

- The solution carefully handles special characters and escape sequences to maintain terminal integrity.
- Tradeoff: Slightly increased processing overhead for outputs with carriage returns (\r), but this is negligible compared to the improved user experience.
- I'd like reviewers to pay close attention to the handling of edge cases in `processCarriageReturns` (e.g., lines ending with carriage returns (\r) or mixed content with carriage returns (\r), line feeds (\n), and escape sequences) to ensure no unintended side effects.
