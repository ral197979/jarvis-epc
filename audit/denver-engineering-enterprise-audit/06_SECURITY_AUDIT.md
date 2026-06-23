# 06 — SECURITY AUDIT
## Red-Team Review — Source Verified

---

## Controls in Place (Verified)

| Control | Implementation | Status |
|---------|---------------|--------|
| Authentication | JWT (15 min) + bcrypt passwords + httpOnly refresh cookies (7 days) | ✅ |
| Token revocation | Redis token store + DB refresh_tokens | ✅ |
| RBAC | `role` in JWT: owner/admin/member/viewer | ✅ |
| CSRF | Double-submit cookie pattern, P2-8 | ✅ |
| CSP | Helmet CSP: script-src 'self', frame-ancestors 'none', P2-1 | ✅ |
| CORS | Allowlist from `ALLOWED_ORIGINS` env var | ✅ |
| Rate limiting | 600/min global, 200/15min auth, 30/min AI | ✅ |
| SQL injection | Parameterized queries only (pg driver) | ✅ |
| File type validation | MIME allowlist + IFC 100MB cap | ✅ |
| Prompt injection | 6-pattern regex guard on /api/v1/ask | ✅ |
| WebSocket auth | JWT verified on upgrade | ✅ |
| RLS (tenant isolation) | PostgreSQL RLS on 201+ tables | ✅ |
| Audit logging | Every mutation auto-logged | ✅ |
| UUID validation | All `:id` params validated as UUID v4 | ✅ |
| Sensitive data redaction | password/token/api_key redacted in audit log | ✅ |
| Bcrypt cost | `bcrypt.hash(password, 12)` — appropriate work factor | ✅ |
| Timing attack prevention | `bcrypt.compare()` called even on invalid users | ✅ |

---

## Findings

### P0 — Critical (Immediate Action Required)

**None found.** No P0 security vulnerabilities identified.

---

### P1 — High Severity

#### P1-A: Missing RLS on ~11 Tables (Cross-Tenant Data Leakage Risk)
**File:** Multiple late migration files  
**Issue:** 212 tables exist; ~201 have confirmed RLS. ~11 tables created in later migrations may rely solely on WHERE-clause tenant filtering. If a query omits the WHERE clause (coding error), data leaks across tenants.  
**Exploitability:** Low — requires a code bug, not a protocol-level bypass  
**Remediation:** Run RLS audit SQL; add missing ENABLE ROW LEVEL SECURITY + policy for each table.

#### P1-B: X-Tenant-ID Header Fallback in `requireTenant()`
```typescript
// api/middleware/tenant.ts
const tenantId = req.auth?.tid ?? req.headers['x-tenant-id'] as string
```
**Issue:** If a route somehow passes tenant middleware without auth middleware, an attacker can supply any tenant ID. While no such route was found in this audit, defensive coding requires removing the fallback.  
**Remediation:**
```typescript
// Remove header fallback — derive tenant from JWT only
const tenantId = req.auth?.tid
if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return }
```

#### P1-C: Open Tenant Registration (No Rate Limiting Beyond Global)
```typescript
// api/routes/tenants.ts — POST / has no specific rate limit
tenantsRouter.post('/', async (req, res) => {
```
**Issue:** Global rate limiter allows 600 requests/minute. An attacker can register ~600 tenants/minute, exhausting DB resources.  
**Remediation:** Add a dedicated tenant-creation rate limit of 5/hour per IP.

---

### P2 — Medium Severity

#### P2-A: Login Brute Force — Lockout After 5 Attempts but No IP-Level Block
**Evidence:**
```typescript
// api/auth.ts — account lockout per user
if (user.failed_login_attempts >= 5) { res.status(423).json({...}) }
```
Account lockout exists but per-user, not per-IP. An attacker can cycle through usernames without triggering lockout.  
**Remediation:** Add Redis-based per-IP login attempt counter.

#### P2-B: Error Response Leaks Internal State on AI Gateway
```typescript
// api/server.ts
res.status(500).json({ error: 'gateway_unreachable', message: msg })
```
`msg` is `err.message` from a network error — can include hostnames, IPs, or partial responses from Anthropic.  
**Remediation:** Return generic message in production: `if (IS_PROD) msg = 'AI service unavailable'`

#### P2-C: No Subresource Integrity (SRI) on External Scripts
No external scripts are loaded in the current build — all assets are bundled by Vite. **Currently not applicable.**

#### P2-D: `APS_CLIENT_SECRET` Logged on Token Failure
```typescript
// api/services/bim/apsViewer.ts
throw new Error(`APS token request failed: ${resp.status} ${await resp.text()}`)
```
If APS returns an error that includes the client secret in its body (unlikely but possible), it would appear in Pino logs.  
**Remediation:** Truncate error body: `(await resp.text()).slice(0, 200)`

#### P2-E: No Security Headers on WebSocket Upgrade
The WebSocket upgrade request is authenticated via JWT but no origin checking is performed. A malicious page on a different domain could attempt a WebSocket connection if the browser sends the JWT cookie.  
**Remediation:** Check `req.headers.origin` against `ALLOWED_ORIGINS` on WS upgrade.

---

### P3 — Low Severity

#### P3-A: Session Token in Query String (WebSocket)
```
ws://host/ws?token=<jwt>
```
Query string tokens appear in access logs, browser history, and referrer headers.  
**Recommendation:** Use a short-lived one-time token for WS auth (exchange via REST before connecting).

#### P3-B: No Content-Type Enforcement on API Responses
Routes that return JSON do not set `Content-Type: application/json` explicitly — Express does this automatically, but not on raw `res.send()` calls.

#### P3-C: Recharts SVG XSS Potential
Data rendered in charts (project names, description fields) passes through Recharts which renders SVG. If a field contains `</text><script>`, it would be rendered in SVG context. However, React's JSX escapes strings before rendering.  
**Verdict:** Not exploitable via React JSX rendering. N/A.

#### P3-D: JWT `jti` Not Validated Beyond Revocation
The `jti` claim is stored in Redis for revocation but is a random UUID — not a sequential nonce. Replay of a valid (non-revoked) JWT is possible within the 15-minute window.  
**Verdict:** Acceptable for access tokens; refresh token revocation is the critical path.

---

## Hardcoded Secrets Search

**Result:** No hardcoded API keys, passwords, or secrets found in production code.

```bash
# grep for common secret patterns in non-env, non-test files
grep -rn "'sk-ant-\|'sk-\|password=.*'" api/ src/ --include="*.ts" 
# 0 results
```

The `.env.example` file contains placeholder values — correct behavior.

---

## Dependency Vulnerabilities

**Not audited in this review.** Recommend running `npm audit` and reviewing:
- `web-ifc` — C++ native bindings, historically has memory safety issues
- `bcrypt` — native binding, check for CVEs
- `jsonwebtoken` — several past CVEs; verify version is latest

---

## Security Score: 78/100

**Strengths:** JWT/bcrypt auth, RLS, CSRF, CSP, prompt injection guard, UUID validation, audit logging  
**Weaknesses:** ~11 tables missing RLS, open tenant registration, WS token in query string, header-based tenant fallback
