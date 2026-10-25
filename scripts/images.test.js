'use strict';

// Chapter images (the fork's images feature): the img/ folder handlers in
// main.js, and what captureBody saves of a picture paragraph. main.js is
// loaded the way filesystem.test.js loads it; captureBody the way
// spans.test.js does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');

/* ---- main.js, with its ipc handlers' map ---- */

const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadMain() {
  const handlers = new Map();
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    libraryRoot: os.tmpdir()
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-img-'));
  main.pointAt(dir);
  return dir;
}

/* ---- captureBody, on its own ---- */

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const capCtx = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function captureBody('), app.indexOf('// A chapter that opens on a line of dialogue')), capCtx);
vm.runInContext('this.api = { captureBody };', capCtx);
const saved = (innerHTML) => capCtx.api.captureBody({ innerHTML });

describe('images', { concurrency: 1 }, () => {
  test('img:store keeps a dragged-in file\'s bytes, full resolution, in img/', () => {
    const dir = tempLibrary();
    try {
      const b = main.call('book:create', { title: 'Pics', author: 'Ada' });
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 9]);
      const src = path.join(dir, 'dragged in.png');
      fs.writeFileSync(src, bytes);
      const r = main.call('img:store', b.id, { srcPath: src, ext: 'png', display: Buffer.from('RIFF-webp').toString('base64') });
      assert.ok(r && r.file, 'stored');
      assert.match(r.file, /^img-[a-z0-9]+(?:-[a-z0-9]+)?\.png$/);
      assert.match(r.display, /^img-[a-z0-9-]+-d\.webp$/);
      const imgDir = path.join(dir, b.id, 'img');
      assert.ok(fs.existsSync(imgDir), 'the img/ folder is made');
      assert.deepEqual(fs.readFileSync(path.join(imgDir, r.file)), bytes); // byte for byte
      assert.equal(fs.readFileSync(path.join(imgDir, r.display)).toString(), 'RIFF-webp');
      const back = main.call('img:read', b.id, r.file);
      assert.equal(back.mime, 'image/png');
      assert.equal(Buffer.from(back.base64, 'base64').compare(bytes), 0);
      const disp = main.call('img:read', b.id, r.display);
      assert.equal(disp.mime, 'image/webp');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('img:store takes the clipboard\'s bytes, and an SVG whole', () => {
    const dir = tempLibrary();
    try {
      const b = main.call('book:create', { title: 'Pics', author: 'Ada' });
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle r="18" cx="20" cy="20"/></svg>';
      const r = main.call('img:store', b.id, { ext: 'svg', original: Buffer.from(svg).toString('base64') });
      assert.ok(r && r.file && !r.display, 'an SVG needs no lighter copy');
      assert.equal(fs.readFileSync(path.join(dir, b.id, 'img', r.file)).toString(), svg);
      assert.equal(main.call('img:read', b.id, r.file).mime, 'image/svg+xml');
      const jpeg = main.call('img:store', b.id, { ext: 'jpeg', original: Buffer.from('not really a jpeg').toString('base64') });
      assert.match(jpeg.file, /\.jpg$/); // jpeg lands as jpg, like the covers
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('img:store refuses what it doesn\'t know', () => {
    const dir = tempLibrary();
    try {
      const b = main.call('book:create', { title: 'Pics', author: 'Ada' });
      assert.equal(main.call('img:store', b.id, { ext: 'gif', original: 'AAA' }).error, 'unsupported');
      assert.equal(main.call('img:store', b.id, { ext: 'png' }).error, 'empty');
      assert.equal(main.call('img:store', b.id, { ext: 'png', srcPath: path.join(dir, 'not-there.png') }).error, 'unreadable');
      assert.ok(!fs.existsSync(path.join(dir, b.id, 'img')), 'nothing was written');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('img:read opens only names NEO made, inside img/', () => {
    const dir = tempLibrary();
    try {
      const b = main.call('book:create', { title: 'Pics', author: 'Ada' });
      for (const bad of ['', 'cover-123.png', '../library.json', 'img-1.png/../../library.json', 'img-1.gif', 'img-1.png.exe']) {
        assert.equal(main.call('img:read', b.id, bad), null, JSON.stringify(bad));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('img:sweep takes only what nothing names, and nothing young', async () => {
    const dir = tempLibrary();
    try {
      const b = main.call('book:create', { title: 'Pics', author: 'Ada' });
      const imgDir = path.join(dir, b.id, 'img');
      const d = (s) => Buffer.from(s).toString('base64');
      const keep = main.call('img:store', b.id, { ext: 'png', original: d('kept picture'), display: d('kept lighter') });
      const orphan = main.call('img:store', b.id, { ext: 'png', original: d('an undone picture'), display: d('undone lighter') });
      const young = main.call('img:store', b.id, { ext: 'png', original: d('still crossing a sync') });
      // the chapter names the first; the other two nothing names. The young
      // one is younger than a day, so the sweep leaves it for the next one
      main.call('chapter:write', b.id, 'ch-1', `<p>Words.</p><p class="image"><img data-img="${keep.file}" data-d="${keep.display}"></p>`);
      const day = 24 * 60 * 60 * 1000;
      const old = Date.now() / 1000 - 2 * day;
      fs.utimesSync(path.join(imgDir, orphan.file), old, old);
      fs.utimesSync(path.join(imgDir, orphan.display), old, old); // written with its original, aged with it
      const r = await main.call('img:sweep', b.id);
      assert.ok(!r.aborted, 'the sweep ran');
      assert.equal(r.removed, 2); // the orphan and its lighter copy
      assert.ok(fs.existsSync(path.join(imgDir, keep.file)), 'the named picture stays');
      assert.ok(!fs.existsSync(path.join(imgDir, orphan.file)), 'the orphan goes');
      assert.ok(fs.existsSync(path.join(imgDir, young.file)), 'a young picture waits');
      // its derivative, named by data-d above, stays too; the orphan's derivative went with it
      assert.ok(fs.existsSync(path.join(imgDir, keep.display)));
      assert.ok(!fs.existsSync(path.join(imgDir, orphan.display)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a picture paragraph keeps its names and loses the page\'s data URL', () => {
    const page = '<p class="image"><img data-img="img-abc12.png" data-d="img-abc12-d.webp" src="data:image/webp;base64,AAAA" alt=""></p>';
    assert.equal(saved(page), '<p class="image"><img data-img="img-abc12.png" data-d="img-abc12-d.webp" alt=""></p>');
    // a picture without names (a chapter written elsewhere) is saved as it is
    const outside = '<p><img src="https://example.com/pic.png" alt="pic"></p>';
    assert.equal(saved(outside), outside);
  });
});
