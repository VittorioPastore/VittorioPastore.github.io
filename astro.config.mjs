import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [tailwind(), react()],
  server: {
    host: true
  },
  site: 'https://www.vittoriopastore.com',
  // The post was first published under this address.
  redirects: {
    '/bones-seed-in-92-bytes': '/bones-seed-on-a-5070',
  },
  //base: 'Portfolio',
});