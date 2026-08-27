/**
 * Denver Engineering — APS (Autodesk Platform Services) Embedded Viewer (v10.2.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Loads the Forge/APS Viewer SDK from Autodesk's CDN, fetches a short-lived
 * 2-legged access token from our backend, and renders the model identified by
 * the base64url URN stored against the BIM model record.
 *
 * States:
 *   loading   — fetching token / loading SDK
 *   unconfigured — APS_CLIENT_ID / APS_CLIENT_SECRET not set in env
 *   no-urn    — model registered but IFC not yet uploaded to APS OSS
 *   error     — SDK or token fetch failed
 *   ready     — viewer fully initialised
 */
import React, { useEffect, useRef, useState } from 'react'

// ─── Autodesk global type stubs ───────────────────────────────────────────────
declare global {
  interface Window {
    Autodesk?: {
      Viewing: {
        Initializer: (opts: object, cb: () => void) => void
        GuiViewer3D: new (container: HTMLElement, config?: object) => ApsViewerInstance
        Document: {
          load: (
            urn: string,
            onSuccess: (doc: ApsDocument) => void,
            onError: (code: number, msg: string) => void,
          ) => void
        }
      }
    }
  }
}

interface ApsViewerInstance {
  start: () => number
  loadDocumentNode: (doc: ApsDocument, node: unknown, opts?: object) => Promise<void>
  finish: () => void
}

interface ApsDocument {
  getRoot: () => { getDefaultGeometry: () => unknown }
}

// ─── SDK loading ──────────────────────────────────────────────────────────────

const APS_VIEWER_VERSION = '7.*'
const APS_CDN = 'https://developer.api.autodesk.com/modelderivative/v2/viewers'

let sdkLoadPromise: Promise<void> | null = null

function loadApsSDK(): Promise<void> {
  if (sdkLoadPromise) return sdkLoadPromise
  if (window.Autodesk?.Viewing) { sdkLoadPromise = Promise.resolve(); return sdkLoadPromise }

  sdkLoadPromise = new Promise((resolve, reject) => {
    // CSS
    const link = document.createElement('link')
    link.rel  = 'stylesheet'
    link.href = `${APS_CDN}/${APS_VIEWER_VERSION}/style.min.css`
    document.head.appendChild(link)

    // JS
    const script = document.createElement('script')
    script.src = `${APS_CDN}/${APS_VIEWER_VERSION}/viewer3D.min.js`
    script.onload  = () => resolve()
    script.onerror = () => reject(new Error('Failed to load APS Viewer SDK'))
    document.head.appendChild(script)
  })

  return sdkLoadPromise
}

// ─── Token fetch ──────────────────────────────────────────────────────────────

interface ViewerTokenResponse {
  access_token: string
  expires_in:   number
  configured:   boolean
  urn:          string | null
}

async function fetchViewerToken(modelId: string): Promise<ViewerTokenResponse> {
  const res = await fetch(`/api/v1/bim-models/${modelId}/viewer-token`)
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
  return res.json() as Promise<ViewerTokenResponse>
}

// ─── Component ────────────────────────────────────────────────────────────────

type ViewerState = 'loading' | 'unconfigured' | 'no-urn' | 'error' | 'ready'

interface ApsViewerProps {
  modelId: string
  height?: number
}

export function ApsViewer({ modelId, height = 480 }: ApsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<ApsViewerInstance | null>(null)
  const [state, setState] = useState<ViewerState>('loading')
  const [errorMsg, setErrorMsg]   = useState('')
  const [urnState, setUrnState]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      setState('loading')
      try {
        // 1. Get token + URN from backend
        const { access_token, expires_in, configured, urn } = await fetchViewerToken(modelId)

        if (cancelled) return

        if (!configured) { setState('unconfigured'); return }
        if (!urn)        { setState('no-urn'); return }

        setUrnState(urn)

        // 2. Load SDK
        await loadApsSDK()
        if (cancelled) return

        const AV = window.Autodesk!.Viewing

        // 3. Initialise viewer
        await new Promise<void>((resolve, reject) => {
          AV.Initializer(
            {
              env: 'AutodeskProduction2',
              api: 'streamingV2',
              getAccessToken: (cb: (token: string, exp: number) => void) => {
                cb(access_token, expires_in)
              },
            },
            () => {
              if (cancelled || !containerRef.current) { reject(new Error('unmounted')); return }

              const viewer = new AV.GuiViewer3D(containerRef.current)
              viewerRef.current = viewer
              const startCode = viewer.start()
              if (startCode > 0) { reject(new Error(`Viewer start error: ${startCode}`)); return }

              AV.Document.load(
                `urn:${urn}`,
                (doc: ApsDocument) => {
                  if (cancelled) return
                  const geometry = doc.getRoot().getDefaultGeometry()
                  viewer.loadDocumentNode(doc, geometry).then(() => {
                    if (!cancelled) setState('ready')
                    resolve()
                  }).catch(reject)
                },
                (code: number, msg: string) => reject(new Error(`APS Document load error ${code}: ${msg}`)),
              )
            },
          )
        })
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err))
          setState('error')
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (viewerRef.current) {
        try { viewerRef.current.finish() } catch { /* ignore */ }
        viewerRef.current = null
      }
    }
  }, [modelId])

  // ─── Overlays ──────────────────────────────────────────────────────────────

  const overlay = (icon: string, title: string, body: string) => (
    <div style={{
      height, background: '#111', border: '1px solid var(--jarvis-bd)', borderRadius: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#888', gap: 8, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 36 }}>{icon}</div>
      <div style={{ fontWeight: 600, color: '#ccc' }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 340 }}>{body}</div>
    </div>
  )

  if (state === 'loading') return overlay('⏳', 'Loading viewer…', 'Fetching APS token and Autodesk SDK.')

  if (state === 'unconfigured') return overlay(
    '🔑', 'APS not configured',
    'Set APS_CLIENT_ID and APS_CLIENT_SECRET environment variables on the API host to enable the 3D viewer.',
  )

  if (state === 'no-urn') return overlay(
    '📤', 'Model not uploaded to APS',
    'The model is registered but the IFC file has not been uploaded to Autodesk OSS yet. ' +
    'Upload the file and set storage_key on the model record to enable 3D viewing.',
  )

  if (state === 'error') return overlay('⚠️', 'Viewer error', errorMsg)

  // ─── Viewer container (state === 'ready' or still loading SDK) ─────────────
  return (
    <div style={{ position: 'relative' }}>
      {state !== 'ready' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', color: '#aaa', fontSize: 13,
        }}>
          Initialising viewer…
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: '100%', height, background: '#1a1a1a', borderRadius: 4 }}
      />
      {urnState && (
        <div style={{ fontSize: 10, color: '#555', marginTop: 4, fontFamily: 'monospace' }}>
          URN: {urnState.slice(0, 48)}…
        </div>
      )}
    </div>
  )
}

export default ApsViewer
