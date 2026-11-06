/* global Services */
/* eslint-disable no-unused-vars */
// Zotero calls these lifecycle hooks by name.
var SJR;

function install() {}

async function startup({ rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + 'chrome/content/sjr.js');
  Zotero.sjrrankings = SJR;
  for (const window of Zotero.getMainWindows()) {
    if (window.ZoteroPane) SJR.addToWindow(window);
  }
  await SJR.init();
}

function onMainWindowLoad({ window }) {
  SJR.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  SJR.removeFromWindow(window);
}

function shutdown() {
  for (const window of Zotero.getMainWindows()) {
    if (window.ZoteroPane) SJR.removeFromWindow(window);
  }
  delete Zotero.sjrrankings;
  SJR = undefined;
}

function uninstall() {}
