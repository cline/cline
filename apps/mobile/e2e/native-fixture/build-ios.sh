#!/bin/bash
# Repackage an already-built iOS Simulator app with an isolated fixture bundle.
# Does not change the original product, app source, native project or auth guards.
set -euo pipefail
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
mobile_dir="$(cd "$fixture_dir/../.." && pwd)"
source_app="${1:?Pass the existing Release-iphonesimulator/Cline.app path}"
output_dir="${2:?Pass a scratch output directory}"
case "$source_app" in *iphonesimulator*/Cline.app) ;; *) echo "Expected an iOS Simulator build product" >&2; exit 1;; esac
mkdir -p "$output_dir"
fixture_app="$output_dir/ClineE2E.app"
if [ -e "$fixture_app" ]; then echo "Use a fresh output directory; fixture app exists" >&2; exit 1; fi
cp -R "$source_app" "$fixture_app"
cd "$mobile_dir"
CLINE_NATIVE_FIXTURE_BUILD=1 EXPO_OVERRIDE_METRO_CONFIG="$fixture_dir/metro.config.cjs" EXPO_PUBLIC_ENV=staging EXPO_PUBLIC_STAGING_EPHEMERAL_AUTH=1 EXPO_PUBLIC_NATIVE_FIXTURE_BASE="${EXPO_PUBLIC_NATIVE_FIXTURE_BASE:-http://127.0.0.1:4783}" \
 bunx expo export:embed --platform ios --entry-file index.js --dev false --reset-cache --bundle-output "$fixture_app/main.jsbundle" --assets-dest "$fixture_app" --max-workers 4
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier bot.cline.app.e2e' "$fixture_app/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Cline E2E' "$fixture_app/Info.plist"
# Simulator-only variant; never use this packaging path for signed device builds.
/usr/bin/codesign --force --sign - "$fixture_app"
printf '%s\n' "$fixture_app"
