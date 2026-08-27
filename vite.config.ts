import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { GcPreviewWadsPlugin } from './vite/previewWads/GcPreviewWadsPlugin.ts';
import { UyaPreviewWadsPlugin } from './vite/previewWads/UyaPreviewWadsPlugin.ts';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? './',
  plugins: [react(), new GcPreviewWadsPlugin(), new UyaPreviewWadsPlugin()],
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        '/run/media/system/data/Projects/ratchet-ps2-cli/test-assets/extractions',
        '/run/media/system/data/Projects/ratchet-ps2-cli/test-assets/extractions_uya'
      ]
    }
  }
});
