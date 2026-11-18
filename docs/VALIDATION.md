# Validation summary: 0.7.0

Validation date: 2026-11-18. Tested on Windows 11 x64.

| Check | Result |
| --- | --- |
| TypeScript and Windows installer build | Passed |
| Core and runtime behavior | 80 distinct checks passed, including separately enabled Python and network dependency-install checks |
| Official authorization component | 56 passed; one POSIX-only file-permission test skipped on Windows |
| Desktop and interface regressions | Chat, file recovery, approvals, requirement interaction, model settings, and progress checks passed |
| Expanded execution details | With 250 log entries, typing, scrolling, and closing worked at 1440-, 1280-, and 900-pixel window widths |
| Packaged application startup | ASAR application and official sign-in controls launched in an isolated profile |
| Packaged browser checks | 15 passed, including actual clicks, input, screenshots, mobile dimensions, network boundaries, builds, cancellation, and split chat |
| Production dependency audit | npm audit --omit=dev reported no known vulnerabilities on the validation date |

## End-to-end tests with live models

A test website verified screenshot recognition by both providers, a counter repair, two browser clicks, page assertions, console inspection, and a final review based on tool output and screenshots.

## Limitations

- A separate Windows 10 computer has not been tested.
- The complete installation and uninstallation wizard paths have not been exhaustively tested.
- This is an unsigned personal build.
- The embedded preview does not yet host backends, database services, or local APIs.
- System development tools were not installed during these tests; approval denial and related handling were verified.
