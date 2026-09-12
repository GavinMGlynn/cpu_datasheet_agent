/**
 * What a chart library hands a custom bar shape.
 *
 * Every field is optional because the library calls the shape before it has
 * finished laying the chart out, and a shape that assumed otherwise would
 * throw on the first render.
 */
export interface BarShapeInput {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly value?: unknown;
}
