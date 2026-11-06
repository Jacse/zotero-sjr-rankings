// Known-answer tests for everything in sjr.js that doesn't need Zotero. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = () => {
  const context = vm.createContext({ Zotero: { debug() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chrome/content/sjr.js'), 'utf8'), context);
  return context.SJR;
};

const plain = value => JSON.parse(JSON.stringify(value));
const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sjr-sample.csv'), 'utf8');

const loaded = () => {
  const SJR = load();
  SJR.setEntries(SJR.parseRankingsFile(sample), 'sjr-sample.csv');
  return SJR;
};

test('reads the real SJR header, with its repeated Publisher column', () => {
  const entries = plain(load().parseRankingsFile(sample));
  assert.strictEqual(entries.length, 6);
  assert.deepStrictEqual(entries[0], {
    title: 'Journal of Testing',
    issns: ['15424863', '0007923X'],
    hIndex: '223',
    quantiles: [
      ['Hematology', '1'],
      ['Oncology', '2'],
    ],
  });
});

test('keeps commas and parentheses inside a category name', () => {
  assert.deepStrictEqual(
    plain(load().parseCategories('Biochemistry, Genetics and Molecular Biology (miscellaneous) (Q1)')),
    [['Biochemistry, Genetics and Molecular Biology (miscellaneous)', '1']]
  );
});

test('a category with no quartile gets no tag', () => {
  assert.deepStrictEqual(plain(load().parseCategories('Software; Hardware (Q3)')), [['Hardware', '3']]);
  assert.deepStrictEqual(plain(load().parseCategories('')), []);
});

test('refuses a file that is not the SJR file', () => {
  assert.throws(
    () => load().parseRankingsFile('a;b\n1;2\n'),
    /Not an SJR rankings file: missing Title, Issn, H index, Categories/
  );
  assert.throws(() => load().parseRankingsFile(sample.split('\n')[0] + '\n'), /it has no journals/);
  assert.throws(
    () => load().parseRankingsFile('<html><title>Just a moment...</title></html>'),
    /Not an SJR rankings file/
  );
});

test('reads a BOM and Windows line endings', () => {
  const entries = load().parseRankingsFile('\uFEFF' + sample.replace(/\n/g, '\r\n'));
  assert.strictEqual(entries.length, 6);
  assert.strictEqual(entries[5].title, 'Same Title');
});

test('normalizes ISSNs from a Zotero field and from the file', () => {
  const SJR = load();
  assert.deepStrictEqual(plain(SJR.parseIssns('0007-923x, 1542-4863')), ['0007923X', '15424863']);
  assert.deepStrictEqual(plain(SJR.parseIssns('15424863, 0007923X')), ['15424863', '0007923X']);
  assert.deepStrictEqual(plain(SJR.parseIssns('-')), []);
  assert.deepStrictEqual(plain(SJR.parseIssns('')), []);
  assert.deepStrictEqual(plain(SJR.parseIssns(undefined)), []);
});

test('an ISSN wins over the title', () => {
  assert.strictEqual(loaded().findEntry('0007-923X', 'Something Else Entirely').title, 'Journal of Testing');
});

test('falls back to the title when the ISSN is missing or unknown', () => {
  const SJR = loaded();
  assert.strictEqual(SJR.findEntry('', 'JOURNAL OF TESTING').title, 'Journal of Testing');
  assert.strictEqual(SJR.findEntry('9999-9999', 'Journal of Testing').title, 'Journal of Testing');
});

test('title matching ignores "the", "&" and punctuation, without eating words', () => {
  const SJR = loaded();
  assert.strictEqual(SJR.findEntry('', 'The Lancet Test').title, 'Lancet Test');
  assert.strictEqual(SJR.findEntry('', 'Arts & Sciences Review').title, 'Arts and Sciences Review');
  assert.strictEqual(SJR.findEntry('', 'Arts and Sciences: Review').title, 'Arts and Sciences Review');
  assert.strictEqual(SJR.normalizeTitle('Theory of Other Mathematics'), 'theoryofothermathematics');
});

test('a journal not in the file is null, and an ambiguous title is undefined', () => {
  const SJR = loaded();
  assert.strictEqual(SJR.findEntry('', 'No Such Journal'), null);
  assert.strictEqual(SJR.findEntry('', 'Same Title'), undefined);
  assert.strictEqual(SJR.findEntry('1111-1111', 'Same Title').hIndex, '10');
  assert.strictEqual(SJR.findEntry('2222-2222', 'Same Title').hIndex, '20');
});

test('summarizes only what happened', () => {
  const SJR = load();
  assert.strictEqual(
    SJR.summarize({ updated: 2, 'not-in-sjr': 0, ambiguous: 0, skipped: 0, failed: 0 }),
    '2 updated'
  );
  assert.strictEqual(
    SJR.summarize({ updated: 1, 'not-in-sjr': 2, ambiguous: 3, skipped: 4, failed: 5 }),
    '1 updated, 2 not in SJR, 3 with a journal title shared by several journals, 4 skipped (no journal), 5 failed'
  );
});

test('manifest, package and updates agree on the version', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const manifest = read('manifest.json');
  const id = manifest.applications.zotero.id;
  const update = read('updates.json').addons[id].updates[0];
  assert.strictEqual(manifest.version, read('package.json').version);
  assert.strictEqual(update.version, manifest.version);
  assert.match(update.update_link, new RegExp('zotero-sjr-rank-' + manifest.version + '\\.xpi$'));
  assert.ok(manifest.applications.zotero.update_url.endsWith('/updates.json'));
});
