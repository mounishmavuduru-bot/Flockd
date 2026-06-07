/**
 * Low-level SpacetimeDB connection helper for FLOCKED.
 * Wraps the generated DbConnection builder + identity-token persistence
 * (so a page refresh reconnects as the SAME player, keeping your row + score).
 */
import { DbConnection } from './bindings';

const TOKEN_KEY = 'flocked.token';

/**
 * @param {object} opts
 * @param {string} opts.uri        ws:// or wss:// SpacetimeDB host
 * @param {string} opts.dbName     database name (module name)
 * @param {string} [opts.tokenKey] localStorage key for the identity token.
 *   Defaults to 'flocked.token' (the player). A read-only watcher (e.g. THE HUNT
 *   dashboard) passes a distinct key so it never clashes with a player tab.
 * @param {(conn:any, identity:any, token:string)=>void} [opts.onConnect]
 * @param {()=>void} [opts.onDisconnect]
 * @param {(err:any)=>void} [opts.onError]
 * @returns {any} the live DbConnection
 */
export function connectToFlocked({ uri, dbName, tokenKey, onConnect, onDisconnect, onError }) {
  const TKEY = tokenKey || TOKEN_KEY;
  let token;
  try { token = localStorage.getItem(TKEY) || undefined; } catch { /* private mode */ }

  let builder = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(dbName)
    .onConnect((conn, identity, tok) => {
      try { localStorage.setItem(TKEY, tok); } catch { /* ignore */ }
      onConnect?.(conn, identity, tok);
    })
    .onDisconnect(() => { onDisconnect?.(); })
    .onConnectError((_conn, err) => { onError?.(err); });

  if (token) builder = builder.withToken(token);

  return builder.build();
}
