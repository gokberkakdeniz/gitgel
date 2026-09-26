#!/usr/bin/env bash
# Builds throwaway git repositories for manually testing Gitgel.
#
# Development tool only: it uses the git CLI and writes, but only inside $ROOT, which it creates
# itself and marks with a marker file. The app never runs git.
#
#   scripts/make-fixtures.sh                 (re)create all fixtures
#   scripts/make-fixtures.sh delete-branch   delete `to-be-deleted` in api-server
#   scripts/make-fixtures.sh remove-repo     move web-app away (repo missing)
#   scripts/make-fixtures.sh restore-repo    move web-app back
set -euo pipefail

ROOT="${GITGEL_FIXTURES:-$HOME/gitgel-fixtures}"
MARKER=".gitgel-fixtures"

# Fixed identity, and none of the user's git config (signing, hooks, default branch).
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.com
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

die() { echo "make-fixtures: $*" >&2; exit 1; }

require_marker() {
  [[ -f "$ROOT/$MARKER" ]] || die "$ROOT has no $MARKER marker; refusing to touch it"
}

# Commit timestamps: N days ago, each commit a few seconds after the previous one so the order is
# stable within a day.
SEQ=0
at() {
  SEQ=$((SEQ + 1))
  local t=$(( $(date -v-"$1"d +%s) - 3600 + SEQ * 10 ))
  export GIT_AUTHOR_DATE="$t +0000" GIT_COMMITTER_DATE="$t +0000"
}

# put <dir> <path> <content>
put() {
  mkdir -p "$(dirname "$1/$2")"
  printf '%s\n' "$3" > "$1/$2"
}

# commit <dir> <days ago> <message>
commit() {
  at "$2"
  git -C "$1" add -A
  git -C "$1" commit -q -m "$3"
}

# A 1x1 PNG.
png() {
  mkdir -p "$(dirname "$1/$2")"
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
    | base64 --decode > "$1/$2"
}

make_web_app() {
  local remote="$ROOT/remote/web-app.git" seed="$ROOT/remote/seed" repo="$ROOT/web-app"

  # main is built in a seed clone and pushed, so the real clone gets origin/HEAD -> main.
  git init -q --bare -b main "$remote"
  git init -q -b main "$seed"
  put "$seed" src/auth/session.ts 'export function getSession() { return null; }'
  put "$seed" src/auth/token.ts 'export function readToken() { return ""; }'
  put "$seed" src/api/client.ts 'export const baseUrl = "/api";'
  put "$seed" package.json '{ "name": "web-app", "version": "1.0.0" }'
  commit "$seed" 30 "Initial app"
  git -C "$seed" push -q "$remote" main
  rm -rf "$seed"

  git clone -q "$remote" "$repo"

  # Fast-forwarded into main.
  git -C "$repo" switch -q -c merged-ff
  put "$repo" src/api/retry.ts 'export const retries = 3;'
  commit "$repo" 20 "Add retry constant"
  git -C "$repo" switch -q main
  git -C "$repo" merge -q --ff-only merged-ff

  # Squash-merged into main; the branch stays.
  git -C "$repo" switch -q -c squashed
  put "$repo" src/api/timeout.ts 'export const timeoutMs = 5000;'
  commit "$repo" 12 "Add request timeout"
  put "$repo" src/api/client.ts 'export const baseUrl = "/api/v1";'
  commit "$repo" 11 "Version the API base URL"
  git -C "$repo" switch -q main
  git -C "$repo" merge -q --squash squashed >/dev/null
  commit "$repo" 10 "Request timeout and versioned base URL (#12)"

  # Old and unmerged: only in the palette's "Older" group.
  git -C "$repo" switch -q -c old-feature
  put "$repo" src/legacy/banner.ts 'export const banner = "old";'
  commit "$repo" 60 "Legacy banner"
  git -C "$repo" switch -q main

  # Checked out in a worktree, with uncommitted and untracked changes.
  git -C "$repo" switch -q -c session-token-refresh
  put "$repo" src/auth/session.ts 'export function getSession() { return refresh(); }'
  commit "$repo" 3 "Refresh the session on read"
  put "$repo" src/auth/refresh.ts 'export function refresh() { return null; }'
  commit "$repo" 3 "Add refresh helper"
  git -C "$repo" mv src/auth/token.ts src/auth/tokens.ts
  commit "$repo" 2 "Rename token.ts to tokens.ts"
  put "$repo" test/auth/refresh.test.ts 'test("refresh", () => {});'
  commit "$repo" 1 "Test refresh"
  git -C "$repo" switch -q main
  git -C "$repo" worktree add -q "$ROOT/wt/token-refresh" session-token-refresh
  put "$ROOT/wt/token-refresh" src/auth/refresh.ts 'export function refresh() { return getSession(); }'
  put "$ROOT/wt/token-refresh" scripts/token-debug.ts 'console.log("token debug");'

  # Recent, not checked out, with a binary file.
  git -C "$repo" switch -q -c feat/billing-v2
  put "$repo" src/billing/plan.ts 'export const plans = ["free", "pro"];'
  commit "$repo" 2 "Billing plans"
  png "$repo" public/billing/badge.png
  commit "$repo" 2 "Billing badge"
  put "$repo" src/billing/invoice.ts 'export function invoice() {}'
  commit "$repo" 2 "Invoice stub"
  git -C "$repo" switch -q main

  git -C "$repo" push -q origin main
}

