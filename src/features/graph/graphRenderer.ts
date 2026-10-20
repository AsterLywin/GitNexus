import {
  GraphRenderEdge,
  GraphRenderNode,
  getRenderWindow
} from "./graphModel";
import { GraphVirtualRenderer } from "./graphVirtualRenderer";

export const GRAPH_ROW_HEIGHT = 44;
export const GRAPH_LANE_WIDTH = 28;

export interface GraphModel {
  nodes: GraphRenderNode[];
  edges: GraphRenderEdge[];
}

export interface RenderedWindow {
  svg: string;
  startRow: number;
  endRow: number;
}

/**
 * Render one window of the graph through the virtual renderer — the only
 * rendering path the live panel uses. Windows are row ranges of the
 * render model; the panel swaps them as the user scrolls, so DOM size
 * stays bounded regardless of history length.
 */
export function renderGraphWindowSvg(
  model: GraphModel,
  startRow: number,
  endRow: number,
  selectedId?: string
): RenderedWindow {
  const window = getRenderWindow(model, startRow, endRow);
  const renderer = new GraphVirtualRenderer(GRAPH_ROW_HEIGHT, GRAPH_LANE_WIDTH);
  return {
    svg: renderer.render(window, selectedId),
    startRow: window.startRow,
    endRow: window.endRow
  };
}
