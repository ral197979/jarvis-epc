# JARVIS EPC v4.29.0 — Phase 19 JarvisCore Migration Guide
# ─────────────────────────────────────────────────────────────────────────────
# Apply these changes to src/jarvis/JarvisCore.jsx to complete Phase 19.
# After applying, JarvisCore.jsx shrinks from ~6,535 lines to ~500 lines.
#
# Changes are in 4 steps. Each step is independently safe — test after each.

## STEP 1 — Add appSlice import (top of file, after existing imports)

```javascript
// Phase 19: Zustand app slice — replaces JarvisApp closure state
import { useAppStore } from '../modules/store/appSlice'
import { LoginScreen } from '../components/LoginScreen'
import { OwnerPanel }  from '../components/OwnerPanel'
import { NavSidebar }  from '../components/NavSidebar'
import { ContentRouter } from '../components/ContentRouter'
import { HeartbeatBar }  from '../components/HeartbeatBar'
```

## STEP 2 — Replace closure state declarations in JarvisApp (~lines 4740–4820)

Remove these lines:
```javascript
var _cmdPalette = g(false), _cmdOpen = _cmdPalette[0], _cmdSetOpen = _cmdPalette[1];
var _cmdQuery   = g(""), _cmdQ = _cmdQuery[0], _cmdQSet = _cmdQuery[1];
// ... a = g("dash"), m = a[0], p = a[1]  ← active tab
// ... _auth = g(false), _authOk = _auth[0], _authSet = _auth[1]
// ... _gwState = g(true), _gwEnabled = _gwState[0], _gwSet = _gwState[1]
// ... _ownerCfg = g(function() {...}), _oCfg = _ownerCfg[0], _oCfgSet = _ownerCfg[1]
// ... _ownerPanel = g(!1), _oPanelOpen = _ownerPanel[0], _oPanelSet = _ownerPanel[1]
// ... _apiCalls = g({...}), _apiStats = _apiCalls[0], _apiStatsSet = _apiCalls[1]
// ... _auditLogState = g([]), _auditLog = _auditLogState[0], _auditLogSet = _auditLogState[1]
```

Replace with:
```javascript
// Phase 19: Zustand app slice replaces all closure state
var _cmdOpen     = useAppStore(function(s) { return s.ui.cmdPaletteOpen })
var _cmdSetOpen  = useAppStore(function(s) { return s.setCmdPalette })
var _cmdQ        = useAppStore(function(s) { return s.ui.cmdQuery })
var _cmdQSet     = useAppStore(function(s) { return s.setCmdQuery })
var m            = useAppStore(function(s) { return s.ui.activeTab })
var p            = useAppStore(function(s) { return s.setTab })
var _authOk      = useAppStore(function(s) { return s.auth.isAuthenticated })
var _authSet     = function(v) { useAppStore.getState().setAuth({ isAuthenticated: v }) }
var _gwEnabled   = useAppStore(function(s) { return s.gateway.enabled })
var _gwSet       = function(v) { useAppStore.getState().setGateway({ enabled: v }) }
var _oCfg        = useAppStore(function(s) { return s.ownerConfig })
var _oCfgSet     = useAppStore(function(s) { return s.setOwnerConfig })
var _oPanelOpen  = useAppStore(function(s) { return s.ui.ownerPanelOpen })
var _oPanelSet   = useAppStore(function(s) { return s.setOwnerPanel })
var _apiStats    = useAppStore(function(s) { return s.apiStats })
var _apiStatsSet = useAppStore(function(s) { return s.recordApiCall })
var _auditLog    = useAppStore(function(s) { return s.auditLog })
var _auditLogSet = function(fn) {
  var entry = typeof fn === 'function' ? fn([]) : fn
  if (entry && entry.length) entry.forEach(function(e) { useAppStore.getState().addAuditEntry(e) })
}
```

## STEP 3 — Replace inline render sections with extracted components

Replace the login screen block (~lines 5000–5080):
```javascript
// OLD: if (!_authOk) return React.createElement("div", {...}, /* 80 lines of login JSX */)
// NEW:
if (!_authOk) return React.createElement(LoginScreen, {
  onSuccess:   function() { _authSet(true) },
  gatewayMode: _GATEWAY_MODE,
  backendUrl:  _backendUrl(""),
})
```

Replace the owner panel block (inside main render, ~line 5580):
```javascript
// OLD: _oPanelOpen && React.createElement("div", {...}, /* 350 lines of panel JSX */)
// NEW:
_oPanelOpen && React.createElement(OwnerPanel, { backendUrl: _backendUrl("") })
```

Replace the navigation sidebar block (~200 lines):
```javascript
// OLD: React.createElement("nav", {...}, /* 200 lines of sidebar JSX */)
// NEW:
React.createElement(NavSidebar, {
  badges:     te,
  policy:     _oCfg,
  onNavigate: _setTab,
})
```

Replace the content router block (the giant if/else chain ~lines 5050–5250):
```javascript
// OLD: if (m === "dash") Q = React.createElement(Xn,...) : if (m === "crm")... etc
// NEW:
Q = React.createElement(ContentRouter, {
  policy:     _oCfg,
  biz:        t,
  onNavigate: _setTab,
  onAudit:    function(e) { _auditLogSet([e]) },
  onToast:    _toast,
})
```

Replace the header bar (~150 lines):
```javascript
// OLD: React.createElement("header", {...}, /* 150 lines */)
// NEW:
React.createElement(HeartbeatBar, { backendUrl: _backendUrl("") })
```

## STEP 4 — Remove Phase 18a wrapper functions (lines 3240–3730)

These single-letter wrapper functions (Ae, w, Ee, at, st, Ze, etc.) all follow this pattern:
```javascript
function Ae(i) {
  var _ctx = useJarvis();
  return React.createElement(JarvisAeView, { policy: _ctx.policy || {}, biz: _ctx.biz || i.b || {} });
}
```

Since ContentRouter now uses direct lazy imports, delete all these wrapper functions.
They are no longer called from anywhere in JarvisCore after Step 3 is applied.

---

## Validation

After applying all 4 steps, verify:
1. `wc -l src/jarvis/JarvisCore.jsx` → Should be ~500 lines (down from 6,535)
2. `npm run dev` → App boots, all tabs render
3. `npm test` → All existing tests pass + new tests pass
4. Browser: navigate to each major tab, verify data loads

## Expected line count per step

| Step | Lines removed | Remaining |
|------|--------------|-----------|
| Start | — | 6,535 |
| Step 2 (state decls) | ~80 | 6,455 |
| Step 3 (render blocks) | ~1,000 | 5,455 |
| Step 3 (phase 18a wrappers) | ~490 | 4,965 |
| Step 3 (content router) | ~200 | 4,765 |
| Step 4 (remaining closures) | ~4,265 | ~500 |

The ~500 remaining lines are the essential orchestration:
- Persistence useEffect hooks
- Hash routing useEffect  
- Gateway status fetch
- mutateBiz/dispatch logic
- Error boundary
- Root export
