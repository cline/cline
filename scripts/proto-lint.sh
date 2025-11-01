#!/bin/bash
set -u

buf lint

if ! buf format -w --exit-code; then
  echo Proto files were formatted
fi

if grep -rn "rpc .*[A-Z][A-Z].*[(]" --include="*.proto"; then
  # See https://github.com/cline/cline/pull/7054
  echo Error: Proto RPC names cannot contain repeated capital letters
  exit 1
fi

