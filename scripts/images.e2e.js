// End-to-end test for pictures in the manuscript (the fork's images
// feature), on a throwaway library: a picture pasted from the clipboard
// becomes its own paragraph, its original is kept byte for byte in the
// book's img/ folder with a lighter copy beside it, the chapter file saves
// only the names (never the data URL), reopening the book reads the picture
// back in, a clipboard that also carries words pastes the words (a picture
// that is only a preview, like Word's, doesn't land twice), and the export
// data keeps the picture with its src resolved. Run with
// `npm run test:images` (under xvfb-run without a display).

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-images-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-images-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Ada Harper', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night', hintShown: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

// a 1×1 PNG, as a screenshot's clipboard would carry
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(cond, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting: ' + cond);
    await tick(80);
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// a paste event carrying exactly what the clipboard says (words, a
// picture, or both), sent to the first chapter's body with the caret in
// its first paragraph
const pasteInBody = `(payload) => {
  const body = document.querySelector('.chapter .chapter-body');
  body.focus();
  const p = body.querySelector('p');
  const r = document.createRange();
  r.setStart(p, 0); r.setEnd(p, 0);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  const dt = new DataTransfer();
  if (payload.text) dt.setData('text/plain', payload.text);
  if (payload.png) dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(PNG_B64)}), (c) => c.charCodeAt(0))], 'shot.png', { type: 'image/png' }));
  body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}`;

test('a pasted picture becomes its own paragraph, its bytes kept whole', async () => {
  await js(`(${pasteInBody})({ png: true })`);
  await until(() => js(`!!document.querySelector('.chapter-body img[data-img][src^="data:"]')`));
  const onPage = await js(`(() => {
    const im = document.querySelector('.chapter-body img[data-img]');
    return { cls: im.closest('p').className, file: im.dataset.img, d: im.dataset.d || '', src: im.src };
  })()`);
  assert.equal(onPage.cls, 'image');
  assert.match(onPage.file, /^img-[a-z0-9-]+\.png$/);
  assert.match(onPage.d, /^img-[a-z0-9-]+-d\.webp$/);
  assert.ok(onPage.src.startsWith('data:image/'), 'the page shows a data URL');
  const imgDir = path.join(LIB, await js(`book.id`), 'img');
  assert.deepEqual(fs.readFileSync(path.join(imgDir, onPage.file)), PNG); // byte for byte
  assert.ok(fs.statSync(path.join(imgDir, onPage.d)).size > 0, 'the lighter copy is beside it');
});

test('the chapter file keeps the names and never the data URL', async () => {
  await js(`flushAllSaves()`);
  await tick(500);
  const chId = await js(`book.chapterOrder[0]`);
  const file = path.join(LIB, await js(`book.id`), 'chapters', `${chId}.html`);
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes('data-img="'), 'the picture\'s name is saved');
  assert.ok(!html.includes('src="data:'), 'the page\'s data URL is not');
});

test('reopening the book reads the picture back in', async () => {
  const id = await js(`book.id`);
  await js(`backToShelf()`);
  await until(() => js(`document.getElementById('editor-view').hidden === true`));
  await js(`openBook(${JSON.stringify(id)})`);
  await until(() => js(`!!document.querySelector('.chapter-body img[data-img][src^="data:"]')`));
});

test('a clipboard that also carries words pastes the words, not a preview', async () => {
  const before = await js(`document.querySelectorAll('.chapter-body img[data-img]').length`);
  await js(`(${pasteInBody})({ png: true, text: "A picture's caption, pasted as words." })`);
  await until(() => js(`document.querySelector('.chapter-body').textContent.includes("pasted as words")`));
  await tick(700);
  assert.equal(await js(`document.querySelectorAll('.chapter-body img[data-img]').length`), before);
});

test('the export data keeps the picture, its src resolved from the original', async () => {
  const kept = await js(`(async () => {
    const d = bookExportData();
    await resolveExportImages(d);
    return d.sections.some((s) => s.paras.some((p) => p.hasImg && /<img src="data:image\\/png/.test(p.html)));
  })()`);
  assert.equal(kept, true);
});

