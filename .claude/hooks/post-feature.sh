#!/bin/bash
# Post-feature hook: ask to git commit or create new branch
# Triggered after code changes are complete

CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ "$CHANGES" -eq 0 ]; then
    echo "No uncommitted changes."
    exit 0
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Feature complete! $CHANGES file(s) changed."
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  [1] Git commit to current branch"
echo "  [2] Create new branch and commit"
echo "  [3] Skip (no action)"
echo ""
echo -n "  Choose (1/2/3): "
read -r choice

case "$choice" in
    1)
        echo ""
        echo "Current branch: $(git branch --show-current)"
        echo -n "Commit message: "
        read -r msg
        if [ -n "$msg" ]; then
            git add -A
            git commit -m "$msg"
            echo "✓ Committed to $(git branch --show-current)"
        else
            echo "✗ Empty message, skipped."
        fi
        ;;
    2)
        echo ""
        echo -n "New branch name: "
        read -r branch_name
        if [ -n "$branch_name" ]; then
            git checkout -b "$branch_name"
            echo -n "Commit message: "
            read -r msg
            if [ -n "$msg" ]; then
                git add -A
                git commit -m "$msg"
                echo "✓ Created branch '$branch_name' and committed."
            else
                echo "✗ Empty message, branch created but not committed."
            fi
        else
            echo "✗ Empty branch name, skipped."
        fi
        ;;
    *)
        echo "Skipped."
        ;;
esac
