/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import {
    Observable,
    filter,
    fromEvent,
    interval,
    map,
    scan,
    merge,
} from "rxjs";

// ============================================================
// 1. CONSTANTS
// ============================================================

/** Fixed dimensions of the SVG game canvas. */
const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

/** Fixed dimensions of a falling target box. */
const Target = {
    WIDTH: 64,
    HEIGHT: 36,
} as const;

/** Game-wide constants: how many digits the player controls, and the game clock rate. */
const Constants = {
    DIGIT_COUNT: 8,
    TICK_RATE_MS: 500,
} as const;

/** How fast targets fall at the very start of the game (tick 0), in px/tick. */
const BASE_FALL_SPEED = 12;

/** How much extra px/tick is added per tick elapsed — compounds gradually over time. */
const SPEED_INCREASE_PER_TICK = 0.02;

/** The y-coordinate targets must reach before they're checked against the player's answer. */
const CHECK_LINE_Y = Viewport.CANVAS_HEIGHT - 50;

/** Random spawn delay range, per spec: 1-3 seconds between targets. */
const MIN_SPAWN_DELAY_MS = 1000;
const MAX_SPAWN_DELAY_MS = 3000;

/** The three bases the player can switch the display to, indexed by the HTML slider's value. */
const BASE_OPTIONS = [2, 8, 16] as const;

// ============================================================
// 2. TYPES
// ============================================================

/** The player's current answer: 8 bits, each 0 or 1. */
type DigitBank = ReadonlyArray<number>;

/** A single falling target as tracked in game state. */
type FallingTargetView = Readonly<{
    id: number; // unique, never reused - lets us remove a specific target from the array
    value: number; // the value the player must match (compared in plain decimal)
    x: number; // horizontal position, fixed at spawn
    y: number; // current vertical position, updated every tick
}>;

/**
 * Every possible event that can change game state. Each variant is tagged
 * with a unique `type` string, letting reduceState's switch narrow to the
 * right shape (and the fields it carries) for each case.
 */
type GameEvent =
    | Readonly<{ type: "TOGGLE_BIT"; index: number }>
    | Readonly<{ type: "TICK" }>
    | Readonly<{ type: "RESTART" }>
    | Readonly<{ type: "TOGGLE_HINT" }>
    | Readonly<{ type: "TOGGLE_PAUSE" }>
    | Readonly<{ type: "SET_BASE"; base: number }>;

/** The single source of truth for the whole game at any point in time. */
type State = Readonly<{
    digitBank: DigitBank;
    allCurrentTargetsInPlay: ReadonlyArray<FallingTargetView>;
    healthReserve: number; // lives remaining; game ends when this hits 0
    score: number; // 1 point per correctly matched target
    gameEnd: boolean;
    spawnDelayTicks: number; // countdown until the next target spawns
    nextTargetId: number; // ensures every spawned target gets a unique id
    ticksElapsed: number; // how many TICK events have occurred since the game/restart began
    showHint: boolean; // whether the "current value" debug hint is visible
    isPaused: boolean; // when true, tick() does nothing except respect digit toggles
    displayBase: number; // 2, 8, or 16 - purely how target values are shown, not compared
}>;

// ============================================================
// 3. INITIAL STATE
// ============================================================

const initialState: State = {
    digitBank: [0, 0, 0, 0, 0, 0, 0, 0],
    allCurrentTargetsInPlay: [],
    healthReserve: 3,
    score: 0,
    gameEnd: false,
    spawnDelayTicks: randomSpawnDelayTicks(),
    nextTargetId: 0,
    ticksElapsed: 0,
    showHint: false,
    isPaused: false,
    displayBase: 16,
};

// ============================================================
// 4. PURE GAME LOGIC
//    (no DOM access, no Observable - just State/values in, State/values out)
// ============================================================

/**
 * Toggles a single bit in the digit bank based on the player's request.
 *
 * @param digitBank current 8-bit answer
 * @param index which bit to flip (0-7)
 * @returns a new DigitBank with that bit flipped
 */
const toggleDigit = (digitBank: DigitBank, index: number): DigitBank =>
    digitBank.map((digit, i) => (i === index ? 1 - digit : digit));