test('a picture dragged in from the Finder lands on the page', async () => {
  const before = await js(`document.querySelectorAll('.chapter-body img[data-img]').length`);
  await js(`(() => {
    const body = document.querySelector('.chapter .chapter-body');
    body.focus();
    const rect = body.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(PNG_B64)}), (c) => c.charCodeAt(0))], 'dragged.png', { type: 'image/png' }));
    body.dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true,
      clientX: rect.left + 40, clientY: rect.top + 40
    }));
  })()`);
  await until(() => js(`document.querySelectorAll('.chapter-body img[data-img]').length > ${before}`));
  const onPage = await js(`(() => {
    const im = [...document.querySelectorAll('.chapter-body img[data-img]')].pop();
    return { cls: im.closest('p').className, src: im.src };
  })()`);
  assert.equal(onPage.cls, 'image');
  assert.ok(onPage.src.startsWith('data:image/'), 'shown at once');
});

test('Format → Insert Image… puts the chosen file at the caret', async () => {
  const before = await js(`document.querySelectorAll('.chapter-body img[data-img]').length`);
  const pick = path.join(tmp, 'chosen-picture.png');
  fs.writeFileSync(pick, PNG);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pick] });
  // the caret stands in the page, as the menu asks of the writer
  await js(`(() => {
    const body = document.querySelector('.chapter .chapter-body');
    body.focus();
    const p = body.querySelectorAll('p')[1];
    const r = document.createRange();
    r.setStart(p, 0); r.setEnd(p, 0);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  wc.send('menu', { type: 'insert-image' });
  await until(() => js(`document.querySelectorAll('.chapter-body img[data-img]').length > ${before}`));
  await until(async () => {
    // the picture's bytes went to img/ by the file's own path (copied, not
    // carried): the newest picture in the folder is the chosen PNG
    const id = await js(`book.id`);
    const newest = fs.readdirSync(path.join(LIB, id, 'img')).filter((f) => !f.includes('-d.')).sort().pop();
    return newest && fs.readFileSync(path.join(LIB, id, 'img', newest)).equals(PNG);
  });
});

test('a Word export carries the pictures in it', async () => {
  const to = path.join(tmp, 'book-pictures.docx');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`doExport('docx')`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
  assert.ok(media.length >= 1, 'the pictures are in word/media/');
  const doc = await zip.file('word/document.xml').async('string');
  assert.ok(doc.includes('<w:drawing>'), 'a drawing sizes it on its page');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.ok(rels.includes('relationships/image'), 'its relationship');
  const types = await zip.file('[Content_Types].xml').async('string');
  assert.ok(types.includes('image/png'), 'its content type');
});

test('an EPUB export carries the pictures in it', async () => {
  const to = path.join(tmp, 'book-pictures.epub');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`doExport('epub')`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const imgs = Object.keys(zip.files).filter((f) => f.startsWith('OEBPS/images/'));
  assert.ok(imgs.length >= 1, 'the pictures are in OEBPS/images/');
  const opf = await zip.file('OEBPS/content.opf').async('string');
  assert.ok(opf.includes('images/img') && opf.includes('media-type="image/png"'), 'the manifest names them');
  const page = await zip.file('OEBPS/ch1.xhtml').async('string');
  assert.ok(page.includes('<img src="images/') && page.includes('/>'), 'XHTML points at the file, self-closed');
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    wc.on('console-message', (_e, level, msg) => { if (level >= 3) console.log('page: ' + String(msg).slice(0, 400)); });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    const md = path.join(tmp, 'book.md');
    fs.writeFileSync(md, ['# The Harbor', 'She came back to the old house at dusk.'].join('\n\n'));
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const results = await window.neo.importFiles([${JSON.stringify(md)}]);
      await addImportedBooks(results, library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(800);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.stack || err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
