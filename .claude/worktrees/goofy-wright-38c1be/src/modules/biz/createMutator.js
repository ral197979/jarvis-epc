/**
 * JARVIS EPC — Audited Biz Mutator Factory
 * ───────────────────────────────────────────
 * Sprint 6-9 (v4.31.0): Extracted from JarvisCore.jsx (Z = useCallback(…)).
 *
 * Creates the audited `Z(mutatorFn, auditLabel)` function used throughout
 * JarvisCore to apply policy-gated, audited, persisted biz state mutations.
 *
 * Accepts all dependencies as parameters so this factory is fully testable
 * outside React and free of module-scope side effects.
 *
 * @param {function} checkPolicy   - _checkPolicy(perm, cfg, role)
 * @param {function} getOwnerCfg   - () => current _oCfg
 * @param {function} setState      - React setState setter for biz state (s)
 * @param {function} syncBiz       - bi() — syncs biz state to Zustand store
 * @param {function} announce      - _announce(msg) for a11y
 * @param {function} auditLogSet   - _auditLogSet(fn|entry[])
 * @param {object}   io            - { set(key, val) } persistence shim
 */
export function createMutator(checkPolicy, getOwnerCfg, setState, syncBiz, announce, auditLogSet, io) {
    var _TRACKED_COLS = ["leads","contracts","invoices","purchase_orders","submittals","rfis","documents","action_items","jhas","incidents","expenses","rfqs","punch_items","engineering_deliverables"];

    return function Z(d, _auditAction) {
        var oCfg = getOwnerCfg();
        // R-17 / R-20: Policy-gated write check
        if (!checkPolicy("data:write", oCfg, oCfg.activeRole || "owner").allowed) {
            console.warn("[JARVIS] Write blocked by policy (role=" + (oCfg.activeRole || "owner") + ")");
            if (typeof announce === "function") announce("Action blocked: insufficient permissions for " + (oCfg.activeRole || "owner") + " role");
            auditLogSet(function(prev) {
                var next = [{ ts: new Date().toISOString(), actor: "system", action: "WRITE_BLOCKED", changes: [_auditAction || "unknown"], id: "AUD-" + Date.now() }].concat(prev.slice(0, 499));
                try { io.set("auditLog", next); } catch(ex) {}
                return next;
            });
            return;
        }

        setState(function(f) {
            var v;
            try {
                v = typeof structuredClone === "function" ? structuredClone(f) : JSON.parse(JSON.stringify(f));
            } catch(_) {
                v = JSON.parse(JSON.stringify(f || {}));
            }
            // R-16: Capture collection counts before mutation
            var _before = {};
            _TRACKED_COLS.forEach(function(col) { _before[col] = (v[col] || []).length; });
            syncBiz(v);
            d && d(v);
            // R-16: Detect changes
            var _changes = [];
            Object.keys(_before).forEach(function(col) {
                var after = (v[col] || []).length;
                if (after !== _before[col]) _changes.push(col + ": " + _before[col] + " \u2192 " + after);
            });
            if (_changes.length > 0 || _auditAction) {
                if (typeof announce === "function") {
                    var _msg = _auditAction ? _auditAction.replace(/_/g, " ") : "Data updated";
                    if (_changes.length > 0) _msg += ": " + _changes.slice(0, 3).join(", ");
                    announce(_msg);
                }
                auditLogSet(function(prev) {
                    var entry = { ts: new Date().toISOString(), actor: "user", action: _auditAction || "state_mutation", changes: _changes, id: "AUD-" + Date.now() };
                    var next = [entry].concat(prev.slice(0, 499));
                    try { io.set("auditLog", next); } catch(ex) {}
                    return next;
                });
            }
            try { io.set("bizState", v); } catch(ex) { console.error("[JARVIS] Persist failed:", ex); }
            return v;
        });
    };
}
