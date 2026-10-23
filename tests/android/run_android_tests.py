"""Run the real Java store, optional APK static checks and Windows/Android JSON handoff.

Python standard library only. Requires a JDK and org.json JAR outside the repository.
All election data is synthetic and lives in disposable temporary directories.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
JAVA_SOURCE = ROOT / "src/android/app/src/main/java/br/escola/vozdaescola/urna/ElectionStore.java"
JAVA_TEST = Path(__file__).with_name("ElectionStoreTest.java")
MAIN_CLASS = "br.escola.vozdaescola.urna.ElectionStoreTest"
RESOURCES = {"index.html", "app.js", "style.css", "favicon.svg", "assets/gresp.png", "assets/estado-sp.png"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(command):
    subprocess.run([str(value) for value in command], cwd=ROOT, check=True)


def source_manifest():
    path = ROOT / "src/android/app/src/main/AndroidManifest.xml"
    manifest = ET.parse(path).getroot()
    android = "{http://schemas.android.com/apk/res/android}"
    application = manifest.find("application")
    require(application is not None and application.get(android + "allowBackup") == "false",
            "Android application backup must be disabled")
    require(not list(manifest.iter("uses-permission")), "Offline app unexpectedly requests Android permissions")
    print("PASS Android source manifest: no network/storage permissions, backup disabled", flush=True)


def apk_static(apk: Path, aapt: Path):
    require(apk.is_file() and aapt.is_file(), "APK/aapt not found")
    with zipfile.ZipFile(apk) as archive:
        names = set(archive.namelist())
        all_assets = {name for name in names if name.startswith("assets/") and not name.endswith("/")}
        require(all_assets == {"assets/" + relative for relative in RESOURCES},
                "APK contains unexpected assets outside its six generic resources")
        assets = {name.removeprefix("assets/") for name in all_assets}
        require(assets == RESOURCES, f"APK generic asset manifest differs: {sorted(assets)}")
        for relative in RESOURCES:
            require(archive.read("assets/" + relative) == (ROOT / "src/web" / relative).read_bytes(),
                    f"APK asset differs from current source: {relative}")
        require(not any(part.lower() in {"dados", "datos", "urna.json", "urna.lock"}
                        for name in names for part in name.split("/")), "APK packages election data")
    permissions = subprocess.check_output([str(aapt), "dump", "permissions", str(apk)], encoding="utf-8")
    require("uses-permission" not in permissions, "Compiled APK unexpectedly requests permissions")
    badging = subprocess.check_output([str(aapt), "dump", "badging", str(apk)], encoding="utf-8")
    require("sdkVersion:'26'" in badging, "APK minimum SDK differs from Android8/API26")
    tree = subprocess.check_output([str(aapt), "dump", "xmltree", str(apk), "AndroidManifest.xml"], encoding="utf-8")
    require(re.search(r"allowBackup[^\n]*=(?:\(type 0x12\))?0x0(?:\s|$)", tree),
            "Compiled APK does not explicitly disable backup")
    print("PASS compiled APK: exact six generic assets, no election data/permissions, backup disabled, API26 minimum", flush=True)


def windows_handoff(exe: Path, java: Path, classpath: str, temporary: Path):
    spec = importlib.util.spec_from_file_location("synthetic_windows_urn_tests", ROOT / "tests/test_urna.py")
    windows = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(windows)
    configuration = windows.fixture_configuration(3, "Urna Windows Fictícia")
    urn = windows.Urn(exe, None, temporary / "windows-urn")
    try:
        urn.start()
        windows.check_blank_setup(urn.request("/api/state")[1])
        urn.access()
        urn.call("config", configuration, admin=True)
        urn.call("open", {}, admin=True)
        urn.vote("Eleitor Windows Fictício Chapa", "c1")
        urn.vote("Eleitor Windows Fictício Branco", "blank")
        urn.call("close", {}, admin=True)
        batch = urn.call("export", admin=True)
        fixture = temporary / "synthetic-handoff-input.json"
        returned = temporary / "synthetic-handoff-output.json"
        fixture.write_text(json.dumps({"configuration": configuration, "windowsBatch": batch}, ensure_ascii=False), encoding="utf-8")
        run([java, "-cp", classpath, MAIN_CLASS, "--handoff", fixture, returned])
        android = json.loads(returned.read_text(encoding="utf-8"))
        android_batch = android["androidBatch"]
        require(batch["electionId"] == android_batch["electionId"], "Windows/Android election IDs differ")
        require(batch["urnId"] != android_batch["urnId"], "Windows/Android share an urn identity")
        merged = urn.call("consolidate", {"batches": [batch, android_batch]}, admin=True)
        expected = {"c1": 1, "c2": 1, "c3": 0, "blank": 1, "nullVote": 1}
        windows.check_counts(merged, expected, 4)
        windows.check_counts(android["androidMerged"], expected, 4)
        windows.no_choice_in_participants(android_batch)
        print("PASS bidirectional Windows/Android handoff: identical election hash, independent urn IDs, exact four-vote merge on both platforms", flush=True)
    finally:
        urn.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    jdk = Path("C:/Program Files/Java/jdk-21/bin")
    parser.add_argument("--java", type=Path, default=jdk / "java.exe")
    parser.add_argument("--javac", type=Path, default=jdk / "javac.exe")
    parser.add_argument("--json-jar", type=Path, required=True)
    parser.add_argument("--exe", type=Path, default=ROOT / "releases/UrnaEstudantil.exe")
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--archive-smoke", action="store_true", help="Only check archive collision/retry; skip the full suite and Windows handoff")
    parser.add_argument("--aapt", type=Path, default=Path.home() / "AppData/Local/Android/Sdk/build-tools/36.0.0/aapt.exe")
    options = parser.parse_args()
    for path in (options.java, options.javac, options.json_jar, options.exe, JAVA_SOURCE, JAVA_TEST):
        require(path.is_file(), f"Required file not found: {path}")
    source_manifest()
    with tempfile.TemporaryDirectory(prefix="urna-android-verification-") as directory:
        temporary = Path(directory)
        classes = temporary / "classes"
        classes.mkdir()
        run([options.javac, "-encoding", "UTF-8", "--release", "8", "-cp", options.json_jar.resolve(),
             "-d", classes, JAVA_SOURCE, JAVA_TEST])
        classpath = str(classes) + os.pathsep + str(options.json_jar.resolve())
        run([options.java, "-cp", classpath, MAIN_CLASS] + (["--archive-smoke"] if options.archive_smoke else []))
        if not options.archive_smoke:
            windows_handoff(options.exe.resolve(), options.java, classpath, temporary)
    if options.apk:
        apk_static(options.apk.resolve(), options.aapt)
    print("ANDROID ARCHIVE SMOKE PASSED" if options.archive_smoke else "ALL ANDROID INTEGRATION CHECKS PASSED", flush=True)


if __name__ == "__main__":
    main()
