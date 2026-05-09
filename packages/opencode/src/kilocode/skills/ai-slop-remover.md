# AI Slop Remover

Use this skill to remove over-engineered, generic, brittle, or cosmetic AI-generated code that does not earn its complexity.

## Detect

- Generic abstractions with only one caller.
- Redundant wrappers, config layers, or adapters that hide simple logic.
- Excessive comments explaining obvious code.
- UI that looks polished but breaks state, accessibility, responsiveness, or theme behavior.
- Tests that duplicate implementation logic instead of asserting behavior.
- Broad refactors bundled with a small bug fix.

## Fix

- Reduce to the smallest implementation that preserves the intended behavior.
- Keep names concrete and local to the domain.
- Prefer existing helpers and conventions over new frameworks.
- Delete dead branches, unused options, and speculative extension points.
- Keep user-visible behavior and public interfaces stable unless changing them is the point.

## Output

State what was simplified, what risk was removed, and what behavior remains unchanged.
