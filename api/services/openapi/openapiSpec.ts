/**
 * Denver Engineering — OpenAPI spec (R6b)
 * ─────────────────────────────────────────────────────────────────────────────
 * Universal API standard (ECOSYSTEM_INTEGRATION_CONTRACT.md §8): publish an
 * OpenAPI document. A full hand-authored spec for ~80 route files would be huge
 * and drift immediately, so this is a real-but-extensible SKELETON: a base
 * document (info / servers / security schemes) plus a registry pattern for adding
 * paths, seeded with a representative core set. Routes register more over time.
 *
 * Pure module — buildDefaultSpec() returns a plain object; the route (routes/
 * openapi.ts) serves it behind the OPENAPI_ENABLED flag.
 */

export const OPENAPI_VERSION = '3.1.0'

export function isOpenApiEnabled(): boolean {
  return process.env['OPENAPI_ENABLED'] === 'true'
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface OperationObject {
  summary?: string
  tags?: string[]
  security?: Array<Record<string, string[]>>
  responses: Record<string, { description: string }>
}

export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers: { url: string }[]
  components: { securitySchemes: Record<string, unknown> }
  paths: Record<string, Record<string, OperationObject>>
}

/** Extensible path registry — routes call register() to contribute operations. */
export class OpenApiRegistry {
  private paths = new Map<string, Record<string, OperationObject>>()

  register(method: HttpMethod, path: string, op: OperationObject): this {
    const item = this.paths.get(path) ?? {}
    item[method] = op
    this.paths.set(path, item)
    return this
  }

  pathCount(): number { return this.paths.size }

  build(): OpenApiDocument {
    const paths: Record<string, Record<string, OperationObject>> = {}
    for (const [p, item] of this.paths) paths[p] = item
    return {
      openapi: OPENAPI_VERSION,
      info: {
        title: 'Denver Engineering API',
        version: '1.0.0',
        description: 'Enterprise EPC Delivery Platform — REST API (partial spec, generated from the OpenAPI registry).',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
        },
      },
      paths,
    }
  }
}

const SECURED: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }]

/** Seed a registry with a representative core surface. Extend as routes adopt it. */
export function seedCoreRegistry(): OpenApiRegistry {
  return new OpenApiRegistry()
    .register('get', '/api/v1/health', {
      summary: 'Service health check', tags: ['system'],
      responses: { '200': { description: 'Service healthy' } },
    })
    .register('get', '/openapi.json', {
      summary: 'This OpenAPI document', tags: ['system'],
      responses: { '200': { description: 'OpenAPI spec' }, '404': { description: 'Spec publishing disabled' } },
    })
    .register('post', '/api/v1/auth/login', {
      summary: 'Authenticate and issue a JWT session cookie', tags: ['auth'],
      responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials' } },
    })
    .register('get', '/api/v1/projects', {
      summary: 'List projects', tags: ['projects'], security: SECURED,
      responses: { '200': { description: 'Project list' } },
    })
    .register('post', '/api/v1/projects', {
      summary: 'Create a project', tags: ['projects'], security: SECURED,
      responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' } },
    })
}

export function buildDefaultSpec(): OpenApiDocument {
  return seedCoreRegistry().build()
}
