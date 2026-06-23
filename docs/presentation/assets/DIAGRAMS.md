# Diagrams

Renderable diagrams for the presentation. All blocks are [Mermaid](https://mermaid.js.org) — paste into any Mermaid-capable renderer (or the Mermaid Live Editor) to export SVG/PNG for slides.

---

## 1. Project lifecycle ribbon

```mermaid
flowchart LR
    A[Proposal & Bid] --> B[Design Coordination]
    B --> C[Construction]
    C --> D[Commissioning]
    D --> E[Turnover]
    subgraph Across the whole lifecycle
    F[Financial Controls]
    G[Document AI & Knowledge]
    H[Predictive & Portfolio Intelligence]
    end
    A -.-> F
    B -.-> G
    C -.-> H
```

---

## 2. The "build-to-operate seam" (positioning)

```mermaid
flowchart LR
    subgraph BUILD[Build it]
    P[Construction project & document tools]
    end
    subgraph SEAM[The seam Denver Engineering owns]
    DE[Delivery + Commissioning + Readiness + Turnover]
    end
    subgraph OPERATE[Operate it]
    O[EAM / CMMS / SCADA / Facilities]
    end
    P --> DE --> O
```

---

## 3. Nine work domains

```mermaid
mindmap
  root((Denver Engineering))
    Operations
      Dashboard
      Projects
      Actions
      Team & Timesheets
      Notifications
    AI
      Ask Jarvis
      Predict
    CRM
      CRM
      Proposals
      Directory
    Engineering
      Engineering Hub / FEED
      Drawings & BIM
      Process Design / P&ID
      Calcs / Fix Library
    Construction
      Daily Logs
      Inspections / Punch
      RFIs / Submittals
      Risk / Compliance
      IoT Sensors
    Finance
      Budget / Change Orders
      Cost Control / Entry
      EVM / Portfolio
    Documents
      Transmittals
      Register & Knowledge
    Procurement
      Subcontracts / Vendors
    System
      Integrations / Automation
      MCP / Settings
```

---

## 4. Commissioning workflow (signature)

```mermaid
flowchart TD
    S[Scope: systems / subsystems / tags] --> TP[Build test packs]
    TP --> P1[Pre-commissioning]
    P1 --> P2[Pre-functional]
    P2 --> P3[Functional performance]
    P3 --> DEF{Deficiency?}
    DEF -- Yes --> R[Open deficiency: severity + owner] --> RT[Retest pack]
    RT --> PASS{Retest pass?}
    PASS -- No --> R
    PASS -- Yes --> CLOSE[Close deficiency]
    DEF -- No --> RDY
    CLOSE --> RDY[Readiness score + blocking factors]
    RDY --> TO[Turnover package: O&M, spares, training, warranty]
```

---

## 5. Readiness scoring model

```mermaid
flowchart LR
    OA[Open actions · 30%] --> SUM((Weighted readiness score 0-100))
    BL[Blockers · 25%] --> SUM
    SLA[SLA health · 20%] --> SUM
    INS[Inspections · 15%] --> SUM
    ESC[Escalations · 10%] --> SUM
    SUM --> ST{State}
    ST --> N[Not ready < 40]
    ST --> A[At risk 40-64]
    ST --> C[Conditionally ready 65-84]
    ST --> RR[Ready >= 85]
```

---

## 6. The intelligence layer

```mermaid
flowchart TB
    DATA[(Unified project data model)]
    DATA --> J[Ask Jarvis · grounded, cited answers]
    DATA --> PR[Predict · health, EAC forecast, anomalies]
    DATA --> CC[Command Center · heatmap, correlation, recommendations]
    J --> DEC[Better, faster decisions]
    PR --> DEC
    CC --> DEC
```

---

## 7. Issue-to-resolution operations loop

```mermaid
flowchart LR
    D[Detect] --> T[Triage · risk score]
    T --> RE[Recommend · explainable next-best-action]
    RE --> AC[Act · reassign / escalate / freeze SLA]
    AC --> RC[Correlate root cause]
    RC --> CL[Close & verify]
    CL --> LE[Learn · fix library + asset health]
    LE --> D
```

---

## 8. Data-to-decisions (executive reporting)

```mermaid
flowchart LR
    LD[Live data: logs, costs, tests, actions] --> KPI[KPI aggregation]
    KPI --> PV[Portfolio risk heatmap]
    PV --> FC[Forecast & anomaly alerts]
    FC --> DC[Executive decision]
    DC --> DA[Directed action] --> LD
```

---

## 9. Security & trust layers

```mermaid
flowchart TB
    U[User] --> AUTH[JWT auth + role-based access]
    AUTH --> RL[Rate limiting + prompt-injection guard]
    RL --> APP[Application]
    APP --> RLS[Row-level security per tenant]
    APP --> AUD[Automatic audit logging]
    RLS --> DB[(Tenant-isolated data)]
    AUD --> EV[Exportable compliance evidence]
```

---

## 10. Asset lifecycle ring

```mermaid
flowchart LR
    RG[Register asset/tag] --> IN[Inspect]
    IN --> CM[Commission]
    CM --> RD[Resolve deficiencies]
    RD --> TO[Turnover]
    TO --> OR[Operating record + asset health]
    OR -.-> RG
```

---

*Convert any diagram to a branded slide graphic using `BRAND_AND_STYLE.md`. Slide-specific build guidance is in `SLIDE_GRAPHICS_SPEC.md`.*
