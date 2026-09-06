# Assignment 1

## Flippy Bit Game

Flippy Bit is a reaction game built with RxJS and Functional Reactive Programming. Numeric targets fall from the top of the screen toward a check line; the player must set an 8-bit binary answer that matches each target's value before it arrives.

### Gameplay

- Targets spawn continuously, each at a random value and a random horizontal position, with a random 1–3 second delay between spawns.
- More than one target can be falling at once. Only the lowest (closest to the check line) target is ever compared against the player's answer. Targets above it are ignored until it's resolved.
- he player's answer is an 8-digit binary number (`digitBank`), toggled bit by bit via keyboard (keys 1–8) or mouse (clicking a digit box).
- If the lowest target reaches the check line and the player's answer matches its value, it's cleared and the score increases by one. If it doesn't match, a life is lost (starting from 3); the game ends once all lives are gone.
- Fall speed starts at a fixed base speed and increases gradually the longer the game runs, so difficulty ramps up over a session rather than staying constant.

### Controls

| Input                        | Effect                                                        |
|-------------------------------|----------------------------------------------------------------|
| `1`–`8` (or click a digit box) | Toggle the corresponding bit                                  |
| `R`                           | Restart the game at any time, no page refresh needed          |
| `P` (or click Pause/Resume)   | Pause/resume the game                                          |
| `H`                           | Toggle a hint showing the current decimal value of your answer |
| Base slider                  | Switch the falling targets' displayed number base (binary/octal/hex) |

### Design decisions

- Pause freezes target movement and spawning, but digit toggling still works while paused, so the player can adjust their answer while thinking, rather than the pause being a total input freeze.
- Base display is a purely visual setting. Internally, every target's value and the player's answer are always compared as plain numbers regardless of display base.  Switching base mid-game only changes how the number is printed.
- Health/lives replace an instant game-over on the first miss, giving the player some room for error rather than ending the run on a single mistake.
- State is managed entirely through a single scan(reduceState, initialState) fold over a merged stream of all input sources (keyboard, mouse, game clock). Every game update, whatever triggered it, goes through the same pure reduceState function, keeping all state transitions centralized and side-effect-free. Rendering is the only place side effects (DOM mutation) occur.

-----

## Usage

Setup (requires node.js):

```bash
> npm install
```

Start tests:

```bash
> npm test
```

Serve up the App (and ctrl-click the URL that appears in the console)

```bash
> npm run dev
```

To format your code, for the assignment specifications:

```bash
npx prettier . --write
```

The configuration for this is set in `.prettierrc.json`. Feel free to change this to your heart's desire, but try to ensure it still fits the assignment guidelines.

If you are using VS Code, you can also install the [Prettier extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode). This skeleton code is set up to automatically format your code on save. You can disable this in `.vscode/settings.json` by changing `"editor.formatOnSave": true` to `"editor.formatOnSave": false`.

## Implementing features

There are a few files you may wish to modify. The rest should **not** be modified as they are used for configuring the build.

`src/main.ts`

- Code file used as the entry point
- Most of your game logic should go here
- Contains main function that is called on page load

`src/style.css`

- Stylesheet
- You may edit this if you wish

`index.html`

- Main html file
- Contains scaffold of game window and some sample shapes
- Feel free to add to this, but avoid changing the existing code, especially the `id` fields

`test/*.test.ts`

- If you want to add tests, these go here
- Uses [`vitest`](https://vitest.dev/api/)

We expect the core logic of your game to be in `src/main.ts`, however, you may elect to spread your code over multiple files. In this case, please use [TS Modules](https://www.typescriptlang.org/docs/handbook/modules.html).

Avoid separating code into too many files as it makes it hard to mark. The maximum recommended code file structure would be something like

```
src/
  main.ts        -- main code logic inc. core game loop
  types.ts       -- common types and type aliases
  util.ts        -- util functions
  state.ts       -- state processing and transformation
  view.ts        -- rendering
  observable.ts  -- functions to create Observable streams
```
