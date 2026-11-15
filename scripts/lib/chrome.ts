/**
 * Headless Chrome on a DevTools connection, with software GL (SwiftShader): this machine has no headless WebGL for
 * node, so seeing what the game really draws goes through Chrome. Used by scripts/cover.ts.
 * Chrome not in a usual place: CHROME=/path/to/chrome
 * Chrome picks its own DevTools port (--remote-debugging-port=0) and writes it to DevToolsActivePort in the profile,
 * so two runs never fight over one port.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Message { id?: number; method?: string; params?: any; result?: any; error?: any }

export interface Chrome {
  /** Send one DevTools command and wait for its reply. */
  send(method: string, params?: object): Promise<Message>;
  /** Run JS in the page (it may await) and return its value; throws if the page throws. */
  evaluate<T>(expression: string): Promise<T>;
  /** Every DevTools message (events and replies) goes to fn. */
  on(fn: (m: Message) => void): void;
  close(): Promise<void>;
}

export async function launchChrome(windowSize = '800,600'): Promise<Chrome> {
  const chromePath = CHROMES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('Chrome not found: set CHROME=/path/to/chrome');
  const profile = mkdtempSync(join(tmpdir(), 'shift-cover-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--user-data-dir=${profile}`, `--window-size=${windowSize}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws: WebSocket | null = null;
  const close = async () => {
    ws?.close();
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Chrome has not let go yet */
    }
  };

  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    if (!ws) await sleep(200);
  }
  if (!ws) {
    await close();
    throw new Error('Chrome did not start');
  }
  const socket = ws;
  await new Promise((r) => socket.addEventListener('open', r));

  let seq = 0;
  const waiting = new Map<number, (m: Message) => void>();
  const listeners: ((m: Message) => void)[] = [];
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as Message;
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)!(m);
      waiting.delete(m.id);
    }
    for (const fn of listeners) fn(m);
  });
  const send = (method: string, params: object = {}) =>
    new Promise<Message>((r) => {
      const id = ++seq;
      waiting.set(id, r);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result?.result?.value as T;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close };
}