/**
 * Interprets the digit bank as an 8-bit binary number and returns its
 * decimal value, for comparison against a falling target's value.
 *
 * @param digitBank current player answer, index 0 = most significant bit
 * @returns decimal value represented by the bits
 */
const digitBankToNumber = (digitBank: DigitBank): number =>
    digitBank.reduce((acc, bit) => acc * 2 + bit, 0);

/**
 * Generates a random target value (0-255, fits in 8 bits).
 * Math.random() is an accepted, standard exception to purity for
 * randomness in FP - noted here rather than hidden.
 */
const randomTargetValue = (): number => Math.floor(Math.random() * 256);

/**
 * Generates a random delay (in whole ticks) before the next target spawns,
 * within the spec's 1-3 second window.
 */
function randomSpawnDelayTicks(): number {
    const delayMs =
        MIN_SPAWN_DELAY_MS +
        Math.random() * (MAX_SPAWN_DELAY_MS - MIN_SPAWN_DELAY_MS);
    return Math.ceil(delayMs / Constants.TICK_RATE_MS);
}

/**
 * Current fall speed, derived fresh from how many ticks have elapsed.
 * Speed is never stored directly in State - always computed from
 * ticksElapsed, so there's nothing that can fall out of sync.
 *
 * @param ticksElapsed number of ticks since the game/restart began
 * @returns current fall speed in px/tick
 */
const currentFallSpeed = (ticksElapsed: number): number =>
    BASE_FALL_SPEED + ticksElapsed * SPEED_INCREASE_PER_TICK;

/**
 * Moves every falling target down by the given speed.
 *
 * @param targets all targets currently in play
 * @param speed px to move each target down this tick
 */
const moveAllTargets = (
    targets: ReadonlyArray<FallingTargetView>,
    speed: number,
): ReadonlyArray<FallingTargetView> =>
    targets.map(t => ({ ...t, y: t.y + speed }));

/**
 * The "lowest" unresolved target is the one furthest down the screen
 * (largest y) - that's the only one the player's digitBank is compared
 * against; others above it are ignored until it's resolved or lost.
 */
const lowestTarget = (
    targets: ReadonlyArray<FallingTargetView>,
): FallingTargetView | undefined =>
    targets.reduce<FallingTargetView | undefined>(
        (lowest, t) => (lowest === undefined || t.y > lowest.y ? t : lowest),
        undefined,
    );

/**
 * Handles a missed target: loses a life, and only ends the game once
 * healthReserve reaches 0 (rather than ending on the very first miss).
 */
const resolveMiss = (
    s: State,
    remaining: ReadonlyArray<FallingTargetView>,
): State => {
    const healthRemaining = s.healthReserve - 1;

    return healthRemaining <= 0
        ? { ...s, allCurrentTargetsInPlay: remaining, healthReserve: 0, gameEnd: true }
        : { ...s, allCurrentTargetsInPlay: remaining, healthReserve: healthRemaining };
};

/**
 * Checks whether the lowest target has reached the check line, and if so,
 * resolves it: correct match scores a point and removes it; a miss costs
 * a life via resolveMiss. Targets still above the line are left untouched.
 */
const resolveIfAtCheckLine = (s: State): State => {
    const target = lowestTarget(s.allCurrentTargetsInPlay);

    // nothing to resolve: no target in play, or the lowest hasn't arrived yet
    if (target === undefined || target.y < CHECK_LINE_Y) return s;

    const correct = digitBankToNumber(s.digitBank) === target.value;
    const remaining = s.allCurrentTargetsInPlay.filter(t => t.id !== target.id);

    return correct
        ? { ...s, allCurrentTargetsInPlay: remaining, score: s.score + 1 }
        : resolveMiss(s, remaining);
};

/**
 * Decrements the spawn countdown, or - once it reaches zero - spawns a
 * fresh target at a random x position and resets the countdown for the
 * next spawn. Spawning is independent of how many targets are already
 * falling, which is what allows several to be in play at once.
 */
