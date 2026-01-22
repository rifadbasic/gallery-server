const fs = require("fs");
const path = require("path");

const fontPath = path.join(__dirname, "./font/Roboto-Bold.ttf");

const fontBase64 = fs.readFileSync(fontPath).toString("base64");

module.exports = fontBase64;

// console.log("Font length:", fontBase64.length);
