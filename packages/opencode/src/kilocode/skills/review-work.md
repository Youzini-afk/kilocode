# Review Work

Use this skill for final acceptance, technical review, plan review, and risk checks after non-trivial work.

## Review Lens

- Correctness: does the change solve the stated problem at the root cause?
- Scope: did it avoid unrelated refactors and hidden behavior changes?
- Maintainability: can future maintainers understand and modify it safely?
- Safety: are permissions, user data, credentials, filesystem access, network calls, and destructive operations handled defensibly?
- Verification: are the smallest relevant tests or manual checks identified and run when practical?

## Process

1. Restate the intended outcome in one sentence.
2. Inspect the changed files and the adjacent call sites that determine behavior.
3. Look for regressions in state synchronization, async ordering, error handling, permissions, and edge cases.
4. Prefer simpler alternatives when the implementation is overbuilt.
5. Separate blocking issues from follow-up improvements.

## Output Format

- Verdict: accept, accept with notes, or reject.
- Blocking issues: concrete file paths and reasons.
- Non-blocking risks: tradeoffs worth tracking.
- Verification: commands or manual flows already checked, plus missing checks if any.