const spawnIfDue = (s: State): State =>
    s.spawnDelayTicks > 0
        ? { ...s, spawnDelayTicks: s.spawnDelayTicks - 1 }
        : {
              ...s,
              allCurrentTargetsInPlay: [
                  ...s.allCurrentTargetsInPlay,
                  {
                      id: s.nextTargetId,
                      value: randomTargetValue(),
                      x: Math.random() * (Viewport.CANVAS_WIDTH - Target.WIDTH),
                      y: 0,
                  },
              ],
              nextTargetId: s.nextTargetId + 1,
              spawnDelayTicks: randomSpawnDelayTicks(),
          };

/**
 * Advances the game by one time step: moves targets, resolves the lowest
 * one if it's reached the check line, then spawns a new target if due.
 * Does nothing if the game has ended or is paused.
 *
 * @param s current state
 * @returns updated state after one tick
 */
const tick = (s: State): State => {
    if (s.gameEnd || s.isPaused) return s;

    const speed = currentFallSpeed(s.ticksElapsed);

    // "moved": state after targets have fallen, before resolving/spawning
    const moved = {
        ...s,
        allCurrentTargetsInPlay: moveAllTargets(s.allCurrentTargetsInPlay, speed),
        ticksElapsed: s.ticksElapsed + 1,
    };
    const resolved = resolveIfAtCheckLine(moved);
    return spawnIfDue(resolved);
};

/**
 * Folds one GameEvent into the current State, producing the next State.
 * This is the single place every kind of event gets turned into a state
 * change - scan() calls this once per event emitted by event$.
 */
const reduceState = (state: State, event: GameEvent): State => {
    switch (event.type) {
        case "TOGGLE_BIT":
            return {
                ...state,
                digitBank: toggleDigit(state.digitBank, event.index),
            };
        case "TICK":
            return tick(state);
        case "RESTART":
            return { ...initialState, spawnDelayTicks: randomSpawnDelayTicks() };
        case "TOGGLE_HINT":
            return { ...state, showHint: !state.showHint };
        case "TOGGLE_PAUSE":
            return { ...state, isPaused: !state.isPaused };
        case "SET_BASE":
            return { ...state, displayBase: event.base };
    }
};

// ============================================================
// 5. EVENT STREAMS
//    (RxJS - turning raw browser input into GameEvents)
// ============================================================

/** Keyboard: digit keys 1-8 toggle the corresponding bit. */
const keyToggle$: Observable<GameEvent> = fromEvent<KeyboardEvent>(
    document,
    "keydown",
).pipe(
    filter(event => /^[1-8]$/.test(event.key)),
    map(event => ({ type: "TOGGLE_BIT" as const, index: Number(event.key) - 1 })),
);

/** Game clock: emits a TICK every TICK_RATE_MS, driving all time-based logic. */
const gameTick$: Observable<GameEvent> = interval(Constants.TICK_RATE_MS).pipe(
    map(() => ({ type: "TICK" as const })),
);

/** Keyboard: R restarts the game at any time, without a page refresh. */
const restart$: Observable<GameEvent> = fromEvent<KeyboardEvent>(
    document,
    "keydown",
).pipe(
    filter(event => event.key.toLowerCase() === "r"),
    map(() => ({ type: "RESTART" as const })),
);

/** Keyboard: H toggles the "current value" hint on/off. */
const toggleHint$: Observable<GameEvent> = fromEvent<KeyboardEvent>(
    document,
    "keydown",
).pipe(
    filter(event => event.key.toLowerCase() === "h"),
    map(() => ({ type: "TOGGLE_HINT" as const })),
);

/** Keyboard: P toggles pause on/off. */
const togglePauseKey$: Observable<GameEvent> = fromEvent<KeyboardEvent>(
    document,
    "keydown",
).pipe(
    filter(event => event.key.toLowerCase() === "p"),
    map(() => ({ type: "TOGGLE_PAUSE" as const })),
);

/**
 * Mouse: clicking a digit box toggles that bit. Uses event delegation -
 * listens on the whole <svg> (which persists across frames) rather than
 * individual boxes (which are destroyed/recreated every render), and
 * reads which box was clicked via its data-fb-bit-index attribute.
 */
