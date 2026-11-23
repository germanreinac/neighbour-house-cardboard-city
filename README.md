# Cardboard City

A small 3D third-person adventure prototype. You go to your friend Milo's house after school. His
big brother lets you in, you walk through the mess, open the back door, and crawl into the pile of
boxes in the backyard. Inside it is nearly dark, much bigger than a backyard, and Milo is missing.
He left notes.

**The one rule of the world: water melts cardboard.** Squirt a wall and it goes soggy, then
collapses. Any wall is a door.

The mood is a kids' spooky story rather than a scary game: a dusk that never ends, lit windows that
a kid drew on with marker, a sun on a string, and cardboard cut-outs that are never facing the same
way twice.

## The level

One linear route spirals through four gated districts to the Treehouse in the middle:

1. **Checkpoint Street** — the Box Knights hold the first gate.
2. **The Narrows** — alleys one box wide, held by the Alley Pirates.
3. **The Dry District** — a long stretch with no pool until the end, held by the Dino Scouts.
4. **Lights Out** — the streetlights are dead and some of the cut-outs follow you when you look away.
5. **The Treehouse** — where Milo is.

Each gate opens when the kids guarding it are soaked. Inside a district you can go any way you
like: follow the chalk arrows, or melt straight through buildings if you can spare the water.
Barricades are taped across the route so you have to spend some. Pools refill your tank and are
checkpoints. A vending box by each pool trades bottle caps for upgrades. Ten of Milo's notes are
scattered along the way.

## Camera and controls

Made for keyboard and mouse. The camera sits over your shoulder and the mouse steers it freely.
Your kid runs the way you push relative to the camera and turns to face it; while you squirt, they
turn to face the crosshair and the camera leans in. The wheel zooms. Shift runs.

A fixed top-down "diorama" camera was tried and removed: it made the city read as a maze of open
boxes and lost the feeling of the towers looming over you.

## Heights and doors

Everything here is cardboard and melts like any other wall.

- **Ramps and stairs** are walked up smoothly, with no jumping. Kids use them too.
- **High ground on the route:** a loading dock in Checkpoint Street, the Knights' watchtower by the
  first gate, a footbridge over The Narrows, a box pyramid in The Dry District with a full bottle
  on top, and a catwalk through Lights Out. Lookouts stand on several of them.
- **Lofts:** many taller buildings have an upstairs reached by a ramp along one wall, with a
  balcony opening and something worth finding.
- **Doors** are flaps on a tape hinge. Walk into one and it swings away from you, then falls shut
  behind you. Closed doors block sight, so kids on the other side can't see you. Kids open them too.

## Touch

Touch controls still work (left stick to run, the camera follows, hold squirt for lock-on and a
door assist), but the game is not designed around them.

## Still in the code, switched off

The earlier open-world systems (tribe forts and flags, capturable pools, raids, wall rebuilding,
allies) are still in `src/main.js` behind the `STORY` flag.

## Run it

It is plain ES modules with three.js vendored in `vendor/`, no build step. Serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Controls

| | |
|---|---|
| WASD | walk (you hop up one-box steps automatically), Shift runs, Space jumps |
| Mouse | look, hold left click to squirt, wheel zooms |
| Right click / Q | place a box |
| G | throw a water balloon |
| X | stand up a cardboard cut-out of yourself |
| E | talk, open doors, trade |

Touch devices get an on-screen stick and buttons.

## Code map

- `src/world.js` voxel grid, soggy-cardboard rules, chunked instanced rendering, city and house generation
- `src/actors.js` walking physics, kid and animal models, tribe AI
- `src/main.js` player, water particles, story beats, market, HUD, input
