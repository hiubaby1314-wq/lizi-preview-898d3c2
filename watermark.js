/**
 * watermark.js - Diagonal repeating watermark for image uploads
 * Uses sharp to overlay a 3% opacity diagonal "栗子素材" watermark
 */
const sharp = require('sharp');

/**
 * Generate a tiled diagonal watermark SVG buffer
 * @param {number} width - target image width
 * @param {number} height - target image height
 * @returns {Buffer} PNG buffer of the watermark overlay
 */
function generateWatermarkSVG(width, height) {
  const text = '栗子素材网';
  const fontSize = 64;
  const angle = -30;
  const spacingX = 480;
  const spacingY = 240;

  // Generate repeated watermark text positions covering the image
  // We need extra coverage because of rotation, so extend beyond bounds
  const diag = Math.sqrt(width * width + height * height);
  const offsetX = -diag / 2;
  const offsetY = -diag / 2;
  const coverW = diag * 2;
  const coverH = diag * 2;

  let textElements = '';
  for (let y = offsetY; y < offsetY + coverH; y += spacingY) {
    for (let x = offsetX; x < offsetX + coverW; x += spacingX) {
      textElements += `<text x="${x}" y="${y}" font-size="${fontSize}" fill="rgba(0,0,0,0.03)" font-family="'Noto Sans CJK SC Black', 'Noto Sans CJK SC', sans-serif" font-weight="900" transform="rotate(${angle} ${x} ${y})">${text}</text>\n`;
    }
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${width/2}, ${height/2}) rotate(${angle}) translate(${-width/2}, ${-height/2})">
    ${textElements}
  </g>
</svg>`;

  return Buffer.from(svg);
}

/**
 * Apply watermark to an image buffer
 * @param {Buffer} imageBuffer - original image buffer
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<Buffer>} watermarked image buffer
 */
async function applyWatermark(imageBuffer, mimeType) {
  try {
    // Only watermark raster images (not GIF to avoid breaking animation)
    if (mimeType === 'image/gif') {
      return imageBuffer;
    }
    if (!mimeType || !mimeType.startsWith('image/')) {
      return imageBuffer;
    }

    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    if (!width || !height) return imageBuffer;

    // Generate watermark overlay
    const wmSvg = generateWatermarkSVG(width, height);

    const wmBuffer = await sharp(wmSvg, { density: 150 })
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer();

    // Composite watermark onto original
    let output = sharp(imageBuffer);

    // Preserve original format
    if (mimeType === 'image/png') {
      output = output.composite([{ input: wmBuffer, blend: 'over' }]).png();
    } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      output = output.composite([{ input: wmBuffer, blend: 'over' }]).jpeg({ quality: 90 });
    } else if (mimeType === 'image/webp') {
      output = output.composite([{ input: wmBuffer, blend: 'over' }]).webp({ quality: 90 });
    } else {
      // Default: try PNG
      output = output.composite([{ input: wmBuffer, blend: 'over' }]).png();
    }

    return await output.toBuffer();
  } catch (err) {
    console.error('[Watermark] Error applying watermark:', err.message);
    // Return original on failure
    return imageBuffer;
  }
}

module.exports = { applyWatermark };