const digitClick$: Observable<GameEvent> = fromEvent<MouseEvent>(
    document.querySelector("#svgCanvas") as SVGSVGElement,
    "click",
).pipe(
    map(event => (event.target as SVGElement).getAttribute("data-fb-bit-index")),
    filter((index): index is string => index !== null),
    map(index => ({ type: "TOGGLE_BIT" as const, index: Number(index) })),
);

/**
 * Mouse: clicking the pause button toggles pause. Same delegation
 * pattern as digitClick$, using data-fb-pause-button instead.
 */
const pauseButtonClick$: Observable<GameEvent> = fromEvent<MouseEvent>(
    document.querySelector("#svgCanvas") as SVGSVGElement,
    "click",
).pipe(
    map(event => (event.target as SVGElement).getAttribute("data-fb-pause-button")),
    filter((clicked): clicked is string => clicked !== null),
    map(() => ({ type: "TOGGLE_PAUSE" as const })),
);

/** The HTML range slider (#baseSlider) sets the display base: 0=binary, 1=octal, 2=hex. */
const baseSlider$: Observable<GameEvent> = fromEvent<Event>(
    document.querySelector("#baseSlider") as HTMLInputElement,
    "input",
).pipe(
    map(event => {
        const sliderIndex = Number((event.target as HTMLInputElement).value);
        return { type: "SET_BASE" as const, base: BASE_OPTIONS[sliderIndex] };
    }),
);

/**
 * Every independent source of change in the game, merged into one stream.
 * merge() combines them in real chronological order, so scan() can fold
 * them all through the same reduceState regardless of where they came from.
 */
const event$: Observable<GameEvent> = merge(
    keyToggle$,
    gameTick$,
    restart$,
    toggleHint$,
    togglePauseKey$,
    digitClick$,
    pauseButtonClick$,
    baseSlider$,
);

// ============================================================
// 6. STATE STREAM
// ============================================================

/**
 * The single source of truth for game state over time: folds every event
 * from event$ through reduceState, starting from initialState, emitting
 * the updated State after each event. Wrapped as a function (rather than
 * exported directly as an Observable) to match the shape expected by
 * test/main.test.ts.
 */
export const state$ = (): Observable<State> =>
    event$.pipe(scan(reduceState, initialState));

// ============================================================
// 7. RENDERING
//    (side effects - the only place DOM mutation is allowed)
// ============================================================

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * One-time setup (grabs the SVG element, sets its viewBox), then returns
 * the actual per-frame render function bound to that element via closure.
 *
 * In MVC terms, the returned function updates the View from the Model.
 */
