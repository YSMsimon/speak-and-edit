import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

// Values from .env / .env.local (never committed). See README.
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), 'WXT_');
const GOOGLE_CLIENT_ID = env.WXT_GOOGLE_CLIENT_ID ?? '';

// Public half of the key in .keys/ keeps the extension ID fixed
// (difgdgokainhimepkpdbhjhfnemkdlah), which Google sign-in needs.
const KEY_FILE = '.keys/public-key.b64';
const publicKey = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : undefined;

export default defineConfig({
  srcDir: 'src',
  // Screenshot builds (scripts/screens.mjs) and release builds (scripts/release.sh) go elsewhere,
  // so the copy Chrome has loaded isn't touched.
  ...(process.env.SCRIBE_OUT ? { outDir: process.env.SCRIBE_OUT } : {}),
  // The end-to-end smoke test page (src/entrypoints/smoke) ships only in SCRIBE_SMOKE=1 builds.
  ...(process.env.SCRIBE_SMOKE ? {} : { filterEntrypoints: ['background', 'meet', 'sidepanel'] }),
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    // The glass quotation mark, made for this project with OpenAI's image model (see THIRD_PARTY.md).
    baseIconPath: 'assets/logo.png',
  },
  manifest: {
    name: 'Speak and Edit',
    // At most 132 characters: the Chrome Web Store's limit.
    description: 'Say an edit in Google Meet and it lands in your Google Doc, Sheet or Slides, credited to whoever said it.',
    // Store builds (SCRIBE_STORE=1) leave the key out: the Web Store gives the extension its own ID.
    ...(publicKey && !process.env.SCRIBE_STORE ? { key: publicKey } : {}),
    // tabCapture + activeTab: record the Meet tab, only after a click.
    // scripting: add the caption reader to a Meet tab that was open before Scribe was installed or updated.
    // alarms: smoke builds only, to check the local smoke server every 30 s.
    // unlimitedStorage: saved meetings (this computer only); no prompt, and no 10 MB limit for a long day of calls.
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'identity', 'tabs', 'tabCapture', 'activeTab', 'scripting', ...(process.env.SCRIBE_SMOKE ? ['alarms'] : [])],
    host_permissions: [
      'https://meet.google.com/*',
      'https://docs.googleapis.com/*',
      'https://sheets.googleapis.com/*',
      'https://slides.googleapis.com/*',
      'https://www.googleapis.com/*',
      // Sign in with ChatGPT: the sign-in and token service, and the API the plan pays for.
      'https://auth.openai.com/*',
      'https://api.openai.com/*',
    ],
    ...(GOOGLE_CLIENT_ID
      ? {
          oauth2: {
            client_id: GOOGLE_CLIENT_ID,
            scopes: [
              'https://www.googleapis.com/auth/documents',
              'https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/presentations',
              // Only files Scribe creates: the "Scribe captures" folder and what's in it.
              'https://www.googleapis.com/auth/drive.file',
              // Your name and photo, so your own lines aren't labelled "You".
              'https://www.googleapis.com/auth/userinfo.profile',
            ],
          },
        }
      : {}),
    action: { default_title: 'Open Speak and Edit' },
  },
  vite: () => ({
    // Shown next to the version in the panel's header, so a reload that took is easy to see.
    define: {
      __SCRIBE_BUILT__: JSON.stringify(process.env.SCRIBE_BUILT ?? new Date().toISOString()),
      // Smoke builds only: reload on a new build and run the smoke test on request (scripts/smoke-server.mjs).
      __SCRIBE_SMOKE__: JSON.stringify(Boolean(process.env.SCRIBE_SMOKE)),
      __SCRIBE_SCREENS__: JSON.stringify(Boolean(process.env.SCRIBE_SCREENS)),
    },
    // Brand logos (Google Docs, Meet, ChatGPT…) from an Iconify set, compiled in at build time. See THIRD_PARTY.md.
    plugins: [tailwindcss(), Icons({ compiler: 'jsx', jsx: 'react' })],
    resolve: {
      alias: [
        { find: /^(streamdown|@streamdown\/(code|math|mermaid|cjk))$/, replacement: path.resolve('src/lib/streamdown-stub.ts') },
        { find: /^shiki$/, replacement: path.resolve('src/lib/shiki-lite.ts') },
      ],
    },
  }),
});
