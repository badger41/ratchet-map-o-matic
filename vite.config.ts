import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? './',
  plugins: [react()],
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
