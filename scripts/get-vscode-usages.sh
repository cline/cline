#!/usr/bin/env bash
set -eu

DIR=${1:-src/}
DEST_DIR=dist-standalone
SDK_DEST=$DEST_DIR/vscode-sdk-uses.txt
CSS_DEST=$DEST_DIR/vscode-css-uses.txt
mkdir -p $DEST_DIR

{
git grep -h 'vscode\.' $DIR |
grep -Ev '//.*vscode' | # remove commented out code
sed 's|.*vscode\.|vscode.|'| # remove everything before vscode.
sed 's/[^a-zA-Z0-9_.].*$//' | # remove everything after last identifier
grep -E '\.[a-z][^.]+$' | # remove types (last part of identifier should be lowercase)
sort | uniq -c | sort -n | # Count occurrences
cat > $SDK_DEST
}
echo Wrote uses of the vscode SDK to $(realpath $SDK_DEST)

{
grep -rh -- --vscode- webview-ui/build/ |
sed 's/--vscode/\n--vscode/g' | # One var per line
grep -- --vscode | # Remove lines that don't have vars.
sed 's/[),"\\].*$//' | # remove from the end of the var name to the end of the line.
sort | uniq > $CSS_DEST
}
echo Wrote vscode vars used to $(realpath $CSS_DEST)

