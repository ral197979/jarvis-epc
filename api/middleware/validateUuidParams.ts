import { Application, Response, NextFunction, Request } from 'express'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UUID_PATH_PARAMS = [
  'id', 'projectId', 'systemId', 'subsystemId', 'tagId',
  'userId', 'itemId', 'markupId', 'versionId',
  'packId', 'resultId', 'deficiencyId',
]

// Known UUID-shaped query parameters (snake_case convention used in this API)
const UUID_QUERY_PARAMS = new Set([
  'project_id', 'system_id', 'subsystem_id', 'tag_id',
  'tenant_id',  'user_id',   'pack_id',
])

export function registerUuidParamGuards(app: Application): void {
  for (const name of UUID_PATH_PARAMS) {
    app.param(name, (req: Request, res: Response, next: NextFunction, val: string) => {
      if (!UUID_RE.test(val)) {
        res.status(400).json({ error: 'validation', message: `invalid UUID: ${name}` })
        return
      }
      next()
    })
  }
}

export function validateUuidQueryParams(req: Request, res: Response, next: NextFunction): void {
  for (const [key, val] of Object.entries(req.query)) {
    if (!UUID_QUERY_PARAMS.has(key)) continue
    const str = String(val ?? '')
    if (str && !UUID_RE.test(str)) {
      res.status(400).json({ error: 'validation', message: `invalid UUID query param: ${key}` })
      return
    }
  }
  next()
}
