// Polyfill crypto.getRandomValues before anything else loads: @cline/shared's
// id generator (nanoid) calls it at import time, and Hermes has no global
// crypto. Must run before expo-router/entry pulls in the app graph.
import "react-native-get-random-values";

// `AbortSignal.timeout` for older Hermes builds, used by the shared Cline
// device-auth implementation.
//
// This has to be a side-effecting MODULE import, not an `if (...)` block in this
// file: ES module imports are hoisted, so any statement here — including a
// feature-detect + assignment — runs only after ALL of this file's imports have
// been evaluated, i.e. after `expo-router/entry` has already pulled in the entire
// application graph. Static imports, on the other hand, are evaluated in source
// order, so this one provably installs the polyfill before the app loads.
import "./src/polyfills";

import "expo-router/entry";
