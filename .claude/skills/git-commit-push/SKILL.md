---
name: git-commit-push
description: Git commit and push workflow. Handles staging, committing, and pushing to GitHub with SSH protocol. Triggers on: commit, push, git commit, git push, 提交, 推送.
---

# Git Commit & Push

## Workflow

### Step 1: Check status
```bash
git status -sb
git diff --stat
git log --oneline -3
```

### Step 2: Stage files
```bash
git add <specific-files>
```
**Never use `git add -A`** — stage specific files only.

### Step 3: Commit
```bash
git commit -m "type: description"
```
Commit message format:
- `feat:` new feature
- `fix:` bug fix
- `refactor:` code refactoring
- Example: `feat: 多版本皮肤+专题功能`

### Step 4: Push (SSH)
```bash
# Ensure remote uses SSH
git remote set-url origin git@github.com:wr57411/question-bank-local.git

# Push
git push origin <branch>
```

**Why SSH**: HTTPS fails due to proxy/SSL issues. SSH works reliably.

### Step 5: Verify
```bash
git log --oneline -1
git status -sb
```

## Key Points
- Remote: `git@github.com:wr57411/question-bank-local.git`
- Branch: `f640/main2`
- Always use SSH for push (HTTPS has proxy issues)
- Stage specific files, never `git add -A`