const render = (): ((s: State) => void) => {
    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );

    return (s: State) => {
        // clear everything from the previous frame before drawing the new one
        svg.replaceChildren();

        // falling targets, labelled in the player's chosen display base
        s.allCurrentTargetsInPlay.forEach(target => {
            const rect = createSvgElement(svg.namespaceURI, "rect", {
                x: `${target.x}`,
                y: `${target.y}`,
                width: `${Target.WIDTH}`,
                height: `${Target.HEIGHT}`,
                rx: "6",
                fill: "white",
                stroke: "black",
                "stroke-width": "2",
                "data-fb-target-id": `${target.id}`,
            });
            const targetText = createSvgElement(svg.namespaceURI, "text", {
                x: `${target.x + Target.WIDTH / 2}`,
                y: `${target.y + Target.HEIGHT / 2 + 8}`,
                "text-anchor": "middle",
                "font-family": "monospace",
                fill: "black",
            });
            targetText.textContent = target.value.toString(s.displayBase).toUpperCase();
            svg.appendChild(rect);
            svg.appendChild(targetText);
        });

        // row of digit toggles, reflecting the actual digitBank and clickable
        const digitWidth = Viewport.CANVAS_WIDTH / Constants.DIGIT_COUNT;
        s.digitBank.forEach((bit, i) => {
            const box = createSvgElement(svg.namespaceURI, "rect", {
                x: `${i * digitWidth + 4}`,
                y: `${Viewport.CANVAS_HEIGHT - 50}`,
                width: `${digitWidth - 8}`,
                height: "40",
                fill: bit === 1 ? "#A5D6A7" : "#EF9A9A",
                stroke: "black",
                "stroke-width": "2",
                "data-fb-bit-index": `${i}`,
            });
            const bitText = createSvgElement(svg.namespaceURI, "text", {
                x: `${i * digitWidth + digitWidth / 2}`,
                y: `${Viewport.CANVAS_HEIGHT - 22}`,
                "text-anchor": "middle",
                "font-family": "monospace",
                fill: "black",
            });
            bitText.textContent = `${bit}`;
            svg.appendChild(box);
            svg.appendChild(bitText);
        });

        // HUD: score, lives, current display base (top-left)
        const scoreText = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: "20",
            "font-family": "monospace",
            "font-size": "16",
            fill: "black",
        });
        scoreText.textContent = `Score: ${s.score}`;
        svg.appendChild(scoreText);

        const livesText = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: "40",
            "font-family": "monospace",
            "font-size": "16",
            fill: "black",
        });
        livesText.textContent = `Lives: ${s.healthReserve}`;
        svg.appendChild(livesText);

        const baseLabel = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: "60",
            "font-family": "monospace",
            "font-size": "13",
            fill: "black",
        });
        baseLabel.textContent = `Base: ${s.displayBase}`;
        svg.appendChild(baseLabel);

        // restart instructions (top-right)
        const restartPrompt = createSvgElement(svg.namespaceURI, "text", {
            x: `${Viewport.CANVAS_WIDTH - 10}`,
            y: "20",
            "text-anchor": "end",
            "font-family": "monospace",
            "font-size": "14",
            fill: "blue",
        });
        restartPrompt.textContent = "Press R to restart";
        svg.appendChild(restartPrompt);

        // hint prompt + optional hint value (bottom-left, above the digit row)
        const hintPrompt = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: `${Viewport.CANVAS_HEIGHT - 80}`,
            "font-family": "monospace",
            "font-size": "14",
            fill: "blue",
        });
        hintPrompt.textContent = "Press H for hint";
        svg.appendChild(hintPrompt);

        if (s.showHint) {
            const hintValueText = createSvgElement(svg.namespaceURI, "text", {
                x: "10",
                y: `${Viewport.CANVAS_HEIGHT - 60}`,
                "font-family": "monospace",
                "font-size": "14",
                fill: "blue",
            });
            hintValueText.textContent = `Current Value: ${digitBankToNumber(s.digitBank)}`;
            svg.appendChild(hintValueText);
        }

        // pause button (top-centre) - clickable rect + label, both tagged
        // with data-fb-pause-button so a click on either registers
        const pauseButton = createSvgElement(svg.namespaceURI, "rect", {
            x: `${Viewport.CANVAS_WIDTH / 2 - 30}`,
            y: "5",
            width: "60",
            height: "24",
            rx: "4",
            fill: "#E0E0E0",
            stroke: "black",
            "stroke-width": "1",
            "data-fb-pause-button": "true",
        });
        const pauseButtonText = createSvgElement(svg.namespaceURI, "text", {
            x: `${Viewport.CANVAS_WIDTH / 2}`,
            y: "21",
            "text-anchor": "middle",
            "font-family": "monospace",
            "font-size": "12",
            fill: "black",
            "data-fb-pause-button": "true",
        });
        pauseButtonText.textContent = s.isPaused ? "Resume" : "Pause";
        svg.appendChild(pauseButton);
        svg.appendChild(pauseButtonText);

        // pause overlay (only while paused and not already game over)
        if (s.isPaused && !s.gameEnd) {
            const pausedText = createSvgElement(svg.namespaceURI, "text", {
                x: `${Viewport.CANVAS_WIDTH / 2}`,
                y: `${Viewport.CANVAS_HEIGHT / 2}`,
                "text-anchor": "middle",
                "font-family": "monospace",
                "font-size": "24",
                fill: "black",
            });
            pausedText.textContent = "PAUSED";
            svg.appendChild(pausedText);
        }
    };
};

// ============================================================
// 8. ENTRY POINT
// ============================================================

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    state$().subscribe(render());
}