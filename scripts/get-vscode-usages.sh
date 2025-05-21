#!/usr/bin/env bash
set -eu

DIR=${1:-src/}
DEST_DIR=dist-standalone
DEST=dist-standalone/vscode-uses.txt
mkdir -p $DEST_DIR

{
git grep -h 'vscode\.' $DIR |
grep -Ev '//.*vscode' | # remove commented out code
sed 's|.*vscode\.|vscode.|'| # remove everything before vscode.
sed 's/[^a-zA-Z0-9_.].*$//' | # remove everything after last identifier
sort | uniq > $DEST
}

echo Done, wrote uses of the vscode SDK to $(realpath $DEST)

