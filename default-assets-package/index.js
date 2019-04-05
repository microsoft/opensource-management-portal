// Return the path to this file as the only entrypoint for this

const path = require('path');
const distPath = path.join(__dirname, 'public');

module.exports = distPath;
