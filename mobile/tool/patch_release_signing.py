#!/usr/bin/env python3
"""Patch Flutter-generated Gradle Kotlin DSL to use the configured release key."""
import pathlib
import sys

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "android/app/build.gradle.kts")
if not path.exists():
    sys.exit(f"ERROR: {path} not found")
text = path.read_text(encoding="utf-8")
if "keystoreProperties" in text:
    print("Release signing already patched; nothing to do.")
    sys.exit(0)

imports = "import java.io.FileInputStream\nimport java.util.Properties\n\n"
props = """val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}
"""
signing = """    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

"""
old = 'signingConfig = signingConfigs.getByName("debug")'
new = ('signingConfig = if (keystorePropertiesFile.exists()) '
       'signingConfigs.getByName("release") else signingConfigs.getByName("debug")')
if text.count(old) != 1 or text.count("    buildTypes {") != 1 or "android {" not in text:
    sys.exit("ERROR: unexpected Flutter-generated Gradle file shape; refusing to patch")
text = text.replace(old, new)
text = text.replace("    buildTypes {", signing + "    buildTypes {")
text = text.replace("android {", props + "\nandroid {", 1)
path.write_text(imports + text, encoding="utf-8")
print(f"Patched {path} for release signing.")
