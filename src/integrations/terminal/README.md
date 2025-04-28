NOTICE TO DEVELOPERS:

The Terminal classes are very sensitive to change, partially because of
the complicated way that shell integration works with VSCE, and
partially because of the way that Cline interacts with the Terminal\*
class abstractions that make VSCE shell integration easier to work with.

At the point that PR #1365 is merged, it is unlikely that any Terminal\*
classes will need to be modified substantially. Generally speaking, we
should think of this as a stable interface and minimize changes.

`TerminalProcess` class is particularly critical because it
provides all input handling and event notifications related to terminal
output to send it to the rest of the program. User interfaces for working
with data from terminals should only be as follows:

1. By listening to the events:

    - this.on("completed", fullOutput) - provides full output upon completion
    - this.on("line") - provides new lines, probably more than one

2. By calling `this.getUnretrievedOutput()`

This implementation intentionally returns all terminal output to the user
interfaces listed above. Any throttling or other stream modification _must_
be implemented outside of this class.

All other interfaces are private.

Warning: Modifying the `TerminalProcess` class without fully understanding VSCE shell integration architecture may affect the reliability or performance of reading terminal output.

`TerminalProcess` was carefully designed for performance and accuracy:

Performance is obtained by: - Throttling event output on 100ms intervals - Using only indexes to access the output array - Maintaining a zero-copy implementation with a fullOutput string for storage - The fullOutput array is never split on carriage returns
as this was found to be very slow - Allowing multi-line chunks - Minimizing regular expression calls, as they have been tested to be
500x slower than the use of string parsing functions for large outputs
in this implementation

Accuracy is obtained by: - Using only indexes against fullOutput - Paying close attention to off-by-one errors when indexing any content - Always returning exactly the content that was printed by the terminal,
including all carriage returns which may (or may not) have been in the
input stream

Additional resources:

- This implementation was rigorously tested using:

    - https://github.com/KJ7LNW/vsce-test-terminal-integration

- There was a serious upstream bug that may not be fully solved,
  or that may resurface in future VSCE releases, simply due to
  the complexity of reliably handling terminal-provided escape
  sequences across multiple shell implementations. This implementation
  attempts to work around the problems and provide backwards
  compatibility for VSCE releases that may not have the fix in
  upstream bug #237208, but there still may be some unhandled
  corner cases. See this ticket for more detail:

    - https://github.com/microsoft/vscode/issues/237208

- The original Cline PR has quite a bit of information:
    - https://github.com/cline/cline/pull/1089

Contact me if you have any questions: - GitHub: KJ7LNW - Discord: kj7lnw - [roo-cline at z.ewheeler.org]

Cheers,
-Eric, KJ7LNW
