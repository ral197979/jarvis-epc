/**
 * Denver Engineering (Enterprise Process Control) v4.0
 * AI-powered business automation and monitoring dashboard
 *
 * PHASE 2 - Module Extraction
 * All shared logic has been extracted to src/modules/.
 * This file imports from those modules and the inline
 * declarations below are suppressed.
 */

import React from "react";

// ─── Module imports ─────────────────────────────────────────────────────────
import { e, mi, ni } from "../modules/theme";
import { De, Me, Gi, $e } from "../modules/utils/formatters";
import { tt } from "../modules/eventBus";
import {
    _slog, _logError, trackFreshness as _trackFreshness,
    getFreshness as _getFreshness, logActivity as _logActivity,
    checkPerfBudgets as _checkPerfBudgets, stateHealth as _stateHealth,
    heartbeat as _heartbeat, enforceRetention as _enforceRetention,
    exportDiagnostics as _exportDiagnostics,
    safeDisplay as _safeDiplay, secureId as _secureId,
    redactSensitive as _redactSensitive,
} from "../modules/observability";
import {
    sessionMetrics as _sessionMetrics,
    structuredLog as _structuredLog,
    activityFeed as _activityFeed,
    collectionFreshness as _collectionFreshness,
    heartbeatLog as _heartbeatLog,
    gatewayLog as _gatewayLog,
    setMaintenanceMode as _setMaintenanceMode,
    csrfToken as _csrfToken,
    undoStack as _undoStack,
    mutationWindow as _mutationWindow,
    gatewayMode as _GATEWAY_MODE,
    errorLog as _errorLog,
} from "../modules/store";
import {
    _checkPolicy, _checkPolicyServer, _setAuthToken, _getAuthToken,
    _clearAuthToken, _checkSessionTimeout, _announce, _INPUT_LIMITS,
} from "../modules/auth";
import { _gateway, tn as _tnGateway, nn as _nnGateway, backendUrl as _backendUrl } from "../modules/gateway";
import {
    _crud, _sanitize, _rateLimitOk, _pushUndo, _popUndo,
    _filterItems, _SearchBar, _collectionInventory,
    _bulkDeleteAction, _bulkStatusAction, _validators,
    _isCollectionLocked, injectCrudDeps,
} from "../modules/persistence";
import { hashPin as _hashPin } from "../modules/utils/pinUtils";
import { createDispatch, actions as _bizActions, checkWritePolicy } from "../modules/biz/dispatch";
// G5 Sprint 5 (v4.31.0): use extracted JARVIS_ACTIONS from biz/reducer (superset of former inline map)
import { JARVIS_ACTIONS } from "../modules/biz/reducer";
import { useBizStore, hydrateProjectsFromBackend } from "../modules/biz/store";
// G5 Sprint 7 + P4 (v4.31.0): removed 34 dangling letter-code stub imports.
// Only views actually referenced in JarvisCore's body (via live wrappers Ki/ji/Zi
// and the top-level JarvisToastContainer / JarvisCmdPalette / JarvisBuildAIContext /
// JarvisDomainReducer bindings) are imported here. The dangling imports were
// artefacts of earlier extraction phases; their underlying view files were either
// deleted in P4 or kept live via other components (ContentRouter / sibling views).
import { ModalShellView     as JarvisModalShellView     } from "../components/ModalShellView";
import { KiView              as JarvisKiView              } from "../components/KiView";
import { JiView              as JarvisJiView              } from "../components/JiView";
import { DomainReducer       as JarvisDomainReducer       } from "../components/DomainReducer";
import { CmdPalette          as JarvisCmdPalette          } from "../components/CmdPalette";
import { BuildAIContext      as JarvisBuildAIContext      } from "../components/BuildAIContext";
import { ToastContainer      as JarvisToastContainer      } from "../components/ToastContainer";
import { useAppStore }      from "../modules/store/appSlice";
import { LoginScreen }      from "../components/LoginScreen";
import { OwnerPanel }       from "../components/OwnerPanel";
import { NavSidebar }       from "../components/NavSidebar";
import { ContentRouter }    from "../components/ContentRouter";
import { HeartbeatBar }     from "../components/HeartbeatBar";
// ═══════════════════════════════════════════════════
// MODULE: Core Infrastructure
// Dependencies: React, recharts
// ═══════════════════════════════════════════════════
import {
    useState as g,
    useEffect as ui,
    useRef as ei,
    useCallback as ti
} from "react";
// recharts: moved to extracted view components
// ============================================================================
// io — localStorage-backed persistence shim (async API: get/set/remove)
// ============================================================================
var io = (function() {
    var PREFIX = "jarvis:";
    var mem = {};
    var hasLS = (function() {
        try { var k = "__jarvis_ls_test__"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; }
        catch (e) { return false; }
    })();
    return {
        get: function(key) {
            return new Promise(function(resolve) {
                try {
                    if (hasLS) {
                        var raw = localStorage.getItem(PREFIX + key);
                        resolve(raw == null ? null : JSON.parse(raw));
                    } else {
                        resolve(mem[key] == null ? null : mem[key]);
                    }
                } catch (e) { resolve(null); }
            });
        },
        set: function(key, value) {
            return new Promise(function(resolve) {
                try {
                    if (hasLS) localStorage.setItem(PREFIX + key, JSON.stringify(value));
                    else mem[key] = value;
                    resolve(value);
                } catch (e) { resolve(null); }
            });
        },
        remove: function(key) {
            return new Promise(function(resolve) {
                try {
                    if (hasLS) localStorage.removeItem(PREFIX + key);
                    else delete mem[key];
                    resolve(true);
                } catch (e) { resolve(false); }
            });
        },
    };
})();




