import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../lib/clipboard.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function harness({ native, copied = true, throws = false } = {}) {
  const log = [];
  class Element {
    focus(options) { log.push(["focus", this.id, options?.preventScroll]); }
  }
  class Input extends Element {
    constructor(id) {
      super();
      this.id = id;
      this.selectionStart = 2;
      this.selectionEnd = 5;
      this.selectionDirection = "backward";
    }
    setSelectionRange(...args) { log.push(["selectRange", this.id, ...args]); }
  }
  class TextArea extends Input {
    constructor() { super("copy"); this.style = {}; }
    setAttribute() {}
    select() { log.push(["select"]); }
    remove() { log.push(["remove"]); }
  }
  const active = new Input("active");
  const restoredRange = { saved: true };
  const selection = {
    rangeCount: 1,
    getRangeAt() { return { cloneRange: () => restoredRange }; },
    removeAllRanges() { log.push(["clearRange"]); },
    addRange(range) { assert.equal(range, restoredRange); log.push(["restoreRange"]); },
  };
  const document = {
    activeElement: active,
    getSelection: () => selection,
    body: { appendChild() { log.push(["append"]); } },
    createElement: () => new TextArea(),
    execCommand(command) {
      log.push(["exec", command]);
      if (throws) throw new Error("denied");
      return copied;
    },
  };
  const context = vm.createContext({
    exports: {},
    navigator: native ? { clipboard: { writeText: native } } : {},
    document,
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLTextAreaElement: TextArea,
  });
  vm.runInContext(source, context);
  return { copyText: context.exports.copyText, log };
}

let h = harness();
const pending = h.copyText("hello");
assert(h.log.some((entry) => entry[0] === "exec"), "HTTP fallback must run before copyText returns");
await pending;
assert.deepEqual(
  h.log.filter((entry) => entry[0] === "selectRange").at(-1),
  ["selectRange", "active", 2, 5, "backward"],
);
assert(h.log.some((entry) => entry[0] === "restoreRange"));
assert(h.log.some((entry) => entry[0] === "remove"));

let received;
h = harness({ native: (text) => { received = text; return Promise.resolve(); } });
await h.copyText("native");
assert.equal(received, "native");
assert.equal(h.log.length, 0);

h = harness({ native: () => Promise.reject(new Error("permission denied")) });
await h.copyText("fallback");
assert(h.log.some((entry) => entry[0] === "exec"));

h = harness({ native: () => { throw new Error("denied"); } });
await h.copyText("fallback");
assert(h.log.some((entry) => entry[0] === "exec"));

for (const options of [{ copied: false }, { throws: true }]) {
  h = harness(options);
  await assert.rejects(h.copyText("no"));
  assert(h.log.some((entry) => entry[0] === "remove"));
  assert(h.log.some((entry) => entry[0] === "restoreRange"));
  assert(h.log.some((entry) => entry[0] === "focus" && entry[1] === "active"));
}

const context = vm.createContext({ exports: {} });
vm.runInContext(source, context);
await assert.rejects(context.exports.copyText("server"));

console.log("PASS: native preferred; synchronous HTTP fallback; rejected/synchronous native errors fall back; failure rejects; textarea cleanup and focus/input/DOM selection restoration; no DOM rejects.");
