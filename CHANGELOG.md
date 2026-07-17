# Changelog

## 0.0.9 (unreleased)

- Support absolute paths, quoted paths, `~` home expansion, `file://` URIs, and multi-root relative paths when resolving exact file/folder inputs.
- Preserve a visible exact-path QuickPick item (`alwaysShow: true`) while requiring explicit Enter or click to open; prevents automatic opening during input resolution.
- Fix Enter/open race conditions: wait for in-flight exact-resolution before opening, guard against duplicate opens, and surface helpful error messages when opening fails.
- Add automated regression tests covering QuickPick accept/open behavior and path normalization helpers.
