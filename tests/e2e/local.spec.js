import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createDocx, inspectDocx } from '../../src/docx.js';
const secret = 'PRIVATE MANUSCRIPT SENTINEL 87b52';
async function open(page) {
  const bytes = await createDocx([secret, 'A finding.', 'Place references here.']);
  await page.locator('#file').setInputFiles({
    name: 'confidential.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#preview')).toContainText(secret);
}
async function source(page) {
  await page.locator('#manual').click();
  await page.locator('[data-field="title"]').fill('Local source');
  await page.locator('[data-field="author"]').fill('Smith, Jane');
  await page.locator('[data-field="year"]').fill('2024');
  await page.locator('[data-field="container-title"]').fill('Test Journal');
  await page.locator('#save-edit').click();
  await expect(page.locator('#sources')).toContainText('Local source');
}
test('Word edits and downloads work fully offline without document network traffic', async ({
  page,
  context,
}) => {
  const requests = [],
    errors = [];
  page.on('request', (r) =>
    requests.push({ url: r.url(), body: r.postData(), method: r.method() }),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await open(page);
  const baseline = requests.length;
  await context.setOffline(true);
  await source(page);
  await page.locator('[data-paragraph="1"]').click();
  await page.getByRole('button', { name: 'Cite here', exact: true }).click();
  await expect(page.locator('[data-paragraph="1"]')).toContainText('(1)');
  await page.locator('#style').selectOption('apa');
  await expect(page.locator('#preview')).toContainText('Smith, 2024');
  await page.locator('#bibliography').click();
  await expect(page.locator('#preview')).toContainText('References');
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('citeflow.library.v1')).length),
  ).toBe(1);
  await page.locator('#tab-citations').click();
  await page.getByRole('button', { name: 'Edit group / pages' }).click();
  await page.locator('[data-field^="locator:"]').fill('12');
  await page.locator('#save-edit').click();
  await expect(page.locator('#preview')).toContainText('p. 12');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#citations')).not.toContainText('Local source');
  await page.locator('#undo').click();
  await expect(page.locator('#citations')).toContainText('Local source');
  const waiting = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await waiting;
  const result = await inspectDocx(new Uint8Array(await readFile(await download.path())));
  expect(result.document.citations).toHaveLength(1);
  expect(result.document.style).toBe('apa');
  expect(result.paragraphs[0].text).toBe(secret);
  expect(requests.length).toBe(baseline);
  expect(requests.some((r) => r.body?.includes(secret) || r.url.includes(secret))).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/local-browser.png', fullPage: true });
});
test('online lookup sends only a source identifier; relay gets no manuscript', async ({ page }) => {
  const bodies = [];
  await page.route('https://relay.example/**', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        source: { type: 'article-journal', title: 'Remote source', DOI: '10.1234/test' },
        provider: 'Fixture',
      },
    });
  });
  await page.goto('/');
  await open(page);
  await page.locator('#settings').click();
  await page.locator('#relay').fill('https://relay.example/lookup');
  await page.locator('#save-settings').click();
  await page.locator('#url').fill('10.1234/test');
  await page.locator('#lookup').click();
  await expect(page.locator('#candidate')).toContainText('Remote source');
  expect(bodies).toEqual([{ input: 'https://api.crossref.org/works/10.1234%2Ftest' }]);
  expect(JSON.stringify(bodies)).not.toContain(secret);
  await page.locator('#settings').click();
  await page.locator('#offline').check();
  await page.locator('#save-settings').click();
  await page.locator('#lookup').click();
  await expect(page.locator('#status')).toContainText('Offline mode');
  expect(bodies).toHaveLength(1);
});

