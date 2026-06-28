/**
 * Denver Engineering — first-class MCP server (R6c)
 * ─────────────────────────────────────────────────────────────────────────────
 * The PROVIDER side of MCP: exposes Denver's own capabilities as tools other
 * systems can call (ECOSYSTEM_INTEGRATION_CONTRACT.md §5/§8). This is distinct
 * from api/routes/mcp.ts, which is the CONSUMER bridge (Denver → Ava). That route
 * is untouched.
 *
 * A small tool registry + dispatcher. Seeded with read-only, DB-free tools that
 * surface the federation primitives built in R2–R4 (capability registry, object
 * types, canonical events) so a caller can discover what Denver offers. Additive,
 * flag-gated; the route (routes/denverMcp.ts) is intentionally not mounted yet
 * (POST /call needs a service-to-service auth decision).
 */
import { validateRegistry } from '../capabilities/capabilityRegistry'
import { listObjectTypes } from '../registry/objectRegistry'
import { CANONICAL_EVENTS } from '../events/universalEvents'

export interface McpContext { tenantId: string | null }

export interface McpInputSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
}

/** Public tool metadata (no handler) — what `tools/list` returns. */
export interface McpToolDef {
  name: string
  description: string
  inputSchema: McpInputSchema
}

export interface McpTool extends McpToolDef {
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown> | unknown
}

export class UnknownToolError extends Error {
  constructor(name: string) { super(`unknown tool: ${name}`); this.name = 'UnknownToolError' }
}
export class ToolValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ToolValidationError' }
}

export class McpToolRegistry {
  private tools = new Map<string, McpTool>()
  register(tool: McpTool): this { this.tools.set(tool.name, tool); return this }
  has(name: string): boolean { return this.tools.has(name) }
  get(name: string): McpTool | undefined { return this.tools.get(name) }
  count(): number { return this.tools.size }
  /** Tool metadata only (handlers stripped) — safe to expose. */
  list(): McpToolDef[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  }
}

export function isDenverMcpServerEnabled(): boolean {
  return process.env['DENVER_MCP_SERVER'] === 'true'
}

/** Resolve + validate + run a tool. Throws UnknownToolError / ToolValidationError. */
export async function dispatch(
  registry: McpToolRegistry, name: string, ctx: McpContext, args: Record<string, unknown> = {},
): Promise<unknown> {
  const tool = registry.get(name)
  if (!tool) throw new UnknownToolError(name)
  for (const req of tool.inputSchema.required ?? []) {
    if (!(req in args)) throw new ToolValidationError(`missing required arg: ${req}`)
  }
  return await tool.handler(ctx, args)
}

const EMPTY_SCHEMA: McpInputSchema = { type: 'object' }

/** Denver's seeded tool set — read-only discovery of federation primitives. */
export function buildDenverMcpRegistry(): McpToolRegistry {
  return new McpToolRegistry()
    .register({
      name: 'denver.health', description: 'Denver liveness probe', inputSchema: EMPTY_SCHEMA,
      handler: () => ({ status: 'ok', service: 'denver-engineering' }),
    })
    .register({
      name: 'denver.capabilities',
      description: 'Capability → provider registry status (what Denver can route)',
      inputSchema: EMPTY_SCHEMA,
      handler: () => validateRegistry(),
    })
    .register({
      name: 'denver.object_types',
      description: 'Universal Object Registry types and their minting authority',
      inputSchema: EMPTY_SCHEMA,
      handler: () => ({ types: listObjectTypes() }),
    })
    .register({
      name: 'denver.canonical_events',
      description: 'Canonical event vocabulary Denver publishes/subscribes',
      inputSchema: EMPTY_SCHEMA,
      handler: () => ({ events: [...CANONICAL_EVENTS] }),
    })
}
