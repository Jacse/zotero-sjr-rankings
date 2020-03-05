const SJR = {};

const tagColors = {
  1: '#acd372',
  2: '#ead969',
  3: '#fbac63',
  4: '#e06a5f',
};

SJR.matchAll = function(regex, str) {
  const matches = [];
  let match = regex.exec(str);
  while (match != null) {
    matches.push(match);
    match = regex.exec(str);
  }
  return matches;
};

SJR.fetch = function(url, cb) {
  Zotero.debug('[SJR Rankings] GET ' + url);
  let xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      Zotero.debug('[SJR Rankings] received fetch results');
      cb(this.responseText);
    } else if (this.readyState == 4 && this.status == 429) {
      Zotero.debug(
        '[SJR Rankings] ' +
          'could not retrieve the fetch. Server returned: [' +
          xhr.status +
          ': ' +
          xhr.statusText +
          ']. ' +
          "GS want's you to wait for " +
          this.getResponseHeader('Retry-After') +
          ' seconds before sending further requests.'
      );
    } else if (this.readyState == 4) {
      Zotero.debug(
        '[SJR Rankings] ' +
          'could not retrieve the fetch. Server returned: [' +
          xhr.status +
          ': ' +
          xhr.statusText +
          ']'
      );
    }
  };
  xhr.send();
};

const prepForComp = str =>
  str
    .toLowerCase()
    .replace('&', 'and')
    .replace('the', '')
    .replace(/[-|\/\.]/g, '');

SJR.getJournalData = function(item, cb) {
  const journal = item.getField('publicationTitle');
  let searchUrl = 'https://www.scimagojr.com/journalsearch.php?q=' + encodeURIComponent(prepForComp(journal));
  SJR.fetch(searchUrl, function(text) {
    const searchResults = SJR.matchAll(
      /^<a href="journalsearch\.php\?q=(.*?)&.*?><span .*?>(.*?)<\/span>/gm,
      text
    );
    // Find one that matches exactly
    const found = searchResults.find(match => prepForComp(match[2]) === prepForComp(journal));
    if (!found) {
      Zotero.debug('[SJR Rankings] Couldn\'t find journal "' + journal + '"');
      cb(item, null, null);
      return;
    }
    Zotero.debug('[SJR Rankings] Found journal in search results. Fetching data...');
    SJR.fetch(
      'https://www.scimagojr.com/journalsearch.php?q=' + encodeURIComponent(found[1]) + '&tip=sid&clean=0',
      function(text) {
        // H index
        const hMatch = text.match(/class="hindexnumber".*?>(.*?)<\//);
        if (!hMatch || !hMatch[1]) {
          Zotero.debug('[SJR Rankings] Couldn\'t find H index for journal "' + journal + '"');
          cb(item, null, null);
          return;
        }
        // Quantiles
        const quantilesMatches = SJR.matchAll(
          /<tr><td>(.*?)<\/td><td>(\d{4})<\/td><td>Q(\d{1})<\/td><\/tr>/gm,
          text
        );
        const quantiles = [];
        // quantilesMatches =[[full, category, year, quantile], ...]
        // quanties = [[category, quantile],...]
        quantilesMatches.forEach(function(matches) {
          const isNewestForCategory = !quantilesMatches.some(function(quant) {
            return quant[1] === matches[1] && quant[2] > matches[2];
          });
          if (isNewestForCategory) {
            quantiles.push([matches[1], matches[3]]);
          }
        });
        if (quantiles.length === 0) {
          Zotero.debug('[SJR Rankings] Couldn\'t find quantiles for journal "' + journal + '"');
          cb(item, hMatch[1], null);
          return;
        }
        cb(item, hMatch[1], quantiles);
      }
    );
  });
};

SJR.updateItem = function(item, hIndex, quantiles) {
  Zotero.debug('[sjr-rankings] Updating item "' + item.getField('title') + '"');

  // H-index to journal abbreviation column (or clear column if no hIndex)
  item.setField('journalAbbreviation', hIndex || '');

  // Add tags
  if (quantiles) {
    quantiles.forEach(tag => {
      const tagStr = 'Q' + tag[1] + ' ' + tag[0];

      // Add tag to item
      item.addTag(tagStr);

      // Set tag color
      const libraryID = Zotero.Libraries.userLibraryID;
      Zotero.Tags.setColor(libraryID, tagStr, tagColors[tag[1]]);
    });
  }

  try {
    item.saveTx();
  } catch (e) {
    Zotero.debug('[scholar-citations] could not update extra content: ' + e);
  }
};

SJR.processItems = function(items) {
  let item;
  while ((item = items.shift())) {
    if (!item.getField('publicationTitle')) {
      Zotero.debug(
        '[sjr-rankings] ' +
          'skipping item "' +
          item.getField('title') +
          '"' +
          ' it has either an empty title or is missing creator information'
      );
      continue;
    }
    SJR.getJournalData(item, SJR.updateItem);
  }
};

SJR.updateCollection = function(collection) {
  SJR.processItems(collection.getChildItems());
  let childColls = collection.getChildCollections();
  for (let idx = 0; idx < childColls.length; ++idx) {
    SJR.updateCollection(childColls[idx]);
  }
};

SJR.notifierCallback = {
  notify: function(event, type, ids) {
    if (event == 'add') {
      SJR.processItems(Zotero.Items.get(ids));
    }
  },
};

SJR.updateCollectionMenuEntry = function() {
  if (!ZoteroPane.canEditLibrary()) {
    alert('You lack the permission to make edit to this library.');
    return;
  }

  let collection = ZoteroPane.getSelectedCollection();
  if (collection) {
    SJR.updateCollection(collection);
    return;
  }

  alert('Updating citations for this type of entry is not supported.');
  return;
};

SJR.updateItemMenuEntries = function() {
  if (!ZoteroPane.canEditLibrary()) {
    alert('You lack the permission to make edit to this library.');
    return;
  }
  SJR.processItems(ZoteroPane.getSelectedItems());
};

SJR.init = function() {
  // Register the callback in Zotero as an item observer
  const notifierID = Zotero.Notifier.registerObserver(SJR.notifierCallback, ['item']);

  // Unregister callback when the window closes (important to avoid memory leaks)
  window.addEventListener(
    'unload',
    function() {
      Zotero.Notifier.unregisterObserver(notifierID);
    },
    false
  );
};

Zotero.sjrrankings = SJR;
