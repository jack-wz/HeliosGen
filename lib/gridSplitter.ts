/**
 * Split an image into a rows x cols grid of cells (canvas-based).
 * Lean port of node-banana (MIT) src/utils/gridSplitter.ts — manual
 * dimensions only; the auto-detection scorer is not ported.
 */

export interface GridCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridResult {
  rows: number;
  cols: number;
  cells: GridCell[];
}

/**
 * Pixel boundaries [0, ..., size] for count slices along one axis.
 * Rounding to whole pixels keeps adjacent cells perfectly tiled.
 */
function pixelBoundaries(size: number, count: number): number[] {
  const interior = Array.from({ length: Math.max(0, count - 1) }, (_, i) => (i + 1) / count);
  return [0, ...interior.map((o) => Math.round(o * size)), size];
}

export function createGridForDimensions(
  width: number,
  height: number,
  rows: number,
  cols: number,
): GridResult {
  const xs = pixelBoundaries(width, cols);
  const ys = pixelBoundaries(height, rows);
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: xs[col],
        y: ys[row],
        width: xs[col + 1] - xs[col],
        height: ys[row + 1] - ys[row],
      });
    }
  }
  return { rows, cols, cells };
}

/** Splits an image into grid cells, returned as PNG data URLs (row-major). */
export async function splitWithDimensions(
  imageDataUrl: string,
  rows: number,
  cols: number,
): Promise<{ grid: GridResult; images: string[] }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load image"));
    el.src = imageDataUrl;
  });

  const grid = createGridForDimensions(img.naturalWidth, img.naturalHeight, rows, cols);
  const images: string[] = [];
  for (const cell of grid.cells) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2d context");
    canvas.width = cell.width;
    canvas.height = cell.height;
    ctx.drawImage(img, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height);
    images.push(canvas.toDataURL("image/png"));
  }
  return { grid, images };
}
