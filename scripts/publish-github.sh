#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo 'Install GitHub CLI and run gh auth login first.' >&2; exit 1; }
gh auth status
gh repo view huizheng1-lab/CiteFlow --json nameWithOwner
npm test
git rev-parse --git-dir >/dev/null
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit or stash local changes before publishing.' >&2
  exit 1
fi
if git remote get-url origin >/dev/null 2>&1; then
  remote_url="$(git remote get-url origin)"
  case "$remote_url" in
    https://github.com/huizheng1-lab/CiteFlow.git|git@github.com:huizheng1-lab/CiteFlow.git) ;;
    *) echo 'origin does not point to huizheng1-lab/CiteFlow; inspect it before publishing.' >&2; exit 1 ;;
  esac
else
  git remote add origin https://github.com/huizheng1-lab/CiteFlow.git
fi
gh auth setup-git
git push origin main
