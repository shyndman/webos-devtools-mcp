#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {PageSession} from '../dist/pageSession.js';
import {OverlayManager} from '../dist/overlayManager.js';

const [, , endpointArg, outputArg] = process.argv;
const endpoint = endpointArg ?? process.env.PAGE_WS_ENDPOINT;

if (!endpoint) {
  console.error('Usage: node scripts/capture-focus-overlay.mjs <ws-endpoint> [output-path]');
  console.error('Or set PAGE_WS_ENDPOINT and omit the first argument.');
  process.exit(1);
}

const outputPath = outputArg ?? path.resolve('focus-overlay.png');

(async () => {
  const session = new PageSession(endpoint);
  const overlay = new OverlayManager(session);
  try {
    await session.connect();
    const {screenshot} = await overlay.highlightFocused();
    if (screenshot) {
      await fs.writeFile(outputPath, Buffer.from(screenshot, 'base64'));
    } else {
      console.warn('No screenshot returned; writing empty file.');
      await fs.writeFile(outputPath, Buffer.alloc(0));
    }
    console.log(`Saved focus overlay screenshot to ${outputPath}`);
  } finally {
    await overlay.hide().catch(() => {});
    await session.dispose().catch(() => {});
  }
})().catch(error => {
  console.error('Failed to capture focus overlay screenshot:', error);
  process.exit(1);
});
