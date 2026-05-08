/**
 * denver-bridge.js  —  Denver Engineering ↔ Denver Suite iframe bridge
 *
 * Injected into each Denver HTML file (before </body>).
 * Each file must also set DENVER_TOOL_ID and DENVER_TOOL_VERSION before this script:
 *
 *   <script>window.DENVER_TOOL_ID='wwtp'; window.DENVER_TOOL_VERSION='v5.0'</script>
 *   <script src="denver-bridge.js"></script>
 *
 * ─── Contract ────────────────────────────────────────────────────────────────
 *
 * Jarvis → iframe   { type:'JARVIS_CONTEXT', payload:{projectId,projectName,projectType,site} }
 * iframe → Jarvis   { type:'DENVER_RESULT',  payload:{tool,version,summary,pidSvg?,timestamp} }
 *
 * Denver tool can also call:
 *   window.JARVIS_SEND_RESULT(summary, pidSvg)   — directly
 *   document.dispatchEvent(new CustomEvent('denver:export', {detail:{summary,pidSvg}}))  — event-driven
 */
;(function () {
  'use strict'

  // ── 1. Receive project context from Jarvis parent ─────────────────────────
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'JARVIS_CONTEXT') return
    var ctx = e.data.payload || {}
    window.JARVIS_PROJECT = ctx
    document.dispatchEvent(new CustomEvent('jarvis:context', { detail: ctx }))
    _prefill(ctx)
    console.log('[denver-bridge] context received —', ctx.projectName)
  })

  function _prefill (ctx) {
    var selectors = [
      '[data-jarvis="project-name"]',
      'input[name="projectName"]',
      'input[id="project-name"]',
      'input[placeholder*="project" i]',
    ]
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        var inp = /** @type {HTMLInputElement} */ (el)
        if (!inp.value || inp.value === 'New Project' || inp.value === 'Untitled') {
          inp.value = ctx.projectName || ''
          inp.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })
    })
  }

  // ── 2. Send results back to Jarvis parent ─────────────────────────────────
  /**
   * @param {Record<string,unknown>} summary  Key results (e.g. { flow_mgd: 2.5 })
   * @param {string|null}            pidSvg   SVG string for P&ID outputs, or null
   */
  window.JARVIS_SEND_RESULT = function (summary, pidSvg) {
    if (!window.parent || window.parent === window) return
    window.parent.postMessage({
      type: 'DENVER_RESULT',
      payload: {
        tool:      window.DENVER_TOOL_ID      || document.title || 'unknown',
        version:   window.DENVER_TOOL_VERSION || 'unknown',
        summary:   summary  || {},
        pidSvg:    pidSvg   || null,
        timestamp: new Date().toISOString(),
      },
    }, '*')
    console.log('[denver-bridge] result sent —', window.DENVER_TOOL_ID)
  }

  // ── 3. Listen for Denver's custom export events ───────────────────────────
  document.addEventListener('denver:export', function (e) {
    var d = (e.detail || {})
    window.JARVIS_SEND_RESULT(d.summary || {}, d.pidSvg || null)
  })

  // ── 4. Tool-specific event hooks ──────────────────────────────────────────
  // WWTP DesignPro fires 'wwtp:report' on Export
  document.addEventListener('wwtp:report', function (e) {
    var d = e.detail || {}
    window.JARVIS_SEND_RESULT({
      flow_mgd:        d.flow       ?? null,
      bod_influent:    d.bod_in     ?? null,
      bod_effluent:    d.bod_eff    ?? null,
      bod_removal_pct: d.bod_pct    ?? null,
      tn_effluent:     d.tn_eff     ?? null,
      tp_effluent:     d.tp_eff     ?? null,
      srt_days:        d.srt        ?? null,
      sludge_tpd:      d.sludge     ?? null,
      process:         d.process    ?? null,
      aeration_kw:     d.aeration   ?? null,
    }, d.pidSvg || null)
  })

  // AquaSimPro fires 'aquasim:report'
  document.addEventListener('aquasim:report', function (e) {
    var d = e.detail || {}
    window.JARVIS_SEND_RESULT({
      flow_gpm:         d.flow_gpm  ?? null,
      source_type:      d.source    ?? null,
      turbidity_ntu:    d.turbidity ?? null,
      toc_mgl:          d.toc       ?? null,
      product_recovery: d.recovery  ?? null,
      sdi:              d.sdi       ?? null,
      ro_flux:          d.flux      ?? null,
      uv_dose:          d.uv_dose   ?? null,
      chlorine_ct:      d.ct        ?? null,
      process_train:    d.train     ?? null,
    }, null)
  })

  // Denver MEP fires 'mep:report'
  document.addEventListener('mep:report', function (e) {
    var d = e.detail || {}
    window.JARVIS_SEND_RESULT({
      cooling_tons:   d.cooling    ?? null,
      heating_kbtu:   d.heating    ?? null,
      electrical_kva: d.electrical ?? null,
      duct_area_sf:   d.duct_area  ?? null,
      building_sf:    d.area       ?? null,
    }, null)
  })

  console.log('[denver-bridge] active — tool:', window.DENVER_TOOL_ID,
    '| version:', window.DENVER_TOOL_VERSION)
})()
