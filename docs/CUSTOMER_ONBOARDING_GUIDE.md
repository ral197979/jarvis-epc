# Customer Onboarding Guide — Denver Engineering

**Version:** 10.0.0  
**For:** Enterprise Customer Administrators  
**Last Updated:** 2026-05-07

---

## Overview

Welcome to Denver Engineering. This guide walks your team through setup, configuration, and go-live for your enterprise workspace.

---

## Step 1: Tenant Provisioning

Your Customer Success Manager will provision your tenant. You will receive:
- **Tenant ID** — your unique workspace identifier
- **Admin credentials** — initial admin account
- **API endpoint** — your dedicated API URL

Provisioning takes approximately 5 minutes. Once complete, your workspace appears in the `CustomerLaunchCenter` with a go-live checklist.

---

## Step 2: SSO Configuration

Denver Engineering supports SAML 2.0 and OIDC.

**SAML Setup:**
1. Provide your Identity Provider (IdP) metadata URL
2. We configure the Service Provider (SP) with your IdP
3. Test SSO login before proceeding

**OIDC Setup:**
1. Register Denver Engineering as an OAuth 2.0 client in your IdP
2. Provide: `client_id`, `client_secret`, `issuer_url`
3. Redirect URI: `https://api.denverengineering.io/auth/oidc/callback`

---

## Step 3: Team Setup

Add your team members via the admin portal:

1. Navigate to **Settings → Team Members**
2. Invite by email address
3. Assign roles:
   - **Admin** — full platform access
   - **Operator** — can manage workflows, view diagnostics
   - **Viewer** — read-only access

---

## Step 4: Operator Training

All operators should complete the training modules in `OperatorTrainingPanel`:

| Module | Time | Required |
|--------|------|---------|
| Platform Overview | 20 min | ✅ |
| Incident Response | 30 min | ✅ |
| Replay Debugging | 25 min | ✅ |
| Governance Controls | 20 min | Optional |
| Advanced Diagnostics | 35 min | Optional |

Required modules must be completed before go-live.

---

## Step 5: Alert Configuration

Configure where you want to receive platform alerts:

1. **Slack:** Provide your webhook URL in **Settings → Notifications**
2. **PagerDuty:** Provide your routing key for P0/P1 incidents
3. **Email:** Specify addresses for weekly summary reports

---

## Step 6: Billing Setup

Your billing plan is configured automatically during provisioning. To verify:

1. Navigate to **Settings → Billing**
2. Confirm subscription tier and seat count
3. Verify payment method on file

Contact your CSM to adjust tier or seat count.

---

## Step 7: Go Live

Once all launch checklist items in `CustomerLaunchCenter` are complete:

1. Complete all required steps (provisioning, SSO, billing, RBAC, replay verification, training)
2. Click **🚀 Go Live**
3. Your workspace transitions from `pre-launch` to `active` mode

---

## Support

- **In-app:** Use `TenantDiagnosticsPanel` for self-service diagnostics
- **Email:** support@denverengineering.io
- **Escalation:** Your dedicated CSM (critical issues)
- **SLA:** P0 → 15 min, P1 → 1 hour, P2 → 4 hours
