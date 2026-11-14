import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ['index.html'], include: ['@breezystack/lamejs'] }, build: { assetsInlineLimit: 0 }, clearScreen: false, envPrefix: ['VITE_', 'TAURI_ENV_*'] });
