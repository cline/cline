#!/usr/bin/env bash
# set -x
set -eu
DIR=${1:-../src/}
OUT=build/vscode-uses.txt

{
git grep -h 'vscode\.' $DIR |
grep -Ev '//.*vscode' | # remove commented out code
sed 's|.*vscode\.|vscode.|'| # remove everything before vscode.
sed 's/[^a-zA-Z0-9_.].*$//' | # remove everything after last identifier
sort | uniq > $OUT
}

echo Done, wrote uses of the vscode SDK to $(realpath $OUT)

