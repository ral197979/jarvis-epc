# Partner Ecosystem Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This guide covers the full partner lifecycle: onboarding, certification, plugin publishing, and ecosystem maintenance. The partner ecosystem enables third-party integrators to build certified integrations on the Denver Engineering platform.

---

## Partner Lifecycle

```
applied → reviewing → certified
```

| Status | Description | Can Access |
|---|---|---|
| `applied` | Application submitted | Public docs only |
| `reviewing` | Under technical review | Sandbox environment |
| `certified` | Fully certified | Production APIs |

Certification expires 1 year from issue date.

### Advancing Partner Status

```typescript
import { advancePartnerStatus } from '../services/phase11/partnerOnboardingService'

await advancePartnerStatus(partnerId, 'certified')
// Sets: status='certified', certified_at=NOW(), expires_at=NOW()+1year
```

### Active Partner Check

```typescript
isPartnerActive(partner): boolean
// true when: status === 'certified' AND !isCertificationExpired(partner)

isCertificationExpired(partner): boolean
// true when: partner.expiresAt < new Date()
```

---

## Certification Types

All 5 certification types must be passed for full partner status:

| Certification | Description | Required |
|---|---|---|
| `technical_integration` | API integration tested end-to-end | ✅ |
| `security_review` | Security posture evaluated | ✅ |
| `performance_validation` | Integration meets latency/throughput SLA | ✅ |
| `api_compliance` | Follows API versioning and deprecation policy | ✅ |
| `data_handling` | Data residency and privacy requirements met | ✅ |

`hasAllRequiredCertifications`: all 5 types have a `passed` certification with no expiry.

---

## Certification Process

### 1. Apply

Partner submits application via partner portal. Status set to `applied`.

### 2. Technical Review (reviewing)

Engineering team reviews:
- API integration code sample
- Security architecture documentation
- Performance test results (must meet platform baselines)
- Data handling policy

Review timeline: 5–10 business days.

### 3. Certification (certified)

Each certification is tracked individually:

```typescript
import { completeCertification, isCertificationPassing } from '../services/phase11/ecosystemCertificationService'

// Pass a certification
await completeCertification(certId, true, 92)
// status='passed', score=92, expiresAt=NOW()+1year

// Fail a certification
await completeCertification(certId, false, 45)
// status='failed'

// Check passing threshold (default: 80)
isCertificationPassing(cert, 80)  // cert.score >= 80
```

### 4. Recertification

Certifications expire annually. `getExpiringCertifications(daysAhead)` returns all certs expiring within the specified window. Notify partners at 60 days and 30 days before expiry.

---

## Plugin Publishing Portal

Partners with certified status can publish plugins via `pluginPublisherPortal`.

### Plugin Lifecycle

```
draft → submitted → under_review → approved → published
                                        ↓
                                    rejected
                        published → deprecated
```

### Publishing Requirements

```typescript
canPublish(plugin): boolean
// plugin.status === 'approved'

isManifestHashValid(hash): boolean
// /^[a-f0-9]{64}$/  — 64-character SHA-256 hex string
```

Plugin manifest must include:
- Plugin name, version, description
- Required API scopes
- Data access declarations
- Contact email for security notifications
- SHA-256 manifest hash (64 hex characters)

### Publishing a Plugin

```typescript
import { submitPlugin, approvePlugin, publishPlugin } from '../services/phase11/pluginPublisherPortal'

// Partner submits plugin for review
await submitPlugin(pluginId)  // draft → submitted

// Engineering approves after review
await approvePlugin(pluginId)  // submitted/under_review → approved

// Partner publishes
await publishPlugin(pluginId)  // approved → published
// Throws if status !== 'approved'
```

---

## Partner API Access

Certified partners receive:
- Production API credentials (scoped to declared access)
- Rate limits per partnership tier
- Webhook registration for tenant events
- Sandbox environment for ongoing development

### Rate Limits by Tier

| Partner Tier | Requests/min | Webhook Events/sec |
|---|---|---|
| Basic | 60 | 10 |
| Standard | 300 | 50 |
| Premium | 1,000 | 200 |
| Strategic | Custom | Custom |

---

## Ecosystem Maintenance

### Quarterly Certification Audit

Run `getExpiringCertifications(90)` quarterly to identify upcoming expirations.

Actions:
1. Notify partners of upcoming expiry (90 days, 60 days, 30 days)
2. Partners re-submit certification materials
3. Engineering reviews and re-certifies
4. Update `expires_at` on re-certification

### Partner Health Metrics

Track per partner:
- API call volume and error rates
- Time to resolve security notifications
- Plugin update frequency
- Customer adoption of partner's integration

Partners with error rates > 5% in production are flagged for review.

---

## Security Responsibilities

Partners are responsible for:
- Securing their API credentials (rotate every 90 days)
- Promptly patching security vulnerabilities in their integrations
- Notifying Denver Engineering of any security incidents within 24 hours
- Maintaining data handling compliance per their `data_handling` certification

Denver Engineering is responsible for:
- Enforcing RLS on all data accessed via partner APIs
- Monitoring for unusual access patterns
- Revoking access if security terms are violated
- Providing security notifications within 48 hours of relevant platform vulnerabilities

---

## Partner Support

| Channel | Use Case | SLA |
|---|---|---|
| Partner Portal | Self-service docs, certification status | Async |
| Email: partners@denvereng.io | Certification questions, access issues | 1 business day |
| Slack: #partner-integration | Technical implementation help | 4 hours |
| PagerDuty: partner-critical | Production integration outages | 30 minutes |
