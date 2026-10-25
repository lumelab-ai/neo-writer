'use strict';

// The Format menu's paragraph kinds show their keys in the menu's own
// shortcut column (#372). A tab in the label lines them up on no platform:
// macOS printed it as text beside the name. The keys stay the editor's own,
// so the accelerators are shown, not registered, and a press of them that
// reaches the menu anyway (macOS) is left to the page. Loads main.js the way
// filesystem.test.js does, once per platform.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// (with Show More Features on: Poetry Paragraph is one of its items)
// view: the page's view state (body font, drop cap, alignment...) as the window reports it
function menuOn(platform, { script = false, more = true, view = null, heading = undefined } = {}) {
  // the library and the app's settings both stand in a throwaway folder
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-format-menu-'));
  const listeners = new Map();
  let template = null;
  const sent = [];
  let builds = 0;
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => library, getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on: (name, fn) => listeners.set(name, fn), handle() {} },
    BrowserWindow: { getFocusedWindow: () => ({ webContents: { send: (_ch, msg) => sent.push(msg.type) } }), getAllWindows: () => [] },
    // a built menu with no items: macOS's Edit menu watch has nothing to hold
    Menu: { buildFromTemplate: (items) => ({ items: [], template: items }), setApplicationMenu: (menu) => { builds++; template = menu.template; } },
    dialog: {},
    shell: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform, on() {} },
    console,
    Buffer,
    setImmediate: (fn) => fn()
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  context.library = library;
  vm.runInContext('LIBRARY_DIR = library; LIBRARY_FILE = require("path").join(library, "library.json");', context);
  try {
    listeners.get('more:state')(null, more);
    if (view) listeners.get('view:state')({ sender: null }, view);
    if (heading !== undefined) listeners.get('heading:state')(null, heading);
    if (script) listeners.get('script:state')(null, { on: true, book: true, element: 'action' });
    else vm.runInContext('buildMenu()', context);
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
  }
  template.sent = sent;
  template.builds = () => builds;
  return template;
}

const format = (template) => template.find((m) => m.label === 'Format').submenu;
const item = (items, label) => items.find((i) => i.label === label);
function labels(items, out = []) {
  for (const i of items || []) {
    if (typeof i.label === 'string') out.push(i.label);
    labels(i.submenu, out);
  }
  return out;
}

describe('Format menu: the paragraph kinds show their keys as shortcuts', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`Flush and Poetry Paragraph carry their keys, shown not registered (${platform})`, () => {
      const items = format(menuOn(platform));
      const flush = item(items, 'Flush Paragraph');
      const poetry = item(items, 'Poetry Paragraph');
      assert.ok(flush && poetry, 'both are named without the key in the label');
      assert.equal(flush.accelerator, 'Shift+Enter');
      assert.equal(poetry.accelerator, 'CmdOrCtrl+Shift+Enter');
      // the editor answers both keys itself; a registered one would take
      // them from the page on Windows and Linux
      assert.equal(flush.registerAccelerator, false);
      assert.equal(poetry.registerAccelerator, false);
    });

    test(`a script's elements carry ⌘1–⌘7 (Ctrl+1–7), shown not registered (${platform})`, () => {
      const items = format(menuOn(platform, { script: true }));
      const elements = ['Scene Heading', 'Action', 'Character', 'Parenthetical', 'Dialogue', 'Transition', 'Shot'];
      elements.forEach((label, i) => {
        const el = item(items, label);
        assert.ok(el, label);
        assert.equal(el.accelerator, 'CmdOrCtrl+' + (i + 1));
        assert.equal(el.registerAccelerator, false);
      });
      assert.equal(item(items, 'Action').checked, true);
    });

    test(`no menu label carries its shortcut as text (${platform})`, () => {
      for (const template of [menuOn(platform), menuOn(platform, { script: true })]) {
        for (const label of labels(template)) assert.ok(!label.includes('\t'), JSON.stringify(label));
      }
    });
  }

  // what Electron hands a click: a mouse click, Return in the open menu, or
  // the item's key equivalent (macOS), with the keys held
  const mouse = { triggeredByAccelerator: false };
  const menuReturn = { triggeredByAccelerator: true, shiftKey: false, metaKey: false, ctrlKey: false };
  const cmd = (platform) => platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };

  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`a click or Return in the menu runs the item; the item's own keys are the page's (${platform})`, () => {
      const template = menuOn(platform);
      const items = format(template);
      const flush = item(items, 'Flush Paragraph');
      const poetry = item(items, 'Poetry Paragraph');
      flush.click(flush, null, mouse);
      poetry.click(poetry, null, menuReturn);
      assert.deepEqual(template.sent, ['flush', 'poetry']);
      const before = template.builds();
      flush.click(flush, null, { triggeredByAccelerator: true, shiftKey: true });
      poetry.click(poetry, null, { triggeredByAccelerator: true, shiftKey: true, ...cmd(platform) });
      assert.deepEqual(template.sent, ['flush', 'poetry'], 'the page already answered ⇧Enter and ⌘⇧Enter');
      // the menu is drawn again, so a tick the press flipped is put back
      assert.equal(template.builds(), before + 2);
    });

    test(`a script element's own key is the page's too (${platform})`, () => {
      const template = menuOn(platform, { script: true });
      const dialogue = item(format(template), 'Dialogue');
      dialogue.click(dialogue, null, mouse);
      dialogue.click(dialogue, null, { triggeredByAccelerator: true, ...cmd(platform) });
      assert.deepEqual(template.sent, ['scriptElement']);
    });
  }
});

