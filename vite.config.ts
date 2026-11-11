import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The leaderboard server (npm run server) is reached through the dev server, so the game needs no CORS setup.
  server: { port: 5183, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