// ============================================================================
// PHASE 2: THEME, UTILS, EVENT BUS
// ============================================================================
// e (THEME), mi (CHART_COLORS), ni (TOOLTIP_STYLE) → imported from modules/theme
// De, Me, Gi, $e → imported from modules/utils/formatters
// tt (JIP event bus) → imported from modules/eventBus
// ============================================================================
// MCP tool + resource lists extracted to src/constants/mcpTools.ts
import { JARVIS_MCP_TOOLS as oi, JARVIS_MCP_RESOURCES as Ai } from "../constants/mcpTools";
var Ji = 0, yi = false, Di = [];  // session counters (retained)
// G5 Sprint 7 (v4.31.0): dead wrappers Bi / Qi / Yi deleted — they were never
// referenced in the render tree (ContentRouter handles those tabs natively).
// QiView was also deleted in P4 stub cleanup. BiView and YiView remain live
// (BiView via PlannerView, YiView via KiView chain) — we just don't import them
// in JarvisCore anymore.

// Phase 17: extracted to src/components/JiView.tsx
function ji(i) {
  var _ctx = useJarvis();
  return React.createElement(JarvisJiView, {
    policy: _ctx.policy || {},
    biz:    _ctx.biz    || i.b || {},
  });
}

// Phase 16: extracted to src/components/KiView.tsx
function Ki(i) {
  var _ctx = useJarvis();
  return React.createElement(JarvisKiView, {
    policy: _ctx.policy || {},
    biz:    _ctx.biz    || i.b || {},
  });
}

// Phase 15: body extracted to src/components/ModalShellView.tsx
function Zi(i) {
  var _ctx = useJarvis();
  return React.createElement(JarvisModalShellView, Object.assign({}, i, {
    policy: _ctx.policy || {},
    biz:    _ctx.biz    || i.b || {},
  }));
}

// Phase 18d: $i() seed state extracted to src/config/defaultState.ts
import { DEFAULT_BIZ_STATE as _defaultBizState } from "../config/defaultState";
function $i() { return _defaultBizState; }
// Phase 18c: System prompt extracted to src/config/systemPrompt.ts
import { JARVIS_SYSTEM_PROMPT as en } from "../config/systemPrompt";

// R-08: Rate limiting for AI chat
var _chatRateLimit = { lastCall: 0, callCount: 0, windowStart: 0, MAX_PER_MINUTE: 6, COOLDOWN_MS: 5000 };

// R-13: PII field patterns — stripped before sending to LLM
var _piiFields = ["contact", "email", "phone", "address", "ssn", "social", "dob", "birth", "license_no", "bank", "account_no", "routing", "emergency_contact"];

// R-14: AI Data Filter — sanitize business state before LLM calls
var _AI_MAX_ITEMS_PER_COLLECTION = 25;
var _AI_MAX_PAYLOAD_CHARS = 30000;

function _sanitizeForAI(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") return obj;
    if (typeof obj === "number" || typeof obj === "boolean") return obj;
    if (Array.isArray(obj)) {
        return obj.slice(0, _AI_MAX_ITEMS_PER_COLLECTION).map(_sanitizeForAI);
    }
    var clean = {};
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var keyLower = key.toLowerCase();
        var isPII = false;
        for (var p = 0; p < _piiFields.length; p++) {
            if (keyLower.indexOf(_piiFields[p]) >= 0) { isPII = true; break; }
        }
        if (isPII) {
            clean[key] = "[REDACTED]";
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
            clean[key] = _sanitizeForAI(obj[key]);
        } else {
            clean[key] = obj[key];
        }
    }
    return clean;
}

// Phase 17: extracted to src/components/BuildAIContext.ts
function _buildAIContext(t) {
  return JarvisBuildAIContext(t);
}



// ═══════════════════════════════════════════════════
// MODULE: Security & Auth → suppressed: imported from modules/auth/index.js
// MODULE: Phase 18 Observability → suppressed: imported from modules/observability + store
// MODULE: Gateway & API Layer → suppressed: imported from modules/gateway/index.js
// Phase 19: Phase 18a wrapper functions deleted — ContentRouter uses direct lazy imports
// Phase 18b: Navigation config extracted to src/config/navigation.ts
import { NAVIGATION_ITEMS as Ci } from "../config/navigation";
import { effectiveWriteRole as _effectiveWriteRole } from "../config/capabilities";

// ============================================================================
// STATE MANAGEMENT — Phase 5 (SM-01 through SM-04)
// ============================================================================

// SM-01: React Context for state + mutation distribution
var JarvisContext = React.createContext(null);

// SM-08: useJarvis hook — clean interface for child components
// Usage: var ctx = useJarvis(); ctx.dispatch(JARVIS_ACTIONS.ADD_LEAD, leadData);
function useJarvis() {
    var ctx = React.useContext(JarvisContext);
    if (!ctx) {
        console.warn("[JARVIS] useJarvis() called outside JarvisContext.Provider — returning stub");
        return { biz: {}, dispatch: function(){}, mutate: function(){}, setTab: function(){}, ACTIONS: JARVIS_ACTIONS };
    }
    return ctx;
}

// G5 Sprint 5 (v4.31.0): inline JARVIS_ACTIONS deleted — now imported from ../modules/biz/reducer
// The extracted version is a typed superset of the former inline map; all original
// string values are preserved so existing _domainReducer switch cases continue to match.

// SM-03: Domain reducer — processes typed actions against biz state
// This is the future replacement for inline Z(function(v) { ... }) patterns.
// Currently wraps the existing nn() function for AI actions and _dispatch() for UI.
// Phase 17: extracted to src/components/DomainReducer.ts
function _domainReducer(state, action) {
  return JarvisDomainReducer(state, action);
}

// SM-04: Global bridge — connects unbound mutateBiz/setTab to Qn's functions
// These are set by Qn on mount and called by view components that reference them as free variables.
var mutateBiz = function() { console.warn("[JARVIS] mutateBiz called before init"); };
var setTab = function() { console.warn("[JARVIS] setTab called before init"); };

