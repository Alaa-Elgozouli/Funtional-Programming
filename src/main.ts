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
    catchError,
    filter,
    fromEvent,
    interval,
    map,
    scan,
    switchMap,
    take,
    merge,
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
    | Readonly<{ type: "TICK" }>;

const MIN_SPAWN_DELAY_MS = 1000;
const MAX_SPAWN_DELAY_MS = 3000;

const randomSpawnDelayTicks = (): number => {
        const delayMs = MIN_SPAWN_DELAY_MS + Math.random() * (MAX_SPAWN_DELAY_MS - MIN_SPAWN_DELAY_MS);
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
}>;

const initialState: State = {
    digitBank: [0, 0, 0, 0, 0, 0, 0, 0],
    allCurrentTargetsInPlay: [],
    healthReserve: 3,
    score: 0,
    gameEnd: false,
    spawnDelayTicks: randomSpawnDelayTicks(),
    nextTargetId: 0,
};

const keyToggle$: Observable<GameEvent> = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    filter(event => /^[1-8]$/.test(event.key)),
    map(event => ({ type: "TOGGLE_BIT" as const, index: Number(event.key) - 1})),
);

const gameTick$: Observable<GameEvent> = interval(Constants.TICK_RATE_MS).pipe(
    map(() => ({ type: "TICK" as const })),
);

const event$: Observable<GameEvent> = merge(
    keyToggle$,
    gameTick$,
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
        }
    };

export const state$: Observable<State> = event$.pipe(
    scan(reduceState, initialState),
)

const FALL_SPEED = 15;
const CHECK_LINE_Y = Viewport.CANVAS_HEIGHT - 50;

const randomTargetValue = (): number => Math.floor(Math.random() * 256);

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

const moveAllTargets = (targets: ReadonlyArray<FallingTargetView>): ReadonlyArray<FallingTargetView> => targets.map(t => ({
    ...t,
    y: t.y + FALL_SPEED }));

/**
 * The "lowest" unresolved target is the one furthest down the screen
 * (largest y) — that's the only one the player's digitBank is compared
 * against; others above it are ignored until it's resolved.
 */
const lowestTarget = (targets: ReadonlyArray<FallingTargetView>): FallingTargetView | undefined => targets.reduce<FallingTargetView | undefined>(
    (lowest, t) => (lowest === undefined || t.y > lowest.y ? t : lowest), undefined,
);

const resolveIfAtCheckLine = (s: State): State => {
    const target = lowestTarget(s.allCurrentTargetsInPlay);

    if (target === undefined || target.y < CHECK_LINE_Y) return s;

    const correct = digitBankToNumber(s.digitBank) === target.value;
    const remaining = s.allCurrentTargetsInPlay.filter(t => t.id !== target.id);

    return correct ? { ...s, allCurrentTargetsInPlay: remaining, score: s.score + 1} : { ...s, gameEnd: true};
};

const spawnIfDue = (s: State): State =>
    s.spawnDelayTicks > 0
    ? { ...s, spawnDelayTicks: s.spawnDelayTicks - 1}
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
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State): State => {
    if (s.gameEnd) return s;
    const moved = { ...s, allCurrentTargetsInPlay: moveAllTargets(s.allCurrentTargetsInPlay) };
    const resolved = resolveIfAtCheckLine(moved);
    return spawnIfDue(resolved);
};
// Rendering (side effects)

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
                fill: bit === 1 ? "#a5d6a7" : "#ef9a9a",
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
    };
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    state$.subscribe(render());
}
    // Observable: wait for first user click
//     const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

//     click$.pipe(switchMap(() => state$())).subscribe(render());
// } */