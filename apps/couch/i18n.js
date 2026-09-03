const { readFileSync } = require('fs');
const path = require('path');
const SUPPORTED = ['en', 'pt_BR'];

module.exports = function loadStrings(lang) {
  const l = SUPPORTED.includes(lang) ? lang : 'en';
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'locales', `${l}.json`), 'utf8'));
  } catch {
    return JSON.parse(readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf8'));
  }
};
