module.exports = {
  parserOptions: {
    ecmaVersion: 2018
  },
  globals: {
    Zotero: 'writable',
  },
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended",
  ]
};
