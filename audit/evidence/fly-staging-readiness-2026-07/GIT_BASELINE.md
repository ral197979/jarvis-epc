# Git/Release Baseline

- Repository: `ral197979/jarvis-epc`
- Branch: `infra/fly-staging-readiness`, created from `origin/main`
- Base SHA (`origin/main` at branch creation): `eda53c921685316afe758ff7ba474e858bc9d343` — the PR #18 merge commit
- `main` advanced after PR #18: **no** (confirmed via `git log --oneline --decorate -15 origin/main` showing `eda53c9` as HEAD, and `git merge-base --is-ancestor eda53c9 origin/main` → true)
- Pre-existing untracked files present at branch creation (left untouched by this task except where explicitly noted):
  - `audit/evidence/PR_DRAFT_2026-07-02.md` — **not modified, not added, not committed**
  - `audit/evidence/fly-release-2026-07/SAFE_STOP_REPORT.md` — **corrected in place** (rollback-candidate claim and tracking-status note) and **committed** as part of this task, per HOB §7's explicit instruction to reconcile it
