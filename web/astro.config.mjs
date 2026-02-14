import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [
    react(),
    tailwind(),
    mdx()
  ],
  output: 'static',
  site: 'https://serverpilot.ai', // 替换为实际域名
  build: {
    assets: 'assets'
  }
});
