# Enterprise Frontend Components

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

Phase 8 adds 8 enterprise-specific React components in `src/components/enterprise/`. All components use Tailwind CSS and follow the existing dark-mode design system.

## Components

### CustomerSuccessDashboard
**File**: `CustomerSuccessDashboard.tsx`  
**Purpose**: Master customer health view with animated SVG ring charts for adoption, churn risk, support OK, and AI efficiency.  
**API**: `GET /enterprise/health-score`  
**Props**: `{ tenantId: string }`

Score ring rendering: SVG circles with `stroke-dasharray` for proportional fill. Colors: emerald (healthy), amber (at-risk), red (critical).

### TenantHealthPanel
**File**: `TenantHealthPanel.tsx`  
**Purpose**: Compact tenant health widget. Supports `compact` mode for embedding in headers/sidebars.  
**API**: `GET /enterprise/health-score`, `GET /enterprise/entitlements`  
**Props**: `{ tenantId: string; compact?: boolean }`

### SupportEscalationQueue
**File**: `SupportEscalationQueue.tsx`  
**Purpose**: Real-time support queue with SLA countdown, priority badges, and one-click escalation.  
**API**: `GET /enterprise/tickets?status=open`, `POST /enterprise/tickets/:id/escalate`  
**Props**: `{ tenantId: string; onEscalate?: (ticketId: string) => void }`

SLA breach tickets are rendered in a separate "SLA Breached" section with red background. Countdown shows `Xh left` or `OVERDUE`.

### AIUsageMonitor
**File**: `AIUsageMonitor.tsx`  
**Purpose**: Token consumption, budget utilization bar, and cost breakdown by agent type.  
**API**: `GET /enterprise/ai-usage/budget`, `GET /enterprise/ai-usage/by-agent`  
**Props**: `{ tenantId: string }`

Budget bar: emerald (healthy), amber (near limit ≥80%), red (over budget).

### ProductionOpsDashboard
**File**: `ProductionOpsDashboard.tsx`  
**Purpose**: SRE view of deployment health checks with overall status summary and manual check runner.  
**API**: `GET /enterprise/deployment/health`, `POST /enterprise/deployment/health/run`  
**Props**: none (admin-level, no tenant scope)

### DemoControlCenter
**File**: `DemoControlCenter.tsx`  
**Purpose**: Sales tool for creating, inspecting, and resetting demo tenants from all 5 templates.  
**API**: `POST /enterprise/demo`, `GET /enterprise/demo`, `POST /enterprise/demo/:id/reset`  
**Props**: none (admin-level)

### EnterpriseAdminConsole
**File**: `EnterpriseAdminConsole.tsx`  
**Purpose**: Filterable subscription table with lifecycle transition controls (suspend, reactivate, archive).  
**API**: `GET /enterprise/subscriptions`, `POST /enterprise/tenants/:id/lifecycle`  
**Props**: none (admin-level)

### AdoptionAnalyticsView
**File**: `AdoptionAnalyticsView.tsx`  
**Purpose**: Feature adoption rate gauge, monthly usage summary by event type, and feature flag inventory.  
**API**: `GET /enterprise/features`, `GET /enterprise/usage/summary`  
**Props**: `{ tenantId: string }`

### TenantIsolationMonitor
**File**: `TenantIsolationMonitor.tsx`  
**Purpose**: Isolation health checks (API quota, seat quota, key hygiene, expiry) with API key inventory.  
**API**: `GET /enterprise/api-keys`, `GET /enterprise/quota/api`, `GET /enterprise/quota/seats`  
**Props**: `{ tenantId: string }`

## Design Patterns

- **Loading states**: `animate-pulse` class on gray placeholder text
- **Error states**: Red text with raw error message
- **Empty states**: Centered gray text, e.g., "No open tickets"
- **Data fetching**: `useEffect` + `fetch()` — no external data library dependency
- **Fire-and-forget mutations**: `async function handleX()` pattern with try/finally for loading state cleanup
