# Git Master

Use this skill for commits, pushes, rebases, conflict resolution, blame, bisect, and history archaeology.

## Safety Rules

- Read `git status --short` before staging.
- Never include unrelated untracked files unless explicitly requested.
- Keep commits atomic by feature, module, and revert boundary.
- Pair tests with the implementation they verify.
- Do not rewrite pushed history unless the user explicitly asks and the push uses `--force-with-lease`.
- On Windows, do not compose destructive filesystem commands through mixed shells.

## Commit Workflow

1. Inspect status, staged diff, unstaged diff, current branch, upstream, and recent commit style.
2. Split changes by concern. Different modules usually mean different commits.
3. Stage explicit file paths, not broad globs, unless the repo state is intentionally controlled.
4. Use the repository's existing commit convention.
5. Verify the final status and push target.

## History Workflow

- Use `git log -S` when finding when a string was added or removed.
- Use `git log -G` when finding commits whose diff matches a pattern.
- Use `git blame -L` for line ownership.
- Use `git log --follow -- path` for file history across renames.
- Use `git bisect` only with a clear good and bad boundary.
