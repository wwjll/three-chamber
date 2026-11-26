/**
 * Returns the pixel rectangle of one tile in a `tilesX` × `tilesY` grid over a
 * `width` × `height` render target. Tiles run left to right and top to bottom;
 * the rectangle uses the WebGL bottom-left origin, so the first tile sits at
 * the top-left of the image. Boundaries are floored fractions of the full
 * size, so the tiles cover every pixel exactly once even when the size is not
 * a multiple of the tile count.
 */
function getTileRect(index, tilesX, tilesY, width, height) {
    const column = index % tilesX;
    const row = tilesY - 1 - Math.floor(index / tilesX);
    const x0 = Math.floor(column * width / tilesX);
    const x1 = Math.floor((column + 1) * width / tilesX);
    const y0 = Math.floor(row * height / tilesY);
    const y1 = Math.floor((row + 1) * height / tilesY);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export { getTileRect };
