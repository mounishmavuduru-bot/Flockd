# FLOCKD — UI Integration Contract (bring your own auth + lobby)

Build the auth + lobby UI wherever you like (Lovable, Figma → code, React, plain
HTML) and plug it into the game. The game logic lives entirely in **`NetClient`**
(`src/net/index.js`); your UI only needs to **call 6 methods** and **read 1 state
callback**. You never touch the 3D/game internals.

## The surface

`main.js` already creates the client and exposes it as `window.__net`. To use your
own UI instead of the built-in `MenuShell`:

1. Disable the built-in shell: in `src/main.js`, the shell only mounts when
   `useShell` is true (no `?room=`). Set `useShell = false` (or guard the
   `new MenuShell(...)` block) so it never renders.
2. Construct/obtain the client (already done in `main.js`):
   ```js
   const net = new NetClient({ scene, localState: flightState, flightPhysics, onState, onError });
   net.connect();
   ```
3. Wire your UI to these **calls**:
   | Call | When | Notes |
   |------|------|-------|
   | `net.setName(name)` | profile/callsign change | persists server-side |
   | `net.setColor(idx)` | locker color 0..7 | |
   | `net.join({ code, name, mode, color })` | Create/Join a room | `mode`: `'creative'` \| `'survival'`. Creating = pick an unused code. |
   | `net.startBuild()` | host presses Start | lobby → building → playing (generates the world) |
   | `net.leave()` | exit to menu | resets per-match state |
   | `net.tithe({ amount })` | survival "buy mercy" | spend feathers (score) for predator favor |

4. Render from the **`onState(info)` callback** (fires every frame):
   ```js
   onState = (info) => { /* update your UI */ }
   // info = {
   //   connected: boolean,        // true once the websocket + identity are live
   //   inRoom: boolean,           // am I in a room
   //   roomCode: string|null,
   //   roomState: 'lobby'|'building'|'playing'|'over'|null,
   //   mode: 'creative'|'survival'|null,
   //   isHost: boolean,
   //   players: number,
   //   roster: [{ name, color, me, host, score, finished, alive }],
   // }
   ```
   And `onError(reason)` fires on connect failure/drop (`'timeout'|'error'|'disconnected'`).

## Suggested flow (mirror what the game expects)
- **Auth screen** → collect callsign → `net.setName(name)`; pick color → `net.setColor(idx)`.
- **Home** → pick mode + Create/Join → `net.join({...})`. Show a spinner; when
  `info.inRoom` flips true, reveal the game (hide your overlay).
- **Survival waiting room** → if `mode==='survival' && roomState!=='playing'`, show the
  room code + roster (`info.roster`) + a host-only Start that calls `net.startBuild()`.
  (Creative's in-room prompt UI is `src/net/lobbyUI.js` — keep it, or replace it too.)
- **In game** → when `roomState==='playing'`, hide your menu. Show your own Leave.
- **Results** → when `roomState==='over'`, render a scoreboard from `info.roster`
  (sort by `score`), with Play Again → `net.leave()`.

## The clean drop-in (recommended)
A thin facade `window.FlockdNet` will expose exactly the calls + an `onState`
subscription so your component never imports game code:
```js
FlockdNet.onState(info => render(info));
FlockdNet.join({ code:'NEST', name, mode:'survival', color });
FlockdNet.startBuild(); FlockdNet.leave(); FlockdNet.tithe(50);
```
Ask me to generate `src/net/facade.js` + flip `useShell=false`, and your
Lovable/Figma export drops straight in.

## Notes
- Bird **color** is index 0..7 → palette
  `['#ff5a5f','#3fa7ff','#5ad469','#ffd23f','#b06bff','#ff8c42','#2ec4b6','#f15bb5']`.
  (When we add multiple bird **models/skins**, a `skin` field joins `color` here.)
- The deployed client auto-targets Maincloud (`wss://maincloud.spacetimedb.com/flocked`);
  localhost targets the local server. Override with `?stdb=wss://...`.
- Keep any text inserted from `roster`/room code XSS-safe (`textContent`, not innerHTML).
