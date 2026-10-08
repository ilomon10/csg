import process from 'node:process';
import {createMDX} from 'fumadocs-mdx/next';

// Static export for GitHub Pages (spec 010 REQ-WEB-001/002). SITE_BASE_PATH is
// '' for a custom domain or '/<repo>' for a project page, never with a trailing slash.
const basePath = (process.env.SITE_BASE_PATH ?? '').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  images: {unoptimized: true},
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_REPO_URL:
      process.env.REPO_URL ?? 'https://github.com/ilomon10/csg',
    NEXT_PUBLIC_REPO_BRANCH: process.env.REPO_BRANCH ?? 'main',
    NEXT_PUBLIC_SITE_ENV: process.env.SITE_ENV ?? 'development',
    NEXT_PUBLIC_SITE_URL: process.env.SITE_URL ?? 'http://localhost:3000',
  },
};

const withMDX = createMDX();

export default withMDX(config);
