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

// men with hats

// import { stat } from "fs";
import { G } from "vitest/dist/chunks/reporters.d.BFLkQcL6.js";
import "./style.css";

import {
    Observable,
    catchError,
    filter,
    fromEvent,
    interval,
    map,
    scan,
    switchMap,
    take,
    merge,
    from,
} from "rxjs";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const Target = {
    WIDTH: 64,
    HEIGHT: 36,
} as const;

const Constants = {
    DIGIT_COUNT: 8,
    TICK_RATE_MS: 500, // Might need to change this!
} as const;

// creating a type called DigitBank, holding an array of numbers
type DigitBank = ReadonlyArray<number>;

type FallingTargetView = Readonly<{
    id: number;
    value: number;  // the base-16 value the player must match
    x: number;
    y: number;  // current vertical position
}>;

type GameEvent =
    | Readonly<{ type : "TOGGLE_BIT"; index: number }>
    | Readonly<{ type: "TICK" }>
    | Readonly<{ type: "RESTART" }>
    | Readonly<{ type: "TOGGLE_HINT" }>
    | Readonly<{ type: "TOGGLE_PAUSE" }>;

const MIN_SPAWN_DELAY_MS = 1000;
const MAX_SPAWN_DELAY_MS = 3000;

/**
 *
 * @returns
 */
const randomSpawnDelayTicks = (): number => {
    // generating a random delay between 1000 and 3000
    const delayMs = MIN_SPAWN_DELAY_MS + Math.random() * (MAX_SPAWN_DELAY_MS - MIN_SPAWN_DELAY_MS);

    // converts milliseconds into a whole number of ticks
    return Math.ceil(delayMs / Constants.TICK_RATE_MS);
}

// State processing
// every state has a digitBank
type State = Readonly<{
    digitBank: DigitBank;
    allCurrentTargetsInPlay: ReadonlyArray<FallingTargetView>;
    healthReserve: number;
    score: number;
    gameEnd: boolean;
    spawnDelayTicks: number;
    nextTargetId: number;
    ticksElapsed: number;   // tracks how long the game's been running through checking how many tick events have occurred
    showHint: boolean;
    isPaused: boolean;
}>;

const BASE_FALL_SPEED = 3;  // how fast targets fall at the start of the game (tick 0)
const SPEED_INCREASE_PER_TICK = 0.02;   // compounds over time gradually, this is the extra pixels-per-tick

/**
 * A pure function in the form of a constant, takes tickElapsed as an arg and returns a number.
 * It increases gradually the longer the game has been running. It ensures that speed is always derived fresh from ticksElapsed.
 * @param tickElapsed: number of ticks since the game has started
 * @returns current speed
 */
const currentFallSpeed = (tickElapsed: number): number =>
    BASE_FALL_SPEED + tickElapsed * SPEED_INCREASE_PER_TICK;

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
};

const toggleHint$: Observable<GameEvent> = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    filter(event => event.key.toLowerCase() === "h"),
    map(() => ({ type: "TOGGLE_HINT" as const})),
);

const keyToggle$: Observable<GameEvent> = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    filter(event => /^[1-8]$/.test(event.key)),
    map(event => ({ type: "TOGGLE_BIT" as const, index: Number(event.key) - 1})),
);

const togglePauseKey$: Observable<GameEvent> = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    filter(event => event.key.toLowerCase() === "p"),
    map(() => ({ type: "TOGGLE_PAUSE" as const })),
);

const pauseButtonClick$: Observable<GameEvent> = fromEvent<MouseEvent>(document.querySelector("#svgCanvas") as SVGSVGElement, "click").pipe(
    map(event => (event.target as SVGAElement).getAttribute("data-fb-pause-button")),
    filter((clicked): clicked is string => clicked !== null),
    map(() => ({ type: "TOGGLE_PAUSE" as const })),
);

const gameTick$: Observable<GameEvent> = interval(Constants.TICK_RATE_MS).pipe(
    map(() => ({ type: "TICK" as const })),
);

const restart$: Observable<GameEvent> = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    filter(event => event.key.toLowerCase() === "r"),
    map(() => ({ type: "RESTART" as const })),
);

