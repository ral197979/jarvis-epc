# 20 — COMPETITIVE ANALYSIS
## Denver Engineering vs. Procore, ACC, Aconex, Trimble

---

## Methodology

Scores are based on feature parity verified from source code (Denver Engineering) and industry knowledge of competitors (Procore, ACC, Aconex, Trimble). Each dimension scored 0–100.

---

## Side-by-Side Feature Matrix

| Feature | Procore | ACC | Aconex | Trimble | **Denver Eng** |
|---------|---------|-----|--------|---------|----------------|
| **Project Management** |
| Project register | 95 | 90 | 80 | 75 | **85** |
| Portfolio dashboard | 95 | 90 | 70 | 80 | **45** (heatmap mocked) |
| Schedule / CPM | 85 | 80 | 50 | 90 | **70** (real CPM, no resources) |
| **Financial** |
| Budget management | 95 | 70 | 60 | 65 | **75** |
| Change orders | 95 | 75 | 65 | 70 | **72** |
| EVM (Earned Value) | 80 | 70 | 40 | 85 | **88** (ANSI/EIA-748 compliant) |
| Invoicing / billing | 95 | 50 | 40 | 50 | **0** |
| **Document Control** |
| Document register | 85 | 90 | 98 | 80 | **78** |
| Transmittals | 80 | 75 | 98 | 70 | **82** |
| Versioning | 90 | 95 | 95 | 80 | **80** |
| **BIM** |
| Model management | 80 | 98 | 50 | 75 | **60** |
| 3D viewer | 75 | 98 | 30 | 80 | **55** (APS, requires config) |
| Clash detection | 50 | 95 | 20 | 70 | **0** |
| BIM-field linking | 70 | 90 | 30 | 75 | **60** |
| **Quality & Safety** |
| Inspections | 90 | 80 | 50 | 90 | **75** |
| Punch lists | 90 | 80 | 50 | 85 | **78** |
| Deficiency tracking | 85 | 75 | 45 | 80 | **80** |
| RFIs | 95 | 80 | 85 | 75 | **72** |
| Submittals | 95 | 85 | 80 | 75 | **68** |
| **Commissioning** |
| Pre-commissioning | 50 | 40 | 30 | 90 | **78** |
| Test packs | 50 | 40 | 30 | 90 | **72** |
| Runbooks / SOPs | 40 | 35 | 25 | 85 | **75** |
| **IoT / Operational** |
| Sensor monitoring | 0 | 20 | 0 | 30 | **72** |
| SCADA integration | 0 | 15 | 0 | 40 | **38** (via HTTP bridge) |
| Process alarms | 0 | 15 | 0 | 35 | **65** |
| **AI Features** |
| AI assistant / chatbot | 30 | 45 | 10 | 15 | **82** (RAG-grounded) |
| Predictive analytics | 40 | 50 | 10 | 30 | **45** (heuristic) |
| AI document extraction | 50 | 60 | 30 | 20 | **70** |
| AI commissioning packs | 0 | 0 | 0 | 0 | **75** (unique) |
| Fix library (AI patterns) | 0 | 0 | 0 | 0 | **82** (unique) |
| **Integrations** |
| ERP (QuickBooks/SAP) | 90 | 70 | 60 | 75 | **8** (framework only) |
| BACnet/IoT protocols | 0 | 20 | 0 | 40 | **20** (HTTP ingest only) |
| Outbound webhooks | 80 | 75 | 70 | 60 | **85** |
| Email notifications | 90 | 80 | 85 | 80 | **40** (TODO in code) |
| **Platform** |
| Multi-tenancy | 85 | 90 | 85 | 80 | **88** (PostgreSQL RLS) |
| Mobile app | 90 | 90 | 75 | 85 | **30** (service layer only) |
| API completeness | 85 | 90 | 75 | 75 | **82** (340+ endpoints) |
| SSO / SAML | 95 | 95 | 90 | 85 | **0** |
| Security posture | 85 | 90 | 85 | 80 | **78** |

---

## Weighted Overall Scores

Weights reflect enterprise buyer priorities:

| Category | Weight | Procore | ACC | Aconex | Trimble | **Denver Eng** |
|----------|--------|---------|-----|--------|---------|----------------|
| Construction workflow | 25% | 91 | 83 | 74 | 80 | **74** |
| Financial management | 20% | 93 | 66 | 53 | 70 | **59** |
| Document management | 15% | 85 | 87 | 97 | 77 | **80** |
| BIM coordination | 15% | 69 | 95 | 33 | 75 | **44** |
| AI features | 10% | 30 | 39 | 12 | 16 | **71** |
| IoT/operational | 10% | 0 | 17 | 0 | 35 | **58** |
| Platform/enterprise | 5% | 88 | 91 | 83 | 80 | **48** |

**Weighted Score:**
| Platform | Overall |
|---------|---------|
| Procore | **77** |
| ACC | **75** |
| Aconex | **65** |
| Trimble | **70** |
| **Denver Engineering** | **64** |

---

## Where Denver Engineering Wins

| Dimension | Denver Eng Advantage |
|-----------|---------------------|
| EVM (Earned Value) | ANSI/EIA-748 with CPI/SPI/EAC/TCPI — better than most |
| AI assistant quality | RAG-grounded vs. generic chatbots |
| IoT integration | Native sensor ingest — competitors have none |
| Commissioning AI | Unique AI-generated packs with credit billing |
| Fix Library | AI pattern mining from deficiency history — unique |
| Transmittals | Workflow comparable to Aconex at lower cost |
| Price point | Dramatically cheaper than all four competitors |
| SLA engine | More sophisticated than typical task management |

---

## Where Denver Engineering Loses

| Dimension | Gap | Impact |
|-----------|-----|--------|
| Clash detection | 0 vs. 50–95 | ❌ BIM-heavy projects disqualified |
| ERP integration | 8 vs. 60–90 | ❌ Finance teams need QuickBooks sync |
| Mobile app | 30 vs. 75–90 | ❌ Field crew adoption at risk |
| SSO/SAML | 0 vs. 85–95 | ❌ Enterprise IT will reject |
| Invoice/billing | 0 vs. 50–95 | ❌ Accounts payable can't use it |
| Portfolio analytics | 45 vs. 70–95 | ❌ C-suite dashboards are mocked |

---

## Target Customer Profile

**Ideal Denver Engineering customer today:**

✅ Engineering-heavy EPC contractor (200–1,000 employees)  
✅ Water/wastewater utility needing IoT + commissioning  
✅ Environmental engineering firm with field inspections  
✅ Facilities management with IoT monitoring needs  
✅ Any firm frustrated by Procore's price ($375/user/month)  

❌ General contractor needing clash detection  
❌ Large GC needing Procore integration for owner  
❌ Finance team needing AP/AR and QuickBooks sync  
❌ International projects requiring data residency  

---

## Competitive Positioning Summary

Denver Engineering is best positioned as a **Procore alternative for the technical/EPC segment** at 30-50% of the price, differentiating on:
1. AI-native features (RAG assistant, commissioning AI, fix library)
2. IoT/sensor integration (PWTP/WWTP market)
3. Full EVM engine included (not an add-on)
4. No per-module pricing

**Head-to-head win probability:**
- vs. Procore (if price is the deciding factor): 40%
- vs. Procore (if features are equal weight): 15%
- vs. Trimble (commissioning segment): 35%
- vs. Excel + generic tools: 80%
