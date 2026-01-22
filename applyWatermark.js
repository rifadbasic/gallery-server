const sharp = require("sharp");
const generateWatermarkSVG = require("./watermarkSvg");

const applyWatermark = async (imageBuffer) => {
  const metadata = await sharp(imageBuffer).metadata();
  const { width, height, format } = metadata;

  const tileSize = Math.floor(width / 4);

  const svgWatermark = generateWatermarkSVG({
    width,
    height,
    tileSize,
  });

  const watermarkedBuffer = await sharp(imageBuffer)
    .composite([
      {
        input: Buffer.from(svgWatermark),
        blend: "over", // overlay বাদ
      },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();

  return {
    watermarkedBuffer,
    metadata: {
      width,
      height,
      format,
      size: imageBuffer.length,
    },
  };
};

module.exports = applyWatermark;