// AR17-13: View registry — metadata for all domain views
var _VIEW_REGISTRY = {
    "dashboard": { module: "core", label: "Dashboard", collections: ["projects","leads","invoices"], heavy: false },
    "crm": { module: "crm", label: "CRM", collections: ["leads","contracts"], heavy: false },
    "projects": { module: "project", label: "Projects", collections: ["projects","action_items"], heavy: true },
    "safety": { module: "safety", label: "Safety", collections: ["jhas","incidents","toolbox_talks"], heavy: true },
    "construction": { module: "construction", label: "Construction", collections: ["construction_punch","construction_reports","rfis_construction","safety_issues"], heavy: true },
    "portfolio": { module: "portfolio", label: "Portfolio", collections: ["expenses","daily_reports","score_cards","service_tickets","service_trips"], heavy: true },
    "engineering": { module: "engineering", label: "Engineering", collections: ["engineering_deliverables","installation","manpower"], heavy: true },
    "procurement": { module: "procurement", label: "Procurement", collections: ["rfqs","purchase_orders"], heavy: false },
    "submittals": { module: "submittals", label: "Submittals", collections: ["submittals","rfis"], heavy: false },
    "invoicing": { module: "invoicing", label: "Invoicing", collections: ["invoices"], heavy: false },
    "commissioning": { module: "field", label: "Field Ops", collections: ["deficiencies","commissioning_items","cx_itps","cx_certificates"], heavy: true },
    "ncr": { module: "ncr", label: "NCR", collections: ["vendors","customers"], heavy: false },
    "documents": { module: "docs", label: "Documents", collections: ["documents"], heavy: false },
    "closeout": { module: "closeout", label: "Closeout", collections: ["punch_items"], heavy: false },
    "proposals": { module: "proposals", label: "Proposals", collections: ["proposals"], heavy: false },
    "team": { module: "team", label: "Team", collections: ["team_members"], heavy: false }
};

// AR17-10: State selector — memoized collection accessor
function _selectCollection(biz, key) {
    return (biz && biz[key]) || [];
}
function _selectCollectionCount(biz, key) {
    return ((biz && biz[key]) || []).length;
}

function _bindGlobals(mutator, tabSetter, bizRef, oCfgRef) {
    mutateBiz = mutator;
    if (!window.__JARVIS_DIAG) window.__JARVIS_DIAG = {};
    if (bizRef !== undefined) window.__JARVIS_DIAG._biz = bizRef;
    if (oCfgRef !== undefined) window.__JARVIS_DIAG._oCfg = oCfgRef;
    setTab = tabSetter;
    console.info("[JARVIS:SM] Global bridge bound — mutateBiz and setTab are live");
}

