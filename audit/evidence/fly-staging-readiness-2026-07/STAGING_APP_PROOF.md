# Fly Staging Application — Creation Proof

- App name: `denver-epc-staging` (preferred name from the HOB — confirmed available before creation via `flyctl apps list | grep denver-epc-staging` → no match)
- Organization: `personal` — same org as production, confirmed via `flyctl apps create denver-epc-staging --org personal` output (`New app created: denver-epc-staging`) and `flyctl apps list` showing `denver-epc-staging │ personal │ pending`
- Command run: `flyctl apps create denver-epc-staging --org personal`

## Post-creation verification (all read-only checks, run immediately after creation)
| Check | Result |
|---|---|
| App exists | Yes — `flyctl apps list` shows it |
| Correct organization | Yes — `personal`, matching production |
| Machines running | **0** — `flyctl machines list --app denver-epc-staging` → "No machines are available on this app denver-epc-staging" |
| Application release deployed | **None** — `flyctl releases --app denver-epc-staging` → empty table |
| Secrets set | **None** — `flyctl secrets list --app denver-epc-staging` → empty table |
| Production configuration changed | No — see `FLY_PRODUCTION_BASELINE.md` |
| Default Fly hostname assigned | Yes — `denver-epc-staging.fly.dev` (from `flyctl status`) |
| Custom domain added | No — not attempted, not required |
| Volume created | No — not attempted; `fly.staging.toml` defines no `[[mounts]]`, matching production, which also has none |

No release was deployed merely to prove the app exists, per the HOB's explicit instruction. The app remains in `pending` status (no image, no machine) as of the end of this task.
