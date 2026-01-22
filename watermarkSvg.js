const fontBase64 = require("./loadFont");

const generateWatermarkSVG = ({ width, height, tileSize }) => {
  const fontSize = Math.floor(tileSize / 3);
  let svgTiles = "";

  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      svgTiles += `
        <text
          x="${x + tileSize / 2}"
          y="${y + tileSize / 2}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-size="${fontSize}"
          font-family="WatermarkFont"
          font-weight="900"
          fill="white"
          fill-opacity="0.6"
          stroke="black"
          stroke-width="2"
          stroke-opacity="0.45"
          transform="rotate(-30, ${x + tileSize / 2}, ${y + tileSize / 2})"
        >
          GALLERY
        </text>
      `;
    }
  }

  return `
<svg
  width="${width}"
  height="${height}"
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    <style>
      @font-face {
        font-family: 'WatermarkFont';
        src: url(data:font/truetype;base64,${fontBase64}) format('truetype');
      }
    </style>
  </defs>
  ${svgTiles}
</svg>
`;
};

module.exports = generateWatermarkSVG;
