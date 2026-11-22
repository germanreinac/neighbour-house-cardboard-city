# Cardboard City

A small 3D third-person game prototype. You go to your friend Milo's house after school. His big
brother lets you in, you walk through the mess, open the back door, and the pile of boxes in the
backyard turns out to be a whole city run by kids.

**The one rule of the world: water melts cardboard.** Squirt a wall and it goes soggy, then
collapses. Any wall is a door. The other kids' water does the same thing, so the city wears down
as fights move through it.

## What's in the prototype

- Intro: front door, big brother, wrecked house, backyard, the hole in the big box.
- Third-person camera over your shoulder that tucks in behind you in narrow alleys.
- Handmade city detail: marker-drawn windows on every tower, a painted road with parked cardboard
  cars, tube streetlights, a traffic light, hydrants, a lemonade stand, planks and bunting strung
  between towers, rooftop water tanks, and a cardboard sun and clouds hung on strings.
- A dense city of cardboard: alleys one or two boxes wide, buildings with crooked towers stacked
  far overhead, fake shopfronts with painted doors, hand-lettered signs, and cardboard cut-out
  kids standing around to draw fire. The bottom floors are destructible; the towers are not.
- Squirter with a water tank. Melted walls sometimes leave dry boxes you can pick up and place.
  Water balloons open a whole wall. You can stand up a cut-out of yourself as a decoy.
- Three tribes in costumes (Box Knights, Alley Pirates, Dino Scouts). They path through the alleys,
  melt through walls when that is shorter, run out of water and have to go refill.
- A dog that follows you, cats that don't, and geese that knock water out of your tank.

## The loop

1. **Prepare at the Treehouse.** It is your team's base: real wood, can't be melted, nobody fights
   there. The rain barrel fills your tank, the market trades banked bottle caps for upgrades, and
   the war map sets what your compass points at.
2. **Push out.** Water is both your weapon and your key. Every wall you melt is water you won't
   have in the fight.
3. **Hit the objective.** Take a pool by standing in it alone for five seconds, or melt into a
   fort's sealed keep and grab the flag.
4. **Get home.** Caps you pick up sit in your pocket and are lost if you get soaked. A flag slows
   you down, stops you drying off, and sends its whole tribe after you.
5. **Bank and upgrade.** Reaching the Treehouse banks your caps. Flags are planted in the yard.

The city pushes back:

- **Pools are territory.** You can only refill at pools your team holds, and so can the tribes.
  A tribe with no pool nearby has to walk back to its fort for water. Each pool you hold gets one
  of your friends posted to guard it.
- **Raids.** Tribes send raiders to take pools they don't hold, including yours.
- **Flags get stolen back.** A flag in your yard can be carried off by its tribe. You win by
  holding all three at once.
- **Walls get re-taped.** Holes you melt are rebuilt after a while, unless you are nearby or you
  hold the pool in that district.

## Run it

It is plain ES modules with three.js vendored in `vendor/`, no build step. Serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Controls

| | |
|---|---|
| WASD | walk (you hop up one-box steps automatically), Space jumps |
| Mouse | look, hold left click to squirt |
| Right click / Q | place a box |
| G | throw a water balloon |
| X | stand up a cardboard cut-out of yourself |
| E | talk, open doors, trade |

Touch devices get an on-screen stick and buttons.

## Code map

- `src/world.js` voxel grid, soggy-cardboard rules, chunked instanced rendering, city and house generation
- `src/actors.js` walking physics, kid and animal models, tribe AI
- `src/main.js` player, water particles, story beats, market, HUD, input
