/**
 * JARVIS EPC — Core Dispatch Factory
 * ─────────────────────────────────────
 * Sprint 6-9 (v4.31.0): Extracted from JarvisCore.jsx (_dispatch function).
 *
 * Creates the centralized _dispatch function that serves as the single
 * chokepoint for all biz state mutations (R-22). Accepts the runtime
 * dependencies (policy checker, mutator Z, domain reducer, error logger)
 * so this can be instantiated per JarvisCore mount without coupling to module scope.
 */

/**
 * createCoreDispatch — factory that returns the _dispatch(action, data, meta) function.
 *
 * @param {function} checkPolicy  - _checkPolicy from modules/auth
 * @param {function} getOwnerCfg  - () => current _oCfg snapshot
 * @param {function} Z            - the audited mutator (useCallback from JarvisCore)
 * @param {function} domainReducer - _domainReducer(state, action)
 * @param {function} logError     - _logError(source, msg)
 */
export function createCoreDispatch(checkPolicy, getOwnerCfg, Z, domainReducer, logError) {
    return function _dispatch(action, data, meta) {
        var oCfg = getOwnerCfg();
        var actionLabel = (typeof action === "string" ? action : action.type || "unknown") + (meta ? " (" + JSON.stringify(meta).slice(0, 60) + ")" : "");

        // 1. Policy check
        var writePolicy = checkPolicy("data:write", oCfg, oCfg.activeRole || "owner");
        if (!writePolicy.allowed) {
            logError("dispatch", "Blocked: " + actionLabel + " — " + writePolicy.reason);
            return false;
        }

        // SM-06: If action is a domain action object {type, payload}, use domainReducer
        if (typeof action === "object" && action.type) {
            Z(function(state) {
                var result = domainReducer(state, action);
                Object.assign(state, result);
            }, action.type);
            return true;
        }

        // SM-06: If action is a JARVIS_ACTIONS string (e.g. "crm/add_lead"), wrap it
        if (typeof action === "string" && action.indexOf("/") >= 0) {
            Z(function(state) {
                var result = domainReducer(state, { type: action, payload: data });
                Object.assign(state, result);
            }, action);
            return true;
        }

        // Legacy: plain string actions ("add", "update", "delete", "bulk")
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
                            if (arr[idx].id === data.id) { Object.assign(arr[idx], data.changes); break; }
                        }
                    }
                    break;
                case "delete":
                    if (data.collection && data.id) {
                        state[data.collection] = (state[data.collection] || []).filter(function(r) { return r.id !== data.id; });
                    }
                    break;
                case "bulk":
                    if (typeof data.mutator === "function") { data.mutator(state); }
                    break;
                default:
                    if (typeof data === "function") { data(state); }
            }
        }, "dispatch:" + action);

        return true;
    };
}