// Electron's own rule for radio items: one joins the group of the nearest radio
// item above it, unless a separator comes between them, and when the menu opens
// a group with nothing checked shows its first item ticked. These are the labels
// that open menu shows ticked.
function shownTicks(items) {
  const groups = [];
  let group = null;
  for (const i of items) {
    if (i.type === 'separator') group = null;
    else if (i.type === 'radio') {
      if (!group) groups.push(group = []);
      group.push(i);
    }
  }
  return groups.flatMap((g) => g.some((i) => i.checked) ? g.filter((i) => i.checked) : [g[0]]).map((i) => i.label);
}
const view = (st) => ({ focus: 'off', pageTheme: 'night', uiBright: false, bodyFont: 'Georgia', dropCap: 'literary', align: 'left', ...st });

describe('Format menu: chapter and section headings, and Text Size', () => {
  const mouse = { triggeredByAccelerator: false };
  const cmd = (platform) => platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`the headings carry ⌘⌥1 and ⌘⌥2, shown not registered (${platform})`, () => {
      const items = format(menuOn(platform));
      const chapter = item(items, 'Chapter Heading');
      const section = item(items, 'Section Heading');
      assert.ok(chapter && section, 'both are there');
      assert.equal(chapter.accelerator, 'CmdOrCtrl+Alt+1');
      assert.equal(section.accelerator, 'CmdOrCtrl+Alt+2');
      // the editor answers the keys itself (the way the paragraph kinds do)
      assert.equal(chapter.registerAccelerator, false);
      assert.equal(section.registerAccelerator, false);
      assert.equal(chapter.checked, false, 'prose at the caret: no tick');
      // a script's ⌘1–⌘7 are the script's own
      const scriptItems = format(menuOn(platform, { script: true }));
      assert.equal(item(scriptItems, 'Chapter Heading').visible, false);
      assert.equal(item(scriptItems, 'Section Heading').visible, false);
    });

    test(`the caret's heading ticks the one it is (${platform})`, () => {
      const chapter = item(format(menuOn(platform, { heading: 'heading' })), 'Chapter Heading');
      const section = item(format(menuOn(platform, { heading: 'subheading' })), 'Section Heading');
      assert.equal(chapter.checked, true);
      assert.equal(item(format(menuOn(platform, { heading: 'heading' })), 'Section Heading').checked, false);
      assert.equal(section.checked, true);
      assert.equal(item(format(menuOn(platform, { heading: 'subheading' })), 'Chapter Heading').checked, false);
    });

    test(`a click runs the item; the item's own keys are the page's (${platform})`, () => {
      const template = menuOn(platform);
      const chapter = item(format(template), 'Chapter Heading');
      chapter.click(chapter, null, mouse);
      assert.deepEqual(template.sent, ['heading']);
      chapter.click(chapter, null, { triggeredByAccelerator: true, ...cmd(platform) });
      assert.deepEqual(template.sent, ['heading'], 'the page already answered ⌘⌥1');
    });

    test(`Text Size offers every size 8–22 and ticks the one in use (${platform})`, () => {
      const size = item(format(menuOn(platform)), 'Text Size');
      assert.ok(size, 'the submenu is there');
      // Array.from: the template's arrays live in main.js's vm realm
      assert.deepEqual(Array.from(size.submenu, (i) => i.label), Array.from({ length: 15 }, (_, i) => String(8 + i)));
      assert.deepEqual(shownTicks(size.submenu), ['17'], 'the default is 17');
      const twelve = item(format(menuOn(platform, { view: view({ editorFontSize: 12 }) })), 'Text Size');
      assert.deepEqual(shownTicks(twelve.submenu), ['12']);
      assert.equal(size.visible !== false, true, 'a book shows it');
      assert.equal(item(format(menuOn(platform, { script: true })), 'Text Size').visible, false, 'a script hides it');
    });

    test(`picking a size sends it to the window (${platform})`, () => {
      const template = menuOn(platform);
      const twenty = item(item(format(template), 'Text Size').submenu, '20');
      twenty.click(twenty, null, mouse);
      assert.deepEqual(template.sent, ['fontSizeSet']);
    });
  }
});

describe('Format menu: Drop Cap Style ticks one choice (#422)', () => {
  const choices = { literary: 'Literary', fantasy: 'Fantasy', scifi: 'Sci-Fi', none: 'Off' };
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const [value, label] of Object.entries(choices)) {
      test(`${label} alone is ticked (${platform})`, () => {
        const dropCap = item(format(menuOn(platform, { view: view({ dropCap: value }) })), 'Drop Cap Style').submenu;
        assert.deepEqual(shownTicks(dropCap), [label]);
      });
    }
  }

  test('every radio choice in the menus is one group, so one tick shows', () => {
    const groups = (items) => {
      for (const i of items || []) {
        if (!i.submenu) continue;
        const ticks = shownTicks(i.submenu);
        assert.ok(ticks.length <= 1, `${i.label}: ${JSON.stringify(ticks)}`);
        groups(i.submenu);
      }
    };
    for (const options of [{}, { script: true }]) groups(menuOn('darwin', { ...options, view: view({ dropCap: 'none' }) }));
  });
});
