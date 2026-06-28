# Federation Release Policy

How Federation Specification versions are released and supported. Pairs with
`FEDERATION_CHANGE_POLICY.md` (versioning/compatibility) and `FEDERATION_LIFECYCLE.md` (stages).

---

## 1. Release cadence
- **Minor** (`v2.X`) — on demand as additive capabilities are approved; target no more than one per
  **month** to give members a stable target.
- **Patch** (`v2.X.Y`) — anytime for clarifications/typos; no migration required.
- **Major** (`vX.0`) — rare and planned; announced at least **one compatibility window** in advance with
  a migration guide. Batch breaking changes into a major rather than dribbling them out.

Each release ships: updated `ECOSYSTEM_INTEGRATION_CONTRACT.md` (version bumped), a changelog entry, and
the approved RFC(s).

## 2. Compatibility policy
- Within a major line, every minor is **backward compatible** (additive only; consumers ignore unknown
  fields).
- Across majors, a **coexistence period** lets old and new run together (version negotiation /
  dual-read). See `FEDERATION_CHANGE_POLICY.md` §3–4.

## 3. Support window
- The **current** minor and the **previous two** minors are supported.
- The **previous major** is supported for **180 days** after a new major is Certified, then Deprecated →
  Retired.

## 4. LTS policy
- One minor per major line is designated **LTS** and supported for the life of that major (until the next
  major is Certified + its 180-day window).
- New repositories should target the current LTS unless they need a newer minor's capability.

## 5. Migration expectations
- Every breaking change ships migration docs and a coexistence path before it lands (no flag-day cutovers).
- Members must migrate off Deprecated contracts before their compatibility window closes.
- Migrations are additive and reversible wherever possible; data re-keying must preserve identity (UUIDs
  never change — use supersede/merge per the Universal Object Service).

## 6. Repository adoption strategy
- New repos onboard against the current LTS or current minor (`FEDERATION_ADOPTION_GUIDE.md`).
- Adoption is **incremental**: reach Level 1 (Compatible) first, then Level 2 (Certified).
- A repo may adopt the spec behind feature flags and flip them per its own deploy schedule —
  independent deployability is preserved; the federation never requires synchronized releases.

## 7. Release checklist
- [ ] RFC(s) Approved; version assigned.
- [ ] `ECOSYSTEM_INTEGRATION_CONTRACT.md` updated + version bumped.
- [ ] Changelog entry written (what/why/compatibility).
- [ ] Migration + deprecation notices published (if any).
- [ ] Compliance checklist re-validated for the reference implementation.
- [ ] Affected repo owners notified with target dates.