const digitClick$: Observable<GameEvent> = fromEvent<MouseEvent>(document.querySelector("#svgCanvas") as SVGSVGElement, "click",).pipe(     // listens for click event on the <svg> element itself rather than individual boxes
    // click on box gives string from "0" to "7" (index wise), otherwise it'll be null
    map(event => (event.target as SVGElement).getAttribute("data-fb-bit-index")),
    filter((index): index is string => index != null),
    //converts the string into a real `GameEvent`
    map(index => ({ type: "TOGGLE_BIT" as const, index: Number(index) })),
);

const event$: Observable<GameEvent> = merge(
    keyToggle$,
    gameTick$,
    restart$,
    toggleHint$,
    digitClick$,
    pauseButtonClick$,
    togglePauseKey$,
);

const reduceState = (
    state: State,
    event: GameEvent): State => {
        switch(event.type) {
            case "TOGGLE_BIT":
                return {
                    ...state,
                    digitBank: toggleDigit(
                        state.digitBank,
                        event.index
                    ),
                };
            case "TICK":
                return tick(state);

            case "RESTART":
                return {
                    ...initialState,
                    spawnDelayTicks: randomSpawnDelayTicks() };

            case "TOGGLE_HINT":
                return {
                    ...state,
                    showHint: !state.showHint };

            case "TOGGLE_PAUSE":
                return {
                    ...state,
                    isPaused: !state.isPaused
                };
        };
    };

export const state$ = (): Observable<State> =>
    event$.pipe(scan(reduceState, initialState));

const CHECK_LINE_Y = Viewport.CANVAS_HEIGHT - 50;

const randomTargetValue = (): number => Math.floor(Math.random() * 256);

// converts player's 8-bit to a decimal number
const digitBankToNumber = (digitBank: DigitBank): number => digitBank.reduce((acc, bit) => acc * 2 + bit, 0);

/**
 * Toggles the digit bank based on user's request
 *
 * @param digitBank
 * @param index
 * @returns DigitBank
 */
const toggleDigit = (
    digitBank: DigitBank,
    index: number
    ): DigitBank =>
        digitBank.map((digit, i) => i === index ? 1 - digit : digit);

/**
 * It updates the target speed
 * @param targets
 * @param speed
 * @returns
 */
const moveAllTargets = (
    targets: ReadonlyArray<FallingTargetView>,
    speed: number,
): ReadonlyArray<FallingTargetView> =>
    targets.map(t => ({
    ...t,
    y: t.y + speed }));

/**
 * The "lowest" unresolved target is the one furthest down the screen
 * (largest y) — that's the only one the player's digitBank is compared
 * against; others above it are ignored until it's resolved.
 */
const lowestTarget = (targets: ReadonlyArray<FallingTargetView>): FallingTargetView | undefined => targets.reduce<FallingTargetView | undefined>(
    (lowest, t) => (lowest === undefined || t.y > lowest.y ? t : lowest), undefined,
);

/**
 * Handles a missed target, loses a life and ends the game only once out of lives
 */
const resolveMiss = (s: State, remaining: ReadonlyArray<FallingTargetView>): State => {
    const healthRemaining = s.healthReserve - 1;

    return healthRemaining <= 0
    ? {...s, allCurrentTargetsInPlay: remaining, healthReserve: 0, gameEnd: true}
    : {...s, allCurrentTargetsInPlay: remaining, healthReserve: healthRemaining};
}

const resolveIfAtCheckLine = (s: State): State => {

    // finds the lowest target, or undefined if none in play
    const target = lowestTarget(s.allCurrentTargetsInPlay);

    // either there's no target or there's one but hasn't reached check line yet. either way, return state unchanged
    if (target === undefined || target.y < CHECK_LINE_Y) return s;

    // target has reached line, convert the player's 8-bit to a decimal number and compare it against target value
    const correct = digitBankToNumber(s.digitBank) === target.value;

    // build a new array with that specific target removed
    const remaining = s.allCurrentTargetsInPlay.filter(t => t.id !== target.id);

    return correct
    ? { ...s, allCurrentTargetsInPlay: remaining, score: s.score + 1}
    : resolveMiss(s, remaining);
};

