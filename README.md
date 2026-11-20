# Cardboard City

A small 3D first-person game prototype. You go to your friend Milo's house after school. His big
brother lets you in, you walk through the mess, open the back door, and the pile of boxes in the
backyard turns out to be a whole city run by kids.

**The one rule of the world: water melts cardboard.** Squirt a wall and it goes soggy, then
collapses. Any wall is a door. The other kids' water does the same thing, so the city wears down
as fights move through it.

## What's in the prototype

- Intro: front door, big brother, wrecked house, backyard, the hole in the big box.
- A 128×128 voxel city of cardboard buildings, walls, stacks and three tribe forts. Fog and tall
  outer stacks mean you never see out of it.
- Squirter with a water tank. Refill at kiddie pools or with water bottles you find.
- Melted walls sometimes leave dry boxes you can pick up and place (stairs, bridges, cover).
- Water balloons that open a whole wall at once.
- Three tribes in costumes (Box Knights, Alley Pirates, Dino Scouts) who fight you and each other,
  and tunnel through walls when they get stuck.
- A dog that follows you, cats that don't, and geese that knock water out of your tank.
- The Treehouse in the middle: real wood, can't be melted, nobody fights there. It has a market
  that trades bottle caps for a bigger tank, more pressure, a raincoat, balloons and boxes.
- Goal: take the flag out of each tribe's sealed keep and carry all three up to the Treehouse.

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
| E | talk, open doors, trade |

Touch devices get an on-screen stick and buttons.

## Code map

- `src/world.js` voxel grid, soggy-cardboard rules, chunked instanced rendering, city and house generation
- `src/actors.js` walking physics, kid and animal models, tribe AI
- `src/main.js` player, water particles, story beats, market, HUD, input
