import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        '/run/media/system/data/Projects/ratchet-ps2-cli/test-assets/extractions'
      ]
    }
  }
});
