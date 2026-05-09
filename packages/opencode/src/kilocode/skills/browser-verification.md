# Browser Verification

Use this skill when frontend changes need verification in a browser or webview.

## What To Verify

- The target route or panel loads without console errors.
- The specific control changed by the task responds to click, keyboard, and focus.
- State persists or resets exactly as intended.
- Layout adapts at narrow, normal, and wide widths.
- Theme-sensitive colors remain readable in dark and light themes when applicable.
- Loading, empty, disabled, and error states are understandable.

## Process

1. Identify the shortest user path that exercises the changed behavior.
2. Prefer the project's existing dev server or webview test harness.
3. Capture exact errors, selectors, labels, and screenshots only when they help diagnosis.
4. Do not mark verification complete just because the page renders; interact with the changed control.
5. If browser automation is unavailable, list the manual verification steps precisely.

## Report

- Flow tested.
- Pass/fail result.
- Visible issues.
- Follow-up checks still needed.