// ═══════════════════════════════════════════════════
// MODULE: Data Persistence → suppressed: imported from modules/persistence/index.js
var _JarvisErrorBoundary = function(_React$Component) {
    function JEB(props) {
        var _this = _React$Component.call(this, props) || this;
        _this.state = { hasError: false, error: null, errorInfo: null };
        return _this;
    }
    JEB.prototype = Object.create(_React$Component.prototype);
    JEB.prototype.constructor = JEB;
    JEB.getDerivedStateFromError = function(error) {
        return { hasError: true, error: error };
    };
    JEB.prototype.componentDidCatch = function(error, errorInfo) {
        this.setState({ errorInfo: errorInfo });
        console.error("[JARVIS] Unhandled error caught by ErrorBoundary:", error, errorInfo);
        _logError("ErrorBoundary", error, { componentStack: (errorInfo && errorInfo.componentStack || "").slice(0, 200) });
        _sessionMetrics.errors++;
    };
    JEB.prototype.render = function() {
        var _self = this;
        if (this.state.hasError) {
            return React.createElement("div", {
                style: {
                    background: "var(--jarvis-bg)", color: "var(--jarvis-tx)", height: "100vh", display: "flex",
                    flexDirection: "column", alignItems: "center", justifyContent: "center",
                    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
                    padding: 40, textAlign: "center"
                }
            },
            React.createElement("div", { style: { fontSize: 48, marginBottom: 16 } }, "\u26A0\uFE0F"),
            React.createElement("h1", { style: { fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--jarvis-red)" } }, "JARVIS — Runtime Error"),
            React.createElement("p", { style: { fontSize: 13, color: "var(--jarvis-ts)", marginBottom: 20, maxWidth: 500 } },
                "An unhandled error occurred. Your data has been preserved in local storage. Click below to reload."),
            React.createElement("pre", { style: {
                fontSize: 10, color: "var(--jarvis-amb)", background: "var(--jarvis-cd)", padding: 12, borderRadius: 8,
                border: "var(--jarvis-border-width, 1px) solid var(--jarvis-bd)", maxWidth: 600, overflow: "auto",
                marginBottom: 20, textAlign: "left", maxHeight: 200
            } }, String(this.state.error)),
            React.createElement("div", { style: { display: "flex", gap: 10 } },
                React.createElement("button", {
                    onClick: function() { window.location.reload() },
                    style: {
                        background: "var(--jarvis-ac)", color: "#fff", border: "none", borderRadius: 8,
                        padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer"
                    }
                }, "\u21BB Reload App"),
                React.createElement("button", {
                    onClick: function() { _self.setState({ hasError: false, error: null, errorInfo: null }) },
                    style: {
                        background: "var(--jarvis-cd)", color: "var(--jarvis-ts)", border: "var(--jarvis-border-width, 1px) solid var(--jarvis-bd)", borderRadius: 8,
                        padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer"
                    }
                }, "Try to Recover")));
        }
        return this.props.children;
    };
    return JEB;
}(React.Component);

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================
// Primary dashboard container - integrates all modules and features

// F16-12: Toast notification system
var _toastQueue = [];
var _toastListeners = [];
function _toast(msg, type) {
    type = type || "info";
    var t = { id: Date.now(), msg: msg, type: type, ts: Date.now() };
    _toastQueue.push(t);
    if (_toastQueue.length > 5) _toastQueue.shift();
    _toastListeners.forEach(function(fn) { fn(_toastQueue.slice()) });
    // Also announce for screen readers
    if (typeof _announce === "function") _announce(msg);
    // Auto-dismiss after 4s
    setTimeout(function() {
        _toastQueue = _toastQueue.filter(function(x) { return x.id !== t.id });
        _toastListeners.forEach(function(fn) { fn(_toastQueue.slice()) });
    }, 4000);
}

// Phase 18: extracted to src/components/ToastContainer.tsx
function _ToastContainer() {
  var _ctx = useJarvis();
  return React.createElement(JarvisToastContainer, { biz: _ctx.biz || {} });
}
// Phase 17: extracted to src/components/CmdPalette.tsx
function _CmdPalette(props) {
  var _ctx = useJarvis();
  return React.createElement(JarvisCmdPalette, {
    policy: _ctx.policy || {},
    biz:    _ctx.biz    || {},
    ...props,
  });
}

export default function JarvisCore() {
    _sessionMetrics.renderCount++;
    // AR16-17: Performance guard — warn on excessive re-renders
    if (_sessionMetrics.renderCount % 100 === 0) {
        console.info("[JARVIS:Perf] Render #" + _sessionMetrics.renderCount + " | State: " + Math.round(JSON.stringify(t || {}).length / 1024) + "KB");
    }
    _sessionMetrics.lastRender = new Date().toISOString();
    // Phase 19: Zustand app slice replaces all closure state
    var _cmdOpen     = useAppStore(function(s) { return s.ui.cmdPaletteOpen; });
    var _cmdSetOpen  = useAppStore(function(s) { return s.setCmdPalette; });
    var _cmdQ        = useAppStore(function(s) { return s.ui.cmdQuery; });
    var _cmdQSet     = useAppStore(function(s) { return s.setCmdQuery; });
    var m            = useAppStore(function(s) { return s.ui.activeTab; });
    var p            = useAppStore(function(s) { return s.setTab; });
    var _authOk      = useAppStore(function(s) { return s.auth.isAuthenticated; });
    var _authSet     = function(v) { useAppStore.getState().setAuth({ isAuthenticated: v }); if (v) useAppStore.getState().setTab("focus"); }; // W1: login lands on Focus, not Dashboard
    var _gwEnabled   = useAppStore(function(s) { return s.gateway.enabled; });
    var _gwSet       = function(v) { useAppStore.getState().setGateway({ enabled: v }); };
    var _oCfg        = useAppStore(function(s) { return s.ownerConfig; });
    var _oCfgSet     = useAppStore(function(s) { return s.setOwnerConfig; });
    var _authRole    = useAppStore(function(s) { return s.auth.role; });
    // ADR-014: the role every policy check below must use. Derived from the
    // AUTHENTICATED role; the OwnerPanel preview can only narrow it. The old
    // `_oCfg.activeRole || "owner"` read a client-owned value and fell open to
    // owner when it was absent.
    var _writeRole   = _effectiveWriteRole(_authRole, _oCfg.activeRole);
    var _oPanelOpen  = useAppStore(function(s) { return s.ui.ownerPanelOpen; });
    var _oPanelSet   = useAppStore(function(s) { return s.setOwnerPanel; });
    var _apiStats    = useAppStore(function(s) { return s.apiStats; });
    var _apiStatsSet = useAppStore(function(s) { return s.recordApiCall; });
    var _auditLog    = useAppStore(function(s) { return s.auditLog; });
    var _auditLogSet = function(fn) {
        var entry = typeof fn === "function" ? fn([]) : fn;
        if (entry && entry.length) entry.forEach(function(e) { useAppStore.getState().addAuditEntry(e); });
    };
    // Local state — chat open, drawer, modal, timeline, nav order/hidden, persist flag
    var i = g(function() { return $i(); }),
        t = i[0],
        s = i[1],
        u = g(!1),
        c = u[0],
        R = u[1],
        b = g(null),
        P = b[0],
        z = b[1],
        y = g(!1),
        I = y[0],
        q = y[1],
        V = g(!1),
        O = V[0],
        F = V[1],
        x = g(Ci.map(function(d) { return d.id; })),
        _ = x[0],
        C = x[1],
        U = ei(null),
        re = g(!1),
        ie = re[0],
        ye = re[1],
        S = g({}),
        K = S[0],
        le = S[1],
        _persistLoaded = g(!1),
        _plVal = _persistLoaded[0],
        _plSet = _persistLoaded[1],
        // Gateway loading + pin/err stay local — short-lived form state
        _gwLoading = g(false),
        _gwLoadingVal = _gwLoading[0],
        _gwLoadingSet = _gwLoading[1],
        _authPin = g(""),
        _pin = _authPin[0],
        _pinSet = _authPin[1],
        _authErr = g(""),
        _aErr = _authErr[0],
        _aErrSet = _authErr[1];

    ui(function() {
        // INT-08: In proxied mode, try server state first
        io.get("bizState").then(function(d) {
            if (d && typeof d === "object" && d.company) {
                bi(d);
                s(d);
                console.info("[JARVIS] State restored from persistence (" + (d.activity_log || []).length + " events)");
            } else {
                console.info("[JARVIS] No persisted state found — using defaults");
            }
            _plSet(!0);
        }).catch(function(ex) {
            console.warn("[JARVIS] Persistence load failed:", ex);
            _plSet(!0);
        });
        // R-18: Load persisted audit log
        io.get("auditLog").then(function(d) {
            if (d && Array.isArray(d)) {
                _auditLogSet(d);
                console.info("[JARVIS] Audit log restored: " + d.length + " entries");
            }
        }).catch(function() {});
        io.get("navOrder").then(function(d) { if (d) C(d) }).catch(function(){});
        io.get("navHidden").then(function(d) { if (d) le(d) }).catch(function(){});
        // P2-C: duplicate io.get("auditLog") removed — first call above (line ~4802) is canonical
    }, []);

    // R-05: Hash-based URL routing
    ui(function() {
        var _validIds = Ci.map(function(d) { return d.id });
        function _readHash() {
            var h = (window.location.hash || "").replace("#", "");
            if (h && _validIds.indexOf(h) >= 0) p(h);
        }
        _readHash();
        window.addEventListener("hashchange", _readHash);
        return function() { window.removeEventListener("hashchange", _readHash) };
    }, []);

    // P2-D: Fetch AI gateway status on mount (proxied mode)
    ui(function() {
        if (_GATEWAY_MODE !== "proxied") return;
        fetch(_backendUrl("/api/v1/gateway/status"), { credentials: "include" })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) { if (d !== null) _gwSet(d.enabled !== false); })
            .catch(function() {});
    }, []);

    // AUDIT-P0-10: hydrate the biz store's `projects` collection from the
    // real backend once authenticated — see store.ts for scope/rationale.
    ui(function() {
        if (!_authOk) return;
        hydrateProjectsFromBackend().catch(function() {});
    }, [_authOk]);

    // P2-D: Toggle AI gateway kill switch
    var _toggleGateway = function() {
        if (_GATEWAY_MODE !== "proxied") return;
        _gwLoadingSet(true);
        var ep = _gwEnabled ? "/api/v1/gateway/disable" : "/api/v1/gateway/enable";
        fetch(_backendUrl(ep), { method: "POST", credentials: "include" })
            .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function(d) {
                _gwSet(d.gateway === "enabled");
                _gwLoadingSet(false);
                _slog("INFO", "gateway", "Gateway toggled", { enabled: d.gateway === "enabled" });
            })
            .catch(function(err) { _gwLoadingSet(false); console.warn("[JARVIS:Gateway] Toggle failed:", err); });
    };

    var _setTab = function(d) {
        p(d); // p === useAppStore.setTab
        try { window.location.hash = d; } catch(ex) {}
        // A12-14: Announce view change to screen readers
        if (typeof _announce === "function") {
            var _tabLabel = d.charAt(0).toUpperCase() + d.slice(1).replace(/-/g, " ");
            _announce("Navigated to " + _tabLabel);
            _sessionMetrics.viewChanges++;
        }
    };


    function fe(d, f) {
        C(function(v) {
            var j = v.slice(),
                oe = d + f;
            if (oe < 0 || oe >= j.length) return j;
            var o = j[d];
            j[d] = j[oe], j[oe] = o;
            try { io.set("navOrder", j) } catch(ex) {}
            return j
        })
    }
    // ADR-014: the legacy `_activePersona.tabs` nav filter (and its `Se`/`X`
    // results, which nothing ever read) is gone. It was the third screen-
    // authorization table, it keyed on `_PERSONAS` — whose keys are `exec`/`pm`,
    // not `user_role` values — and Phase 1 deleted the `tabs` field it read,
    // leaving `!_activePersona.tabs` permanently true. NavSidebar now projects
    // authorization from the capability registry; there is no second filter.
    var ne = ti(function(d) {
            s(d);
            try { io.set("bizState", d) } catch(ex) { console.error("[JARVIS] Persist failed:", ex) }
        }, []),
        Z = ti(function(d, _auditAction) {
            // R-17: Owner kill switch — block writes when disabled
            // R-20: Policy-gated write check
            if (!_checkPolicy("data:write", _oCfg, _writeRole).allowed) {
                console.warn("[JARVIS] Write blocked by policy (role=" + _writeRole + ")");
                // A12-17: Announce blocked action
                if (typeof _announce === "function") _announce("Action blocked: insufficient permissions for " + _writeRole + " role");
                _auditLogSet(function(prev) {
                    var next = [{ ts: new Date().toISOString(), actor: "system", action: "WRITE_BLOCKED", changes: [_auditAction || "unknown"], id: "AUD-" + Date.now() }].concat(prev.slice(0, 499));
                    try { io.set("auditLog", next) } catch(ex) {}
                    return next;
                });
                return;
            }
            s(function(f) {
                var v;
                try {
                    v = typeof structuredClone == "function" ? structuredClone(f) : JSON.parse(JSON.stringify(f))
                } catch {
                    v = JSON.parse(JSON.stringify(f || {}))
                }
                // R-16: Capture collection counts before mutation
                var _before = {};
                ["leads","contracts","invoices","purchase_orders","submittals","rfis","documents","action_items","jhas","incidents","expenses","rfqs","punch_items","engineering_deliverables"].forEach(function(col) {
                    _before[col] = (v[col] || []).length;
                });
                bi(v), d && d(v);
                // R-16: Detect what changed and log it
                var _changes = [];
                Object.keys(_before).forEach(function(col) {
                    var after = (v[col] || []).length;
                    if (after !== _before[col]) {
                        _changes.push(col + ": " + _before[col] + " \u2192 " + after);
                    }
                });
                if (_changes.length > 0 || _auditAction) {
                    // A12-13: Announce mutations to screen readers
                    if (typeof _announce === "function") {
                        var _msg = _auditAction ? _auditAction.replace(/_/g, " ") : "Data updated";
                        if (_changes.length > 0) _msg += ": " + _changes.slice(0, 3).join(", ");
                        _announce(_msg);
                    }
                    _auditLogSet(function(prev) {
                        var entry = {
                            ts: new Date().toISOString(),
                            actor: "user",
                            action: _auditAction || "state_mutation",
                            changes: _changes,
                            id: "AUD-" + Date.now()
                        };
                        var next = [entry].concat(prev.slice(0, 499));
                        // R-18: Persist audit log
                        try { io.set("auditLog", next) } catch(ex) {}
                        return next;
                    });
                }
                try { io.set("bizState", v) } catch(ex) { console.error("[JARVIS] Persist failed:", ex) }
                return v
            })
        }, []),
        Q = null;

    // SM-05: Bind global bridge — mutateBiz and setTab become live
    _bindGlobals(Z, _setTab, t, _oCfg);
    window.__JARVIS_CMD = function() { _cmdSetOpen(function(v) { return !v }); _cmdQSet(""); };

    // R-22: Centralized dispatch — standard mutation interface
    // All future code should call _dispatch instead of Z directly.
    // This creates a single chokepoint for policy, audit, validation.
    function _dispatch(action, data, meta) {
        var actionLabel = (typeof action === "string" ? action : action.type || "unknown") + (meta ? " (" + JSON.stringify(meta).slice(0, 60) + ")" : "");

        // 1. Policy check
        var writePolicy = _checkPolicy("data:write", _oCfg, _writeRole);
        if (!writePolicy.allowed) {
            _logError("dispatch", "Blocked: " + actionLabel + " — " + writePolicy.reason);
            return false;
        }

        // BRIDGE: These Z() calls are the _dispatch → bizReducer → Zustand sync bridge.
        // They are NOT raw mutations — they route through bizReducer and should remain.
        // Phase 8: All *direct* Z() mutations above have been migrated to typed _dispatch().
        // SM-06: If action is a domain action object {type, payload}, use _domainReducer
        if (typeof action === "object" && action.type) {
            Z(function(state) {
                var result = _domainReducer(state, action);
                Object.assign(state, result);
            }, action.type);
            return true;
        }

        // SM-06: If action is a JARVIS_ACTIONS string (e.g. "crm/add_lead"), wrap it
        if (typeof action === "string" && action.indexOf("/") >= 0) {
            Z(function(state) {
                var result = _domainReducer(state, { type: action, payload: data });
                Object.assign(state, result);
            }, action);
            return true;
        }

        // Legacy: plain string actions ("add", "update", "delete", "set_company")
        // 2. Execute mutation via Z with audit label
        Z(function(state) {
            switch(action) {
                case "add":
                    if (data.collection && data.record) {
                        state[data.collection] = state[data.collection] || [];
                        state[data.collection].push(data.record);
                    }
                    break;
                case "update":
                    if (data.collection && data.id && data.changes) {
                        var arr = state[data.collection] || [];
                        for (var idx = 0; idx < arr.length; idx++) {
                            if (arr[idx].id === data.id) {
                                Object.assign(arr[idx], data.changes);
                                break;
                            }
                        }
                    }
                    break;
                case "delete":
                    if (data.collection && data.id) {
                        state[data.collection] = (state[data.collection] || []).filter(function(r) {
                            return r.id !== data.id;
                        });
                    }
                    break;
                case "bulk":
                    if (typeof data.mutator === "function") {
                        data.mutator(state);
                    }
                    break;
                default:
                    // Pass-through for legacy callers
                    if (typeof data === "function") {
                        data(state);
                    }
            }
        }, "dispatch:" + action);

        return true;
    }

    var te = {
        crm: (t.leads || []).length,
        feed: (t.feed_studies || []).length,
        projects: (t.contracts || []).length,
        construction: (t.construction_reports || []).length,
        proposals: (t.proposals || []).length,
        calc: (t.calculators || []).length,
        hub: (t.jarvis_services || []).length,
        team: (t.team_members || []).length,
        portfolio: 0,
        predict: 0,
        actions: (t.action_items || []).filter(function(d) {
            return d.status === "open"
        }).length,
        field: (t.service_trips || []).filter(function(d) {
            return d.status === "in-progress" || d.status === "scheduled"
        }).length + (t.service_tickets || []).filter(function(d) {
            return d.status === "open"
        }).length,
        docs: (t.documents || []).length + (t.transmittals || []).length,
        directory: (t.vendors || []).length + (t.customers || []).length,
        mcp: (oi || []).length,
        integrations: (t.integrations || []).length,
        notifications: (t.notifications || []).filter(function(d) {
            return !d.read
        }).length,
        system: t.jarvis && t.jarvis.skills ? t.jarvis.skills.total : 0
    };

    function ce(d, f) {
        return f ? f.type === "action" ? (d.action_items || []).find(function(v) {
            return v.id === f.id
        }) || null : f.type === "proposal" ? (d.proposals || []).find(function(v) {
            return v.id === f.id
        }) || null : f.type === "ticket" ? (d.service_tickets || []).find(function(v) {
            return v.id === f.id
        }) || null : f.type === "notif" && (d.notifications || []).find(function(v) {
            return v.id === f.id
        }) || null : null
    }

    function E(d) {
        d && d.tab && _setTab(d.tab);
        var f = d.kind === "action" || d.kind === "proposal" || d.kind === "ticket" ? d.kind : null;
        f && z({
            type: f,
            id: d.id
        }), d.kind === "notif" && (
            // Phase 8: Migrated notification mark-read to typed _dispatch()
            _dispatch({ type: "notif/mark_read", data: { id: d.id } }),
            _setTab("notifications"))
    }

    function D(d) {
        // Phase 7: Migrated from inline Z() mutation to typed _dispatch()
        var v = "AI-" + String(Math.floor(Math.random() * 900) + 100) + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
        var j = {
            id: v,
            project: d.project || "",
            subject: d.subject || "",
            assigned: d.assigned || "",
            priority: d.priority || "med",
            due: d.due || it(7),
            status: "open",
            category: d.category || "general"
        };
        _dispatch(_bizActions.addAction(j));
        tt.publish("actions", "created", j, "ui");
        q(!1); _setTab("actions"); z(null);
    }

    function Y(d, f, v) {
        // Phase 7: Migrated from inline Z() to typed _dispatch() for action_items
        if (!f) return;
        if (d === "action") {
            _dispatch(_bizActions.updateStatus(f.id, "action_items", v));
            tt.publish(d, "transition", { id: f.id, from: f.status, to: v }, "ui");
        } else {
            // Phase 8: Migrated proposal/ticket transitions to typed _dispatch()
            if (d === "proposal") {
                _dispatch({ type: "proposals/update_status", data: { id: f.id, status: v } });
            } else if (d === "ticket") {
                _dispatch({ type: "tickets/update_status", data: { id: f.id, status: v } });
            }
            tt.publish(d, "transition", { id: f.id, from: f.status, to: v }, "ui");
        }
    }

    function be(d, f) {
        f && (q(!0), z({
            type: d,
            id: f.id,
            draftAction: {
                subject: (d === "proposal" ? "Review/Send proposal: " : "Follow up: ") + (f.subject || f.name || f.title || f.id),
                project: f.project || f.site || f.customer || "",
                assigned: f.assigned || "",
                priority: "med",
                due: it(5),
                status: "open",
                category: d
            }
        }))
    }
    var ve = ce(t, P),
        l = P && (P.type === "action" || P.type === "proposal" || P.type === "ticket") ? P.type : null,
        W = (t.activity_log || []).filter(function(d) {
            if (!P) return !1;
            var f = P.id;
            return d && d.meta && d.meta.id === f
        });

    function _updateOwnerCfg(key, val) {
        _oCfgSet(function(prev) {
            var next = Object.assign({}, prev);
            next[key] = val;
            try { localStorage.setItem("jarvis:owner_cfg", JSON.stringify(next)) } catch(ex) {}
            return next;
        });
        // R-18: Audit config changes
        _auditLogSet(function(prev) {
            var entry = {
                ts: new Date().toISOString(),
                actor: "owner",
                action: "config_change",
                changes: [key + " = " + JSON.stringify(val).slice(0, 50)],
                id: "AUD-" + Date.now()
            };
            var next = [entry].concat(prev.slice(0, 499));
            try { io.set("auditLog", next) } catch(ex) {}
            return next;
        });
    }

    function _doLogin() {
        if (_GATEWAY_MODE === "proxied") {
            // INT-05: Server-side authentication — get JWT
            var pinHash = _hashPin(_pin);
            fetch(_backendUrl("/api/v1/auth/login"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method: "pin", credentials: { pin_hash: pinHash } })
            }).then(function(r) {
                if (r.ok) return r.json();
                throw new Error("status " + r.status);
            }).then(function(d) {
                _setAuthToken(d.token, d.expires_at);
                _authSet(true);
                _aErrSet("");
                if (typeof _announce === "function") _announce("Login successful — " + d.user.role + " role");
                console.info("[JARVIS:Auth] Server login OK — role: " + d.user.role);
            }).catch(function(err) {
                console.warn("[JARVIS:Auth] Server login failed:", err.message);
                _aErrSet("Invalid PIN. Try again.");
            });
        } else {
            // DIRECT: Client-side PIN check
            if (_hashPin(_pin) === _oCfg.pinHash) {
                _authSet(true);
                _aErrSet("");
                if (typeof _announce === "function") _announce("Login successful");
                /* SEC-P0-B: sessionStorage.setItem("jarvis_auth") removed — auth state lives in React only */
            } else {
                _aErrSet("Invalid PIN. Try again.");
                if (typeof _announce === "function") _announce("Invalid PIN. Try again.");
            }
        }
    }

    // R-09: Full data export/backup
    function _exportAll() {
        // R-17: Owner kill switch — block exports when disabled
        // R-20: Policy-gated export check
        if (_GATEWAY_MODE === "proxied") {
            // INT-10: Server-side export includes audit trail
            var jwt = _getAuthToken();
            if (jwt) {
                Promise.all([
                    fetch(_backendUrl("/api/v1/state"), { headers: { "Authorization": "Bearer " + jwt } }).then(function(r) { return r.json() }),
                    fetch(_backendUrl("/api/v1/audit/export?format=json"), { headers: { "Authorization": "Bearer " + jwt } }).then(function(r) { return r.json() })
                ]).then(function(results) {
                    var backup = { version: "jarvis-v4-server-backup", exported: new Date().toISOString(), state: results[0].state, stateVersion: results[0].version, audit: results[1].entries };
                    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
                    var a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "jarvis-server-backup-" + new Date().toISOString().slice(0, 10) + ".json";
                    a.click();
                }).catch(function(err) { alert("Server export failed: " + err.message) });
                return;
            }
        }
        if (!_checkPolicy("data:export", _oCfg, _writeRole).allowed) {
            alert("Exports are currently disabled by policy. Enable in Owner Controls or switch to Owner role.");
            console.warn("[JARVIS] Export blocked by policy");
            return;
        }
        try {
            var payload = {
                _jarvis_version: "4.0",
                _exported_at: new Date().toISOString(),
                _record_counts: {
                    leads: (t.leads || []).length,
                    contracts: (t.contracts || []).length,
                    invoices: (t.invoices || []).length,
                    actions: (t.action_items || []).length,
                    events: (t.activity_log || []).length
                },
                bizState: t,
                ownerCfg: _oCfg,
                navOrder: _,
                navHidden: K
            };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "JARVIS_backup_" + new Date().toISOString().slice(0, 10) + ".json";
            a.click();
            URL.revokeObjectURL(a.href);
            console.info("[JARVIS] Full backup exported");
        } catch(ex) {
            console.error("[JARVIS] Export failed:", ex);
            alert("Export failed: " + ex.message);
        }
    }

    // R-10: Data import/restore
    function _importAll(file) {
        if (!file) return;
        // R-20: Policy-gated import check
        if (!_checkPolicy("data:import", _oCfg, _writeRole).allowed) {
            alert("Imports are disabled by policy. Switch to Owner role.");
            return;
        }
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var data = JSON.parse(ev.target.result);
                if (!data._jarvis_version || !data.bizState) {
                    alert("Invalid JARVIS backup file.");
                    return;
                }
                if (!confirm("This will replace ALL current data with the backup from " + (data._exported_at || "unknown date") + ". Continue?")) return;
                // S15-14: Validate imported data structure
                if (typeof data !== "object" || Array.isArray(data)) { _announce("Invalid backup format"); return; }
                var _dangerKeys = ["__proto__", "constructor", "prototype"];
                for (var _dk in data) { if (_dangerKeys.indexOf(_dk) >= 0) { _announce("Rejected: unsafe key in import"); _logError("security", "Prototype pollution attempt in import: " + _dk); return; } }
                data = _sanitize(data);
                var restored = data.bizState;
                bi(restored);
                s(restored);
                io.set("bizState", restored);
                if (data.navOrder) { C(data.navOrder); io.set("navOrder", data.navOrder); }
                if (data.navHidden) { le(data.navHidden); io.set("navHidden", data.navHidden); }
                if (data.ownerCfg) { _oCfgSet(data.ownerCfg); localStorage.setItem("jarvis:owner_cfg", JSON.stringify(data.ownerCfg)); }
                console.info("[JARVIS] Data restored from backup:", data._exported_at);
                alert("Data restored successfully from " + (data._exported_at || "backup") + ".");
            } catch(ex) {
                console.error("[JARVIS] Import failed:", ex);
                alert("Import failed: " + ex.message);
            }
        };
        reader.readAsText(file);
    }

    // R-07: Error reporting - create notification on errors
    // Phase 8: Migrated to typed _dispatch() now that notif/add is in the domain reducer
    function _logError(source, msg) {
        console.error("[JARVIS:" + source + "] " + msg);
        _dispatch({
            type: "notif/add",
            data: {
                id: "ERR-" + Date.now(),
                title: "Error: " + source,
                body: msg,
                kind: "error",
                read: false,
                ts: Date.now()
            }
        });
    }


    if (_oCfg.authEnabled && !_authOk) {
        // Phase 19: Replaced ~60 lines of inline login JSX with LoginScreen component
        return React.createElement(LoginScreen, {
            onSuccess:   function() { _authSet(true); },
            gatewayMode: _GATEWAY_MODE,
            backendUrl:  _backendUrl(""),
        });
    }

    return React.createElement(JarvisContext.Provider, {
        value: {
            biz: t, dispatch: _dispatch, mutate: Z, setTab: _setTab,
            ownerCfg: _oCfg, activeRole: _writeRole,
            auditLog: _auditLog, apiStats: _apiStats, errorLog: _errorLog, sessionMetrics: _sessionMetrics, ACTIONS: JARVIS_ACTIONS
        }
    }, React.createElement(_JarvisErrorBoundary, null, React.createElement("div", {
        role: "application",
        "aria-label": "Denver Engineering v4 Engineering Management System",
        style: {
            background: "var(--jarvis-bg)",
            color: "var(--jarvis-tx)",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
            overflow: "hidden"
        }
    }, React.createElement("a", {
        href: "#jarvis-main-content",
        className: "skip-link",
        onKeyDown: function(ev) { if (ev.key === "Enter") { var el = document.getElementById("jarvis-main-content"); if (el) { el.focus(); el.scrollIntoView(); } } }
    }, "Skip to main content"), React.createElement(_CmdPalette, {
        open: _cmdOpen,
        biz: t,
        query: _cmdQ,
        onQueryChange: _cmdQSet,
        onClose: function() { _cmdSetOpen(false); _cmdQSet("") }
    }), React.createElement(_ToastContainer, null), React.createElement(HeartbeatBar, { backendUrl: _backendUrl("") }), _oPanelOpen && React.createElement(OwnerPanel, { backendUrl: _backendUrl("") })
    , React.createElement("div", {
        style: {
            flex: 1,
            display: "flex",
            overflow: "hidden"
        }
    }, React.createElement(NavSidebar, {
        badges:     te,
        policy:     _oCfg,
        onNavigate: _setTab,
    }), React.createElement(ContentRouter, {
        policy:     _oCfg,
        biz:        t,
        onNavigate: _setTab,
        onAudit:    function(e) { _auditLogSet([e]); },
        onToast:    _toast,
    }), c && _oCfg.chatEnabled && React.createElement("aside", {
        role: "complementary",
        "aria-label": "AI Chat Assistant",
        style: {
            width: 280,
            borderLeft: "var(--jarvis-border-width, 1px) solid var(--jarvis-bd)",
            background: "var(--jarvis-sf)",
            display: "flex",
            flexDirection: "column",
            flex: "none"
        }
    }, React.createElement(Tn, {
        biz: t,
        onUpdate: function(newState) {
            // Phase 7: AI state mutations routed through domain reducer via raw/mutate
            // This preserves the audited Z() path while routing through bizReducer
            _dispatch({ type: "raw/mutate", mutator: function(state) { Object.assign(state, newState); } });
        },
        onApiCall: function(info) {
            _apiStatsSet(function(prev) {
                return { count: prev.count + 1, tokens: prev.tokens + (info.tokens || 0), lastCall: Date.now() };
            });
            // R-18: Audit AI calls
            _auditLogSet(function(prev) {
                var entry = {
                    ts: new Date().toISOString(),
                    actor: "ai",
                    action: info.action || "ai_chat",
                    changes: ["tokens: ~" + (info.tokens || 0) + ", payload: " + (info.payloadChars || 0) + " chars"],
                    id: "AUD-" + Date.now()
                };
                var next = [entry].concat(prev.slice(0, 499));
                try { io.set("auditLog", next) } catch(ex) {}
                return next;
            });
        }
    }))), React.createElement(Zi, {
        open: I,
        title: "Create Action Item",
        onClose: function() {
            q(!1)
        }
    }, React.createElement(Ki, {
        open: I,
        draft: P && P.draftAction ? P.draftAction : null,
        onCancel: function() {
            q(!1)
        },
        onSave: D
    })), React.createElement(Zi, {
        open: O,
        title: "Activity Timeline",
        onClose: function() {
            F(!1)
        },
        width: 720
    }, React.createElement(ji, {
        items: t.activity_log || []
    })), React.createElement(Zi, {
        open: !!l,
        type: l,
        entity: ve,
        timeline: W,
        onClose: function() {
            z(null)
        },
        onTransition: Y,
        onCreateActionFrom: be
    }))))
}