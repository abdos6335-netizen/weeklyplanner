#!/usr/bin/env python3
"""Patch the Flutter-generated android/app/build.gradle.kts so release builds
are signed with a keystore described by android/key.properties.

- If key.properties does not exist, the release build falls back to the debug
  key (same behaviour as before), so local/CI debug flows are unchanged.
- No keystore, password or alias is ever written into the repository.
- Fails loudly if the generated file has an unexpected shape, instead of
  silently producing a wrongly signed APK.
"""
import pathlib
import sys

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "android/app/build.gradle.kts")
if not path.exists():
    sys.exit(f"ERROR: {path} not found (expected a Kotlin DSL gradle file)")

text = path.read_text(encoding="utf-8")
if "keystoreProperties" in text:
    print("Release signing already patched; nothing to do.")
    sys.exit(0)

IMPORTS = "import java.io.FileInputStream\nimport java.util.Properties\n\n"
PROPS = '''
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}
'''
SIGNING_CONFIGS = '''    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

'''
OLD_SIGNING = 'signingConfig = signingConfigs.getByName("debug")'
NEW_SIGNING = (
    'signingConfig = if (keystorePropertiesFile.exists()) '
    'signingConfigs.getByName("release") else signingConfigs.getByName("debug")'
)

if text.count(OLD_SIGNING) != 1:
    sys.exit("ERROR: expected exactly one debug signingConfig line in the release buildType")
if text.count("    buildTypes {") != 1:
    sys.exit("ERROR: expected exactly one buildTypes block")
if "android {" not in text:
    sys.exit("ERROR: android block not found")

text = text.replace(OLD_SIGNING, NEW_SIGNING)
text = text.replace("    buildTypes {", SIGNING_CONFIGS + "    buildTypes {")
# Insert the properties loader right before the android block (after plugins).
text = text.replace("android {", PROPS.lstrip("\n") + "\nandroid {", 1)
text = IMPORTS + text

path.write_text(text, encoding="utf-8")
print(f"Patched {path} for release signing.")
