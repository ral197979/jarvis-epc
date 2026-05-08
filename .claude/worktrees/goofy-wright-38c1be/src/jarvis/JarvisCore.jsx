/**
 * Jarvis EPC (Enterprise Process Control) v4.0
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
    _clearAuthToken, _checkSessionTimeout, _announce, _PERSONAS, _INPUT_LIMITS,
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
// Sprint 9 (v4.31.0): _exportAll / _importAll extracted to modules/biz/dataIO.ts
import { exportAll as _exportAllFn, importAll as _importAllFn } from "../modules/biz/dataIO";
// Sprint 6-9 (v4.31.0): _dispatch factory extracted to modules/biz/coreDispatch.js
import { createCoreDispatch } from "../modules/biz/coreDispatch";
// Sprint 6-9 (v4.31.0): Z mutator factory extracted to modules/biz/createMutator.js
import { createMutator } from "../modules/biz/createMutator";
// G5 Sprint 5 (v4.31.0): use extracted JARVIS_ACTIONS from biz/reducer (superset of former inline map)
import { JARVIS_ACTIONS } from "../modules/biz/reducer";
import { useBizStore } from "../modules/biz/store";
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
import { useState as g, useEffect as ui, useRef as ei, useCallback as ti } from "react";
import { io } from '../modules/persistence/localStore';                       // Sprint 7
import { ErrorBoundary as _JarvisErrorBoundary } from '../components/ErrorBoundary'; // Sprint 8
import { JARVIS_MCP_TOOLS as oi, JARVIS_MCP_RESOURCES as Ai } from "../constants/mcpTools";
import { DEFAULT_BIZ_STATE as _defaultBizState } from "../config/defaultState";
import { JARVIS_SYSTEM_PROMPT as en } from "../config/systemPrompt";
import { sanitizeForAI as _sanitizeForAI } from '../modules/utils/aiSanitizer'; // Sprint 8
import { NAVIGATION_ITEMS as Ci } from "../config/navigation";
import { JarvisContext, useJarvis } from '../contexts/JarvisContext';           // Sprint 6
import { VIEW_REGISTRY as _VIEW_REGISTRY } from "../config/viewRegistry";

var Ji = 0, yi = false, Di = [];  // session counters
var _chatRateLimit = { lastCall: 0, callCount: 0, windowStart: 0, MAX_PER_MINUTE: 6, COOLDOWN_MS: 5000 };
var mutateBiz = function() { console.warn("[JARVIS] mutateBiz called before init"); };
var setTab    = function() { console.warn("[JARVIS] setTab called before init"); };

// Thin wrappers — delegate to extracted view components
function ji(i)  { var c = useJarvis(); return React.createElement(JarvisJiView,       { policy: c.policy||{}, biz: c.biz||i.b||{} }); }
function Ki(i)  { var c = useJarvis(); return React.createElement(JarvisKiView,       { policy: c.policy||{}, biz: c.biz||i.b||{} }); }
function Zi(i)  { var c = useJarvis(); return React.createElement(JarvisModalShellView, Object.assign({}, i, { policy: c.policy||{}, biz: c.biz||i.b||{} })); }
function $i()   { return _defaultBizState; }
function _buildAIContext(t) { return JarvisBuildAIContext(t); }
function _domainReducer(state, action) { return JarvisDomainReducer(state, action); }
function _bindGlobals(mutator, tabSetter, bizRef, oCfgRef) {
    mutateBiz = mutator; setTab = tabSetter;
    if (!window.__JARVIS_DIAG) window.__JARVIS_DIAG = {};
    if (bizRef   !== undefined) window.__JARVIS_DIAG._biz  = bizRef;
    if (oCfgRef  !== undefined) window.__JARVIS_DIAG._oCfg = oCfgRef;
    console.info("[JARVIS:SM] Global bridge bound — mutateBiz and setTab are live");
}
function _selectCollection(biz, key) { return (biz && biz[key]) || []; }
function _selectCollectionCount(biz, key) { return ((biz && biz[key]) || []).length; }

// F16-12: Toast notification system
var _toastQueue = [], _toastListeners = [];
function _toast(msg, type) {
    type = type || "info";
    var t = { id: Date.now(), msg: msg, type: type, ts: Date.now() };
    _toastQueue.push(t);
    if (_toastQueue.length > 5) _toastQueue.shift();
    _toastListeners.forEach(function(fn) { fn(_toastQueue.slice()); });
    if (typeof _announce === "function") _announce(msg);
    setTimeout(function() { _toastQueue = _toastQueue.filter(function(x) { return x.id !== t.id; }); _toastListeners.forEach(function(fn) { fn(_toastQueue.slice()); }); }, 4000);
}
function _ToastContainer() { var c = useJarvis(); return React.createElement(JarvisToastContainer, { biz: c.biz||{} }); }
function _CmdPalette(props) { var c = useJarvis(); return React.createElement(JarvisCmdPalette, Object.assign({ policy: c.policy||{}, biz: c.biz||{} }, props)); }

export default function JarvisCore() {
    _sessionMetrics.renderCount++;
    if (_sessionMetrics.renderCount % 100 === 0) console.info("[JARVIS:Perf] Render #" + _sessionMetrics.renderCount);
    _sessionMetrics.lastRender = new Date().toISOString();
    // Zustand app slice (Phase 19)
    var _cmdOpen  = useAppStore(function(s){return s.ui.cmdPaletteOpen;}), _cmdSetOpen = useAppStore(function(s){return s.setCmdPalette;});
    var _cmdQ     = useAppStore(function(s){return s.ui.cmdQuery;}),       _cmdQSet    = useAppStore(function(s){return s.setCmdQuery;});
    var m         = useAppStore(function(s){return s.ui.activeTab;}),      p           = useAppStore(function(s){return s.setTab;});
    var _authOk   = useAppStore(function(s){return s.auth.isAuthenticated;}), _authSet = function(v){useAppStore.getState().setAuth({isAuthenticated:v});};
    var _gwEnabled= useAppStore(function(s){return s.gateway.enabled;}),   _gwSet      = function(v){useAppStore.getState().setGateway({enabled:v});};
    var _oCfg     = useAppStore(function(s){return s.ownerConfig;}),       _oCfgSet    = useAppStore(function(s){return s.setOwnerConfig;});
    var _oPanelOpen=useAppStore(function(s){return s.ui.ownerPanelOpen;}), _oPanelSet  = useAppStore(function(s){return s.setOwnerPanel;});
    var _apiStats = useAppStore(function(s){return s.apiStats;}),          _apiStatsSet= useAppStore(function(s){return s.recordApiCall;});
    var _auditLog = useAppStore(function(s){return s.auditLog;});
    var _auditLogSet = function(fn){var entry=typeof fn==="function"?fn([]):fn;if(entry&&entry.length)entry.forEach(function(e){useAppStore.getState().addAuditEntry(e);});};
    // Local state
    var i=g(function(){return $i();}), t=i[0], s=i[1];
    var u=g(!1), c=u[0], R=u[1];
    var b=g(null), P=b[0], z=b[1];
    var y=g(!1), I=y[0], q=y[1];
    var V=g(!1), O=V[0], F=V[1];
    var x=g(Ci.map(function(d){return d.id;})), _=x[0], C=x[1];
    var U=ei(null), re=g(!1), ie=re[0], ye=re[1];
    var S=g({}), K=S[0], le=S[1];
    var _persistLoaded=g(!1), _plVal=_persistLoaded[0], _plSet=_persistLoaded[1];
    var _gwLoading=g(false), _gwLoadingVal=_gwLoading[0], _gwLoadingSet=_gwLoading[1];
    var _authPin=g(""), _pin=_authPin[0], _pinSet=_authPin[1];
    var _authErr=g(""), _aErr=_authErr[0], _aErrSet=_authErr[1];

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
    var _activePersona = _PERSONAS[_oCfg.activeRole] || _PERSONAS.owner,
        Se = _.map(function(d) {
            return Ci.find(function(f) {
                return f.id === d
            })
        }).filter(function(d) {
            if (!d || K[d.id]) return false;
            // R-21: Persona tab filter — null means all tabs allowed (owner)
            if (!_activePersona.tabs) return true;
            return _activePersona.tabs.indexOf(d.id) >= 0;
        }),
        X = _.map(function(d) {
            return Ci.find(function(f) {
                return f.id === d
            })
        }).filter(Boolean),
        ne = ti(function(d) {
            s(d);
            try { io.set("bizState", d) } catch(ex) { console.error("[JARVIS] Persist failed:", ex) }
        }, []),
        // Sprint 6-9 (v4.31.0): Z mutator body extracted to modules/biz/createMutator.js
        Z = ti(createMutator(_checkPolicy, function() { return _oCfg; }, s, bi, _announce, _auditLogSet, io), []),
        Q = null;

    // SM-05: Bind global bridge — mutateBiz and setTab become live
    _bindGlobals(Z, _setTab, t, _oCfg);
    window.__JARVIS_CMD = function() { _cmdSetOpen(function(v) { return !v }); _cmdQSet(""); };

    // R-22: Centralized dispatch — Sprint 6-9: factory extracted to modules/biz/coreDispatch.js
    var _dispatch = createCoreDispatch(_checkPolicy, function() { return _oCfg; }, Z, _domainReducer, _logError);

    var _n = function(col) { return (t[col]||[]).length; };
    var te = {
        crm: _n("leads"), feed: _n("feed_studies"), projects: _n("contracts"),
        construction: _n("construction_reports"), proposals: _n("proposals"),
        calc: _n("calculators"), hub: _n("jarvis_services"), team: _n("team_members"),
        portfolio: 0, predict: 0,
        actions: (t.action_items||[]).filter(function(d){return d.status==="open";}).length,
        field: (t.service_trips||[]).filter(function(d){return d.status==="in-progress"||d.status==="scheduled";}).length
              +(t.service_tickets||[]).filter(function(d){return d.status==="open";}).length,
        docs: _n("documents")+_n("transmittals"), directory: _n("vendors")+_n("customers"),
        mcp: (oi||[]).length, integrations: _n("integrations"),
        notifications: (t.notifications||[]).filter(function(d){return !d.read;}).length,
        system: t.jarvis && t.jarvis.skills ? t.jarvis.skills.total : 0
    };
    function ce(d,f) {
        if (!f) return null;
        var col = f.type==="action"?"action_items":f.type==="proposal"?"proposals":f.type==="ticket"?"service_tickets":f.type==="notif"?"notifications":null;
        return col ? (d[col]||[]).find(function(v){return v.id===f.id;})||null : null;
    }
    function E(d) {
        d && d.tab && _setTab(d.tab);
        var f = ["action","proposal","ticket"].indexOf(d.kind)>=0 ? d.kind : null;
        if (f) z({type:f,id:d.id});
        if (d.kind==="notif") { _dispatch({type:"notif/mark_read",data:{id:d.id}}); _setTab("notifications"); }
    }
    function D(d) {
        var v = "AI-"+String(Math.floor(Math.random()*900)+100)+"-"+Math.random().toString(16).slice(2,6).toUpperCase();
        var j = { id:v, project:d.project||"", subject:d.subject||"", assigned:d.assigned||"", priority:d.priority||"med", due:d.due||it(7), status:"open", category:d.category||"general" };
        _dispatch(_bizActions.addAction(j)); tt.publish("actions","created",j,"ui"); q(!1); _setTab("actions"); z(null);
    }
    function Y(d,f,v) {
        if (!f) return;
        if (d==="action") { _dispatch(_bizActions.updateStatus(f.id,"action_items",v)); }
        else if (d==="proposal") { _dispatch({type:"proposals/update_status",data:{id:f.id,status:v}}); }
        else if (d==="ticket")   { _dispatch({type:"tickets/update_status",data:{id:f.id,status:v}}); }
        tt.publish(d,"transition",{id:f.id,from:f.status,to:v},"ui");
    }
    function be(d,f) {
        f && (q(!0), z({type:d,id:f.id,draftAction:{subject:(d==="proposal"?"Review/Send proposal: ":"Follow up: ")+(f.subject||f.name||f.title||f.id),project:f.project||f.site||f.customer||"",assigned:f.assigned||"",priority:"med",due:it(5),status:"open",category:d}}));
    }
    var ve=ce(t,P), l=P&&["action","proposal","ticket"].indexOf(P.type)>=0?P.type:null, W=(t.activity_log||[]).filter(function(d){return P&&d&&d.meta&&d.meta.id===P.id;});
    function _updateOwnerCfg(key,val) {
        _oCfgSet(function(prev) { var next=Object.assign({},prev); next[key]=val; try{localStorage.setItem("jarvis:owner_cfg",JSON.stringify(next));}catch(ex){} return next; });
        _auditLogSet(function(prev) { var entry={ts:new Date().toISOString(),actor:"owner",action:"config_change",changes:[key+" = "+JSON.stringify(val).slice(0,50)],id:"AUD-"+Date.now()}; var next=[entry].concat(prev.slice(0,499)); try{io.set("auditLog",next);}catch(ex){} return next; });
    }
    function _doLogin() {
        if (_GATEWAY_MODE==="proxied") {
            var ph=_hashPin(_pin);
            fetch(_backendUrl("/api/v1/auth/login"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({method:"pin",credentials:{pin_hash:ph}})})
                .then(function(r){if(r.ok)return r.json();throw new Error("status "+r.status);})
                .then(function(d){_setAuthToken(d.token,d.expires_at);_authSet(true);_aErrSet("");if(typeof _announce==="function")_announce("Login successful — "+d.user.role+" role");console.info("[JARVIS:Auth] Server login OK — role: "+d.user.role);})
                .catch(function(err){console.warn("[JARVIS:Auth] Server login failed:",err.message);_aErrSet("Invalid PIN. Try again.");});
        } else {
            if (_hashPin(_pin)===_oCfg.pinHash){_authSet(true);_aErrSet("");if(typeof _announce==="function")_announce("Login successful");}
            else{_aErrSet("Invalid PIN. Try again.");if(typeof _announce==="function")_announce("Invalid PIN. Try again.");}
        }
    }
    // R-09 / R-10: thin wrappers over extracted dataIO module (Sprint 9)
    function _exportAll() {
        _exportAllFn(t,_oCfg,_,K,_backendUrl,_getAuthToken(),_GATEWAY_MODE==="proxied",{exportAllowed:_checkPolicy("data:export",_oCfg,_oCfg.activeRole||"owner").allowed,importAllowed:false});
    }
    function _importAll(file) {
        if (!file) return;
        _importAllFn(file,{exportAllowed:false,importAllowed:_checkPolicy("data:import",_oCfg,_oCfg.activeRole||"owner").allowed},{onBizState:function(r){bi(r);s(r);},onNavOrder:function(o){C(o);},onNavHidden:function(h){le(h);},onOwnerCfg:function(c){_oCfgSet(c);}},_sanitize,_announce);
    }
    // R-07: Error reporting
    function _logError(source,msg) {
        console.error("[JARVIS:"+source+"] "+msg);
        _dispatch({type:"notif/add",data:{id:"ERR-"+Date.now(),title:"Error: "+source,body:msg,kind:"error",read:false,ts:Date.now()}});
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
            ownerCfg: _oCfg, activeRole: _oCfg.activeRole || "owner",
            auditLog: _auditLog, apiStats: _apiStats, errorLog: _errorLog, sessionMetrics: _sessionMetrics, ACTIONS: JARVIS_ACTIONS
        }
    }, React.createElement(_JarvisErrorBoundary, null, React.createElement("div", {
        role: "application",
        "aria-label": "JARVIS EPC v4 Engineering Management System",
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