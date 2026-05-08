# Procurement Response Pack — Denver Engineering

**For:** Enterprise Procurement Teams  
**Version:** 10.0.0  
**Date:** 2026-05-07

---

## Company Information

**Legal Name:** Denver Engineering Inc.  
**Founded:** 2023  
**Headquarters:** Denver, CO, USA  
**Employees:** 45  
**Product:** AI Workflow Platform (SaaS + On-premise)

---

## Security Questionnaire Responses

### Data Handling

**Q: Where is customer data stored?**  
A: Customer data is stored in AWS RDS (Postgres 15) with AES-256 encryption at rest. Data residency regions: US-East, US-West, EU-Frankfurt. Customer data is never co-mingled — per-tenant Row-Level Security enforces strict isolation at the database layer.

**Q: What is the data retention policy?**  
A: Configurable per tier. Audit logs: 30 days (Starter), 90 days (Professional), up to 7 years (Enterprise). Customer data deleted within 30 days of contract termination.

**Q: Do you use subprocessors?**  
A: Yes. Key subprocessors: AWS (infrastructure), Stripe (billing), OpenAI (AI model provider). Full subprocessor list available under NDA.

### Access Control

**Q: How is access to customer data controlled?**  
A: PostgreSQL Row-Level Security with mandatory `tenant_id` enforcement on all queries. Application engineers cannot access customer data without audit-logged break-glass procedure.

**Q: What authentication mechanisms are supported?**  
A: SSO via SAML 2.0 and OIDC. MFA enforced for admin roles. API key authentication for service integrations.

**Q: Is there role-based access control?**  
A: Yes. Roles: admin, operator, viewer, edge_node. Permissions enforced at API and database layers.

### Compliance

**Q: What certifications does Denver Engineering hold?**  
A: SOC 2 Type II audit in progress (evidence collected, audit scheduled Q3 2026). ISO 27001 alignment documented. HIPAA-compliant data handling available as Enterprise add-on.

**Q: How are security incidents managed?**  
A: Formal incident response playbook with P0/P1/P2/P3 classification. Customers notified within 72 hours of confirmed breach affecting their data (per GDPR Article 33).

### Business Continuity

**Q: What is the uptime SLA?**  
A: 99.9% for Professional tier; custom (up to 99.99%) for Enterprise. Monitored via `uptimeMonitor` across 9 metric dimensions.

**Q: What is the RTO/RPO?**  
A: RTO: 4 hours. RPO: 1 hour. Based on continuous WAL streaming and cross-region backups.

**Q: Do you conduct DR tests?**  
A: Yes, quarterly. Results available to Enterprise customers under NDA.

---

## Standard Contract Terms

- **Payment terms:** Net 30 (Enterprise), credit card (Starter/Professional)
- **Contract term:** Annual or multi-year (Enterprise)
- **Auto-renewal:** Yes, with 90-day termination notice
- **Governing law:** Colorado, USA
- **DPA available:** Yes (GDPR, CCPA compliant)
- **Data Processing Agreement:** Standard DPA included; custom DPA negotiable for Enterprise

---

## References

Available upon request from enterprise customers currently in production deployment.
