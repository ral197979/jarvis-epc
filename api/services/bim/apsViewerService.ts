/**
 * Denver Engineering — Autodesk Platform Services Viewer Token (v10.2.0)
 * ────────────────────────────────────────────────────────────────────────
 * Issues short-lived APS access tokens for the embedded Forge/APS viewer.
 * The viewer runs entirely in the browser — this service only provides
 * the auth token (2-legged OAuth) and URN translation.
 *
 * Required env vars:
 *   APS_CLIENT_ID     — Autodesk app client ID
 *   APS_CLIENT_SECRET — Autodesk app client secret
 *
 * When env vars are not set, returns a stub token so the rest of the
 * platform continues to work without APS configured.
 */

interface ApsToken {
  access_token: string
  token_type:   string
  expires_in:   number
  expires_at:   number   // unix ms
}

let _cached: ApsToken | null = null

export async function getApsViewerToken(): Promise<{
  access_token: string
  expires_in:   number
  configured:   boolean
}> {
  const clientId     = process.env['APS_CLIENT_ID']
  const clientSecret = process.env['APS_CLIENT_SECRET']

  if (!clientId || !clientSecret) {
    return { access_token: '', expires_in: 0, configured: false }
  }

  // Return cached token if still valid (with 60s buffer)
  if (_cached && _cached.expires_at > Date.now() + 60_000) {
    return { access_token: _cached.access_token, expires_in: Math.floor((_cached.expires_at - Date.now()) / 1000), configured: true }
  }

  // 2-legged OAuth token from APS
  const resp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'client_credentials',
      scope:         'viewables:read',
    }),
  })

  if (!resp.ok) {
    throw new Error(`APS token request failed: ${resp.status} ${await resp.text()}`)
  }

  const data = await resp.json() as { access_token: string; token_type: string; expires_in: number }
  _cached = {
    access_token: data.access_token,
    token_type:   data.token_type,
    expires_in:   data.expires_in,
    expires_at:   Date.now() + data.expires_in * 1000,
  }

  return { access_token: _cached.access_token, expires_in: _cached.expires_in, configured: true }
}

// ─── URN helpers ──────────────────────────────────────────────────────────────
// APS viewer needs a base64-encoded URN of the object in Autodesk OSS.
// When the file is uploaded to OSS, its URN is: urn:adsk.objects:os.object:{bucket}/{key}

export function toApsUrn(bucketKey: string, objectKey: string): string {
  const raw = `urn:adsk.objects:os.object:${bucketKey}/${objectKey}`
  return Buffer.from(raw).toString('base64url')
}

export function fromStorageKey(storageKey: string, bucket = 'denver-engineering'): string {
  return toApsUrn(bucket, storageKey)
}