const spawnIfDue = (s: State): State =>
    s.spawnDelayTicks > 0
    ? { ...s, spawnDelayTicks: s.spawnDelayTicks - 1}
    : {
    ...s,
    // append a new target object at the end of the existing array
    allCurrentTargetsInPlay: [
        ...s.allCurrentTargetsInPlay,
        {
            id: s.nextTargetId,
            value: randomTargetValue(),
            x: Math.random() * (Viewport.CANVAS_WIDTH - Target.WIDTH),
            y: 0,   // starts at the top
        },
    ],
    nextTargetId: s.nextTargetId + 1,   // to ensure ids never repeat
    spawnDelayTicks: randomSpawnDelayTicks(),
};

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State): State => {
    if (s.gameEnd || s.isPaused) return s;

    const speed = currentFallSpeed(s.ticksElapsed);

    // build a new state object and overrides two fields
    // moved is the state after targets have fallen, before checking if any reached check line or any spawned a new one
    const moved = {
        ...s,
        allCurrentTargetsInPlay: moveAllTargets(s.allCurrentTargetsInPlay, speed),
        ticksElapsed: s.ticksElapsed + 1
    };
    const resolved = resolveIfAtCheckLine(moved);
    return spawnIfDue(resolved);
};

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

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

const render = (): ((s: State) => void) => {
    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,

    );
    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {

        // clear everything from the previous frame before drawing the new one
        svg.replaceChildren();

        // Draw each falling currently in play
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
        targetText.textContent = target.value.toString(16).toUpperCase();
        svg.appendChild(rect);
        svg.appendChild(targetText);
    });

        // Draw the row of digit toggles as a demonstration
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

        // score display
        const scoreText = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: "20",
            "font-family": "monospace",
            "font-size": "16",
            fill: "black",
        });
        scoreText.textContent = `Score: ${s.score}`;
        svg.appendChild(scoreText);

        // health display
        const livesText = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: "40",
            "font-family": "monospace",
            "font-size": "16",
            fill: "black",
        });
        livesText.textContent = `Lives: ${s.healthReserve}`;
        svg.appendChild(livesText);

        //restart instructions
        const restartPrompt = createSvgElement(svg.namespaceURI, "text", {
            x: `${Viewport.CANVAS_WIDTH - 10}`,
            y: "20",
            "text-anchor": "end",   // text grows leftward from x
            "font-family": "monospace",
            "font-size": "12",
            fill: "blue",
        });
        restartPrompt.textContent = "Press R to restart";
        svg.appendChild(restartPrompt);

        // hint prompt
        const hintPrompt = createSvgElement(svg.namespaceURI, "text", {
            x: "10",
            y: `${Viewport.CANVAS_HEIGHT - 80}`,
            "font-family": "monospace",
            "font-size": "12",
            fill: "blue",
        });
        hintPrompt.textContent = "Press H for hint";
        svg.appendChild(hintPrompt);

        // hint option
        if (s.showHint) {
        const debugText = createSvgElement(svg.namespaceURI, "text", {
                x: "10",
                y: `${Viewport.CANVAS_HEIGHT - 60}`,
                "font-family": "monospace",
                "font-size": "14",
                fill: "blue",
            });
            debugText.textContent = `Current Value: ${digitBankToNumber(s.digitBank)}`;
            svg.appendChild(debugText);
        }

        // pause button - clickable rect + label
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
            fill: "balck",
            "data-fb-pause-button": "true",
        });
        pauseButtonText.textContent = s.isPaused ? "Resume" : "Pause";
        svg.appendChild(pauseButton);
        svg.appendChild(pauseButtonText);

        // pause overlay
        if (s.isPaused && !s.gameEnd) {
            const pausedText = createSvgElement(svg.namespaceURI, "text", {
                x: `${Viewport.CANVAS_WIDTH / 2}`,
                y: `${Viewport.CANVAS_HEIGHT / 2}`,
                "text-anchor": "middle",
                "font-family": "monospace",
                "font-size": "24",
                fill: "black",
            });
            pausedText.textContent = "PAUSED"
            svg.appendChild(pausedText);
        }
    };
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    state$().subscribe(render());
}
    // Observable: wait for first user click
//     const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

//     click$.pipe(switchMap(() => state$())).subscribe(render());
// } */