test('collaborator packages download offline without changing the open manuscript', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await open(page);
  await source(page);
  await page.locator('[data-paragraph="1"]').click();
  await page.getByRole('button', { name: 'Cite here', exact: true }).click();
  await expect(page.locator('[data-paragraph="1"]')).toContainText('(1)');
  await page.locator('#bibliography').click();
  await expect(page.locator('#preview')).toContainText('References');
  const revision = await page.locator('#revision').innerText();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await context.setOffline(true);
  for (const target of ['endnote', 'mendeley']) {
    await page.getByRole('button', { name: 'Export for collaborators', exact: true }).click();
    await expect(page.locator('#handoff-dialog')).toContainText('Experimental compatibility');
    await page.locator('#handoff-target').selectOption(target);
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download handoff ZIP', exact: true }).click();
    const result = await waiting;
    const zip = await JSZip.loadAsync(await readFile(await result.path()));
    expect(zip.file(`manuscript-${target}.docx`)).toBeTruthy();
    expect(zip.file('original-citeflow.docx')).toBeTruthy();
    const report = JSON.parse(await zip.file('handoff-report.json').async('string'));
    expect(report.nativeApplicationVerified).toBe(false);
    expect(report.citationCount).toBe(1);
    await expect(page.locator('#revision')).toHaveText(revision);
    await expect(page.locator('#preview')).toContainText(secret);
  }
  expect(requests).toEqual([]);
});

test('saved library imports RIS, BibTeX and XML offline and can cite imported sources', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await open(page);
  await context.setOffline(true);
  await page.locator('#tab-library').click();
  for (const [name, text] of [
    ['refs.ris', 'TY  - JOUR\nTI  - RIS imported source\nAU  - Smith, Jane\nPY  - 2024\nER  -'],
    ['refs.bib', '@book{a,title={BibTeX imported source},author={Jones, Bob},year={2023}}'],
    [
      'refs.xml',
      '<xml><records><record><ref-type>17</ref-type><titles><title>XML imported source</title></titles></record></records></xml>',
    ],
  ]) {
    await page
      .locator('#import-library')
      .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#library-panel')).toContainText(
      text.includes('RIS imported')
        ? 'RIS imported source'
        : text.includes('BibTeX imported')
          ? 'BibTeX imported source'
          : 'XML imported source',
    );
  }
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('citeflow.library.v1')).length),
  ).toBe(3);
  await page.screenshot({ path: 'test-results/import-library.png', fullPage: true });
  await page.locator('[data-paragraph="1"]').click();
  await page
    .locator('#library .source')
    .filter({ hasText: 'RIS imported source' })
    .getByRole('button', { name: 'Cite here', exact: true })
    .click();
  await page.locator('#tab-sources').click();
  await expect(page.locator('#sources .source')).toHaveCount(1);
  await expect(page.locator('[data-paragraph="1"]')).toContainText('(1)');
});

test('duplicate sources can be merged, undone and deleted when unused', async ({ page }) => {
  const { LocalWorkspace } = await import('../../browser/workspace.js');
  const w = new LocalWorkspace();
  await w.open(await createDocx(['One.', 'Two.']), 'duplicates.docx');
  const paper = {
    type: 'article-journal',
    title: 'Duplicate publication',
    author: [{ family: 'Smith' }],
    issued: { 'date-parts': [[2024]] },
    'container-title': 'Journal',
  };
  const result = await w.edit([
    { type: 'source.upsert', source: paper },
    { type: 'source.upsert', source: { ...paper, page: '1-9' } },
  ]);
  const [a, b] = result.results.map((x) => x.sourceId);
  await w.edit([
    { type: 'citation.insert', items: [{ id: a }], anchor: { exactText: 'One.' } },
    { type: 'citation.insert', items: [{ id: b }], anchor: { exactText: 'Two.' } },
    { type: 'bibliography.place' },
  ]);
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'duplicates.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(w.download()),
  });
  await expect(page.locator('#sources .source')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Delete unused source' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Merge duplicates', exact: true }).first().click();
  await page.locator('[data-merge-source]').check();
  await page.getByRole('button', { name: 'Merge selected duplicates', exact: true }).click();
  await expect(page.locator('#sources .source')).toHaveCount(1);
  await expect(page.locator('[data-paragraph="1"]')).toContainText('(1)');
  await page.locator('#undo').click();
  await expect(page.locator('#sources .source')).toHaveCount(2);
  await page.locator('#tab-citations').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await page.locator('#tab-sources').click();
  await page.getByRole('button', { name: 'Delete unused source', exact: true }).last().click();
  await expect(page.locator('#sources .source')).toHaveCount(1);
  await page.locator('#undo').click();
  await expect(page.locator('#sources .source')).toHaveCount(2);
});
