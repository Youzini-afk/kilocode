# Frontend UI/UX Engineering

Use this skill for visible product surfaces: layout, interaction, accessibility, responsive behavior, design-system consistency, and frontend implementation quality.

## Operating Rules

- Start by identifying the user goal, target surface, existing component system, theme tokens, and responsive constraints.
- Reuse the project's UI primitives, CSS variables, spacing scale, and icon system before adding custom styling.
- Prefer a clear visual hierarchy over decorative noise: primary action, secondary action, status, error, and empty states should be obvious.
- Check keyboard access, focus states, labels, contrast, reduced-motion implications, and small-width behavior.
- Keep implementation scoped. Do not redesign unrelated screens while fixing one panel or component.

## Implementation Checklist

- Inspect neighboring components before editing.
- Preserve state and event semantics; UI polish must not break click, save, toggle, or keyboard behavior.
- Use layout primitives that shrink safely: `min-width: 0`, wrapping grids, and responsive fallbacks.
- Avoid hard-coded colors when a theme token exists.
- After changes, verify the exact user path that motivated the UI work.

## Review Output

When reviewing, report:

- Main UX risk.
- Layout/accessibility issues.
- Implementation mismatch with project patterns.
- Smallest fix that improves the user-visible outcome.
