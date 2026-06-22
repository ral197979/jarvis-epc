/**
 * Denver Engineering — SAML Role Mapping
 * ─────────────────────────────────────────
 * Maps IdP group/role claims to Denver Engineering platform roles.
 *
 * Denver Eng roles:
 *   owner          — Full admin + billing; usually the account creator
 *   admin          — User management + all project access
 *   project_manager — Manage projects, approvals, budgets
 *   engineer       — Technical work: drawings, inspections, tests
 *   viewer         — Read-only access
 *
 * Mapping priority:
 *   1. Explicit role_mapping JSON (configured per tenant)
 *   2. Well-known IdP group names (built-in heuristics)
 *   3. tenant_sso_configs.default_role (fallback)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlatformRole = 'owner' | 'admin' | 'project_manager' | 'engineer' | 'viewer'

export interface AttributeValues {
  email?:       string
  displayName?: string
  groups?:      string[]
  role?:        string          // direct role claim from some IdPs
  [key: string]: unknown
}

// ─── Valid roles set ──────────────────────────────────────────────────────────

const VALID_ROLES = new Set<PlatformRole>(['owner', 'admin', 'project_manager', 'engineer', 'viewer'])

export function isValidRole(role: unknown): role is PlatformRole {
  return typeof role === 'string' && VALID_ROLES.has(role as PlatformRole)
}

// ─── Built-in heuristics ──────────────────────────────────────────────────────
// These patterns match common Azure AD / Okta group naming conventions.

const BUILTIN_PATTERNS: Array<{ pattern: RegExp; role: PlatformRole }> = [
  { pattern: /\b(owner|billing|account.?owner)\b/i,           role: 'owner'           },
  { pattern: /\b(admin|administrator|sys.?admin)\b/i,          role: 'admin'           },
  { pattern: /\b(pm|project.?manager?|program.?manager?)\b/i, role: 'project_manager' },
  { pattern: /\b(engineer|developer|technical|design)\b/i,    role: 'engineer'        },
  { pattern: /\b(viewer|read.?only|observer)\b/i,             role: 'viewer'          },
]

/**
 * Derives a Denver Eng role from IdP-provided attribute values.
 *
 * @param attrs          Extracted IdP attributes (email, displayName, groups, role)
 * @param roleMapping    Tenant-specific mapping JSON: { "IdP-Group-Name": "denver-role" }
 * @param defaultRole    Fallback role when no mapping matches
 */
export function deriveRole(
  attrs:       AttributeValues,
  roleMapping: Record<string, string>,
  defaultRole: PlatformRole = 'viewer',
): PlatformRole {
  // 1. Direct role claim from IdP (e.g. Okta custom attribute)
  if (attrs.role && isValidRole(attrs.role)) {
    return attrs.role
  }

  // 2. Explicit role_mapping (tenant-configured)
  const groups = attrs.groups ?? []
  for (const group of groups) {
    const mapped = roleMapping[group]
    if (mapped && isValidRole(mapped)) {
      return mapped
    }
  }

  // 3. Partial-match role_mapping (case-insensitive)
  for (const group of groups) {
    for (const [key, val] of Object.entries(roleMapping)) {
      if (group.toLowerCase().includes(key.toLowerCase()) && isValidRole(val)) {
        return val
      }
    }
  }

  // 4. Built-in heuristics against group names
  // Sort: prefer higher-privilege matches (owner > admin > pm > engineer > viewer)
  const roleOrder: PlatformRole[] = ['owner', 'admin', 'project_manager', 'engineer', 'viewer']
  let bestRole: PlatformRole | null = null
  for (const group of groups) {
    for (const { pattern, role } of BUILTIN_PATTERNS) {
      if (pattern.test(group)) {
        if (!bestRole || roleOrder.indexOf(role) < roleOrder.indexOf(bestRole)) {
          bestRole = role
        }
      }
    }
  }
  if (bestRole) return bestRole

  // 5. Default role
  return isValidRole(defaultRole) ? defaultRole : 'viewer'
}

// ─── Attribute extraction ─────────────────────────────────────────────────────

/**
 * Extracts email, displayName, and groups from a raw SAML attribute map
 * according to the tenant's attribute_mapping configuration.
 *
 * attribute_mapping shape:
 * {
 *   "email":       ["claim-name-1", "claim-name-2"],
 *   "displayName": ["claim-name"],
 *   "groups":      ["claim-name"]
 * }
 */
export function extractAttributes(
  rawAttrs:         Record<string, unknown>,
  attributeMapping: Record<string, string[]>,
): AttributeValues {
  const result: AttributeValues = {}

  // Default attribute name lists for common IdPs
  const defaults: Record<keyof AttributeValues, string[]> = {
    email: [
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
      'email', 'mail', 'Email', 'emailAddress',
    ],
    displayName: [
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/displayname',
      'displayName', 'name', 'cn', 'fullName',
    ],
    groups: [
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
      'http://schemas.xmlsoap.org/claims/Group',
      'groups', 'memberOf', 'roles', 'Roles',
    ],
  }

  for (const field of ['email', 'displayName', 'groups'] as const) {
    const candidates = attributeMapping[field] ?? defaults[field] ?? []
    for (const name of candidates) {
      if (rawAttrs[name] !== undefined && rawAttrs[name] !== null) {
        const val = rawAttrs[name]
        if (field === 'groups') {
          result.groups = Array.isArray(val) ? val.map(String) : [String(val)]
        } else {
          result[field] = String(val)
        }
        break
      }
    }
  }

  return result
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates that extracted attributes include at minimum a usable email.
 * Throws with a descriptive error if required claims are missing.
 */
export function validateRequiredClaims(attrs: AttributeValues): void {
  if (!attrs.email) {
    throw new Error(
      'SAML assertion missing email claim. Check your attribute_mapping configuration. ' +
      'Common Azure AD claim: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attrs.email)) {
    throw new Error(`SAML assertion contains invalid email format: ${attrs.email}`)
  }
}
