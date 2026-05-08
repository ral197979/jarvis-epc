# Denver_Engineering Audit Playbook

This package contains a reusable audit structure for Denver_Engineering.

## Contents
- `docs/DENVER_ENGINEERING_AUDIT_PLAYBOOK.md` — full audit execution playbook
- `docs/CLAUDE_EXECUTION_PROMPT.txt` — copy-paste prompt for Claude
- `templates/scorecard.json` — score template
- `templates/findings.csv` — findings register template

## When to reuse Luna vs use this
- Reuse Luna only as a base audit shell.
- Use this Denver_Engineering version for any real audit because EPC/completions workflows have different truth checks, risks, and pass/fail gates.

## How to use
1. Open `docs/DENVER_ENGINEERING_AUDIT_PLAYBOOK.md`.
2. Give Claude access to the Denver_Engineering repo.
3. Paste `docs/CLAUDE_EXECUTION_PROMPT.txt`.
4. Require Claude to follow the phase order and output structure exactly.
5. Track remediation using `templates/findings.csv` and `templates/scorecard.json`.
