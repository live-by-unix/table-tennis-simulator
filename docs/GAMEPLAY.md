# Gameplay

## Controls

| Input | Action |
|---|---|
| Mouse move | Move paddle (up/down = height, left/right = across table) |
| `W`/`S` or `↑`/`↓` | Move paddle toward/away from table |
| Mouse click / `Space` | Serve (when it's your serve) |
| Sensitivity slider | Mouse sensitivity (in-game) |
| Invert Y | Invert vertical mouse axis |

Paddle speed matters: a fast swing produces a faster, heavier shot; brushing the ball imparts spin.

## Rules implemented

- First to 11 points, win by 2
- Serve alternates every 2 points; at 10–10 every point
- Serve: bounce on own side → bounce on opponent side → rally
- Net on serve = let (replay, no point)
- Point lost on: ball lands out, double bounce on your side, shot failing to cross the net, service faults
- Disconnect: 30-second reconnect grace, then forfeit

## Physics

- Realistic gravity and air drag
- Spin (topspin/backspin/sidespin) curves flight via Magnus effect and kicks on table bounce
- Paddle collisions transfer swing velocity, angle, and brush spin

## Camera

Third-person camera behind your end of the table, smoothly tracking the ball. Spectators get a cinematic orbiting camera.
