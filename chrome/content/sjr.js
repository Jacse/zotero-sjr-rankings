/* global ChromeUtils, IOUtils, PathUtils, SJR:writable */
// Zotero can load this file more than once into the same scope, so nothing here is declared at the top level.
(function() {
  SJR = {
    entries: null,
    byIssn: new Map(),
    byTitle: new Map(),
    sourceName: null,
  };

  const NOT_IN_SJR_TAG = 'Not in SJR';
  const STORE_FILE = 'sjr-rankings.json';
  const REQUIRED_COLUMNS = ['Title', 'Issn', 'H index', 'Categories'];

  const tagColors = {
    1: '#acd372',
    2: '#ead969',
    3: '#fbac63',
    4: '#e06a5f',
  };

  const labels = {
    item: 'Update SJR ranking(s)',
    collection: 'Update SJR rankings',
    load: 'Load SJR rankings file…',
  };

  SJR.parseCsvRows = function(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') field += char;
        else if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') field += char;
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  };

  // "Hematology (Q1); Oncology (Q2); Software" => [['Hematology', '1'], ['Oncology', '2']]
  SJR.parseCategories = function(categories) {
    const quantiles = [];
    for (const part of (categories || '').split(';')) {
      const match = part.trim().match(/^(.*\S)\s*\(Q([1-4])\)$/);
      if (match) quantiles.push([match[1], match[2]]);
    }
    return quantiles;
  };

  // Reads the semicolon-separated file from https://www.scimagojr.com/journalrank.php ("Download").
  SJR.parseRankingsFile = function(text) {
    const rows = SJR.parseCsvRows(text.replace(/^\uFEFF/, ''), ';');
    const header = rows[0] || [];
    const missing = REQUIRED_COLUMNS.filter(name => !header.includes(name));
    if (missing.length) {
      throw new Error('Not an SJR rankings file: missing ' + missing.join(', '));
    }
    const column = name => header.indexOf(name);
    const entries = [];
    for (const row of rows.slice(1)) {
      const title = row[column('Title')];
      if (!title) continue;
      entries.push({
        title,
        issns: SJR.parseIssns(row[column('Issn')]),
        hIndex: (row[column('H index')] || '').trim(),
        quantiles: SJR.parseCategories(row[column('Categories')]),
      });
    }
    if (!entries.length) throw new Error('Not an SJR rankings file: it has no journals');
    return entries;
  };

  SJR.parseIssns = function(value) {
    return (value || '')
      .split(/[,\s]+/)
      .map(issn => issn.replace(/-/g, '').toUpperCase())
      .filter(issn => /^\d{7}[\dX]$/.test(issn));
  };

  SJR.normalizeTitle = function(title) {
    return (title || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\bthe\b/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  };

  SJR.setEntries = function(entries, sourceName) {
    SJR.entries = entries;
    SJR.sourceName = sourceName;
    SJR.byIssn = new Map();
    SJR.byTitle = new Map();
    for (const entry of entries) {
      for (const issn of entry.issns) SJR.byIssn.set(issn, entry);
      const title = SJR.normalizeTitle(entry.title);
      // Two journals can share a title. A title that isn't unique can't identify a journal.
      SJR.byTitle.set(title, SJR.byTitle.has(title) ? null : entry);
    }
  };

  // Returns an entry, null if the journal isn't in the file, or undefined if the title is ambiguous.
  SJR.findEntry = function(issnField, journalTitle) {
    for (const issn of SJR.parseIssns(issnField)) {
      const entry = SJR.byIssn.get(issn);
      if (entry) return entry;
    }
    const entry = SJR.byTitle.get(SJR.normalizeTitle(journalTitle));
    if (entry === null) return undefined;
    return entry || null;
  };

  SJR.storePath = function() {
    return PathUtils.join(Zotero.DataDirectory.dir, STORE_FILE);
  };

  SJR.init = async function() {
    try {
      if (!(await IOUtils.exists(SJR.storePath()))) return;
      const stored = JSON.parse(await IOUtils.readUTF8(SJR.storePath()));
      SJR.setEntries(stored.entries, stored.sourceName);
    } catch (e) {
      Zotero.debug('[SJR Rankings] could not read stored rankings: ' + e);
    }
  };

  SJR.loadFile = async function(path) {
    const entries = SJR.parseRankingsFile(await IOUtils.readUTF8(path));
    const sourceName = PathUtils.filename(path);
    await IOUtils.writeUTF8(SJR.storePath(), JSON.stringify({ sourceName, entries }));
    SJR.setEntries(entries, sourceName);
    return entries.length;
  };

  SJR.notify = function(headline, description) {
    const progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline(headline);
    progress.addDescription(description);
    progress.show();
    progress.startCloseTimer(6000);
  };

  const isValidField = (item, field) =>
    Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field), item.itemTypeID);

  const colorTag = async function(libraryID, tag, quantile) {
    if (Zotero.Tags.getColor(libraryID, tag)) return;
    // Zotero allows 9 colored tags per library. Past that the tag is still added, without a color.
    if (Zotero.Tags.getColors(libraryID).size >= Zotero.Tags.MAX_COLORED_TAGS) return;
    await Zotero.Tags.setColor(libraryID, tag, tagColors[quantile]);
  };

  // Returns what happened, for the summary: 'updated', 'not-in-sjr' or 'ambiguous'.
  SJR.updateItem = async function(item) {
    const entry = SJR.findEntry(item.getField('ISSN'), item.getField('publicationTitle'));
    if (entry === undefined) return 'ambiguous';
    if (entry === null) {
      item.addTag(NOT_IN_SJR_TAG);
      await item.saveTx();
      return 'not-in-sjr';
    }
    item.removeTag(NOT_IN_SJR_TAG);
    // The H index goes in the journal abbreviation field so it can be sorted. Not every item type has it.
    if (isValidField(item, 'journalAbbreviation')) item.setField('journalAbbreviation', entry.hIndex);
    for (const [category, quantile] of entry.quantiles) {
      const tag = 'Q' + quantile + ' ' + category;
      item.addTag(tag);
      await colorTag(item.libraryID, tag, quantile);
    }
    await item.saveTx();
    return 'updated';
  };

  SJR.processItems = async function(items) {
    const counts = { updated: 0, 'not-in-sjr': 0, ambiguous: 0, skipped: 0, failed: 0 };
    for (const item of items) {
      if (!item.isRegularItem() || !item.getField('publicationTitle')) {
        counts.skipped++;
        continue;
      }
      try {
        counts[await SJR.updateItem(item)]++;
      } catch (e) {
        counts.failed++;
        Zotero.debug('[SJR Rankings] could not update item ' + item.id + ': ' + e);
      }
    }
    return counts;
  };

  SJR.collectionItems = function(collection) {
    const items = collection.getChildItems();
    for (const child of collection.getChildCollections()) items.push(...SJR.collectionItems(child));
    return items;
  };

  SJR.summarize = function(counts) {
    const parts = [counts.updated + ' updated'];
    if (counts['not-in-sjr']) parts.push(counts['not-in-sjr'] + ' not in SJR');
    if (counts.ambiguous) parts.push(counts.ambiguous + ' with a journal title shared by several journals');
    if (counts.skipped) parts.push(counts.skipped + ' skipped (no journal)');
    if (counts.failed) parts.push(counts.failed + ' failed');
    return parts.join(', ');
  };

  SJR.runUpdate = async function(window, items) {
    if (!SJR.entries) {
      SJR.notify('SJR Rankings', 'Load the SJR file first: Tools → ' + labels.load);
      return null;
    }
    const editable = items.filter(item => Zotero.Libraries.get(item.libraryID).editable);
    if (editable.length < items.length) {
      Zotero.alert(window, 'SJR Rankings', 'You lack the permission to edit this library.');
      return null;
    }
    const counts = await SJR.processItems(items);
    SJR.notify('SJR Rankings (' + SJR.sourceName + ')', SJR.summarize(counts));
    return counts;
  };

  SJR.updateItemMenuEntries = function(window) {
    return SJR.runUpdate(window, window.ZoteroPane.getSelectedItems());
  };

  SJR.selectedCollections = function(pane) {
    // Zotero 10 warns on getSelectedCollection() and throws if several collections are selected.
    if (pane.getSelectedCollections) return pane.getSelectedCollections();
    const collection = pane.getSelectedCollection();
    return collection ? [collection] : [];
  };

  SJR.updateCollectionMenuEntry = function(window) {
    const collections = SJR.selectedCollections(window.ZoteroPane);
    if (!collections.length) {
      Zotero.alert(window, 'SJR Rankings', 'Select a collection to update its rankings.');
      return null;
    }
    const items = new Set();
    for (const collection of collections) {
      for (const item of SJR.collectionItems(collection)) items.add(item);
    }
    return SJR.runUpdate(window, [...items]);
  };

  SJR.loadFileMenuEntry = async function(window) {
    const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker = new FilePicker();
    picker.init(window, 'Choose the SJR rankings file', picker.modeOpen);
    picker.appendFilter('SJR rankings (*.csv)', '*.csv');
    picker.appendFilters(picker.filterAll);
    if ((await picker.show()) !== picker.returnOK) return;
    try {
      const count = await SJR.loadFile(picker.file);
      SJR.notify('SJR Rankings', 'Loaded ' + count + ' journals from ' + SJR.sourceName);
    } catch (e) {
      Zotero.alert(window, 'SJR Rankings', String(e.message || e));
    }
  };

  const menuItems = [
    {
      id: 'zotero-itemmenu-sjrrankings',
      parent: 'zotero-itemmenu',
      label: 'item',
      command: 'updateItemMenuEntries',
    },
    {
      id: 'zotero-collectionmenu-sjrrankings',
      parent: 'zotero-collectionmenu',
      label: 'collection',
      command: 'updateCollectionMenuEntry',
    },
    {
      id: 'menu_Tools-sjrrankings-load',
      parent: 'menu_ToolsPopup',
      label: 'load',
      command: 'loadFileMenuEntry',
    },
  ];

  SJR.addToWindow = function(window) {
    const doc = window.document;
    for (const { id, parent, label, command } of menuItems) {
      const menuitem = doc.createXULElement('menuitem');
      menuitem.id = id;
      menuitem.setAttribute('label', labels[label]);
      menuitem.addEventListener('command', () => SJR[command](window));
      doc.getElementById(parent).appendChild(menuitem);
    }
  };

  SJR.removeFromWindow = function(window) {
    for (const { id } of menuItems) {
      const menuitem = window.document.getElementById(id);
      if (menuitem) menuitem.remove();
    }
  };
})();
