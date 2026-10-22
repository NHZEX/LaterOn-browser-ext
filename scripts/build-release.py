#!/usr/bin/env python3
"""Build a minimal, reproducible LaterOn extension ZIP from an explicit allowlist."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# Only extension runtime files and the required license notice belong in a release package.
# Keep this list explicit: adding a test, screenshot, design draft or document to
# the repository must never make it into a user's extension by accident.
SPECIFICATION = json.loads((ROOT / "scripts/runtime-files.json").read_text(encoding="utf-8"))
RUNTIME_FILES = tuple(SPECIFICATION["files"])
RUNTIME_DIRS = tuple(SPECIFICATION["directories"])

FORBIDDEN_PREFIXES = ("tests/", "design/", "scripts/", "dist/", ".git/")
FORBIDDEN_NAMES = {
    ".DS_Store",
    ".gitignore",
    "README.md",
    "CHANGELOG.md",
    "icon.svg",
    "popup.css",
    "popup.html",
    "popup.js",
}


def relative_name(path: Path, source_dir: Path = ROOT) -> str:
    return path.relative_to(source_dir).as_posix()


def release_files() -> list[Path]:
    files = [ROOT / name for name in RUNTIME_FILES]
    for directory in RUNTIME_DIRS:
        files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())

    missing = [relative_name(path) for path in files if not path.is_file()]
    if missing:
        raise RuntimeError("Missing required release files: " + ", ".join(missing))

    duplicates = [name for name in {relative_name(path) for path in files} if sum(relative_name(item) == name for item in files) > 1]
    if duplicates:
        raise RuntimeError("Duplicate release entries: " + ", ".join(sorted(duplicates)))

    return sorted(files, key=relative_name)


def file_hashes(directory: Path, names: list[str]) -> dict[str, str]:
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in names}


def build_files(source_dir: Path) -> list[Path]:
    originals = release_files()
    if source_dir == ROOT:
        return originals
    names = [relative_name(path) for path in originals] + ["background-runtime.js"]
    actual = {relative_name(path, source_dir) for path in source_dir.rglob("*") if path.is_file()}
    if actual != set(names):
        raise RuntimeError(f"WXT output differs from allowlist; missing={sorted(set(names) - actual)}, extra={sorted(actual - set(names))}")

    state = json.loads((ROOT / ".wxt/compat-build.json").read_text(encoding="utf-8"))
    inputs = [relative_name(path) for path in originals] + SPECIFICATION["buildInputs"]
    if state["directory"] != source_dir.relative_to(ROOT).as_posix() or state["inputs"] != file_hashes(ROOT, inputs):
        raise RuntimeError("WXT build is stale; run pnpm build")
    if state["outputs"] != file_hashes(source_dir, names):
        raise RuntimeError("WXT build output was modified; run pnpm build")
    expected_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    manifest = json.loads((source_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest != expected_manifest:
        raise RuntimeError("WXT manifest differs from the extension manifest")
    changed = [relative_name(path) for path in originals if relative_name(path) != "manifest.json" and
               (source_dir / ("background-runtime.js" if relative_name(path) == "background.js" else relative_name(path))).read_bytes() != path.read_bytes()]
    if changed:
        raise RuntimeError("WXT changed legacy runtime files: " + ", ".join(changed))
    return [source_dir / name for name in sorted(names)]


def validate_manifest(files: list[Path], source_dir: Path = ROOT) -> str:
    manifest = json.loads((source_dir / "manifest.json").read_text(encoding="utf-8"))
    version = str(manifest.get("version", "")).strip()
    if not version:
        raise RuntimeError("manifest.json has no version")

    names = {relative_name(path, source_dir) for path in files}
    referenced = {
        manifest.get("background", {}).get("service_worker"),
        manifest.get("side_panel", {}).get("default_path"),
        manifest.get("options_page"),
    }
    referenced.update(manifest.get("icons", {}).values())
    referenced.update(manifest.get("action", {}).get("default_icon", {}).values())
    for group in manifest.get("web_accessible_resources", []):
        referenced.update(group.get("resources", []))

    missing = sorted(path for path in referenced if path and path not in names)
    if missing:
        raise RuntimeError("Manifest references files outside the release allowlist: " + ", ".join(missing))
    return version


def validate_archive(archive: Path, expected: set[str]) -> None:
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError("Release ZIP contains duplicate entries")
        if set(names) != expected:
            missing = sorted(expected - set(names))
            extra = sorted(set(names) - expected)
            raise RuntimeError(f"Release ZIP contents differ from allowlist; missing={missing}, extra={extra}")
        for name in names:
            if name in FORBIDDEN_NAMES or name.endswith(".md") or name.startswith(FORBIDDEN_PREFIXES):
                raise RuntimeError(f"Development-only file leaked into release ZIP: {name}")
        json.loads(package.read("manifest.json").decode("utf-8"))


def validate_sources(archive: Path, files: list[Path], source_dir: Path = ROOT) -> None:
    validate_archive(archive, {relative_name(path, source_dir) for path in files})
    with zipfile.ZipFile(archive) as package:
        stale = [relative_name(path, source_dir) for path in files if package.read(relative_name(path, source_dir)) != path.read_bytes()]
    if stale:
        raise RuntimeError("Release ZIP differs from current source: " + ", ".join(stale))


def replace_archive(temporary: Path, archive: Path) -> None:
    if archive.is_file() and archive.read_bytes() == temporary.read_bytes():
        return
    # Retry short-lived file locks; retain the previous ZIP if replacement fails.
    for attempt in range(12):
        try:
            temporary.replace(archive)
            return
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(0.25 * (attempt + 1))


def build(output_dir: Path = DIST, source_dir: Path = ROOT) -> Path:
    files = build_files(source_dir)
    version = validate_manifest(files, source_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"LaterOn-{version}.zip"
    temporary = archive.with_suffix(".zip.tmp")

    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for path in files:
                name = relative_name(path, source_dir)
                # A fixed timestamp makes identical source trees produce identical archives.
                entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o644 << 16
                package.writestr(entry, path.read_bytes(), compresslevel=9)
        validate_archive(temporary, {relative_name(path, source_dir) for path in files})
        replace_archive(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)

    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify an existing ZIP against current runtime files")
    parser.add_argument("--output-dir", type=Path, default=DIST, help="Archive output directory (default: dist)")
    parser.add_argument("--source-dir", type=Path, default=ROOT, help="Validated WXT output directory, or repository root for legacy packaging")
    args = parser.parse_args()
    try:
        output_dir = args.output_dir.resolve()
        source_dir = args.source_dir.resolve()
        if args.check:
            files = build_files(source_dir)
            version = validate_manifest(files, source_dir)
            archive = output_dir / f"LaterOn-{version}.zip"
            validate_sources(archive, files, source_dir)
        else:
            archive = build(output_dir, source_dir)
    except Exception as error:
        print(f"Release build failed: {error}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(archive) as package:
        count = len(package.namelist())
    size_kb = archive.stat().st_size / 1024
    display_path = archive.relative_to(ROOT) if archive.is_relative_to(ROOT) else archive
    print(f"{'Verified' if args.check else 'Built'} {display_path} ({count} files, {size_kb:.1f} KB)")
    print("Verified: no tests, design drafts, previews, documentation, .DS_Store or icon.svg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
