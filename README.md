# Zotero SJR Rankings (ZSC)
This add-on for Zotero tags journal articles with SJR journal quantiles and inserts a journal's "H index" to the "journal abbreviation" field. While a hack, it allows you to use that column to sort/filter.

Works with Zotero 7 to 10, and not with Zotero 6 or older. It replaces whatever is in the journal abbreviation field of a journal it finds.

## Installation
To install the add-on for Zotero:
1. Download the lastest version of the add-on from [the release page](https://github.com/Jacse/zotero-sjr-rankings/releases). It's an ".xpi" file.
1. In Zotero go to Tools -> Plugins and drag the ".xpi" file into the window.

## Usage
SJR's site no longer answers automated lookups, so the add-on reads SJR's own free spreadsheet instead:

1. Open [the SJR journal rankings](https://www.scimagojr.com/journalrank.php) in your browser and click "Download". You get a `.csv` file.
1. In Zotero go to Tools -> "Load SJR rankings file…" and choose that file. You only need to do this again when you want a newer year.
1. Right click the journal articles you want to update and click "Update SJR ranking(s)", or right click a collection and click "Update SJR rankings".

It matches a journal by ISSN, then by exact title. A journal that isn't in the file gets the tag "Not in SJR". An item can get that tag by mistake if neither its ISSN nor its journal name matches what SJR lists, such as "British Medical Journal" for SJR's "BMJ", so check SJR before relying on the tag. Zotero allows 9 colored tags per library, so any tags past that have no color.

## Development
`npm test` runs the known-answer tests, `npm run lint` runs ESLint, and `npm run build` makes the `.xpi` in `build/`.
