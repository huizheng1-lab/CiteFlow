import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocx, inspectDocx } from '../../src/docx.js';
const secret = 'PRIVATE MANUSCRIPT SENTINEL 87b52';
async function open(page) {
  const bytes = await createDocx([secret, 'A finding.', 'Place references here.']);
  await page
    .locator('#file')
    .setInputFiles({
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
