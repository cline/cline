#!/usr/bin/env bash
set -eu

FILES=$(git ls-files src|grep -v test|grep -v vscode|grep -v extension.ts|grep -v evals|grep -v standalone|grep -v /dev/)
DEST_DIR=dist-standalone
SDK_DEST=$DEST_DIR/vscode-sdk-uses.txt
CSS_DEST=$DEST_DIR/vscode-css-uses.txt
TMP=/tmp/vscode-sdk-uses.txt.tmp
mkdir -p $DEST_DIR

if [[ ${1:-} == "-v" ]]; then
  grep -Er --color=always 'vscode[?]?\.' $FILES
fi

{
  grep -Ehr 'vscode[?]?\.' $FILES |
  grep -Ev '//.*vscode' | # remove commented out code
  grep -v vscode.commands.executeCommand | # executeCommand is handled separately
  #grep -Ev '"vscode' | # remove command strings that get included because they start with vscode
  sed 's|.*vscode|vscode|'| # remove everything before vscode.
  sed 's|?||g' | # remove ? from vcode?.env?.foo
  sed 's/[^a-zA-Z0-9_.?].*$//' | # remove everything after last identifier
  grep -E '\.[a-z][^.]+$' | # remove types (last part of identifier should be lowercase)
  cat > $TMP
}
{
  grep -hr 'vscode.commands.executeCommand' $FILES |
  perl -ne 'print if /["\x27"]/'  | # Remove occurrences where the command is not on the same line (line doesnt contain quote chars) :(
  sed -n 's|.*\(vscode.commands.executeCommand[^,]*\).*|\1|p'| # Remove all params after the first one
  sed 's|\(".*"\).*|\1)|'| # Close the parantheses
  cat >> $TMP
}

# Count occurrences
cat $TMP | sort | uniq -c | sort -n > $SDK_DEST
rm $TMP

echo Wrote uses of the vscode SDK to $(realpath $SDK_DEST)

{
grep -rh -- --vscode- webview-ui/build/ |
sed 's/--vscode/\n--vscode/g' | # One var per line
grep -- --vscode | # Remove lines that don't have vars.
sed 's/[),"\\].*$//' | # remove from the end of the var name to the end of the line.
sort | uniq > $CSS_DEST
}
echo Wrote vscode vars used to $(realpath $CSS_DEST)
