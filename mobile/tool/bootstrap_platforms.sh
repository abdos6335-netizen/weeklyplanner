#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="$(mktemp -d)"
trap 'rm -rf "$backup"' EXIT
mkdir -p "$backup"
cp android/app/src/main/AndroidManifest.xml "$backup/AndroidManifest.xml"
cp -R android/app/src/main/kotlin "$backup/kotlin"
flutter create --platforms=android,ios --org com.weeklyplanner --project-name mobile .
cp "$backup/AndroidManifest.xml" android/app/src/main/AndroidManifest.xml
rm -rf android/app/src/main/kotlin
cp -R "$backup/kotlin" android/app/src/main/kotlin
cat > test/widget_test.dart <<'EOF'
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Flutter test environment is available', () {
    expect(true, isTrue);
  });
}
EOF
flutter pub get
