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

// State processing
// every state has a digitBank
type State = Readonly<{
    digitBank: DigitBank;
    gameEnd: boolean;
}>;

type GameEvent = Readonly<{
    type: "TOGGLE_BIT";
    index: number;
}>;

const initialState: State = {
    digitBank: [0, 0, 0, 0, 0, 0, 0, 0],
    gameEnd: false,
};

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
        }
    };

const keyboard$ = fromEvent<KeyboardEvent>( document, "keydown");

const digitEvent$ = keyboard$.pipe(
    filter(event => /^[1-8]$/.test(event.key)),
    map(event => ({
        type: "TOGGLE_BIT" as const,
        index: Number(event.key) - 1,
    })),
);
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
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State) => s;

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
        // Draw a static falling target as a demonstration
        const target = createSvgElement(svg.namespaceURI, "rect", {
            x: `${Viewport.CANVAS_WIDTH / 2 - Target.WIDTH / 2}`,
            y: "40",
            width: `${Target.WIDTH}`,
            height: `${Target.HEIGHT}`,
            rx: "6",
            fill: "white",
            stroke: "black",
            "stroke-width": "2",
        });
        const targetText = createSvgElement(svg.namespaceURI, "text", {
            x: `${Viewport.CANVAS_WIDTH / 2}`,
            y: `${40 + Target.HEIGHT / 2 + 8}`,
            "text-anchor": "middle",
            "font-family": "monospace",
            fill: "black",
        });
        targetText.textContent = "13";
        svg.appendChild(target);
        svg.appendChild(targetText);

        // Draw the row of digit toggles as a demonstration
        const digitWidth = Viewport.CANVAS_WIDTH / Constants.DIGIT_COUNT;
        Array.from({ length: Constants.DIGIT_COUNT }).forEach((_, i) => {
            const bit = createSvgElement(svg.namespaceURI, "rect", {
                x: `${i * digitWidth + 4}`,
                y: `${Viewport.CANVAS_HEIGHT - 50}`,
                width: `${digitWidth - 8}`,
                height: "40",
                fill: "#ef9a9a",
                stroke: "black",
                "stroke-width": "2",
            });
            const bitText = createSvgElement(svg.namespaceURI, "text", {
                x: `${i * digitWidth + digitWidth / 2}`,
                y: `${Viewport.CANVAS_HEIGHT - 22}`,
                "text-anchor": "middle",
                "font-family": "monospace",
                fill: "black",
            });
            bitText.textContent = "0";
            svg.appendChild(bit);
            svg.appendChild(bitText);
        });
    };
};

// export const state$ = (): Observable<State> => {
//     /** Determines the rate of time steps */
//     const tick$ = interval(Constants.TICK_RATE_MS);

//     return tick$.pipe(scan((s: State) => ({ gameEnd: false }), initialState));
// };

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
// if (typeof window !== "undefined") {
//     // Observable: wait for first user click
//     const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

//     click$.pipe(switchMap(() => state$())).subscribe(render());
// }
