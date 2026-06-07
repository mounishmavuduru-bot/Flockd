# FLOCKD — demo video script

Two cuts: a ~2:20 main walkthrough and a ~50s sizzle. Capture notes are at the bottom — read them first, because the proof beats only land if the right windows are open.

Live: https://flyflockd.vercel.app

## A) Main walkthrough (~2:20)

| Beat | Shot / on-screen cue | VO |
|---|---|---|
| **Cold open (5s)** | [Tight on a webcam feed: a person flapping their arms hard. Cut to the matching bird climbing through the Sydney Opera House sails. No UI yet.] | "I'm flapping my arms at a webcam. That's flying the bird. No controller." |
| **What it is** | [Title card: FLOCKD. Then pull back to the full game — your bird plus three others banking in formation.] | "FLOCKD is a multiplayer flight game. Real wings, real air. You and a flock, live." |
| **Controls** | [Split screen: webcam pose skeleton on the left, bird responding on the right. Quick cut to keyboard, then phone tilt.] | "Webcam arm-flapping if you've got a camera. Keyboard or tilt if you don't. It's a real aerodynamic model underneath, not a jump button." |
| **Join + pick** | [Menu shell: type a callsign, pick a bird color in the locker, two mode cards: RACE and SURVIVAL. Hover RACE.] | "Pick a callsign, pick a bird, pick a world. Eight real landmarks — Opera House, Niagara, Himeji, Christ the Redeemer." |
| **RACE (quick)** | [Flock chasing a ring course through Niagara Falls. Rings light up as birds pass. Banner: live commentary line appears.] | "RACE is the flock against a ring course through those worlds. Watch the top of the screen." |
| **Commentary names the real leader** | [Zoom the commentary banner: "RAVEN leads by 40 meters over FINCH." Cut so the named leader is visibly in front.] | "That commentary isn't canned. Every three and a half seconds Claude reads the live standings and calls the actual leader and the actual gap. Names a bird, names the meters." |
| **Switch to SURVIVAL** | [Back to mode cards, click SURVIVAL. World loads. HUD shows feather count. A dark hawk silhouette enters frame.] | "SURVIVAL is every bird for itself. And it's not just players in here." |
| **The hawk** | [The hawk Skraah locks onto the lead bird and dives. Screen edge fogs; a wing-clip hit staggers the leader.] | "One predator. Skraah. Claude flies it. It hunts whoever's winning and fires sabotage — clips your wing, drops fog, throws a headwind. Always at the leader, so leading is dangerous." |
| **Second screen: THE HUNT dashboard** | [Cut to a second monitor running dashboard.html. Live panels: Claude's reasoning feed scrolling, a predator radar, a sabotage timeline ticking.] | "This is a second screen. THE HUNT. It calls zero reducers — it's a pure subscription. So this is Claude's actual reasoning, streaming out of the database as the match plays." |
| **Hawk references its own log** | [Highlight one reasoning line that quotes an earlier decision, e.g. "Last tick I clipped RAVEN; she recovered, switching to fog."] | "And the hawk reads its own history. Its last logged decision gets fed back as its next prompt, so it builds on what it just did. You can watch it reason against itself." |
| **The architecture reveal** | [Diagram for 3s: client → SpacetimeDB → AI sidecar. Then highlight that hawk rows and player rows sit in the same table.] | "Here's the trick. SpacetimeDB is the only backend. A Node sidecar holds the Claude key, reads live rows, calls Haiku, and writes the answer back as more rows. The AI is just another database client. The hawk's moves and the commentary are synced rows — same shape as a player's." |
| **PROOF beat (spacetime sql)** | [Cut to a terminal. Type and run: `spacetime sql flocked "UPDATE player SET x = 9999 WHERE name = 'FINCH'"`. Cut back to game. Next commentary line updates the standings.] | "Don't take my word for it. I'll teleport a player in raw SQL. Next commentary line — there — the standings already moved. It's reading the database, not a script." |
| **Durability proof (optional 2s)** | [Run: `spacetime sql flocked "SELECT line FROM commentary ORDER BY created_at DESC LIMIT 5"`. Rows print.] | "And every line the AI wrote is a real, durable row. There they are." |
| **Feather Tithe** | [Back in game, leader is under attack. Player clicks "Feather Tithe", feather count drops, hawk peels off and breaks pursuit.] | "If the hawk's on you, buy it off. Feather Tithe — spend your feathers, the predator backs off. One atomic reducer, and it leaves you alone." |
| **Close (1 line)** | [Wide shot: the flock crossing a finish ring at sunset over Riomaggiore. Cut to URL card: flyflockd.vercel.app] | "Real flight, real flock, and an AI that lives in the same database you do. FLOCKD. It's live — go flap." |

## B) Sizzle cut (~50s)

| Beat | Shot / on-screen cue | VO |
|---|---|---|
| **Hook (6s)** | [Webcam: arms flapping. Cut to the bird climbing through the Opera House sails.] | "I flap my arms at a webcam. The bird flies. With a whole flock, live." |
| **The hawk (10s)** | [SURVIVAL. Skraah dives on the lead bird, fog creeps in, a wing-clip lands.] | "In SURVIVAL there's a predator. Claude flies it. It hunts the leader and sabotages them — wing-clip, fog, headwind." |
| **Dashboard + reasoning (10s)** | [Second screen, dashboard.html: reasoning feed scrolling, radar, sabotage timeline. Highlight a line where the hawk cites its own last move.] | "Second screen. Pure subscription, zero reducers. That's Claude's live reasoning straight from the database — and it reads its own last decision to plan the next one." |
| **Proof (12s)** | [Terminal: run `spacetime sql flocked "UPDATE player SET x = 9999 WHERE name = 'FINCH'"`. Cut to the commentary banner updating.] | "The commentary names the real leader and the real gap. I'll move a player in raw SQL — next line, the standings update. It's reading the database, not a script. The AI is just another DB client." |
| **Close (8s)** | [Wide flock shot over Christ the Redeemer. URL card: flyflockd.vercel.app] | "One database. Players and an AI predator in the same rows. FLOCKD. It's live." |

## C) Capture notes

**Windows / screens**
- Browser window 1 (main, ~1080p): the game at flyflockd.vercel.app, joined into a live match. Keep the commentary banner and feather count visible in frame.
- Browser window 2 (second monitor or second tab, full-screen): dashboard.html (THE HUNT) — confirm the reasoning feed, predator radar, and sabotage timeline are all populating before you roll.
- Terminal window, large readable font: `spacetime` CLI, logged into the maincloud `flocked` db. Pre-test both proof commands so they return instantly on camera:
  - `spacetime sql flocked "UPDATE player SET x = 9999 WHERE name = '<a real player in your match>'"`
  - `spacetime sql flocked "SELECT line FROM commentary ORDER BY created_at DESC LIMIT 5"`

**Before you hit record**
- Sidecar running and connected to the same db you're filming (so Claude is actually writing rows). Verify a fresh commentary line appears every ~3.5s and the hawk reasoning is updating on the dashboard.
- Webcam on, MediaPipe pose tracking confirmed working in good light — do a flap test and watch the skeleton track before recording the hook.
- Have 2-4 birds in the match (a couple extra clients or teammates) so the commentary has real standings to name and the hawk has a clear leader to hunt.
- Know the exact `name` value of a player in your match so the SQL UPDATE hits a real row — pull it from the dashboard or `SELECT name FROM player`.
- Get into a SURVIVAL match with feathers in the bank before the Tithe beat, and let the hawk lock on so the back-off is visible on cue.

**Timing the proof beat (most important)**
- Frame the terminal and the commentary banner so you can cut between them fast (or split-screen them). Run the UPDATE, then hold on the banner until the next line refreshes — that refresh landing on camera is the whole point. Do a dry run so you know roughly how many seconds until the next commentary tick.
- Pick a victim name for the UPDATE that is clearly NOT currently leading, so the standings visibly change.

**Do not show / do not say:** Claude building worlds (the eight worlds are deterministic seed GLBs), more than one predator, ghost races, NL-to-SQL, fog-of-war, or cross-match memory — none of those are built.