make_api_server() {
  local repo="$ROOT/api-server"

  # Default branch master and no origin: base falls back past origin/HEAD and main.
  git init -q -b master "$repo"
  put "$repo" src/index.ts 'import "./jobs";'
  put "$repo" src/jobs/index.ts 'export const jobs = [];'
  put "$repo" src/config/schedule.ts 'export const schedule = {};'
  put "$repo" package.json '{ "name": "api-server", "version": "1.0.0" }'
  commit "$repo" 40 "Initial server"

  git -C "$repo" switch -q -c feat/job-queue
  put "$repo" src/queue/worker.ts 'export function work() {}'
  commit "$repo" 5 "Queue worker"
  put "$repo" src/queue/index.ts 'export * from "./worker";'
  commit "$repo" 4 "Queue index"
  put "$repo" docker-compose.yml 'services: { redis: { image: redis } }'
  commit "$repo" 3 "Redis for the queue"

  # Stacked on feat/job-queue, checked out in a worktree with one modified file.
  git -C "$repo" switch -q -c token-rotation-job
  put "$repo" src/jobs/rotate-tokens.ts 'export function rotate() {}'
  commit "$repo" 2 "Token rotation job"
  put "$repo" test/jobs/rotate-tokens.test.ts 'test("rotate", () => {});'
  commit "$repo" 1 "Test token rotation"

  git -C "$repo" switch -q -c to-be-deleted master
  put "$repo" src/tmp.ts 'export const tmp = 1;'
  commit "$repo" 1 "Temporary change"

  git -C "$repo" switch -q master
  git -C "$repo" worktree add -q "$ROOT/wt/token-rotation" token-rotation-job
  put "$ROOT/wt/token-rotation" src/jobs/rotate-tokens.ts 'export function rotate() { return true; }'
  git -C "$repo" worktree add -q --detach "$ROOT/wt/detached" feat/job-queue~1
}

make_all() {
  case "$ROOT" in
    "" | "/" | "$HOME" | "$HOME/") die "refusing to use $ROOT as the fixture root" ;;
  esac
  if [[ -e "$ROOT" ]]; then
    require_marker
    rm -rf "$ROOT"
  fi
  mkdir -p "$ROOT"
  touch "$ROOT/$MARKER"

  make_web_app
  make_api_server
  put "$ROOT" not-a-repo/notes.txt 'Not a git repository.'

  cat <<EOF
Fixtures ready in $ROOT

Add these in Gitgel:
  $ROOT/web-app              git repo (base from origin/HEAD -> main)
  $ROOT/api-server           git repo (base master, no origin)
  $ROOT/wt/token-refresh     worktree folder, resolves to web-app
  $ROOT/not-a-repo           not a git repo
EOF
}

case "${1:-}" in
  "") make_all ;;
  delete-branch)
    require_marker
    git -C "$ROOT/api-server" branch -q -D to-be-deleted
    echo "Deleted to-be-deleted in $ROOT/api-server"
    ;;
  remove-repo)
    require_marker
    mv "$ROOT/web-app" "$ROOT/web-app.moved"
    echo "Moved $ROOT/web-app to $ROOT/web-app.moved"
    ;;
  restore-repo)
    require_marker
    mv "$ROOT/web-app.moved" "$ROOT/web-app"
    echo "Moved $ROOT/web-app.moved back to $ROOT/web-app"
    ;;
  *) die "unknown command: $1 (use delete-branch, remove-repo or restore-repo)" ;;
esac
