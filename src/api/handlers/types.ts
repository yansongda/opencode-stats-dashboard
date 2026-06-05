/**
 * Handler type definitions for API endpoint handlers.
 *
 * Each handler module exports a function that registers its routes
 * on the given APIRouter instance.
 */

import type { APIRouter } from "../router"

/**
 * A route registrar function that mounts its routes onto the router.
 * Used by handler modules (stats, stream, ingest, etc.)
 */
export type RouteRegistrar = (router: APIRouter) => void
