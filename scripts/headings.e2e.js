// End-to-end tests for chapter and section headings: ⌘⌥1 (Ctrl+Alt+1) makes
// the paragraph at the caret a chapter's title, ⌘⌥2 a section's, the same key
// takes it back, Enter under one steps out to prose, Backspace at the start
// of an empty one demotes it, a heading never takes the drop cap, and the
// chapter file on disk carries the class. Run with `npm run test:headings`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-headings-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-headings-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
async function chord(keyCode, modifiers = [MOD]) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(60);
}
const headingKey = (n) => chord(String(n), [MOD, 'alt']);
async function key(keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await tick(60);
}

// the caret at the end of paragraph n
async function caretEnd(n) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${n}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(200);
}
// (executeJavaScript hands back plain values, not elements)
const cls = (n) => js(`document.querySelector('.chapter-body').children[${n}] ? document.querySelector('.chapter-body').children[${n}].className : null`);
const text = (n) => js(`document.querySelector('.chapter-body').children[${n}] ? document.querySelector('.chapter-body').children[${n}].textContent : null`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('⌘⌥1 makes the paragraph a chapter heading', async () => {
  await caretEnd(0);
  await headingKey(1);
  assert.equal(await cls(0), 'heading');
  const noFirst = await js(`!document.querySelector('.chapter-body').children[0].hasAttribute('data-first')`);
  assert.ok(noFirst, 'a heading takes no drop cap');
  const first = await js(`document.querySelector('.chapter-body p[data-first]') && document.querySelector('.chapter-body p[data-first]').textContent`);
  assert.match(first, /^Rain fell on the harbor 1/, 'the paragraph under it is the opening one');
});

test('words typed land in the heading', async () => {
  await type(' Part Two');
  assert.match(await text(0), /Part Two$/);
  assert.equal(await cls(0), 'heading');
});

test('the same key takes it back to prose', async () => {
  await headingKey(1);
  assert.equal(await cls(0), '');
  const back = await js(`document.querySelector('.chapter-body p[data-first]') && document.querySelector('.chapter-body p[data-first]').textContent`);
  assert.match(back, /^Rain fell on the harbor 0/, 'the drop cap is back on it');
});

test('⌘⌥2 makes a section heading', async () => {
  await caretEnd(2);
  await headingKey(2);
  assert.equal(await cls(2), 'subheading');
  await headingKey(2);
  assert.equal(await cls(2), '');
});

test('Enter under a heading steps out to prose', async () => {
  await caretEnd(5);
  await headingKey(1);
  await key('Enter');
  assert.equal(await cls(6), '', 'the new paragraph is plain');
  assert.equal(await cls(5), 'heading', 'the heading itself stays a heading');
  await caretEnd(5);
  await headingKey(1); // back to prose, so later tests count paragraphs plainly
});

test('Backspace at an empty heading\'s start demotes it', async () => {
  await caretEnd(7);
  await headingKey(1);
  await js(`(() => {
    const p = document.querySelector('.chapter-body').children[7];
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  })()`);
  await key('Backspace');
  await tick(200);
  await key('Backspace');
  assert.equal(await cls(7), '', 'empty and Backspace: prose again');
});

test('the chapter file on disk carries the classes', async () => {
  await caretEnd(3);
  await headingKey(1);
  await caretEnd(8);
  await headingKey(2);
  await js(`flushAllSaves()`);
  await tick(600);
  const libDir = path.join(tmp, 'NEO Library');
  const bookDir = fs.readdirSync(libDir).filter((n) => n.startsWith('book-')).map((n) => path.join(libDir, n))[0];
  assert.ok(bookDir, 'the book folder is there');
  const chapters = fs.readdirSync(path.join(bookDir, 'chapters')).filter((n) => n.endsWith('.html'));
  const html = chapters.map((n) => fs.readFileSync(path.join(bookDir, 'chapters', n), 'utf8')).join('\n');
  assert.match(html, /<p class="heading">/);
  assert.match(html, /<p class="subheading">/);
});

test('pasted h1 and h3 come in as headings', async () => {
  await caretEnd(9);
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const r = document.createRange();
    r.selectNodeContents(body.children[9]);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/html', '<h1>A pasted title</h1><p>plain words</p><h3>a section of it</h3>');
    body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await tick(400);
  const got = await js(`document.querySelector('.chapter-body').innerHTML`);
  assert.match(got, /<p class="heading">A pasted title<\/p>/);
  assert.match(got, /<p class="subheading">a section of it<\/p>/);
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Headings', chapters: [
        { title: 'One', paras: Array.from({ length: 10 }, (_, i) => ({ text: 'Rain fell on the harbor ' + i + ' and' })) }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(300);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
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
