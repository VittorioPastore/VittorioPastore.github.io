import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [tailwind(), react()],
  server: {
    host: true
  },
  site: 'https://www.vittoriopastore.com'
  //base: 'Portfolio',
});