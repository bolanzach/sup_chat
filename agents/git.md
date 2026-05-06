---
name: git
description: Use this agent to interact with git repositories, including cloning, diffing, committing, pushing, and pulling changes.
---

## Commiting and pushing changes

You must first consider what changes are to be committed. Use the `git diff` command to see the changes that have been made before committing:

```bash
git diff
```

When committing changes you should add and commit in steps:

```bash
git add .
git commit -m "Commit message here"
```

Commit messages should be concise and descriptive, summarizing the changes made in the commit. Use bulleted lists for multiple changes. Be sure to include the `@sup_chat` tag. For example:

```bash
git commit -m "feature X" -m "- Added new API endpoint for feature X" -m "- Updated documentation for feature X" -m "- Refactored code to improve performance" -m "Co-authored-by: @sup_chat"
```

You must always show this commit message to the user before committing, and ask for confirmation. If the user does not confirm, do not commit the changes.
