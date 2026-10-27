#!/bin/bash
# Builds a distinct APK through a one-off Gradle init script. Never installs it.
set -euo pipefail
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
mobile_dir="$(cd "$fixture_dir/../.." && pwd)"
output_dir="${1:?Pass an isolated scratch output directory}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
export CLINE_NATIVE_FIXTURE_BUILD=1
export CLINE_NATIVE_FIXTURE_DIR="$fixture_dir"
export CLINE_NATIVE_FIXTURE_ANDROID_BUILD_DIR="$output_dir/app-build"
export EXPO_OVERRIDE_METRO_CONFIG="$fixture_dir/metro.config.cjs"
export EXPO_PUBLIC_ENV=staging
export EXPO_PUBLIC_STAGING_EPHEMERAL_AUTH=1
export EXPO_PUBLIC_NATIVE_FIXTURE_BASE="${EXPO_PUBLIC_NATIVE_FIXTURE_BASE:-http://127.0.0.1:4783}"
cd "$mobile_dir/android"
./gradlew --init-script "$fixture_dir/android-fixture.init.gradle" app:assembleRelease --no-watch-fs --max-workers=4 -x lint -x test -PreactNativeArchitectures=arm64-v8a
cp "$output_dir/app-build/outputs/apk/release/app-release.apk" "$output_dir/cline-native-fixture.apk"
printf '%s\n' "$output_dir/cline-native-fixture.apk"
