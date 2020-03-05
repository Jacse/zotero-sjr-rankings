module.exports = {
  parserOptions: {
    ecmaVersion: 2017
  },
  globals: {
    Zotero: 'writable',
    ZoteroPane: 'readable',
  },
  env: {
    es6: true,
    browser: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended",
  ]
};