# Collaborator exports

The browser's **Export for collaborators** command prepares a ZIP locally in the document worker. Neither the document nor its metadata is sent to a service. Export does not change the open document, its revision, undo history, or unsaved status.

Both routes are **experimental and unverified in the actual Word add-ins**. They are intended to eliminate individual reinsertion, but are not certified native EndNote/Mendeley exports. A ZIP with RIS alone would not meet that goal and is not presented as a linked-document conversion.

## EndNote

The Word copy replaces CiteFlow controls with EndNote's documented temporary citation syntax. Each cited source has a stable, collision-checked Label in the included EndNote XML library. Recipients import the library into a fresh EndNote library, choose Label rather than record number in Temporary Citations preferences, and run Word's Update Citations and Bibliography for the entire document. This is a one-time bulk formatting step, not already-native EN.CITE field output.

The existing bibliography is removed in the collaborator copy because EndNote generates its own. Bibliography placement/heading may need adjustment. The original formatted CiteFlow document is included unchanged for comparison and recovery.

Supports journal articles, books, book sections, conference papers, reports, theses and web pages; other types fail explicitly. Source title, author/editor lists, year, container, volume, issue, pages, publisher/place, edition, ISBN/ISSN, DOI, PMID and URL are mapped. Full CSL records are included separately so additional metadata is not lost from the package. Date precision beyond year and specialized fields need import review.

Groups, prefixes, suffixes and page locators are converted. Non-page locators, delimiter-bearing values, missing authors/years and literal braces in manuscript prose fail explicitly instead of producing ambiguous matches. EndNote styles must include Cited Pages to render page locators.

## Mendeley

The Word copy replaces CiteFlow controls with legacy Word ADDIN CSL_CITATION fields holding CSL embedded citation objects. Existing citation display runs remain in the fields; groups, labels, locators, prefixes and suffixes are carried with full source metadata. An existing bibliography becomes an ADDIN CSL_BIBLIOGRAPHY field at its original location. Leading layout spaces are outside the fields.

This does **not** generate the private modern Mendeley Cite representation. Mendeley documents a bulk conversion route for Desktop-generated citations, but whether that route accepts CiteFlow-generated legacy fields remains unverified. Source URIs are real DOI/URL values or explicit local URNs; we never manufacture Mendeley account/library identifiers. If Mendeley Cite does not offer conversion or cannot resolve records, stop and report that failure; do not claim the collaborator can continue unaided. CSL JSON in the archive is a backup, not a Mendeley library import format.

## Package and integrity

- `original-citeflow.docx`: byte-for-byte input backup.
- `manuscript-endnote.docx` or `manuscript-mendeley.docx`: separate handoff document.
- `references.xml`: EndNote library for the EndNote route.
- `references.csl.json`: cited sources only, including metadata beyond mapped fields.
- `handoff-report.json`: input/output hashes, original occurrence IDs, source links, compatibility status and warnings.
- `READ-ME.txt`: recipient steps and limitations.

Exports refuse tracked changes, missing/duplicate anchors, foreign citation fields and unexpected CiteFlow controls. Renamed CiteFlow custom XML parts and inbound relationships are removed from collaborator copies; unrelated package entries are retained. The original remains editable in CiteFlow. Importing the converted copy back into CiteFlow is not supported.

## Required application acceptance tests

For each supported Word OS/add-in version, record the versions and test: bulk conversion without individually choosing sources; edit a group/page; add a new citation; remove an existing one; change Vancouver/APA style; regenerate the bibliography; save, close and reopen. Compare source counts, grouping, page numbers, bibliography position and metadata. Repeat in a collaborator's separate library/account. Only mark `nativeApplicationVerified` true for a verified adapter/version; automated OOXML checks alone are insufficient.

## Format evidence

- EndNote temporary citation components: https://docs.endnote.com/docs/endnote/2025/macos/v1/content/09word/components_ofatempcite.htm
- EndNote Label preferences: https://docs.endnote.com/docs/endnote/2025/macos/v1/content/21prefs/temporary_citations.htm
- CSL embedded citation schema: https://github.com/citation-style-language/schema
- Historical embedded-object description and Mendeley example: https://github.com/dhimmel/csl-schema
- Mendeley Desktop document conversion release: https://www.mendeley.com/release-notes/mendeley-cite-v1_16_0
