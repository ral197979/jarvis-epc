/**
 * Denver Engineering — capability-holder helpers for the ADR-014 ratchets.
 *
 * Re-exported through one module so a ratchet test asserts against the same
 * registry the server decides with, rather than a copy that could drift.
 */
export { SERVER_ROLE_CAPS, isServerCapability, roleHasCapability } from '../../authz/capabilities'
export { ALL_ROLES as ALL_ROLES_FOR_TEST } from './testPrincipal'
