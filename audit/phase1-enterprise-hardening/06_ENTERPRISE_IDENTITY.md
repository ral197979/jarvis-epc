# Phase 6 — Enterprise Identity
**Denver Engineering Platform · SAML, SCIM, SSO**
**Status:** ❌ NOT STARTED — Gap analysis and architecture documented

---

## Objective

Enable enterprise customers to use their existing identity providers (Azure AD, Okta, Google Workspace) for single sign-on and automated user provisioning. This is a hard requirement for enterprise sales into Fortune 500 construction firms.

---

## Current State

Denver Engineering has:
- ✅ Custom JWT authentication (`api/auth.ts`)
- ✅ 5-role RBAC (owner, admin, project_manager, engineer, viewer)
- ✅ Multi-tenant user storage (`users` table with `tenant_id`)
- ❌ No SSO (no SAML, no OIDC, no OAuth social login)
- ❌ No SCIM provisioning endpoint
- ❌ No IdP connection per tenant

The commercial readiness audit noted this as the primary reason enterprise deals stall:

> "Any CISO-level buyer will immediately ask: 'Does it support our Okta?' The answer today is no."

---

## Gap Analysis

### Gap 1: SAML 2.0 Single Sign-On

Enterprise buyers want their employees to log in via their corporate IdP without creating a separate password. SAML 2.0 is the de facto standard for construction enterprise (older buyers) and OIDC for cloud-native buyers (newer).

**What's missing:**
- No `passport-saml` or `samlify` library installed
- No `/auth/saml/login` redirect endpoint
- No `/auth/saml/callback` assertion consumer endpoint
- No per-tenant IdP configuration storage (entityId, SSO URL, certificate)
- No attribute mapping (IdP claims → Denver Eng user fields)
- No JIT provisioning (create user on first SAML login)

**Implementation estimate:** 3–5 days for a single IdP; 7–10 days for multi-IdP per tenant.

### Gap 2: OIDC (OpenID Connect)

OIDC is preferred by cloud-native enterprises (Okta, Azure AD modern flows, Google Workspace):
- Simpler than SAML
- Uses `passport-openidconnect` or `openid-client`
- Required for Azure AD B2C and some Okta configurations

### Gap 3: SCIM 2.0 User Provisioning

SCIM allows Okta/Azure AD to automatically create, update, and deactivate users when their HR system changes. Without SCIM, IT admins must manually manage users in two systems.

**What's missing:**
- No `/scim/v2/Users` CRUD endpoint
- No SCIM token authentication
- No attribute mapping (SCIM schema → Denver Eng schema)
- No deprovisioning flow (SCIM DELETE → `is_active = false`)

### Gap 4: Per-Tenant IdP Configuration

Enterprise tenants need to configure their own identity provider. This requires:
- A `tenant_sso_configs` table: `tenant_id`, `protocol` (saml/oidc), `idp_entity_id`, `sso_url`, `certificate`, `attribute_mapping`
- Admin UI for IT admins to configure their IdP
- Metadata URL auto-import for common IdPs

---

## Recommended Implementation Plan

### Phase 6A: SAML for Azure AD (Week 1–2)

```
1. npm install @node-saml/passport-saml
2. Add tenant_sso_configs table (migration 073)
3. Implement GET /auth/saml/:tenantSlug/login   — generates SAML AuthnRequest
4. Implement POST /auth/saml/:tenantSlug/callback — validates assertion, issues JWT
5. Add JIT provisioning: create user if not exists on first SAML login
6. Attribute mapping: NameID → email, role claim → Denver Eng role
```

**Tenant SSO config table:**
```sql
CREATE TABLE tenant_sso_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  protocol    TEXT NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  -- SAML-specific
  idp_entity_id   TEXT,
  idp_sso_url     TEXT,
  idp_certificate TEXT,  -- PEM
  sp_entity_id    TEXT,
  -- OIDC-specific
  client_id       TEXT,
  client_secret   TEXT,  -- encrypted at rest
  discovery_url   TEXT,
  -- Shared
  attribute_mapping JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 6B: OIDC for Okta (Week 2–3)

```
1. npm install openid-client
2. Add OIDC strategy via discovery URL
3. Reuse same JWT issuance flow as SAML callback
4. Test against Okta developer account
```

### Phase 6C: SCIM 2.0 (Week 3–4)

```
1. Add /scim/v2/Users endpoint router
2. Implement GET /scim/v2/Users?filter=userName eq "..."
3. Implement POST /scim/v2/Users  — create user
4. Implement PUT  /scim/v2/Users/:id — update user
5. Implement PATCH /scim/v2/Users/:id — partial update (active=false)
6. Add SCIM bearer token authentication per tenant
7. Test with Okta SCIM provisioning app
```

---

## Security Considerations

### Certificate Validation
SAML assertions must be signed with the IdP's X.509 certificate. The certificate must be pinned per tenant, not trusted dynamically. Any SAML assertion without a valid signature from the stored certificate must be rejected.

### SAML Replay Prevention
SAML assertion IDs (`InResponseTo`) must be checked against a short-lived store to prevent replay attacks. Use Redis (when upgraded) or a PostgreSQL table with TTL cleanup.

### OIDC State Parameter
The `state` parameter in the OAuth 2.0 authorization flow must be verified on callback to prevent CSRF. Use a signed, expiring state token tied to the session.

### SCIM Token Rotation
SCIM bearer tokens should be rotatable per tenant without disrupting provisioning. Store a hash (not the token itself) in the database.

---

## Score Impact (If Implemented)

| Metric | Current | After 6A-6C |
|--------|---------|-------------|
| Enterprise Identity score | 22/100 | 72/100 |
| Can sell to Fortune 500 | No | Conditionally yes |
| IT admin requirement | Manual user mgmt | Automated |
| Overall platform score | 79/100 | ~86/100 |

---

## Decision Required

Before implementation, the product team needs to confirm:

1. **SAML or OIDC first?** — SAML for older construction enterprises; OIDC for tech-forward customers
2. **Azure AD or Okta first?** — Azure AD has larger market share in construction; Okta is preferred by software-forward firms
3. **Self-service configuration?** — Can tenant admins configure their own IdP, or does it require a platform admin?
4. **Free vs. paid feature?** — SSO is typically gated behind enterprise tiers in competing products (Procore, ACC)
