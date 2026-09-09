/**
 * Result type of every read query in `src/lib/queries`.
 *
 * „Nothing there“ and „could not be loaded“ must not look the same on screen
 * (Gaby WP4 F1/F2, WP5 F6): a failing query returns `{ ok: false }` instead of
 * an empty list, so the page can show a hint and the user knows to reload
 * rather than believing the list is empty.
 *
 * It lived in `sessionDetail.ts` until WP7 and moved here when the player
 * queries started using it too.
 */

export type QueryFailure = 'not_found' | 'error';

export type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: QueryFailure };
