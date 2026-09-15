import { Buffer } from "buffer";

// node-postgres uses only this small subset of Node's process API in its
// browser-compatible execution paths. Keep it lexical to the bundle instead
// of installing a global Node process polyfill in the browser.
const process = {
  env: {} as Record<string, string | undefined>,
  platform: "browser",
  domain: undefined,
  nextTick(callback: (...args: any[]) => void, ...args: any[]) {
    queueMicrotask(() => callback(...args));
  },
};

const global = globalThis;
export { Buffer, process, global };
