// This service now delegates to the host bridge for cross-IDE compatibility
//export { searchWorkspaceFiles } from "@utils/search"

/*
This file previously provided functionality to search workspace files using ripgrep and fuzzy matching.
The implementation has been moved to the host bridge system for cross-IDE compatibility.

The function is now available through the host bridge:
- searchWorkspaceFiles: Searches workspace files with fuzzy matching

For VSCode, the actual implementation is in src/hosts/vscode/search/
For other IDEs, different implementations can be provided through their respective host bridges.
*/
