import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const websiteRoot = join(__dirname, '../packages/website')
const docsRoot = join(websiteRoot, 'docs')

// Skip all tests if website package doesn't exist (Phase 3 in TODO.md)
const websiteExists = existsSync(websiteRoot)

describe.skipIf(!websiteExists)('Website Setup', () => {
  describe('Project Structure', () => {
    it('should have website package directory', () => {
      expect(existsSync(websiteRoot)).toBe(true)
    })

    it('should have docs directory', () => {
      expect(existsSync(docsRoot)).toBe(true)
    })

    it('should have .vitepress directory', () => {
      const vitepressDir = join(docsRoot, '.vitepress')
      expect(existsSync(vitepressDir)).toBe(true)
    })

    it('should have VitePress config file', () => {
      const configFile = join(docsRoot, '.vitepress/config.ts')
      expect(existsSync(configFile)).toBe(true)
    })
  })

  describe('Package Configuration', () => {
    it('should have valid package.json', () => {
      const packagePath = join(websiteRoot, 'package.json')
      expect(existsSync(packagePath)).toBe(true)

      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(packageJson.name).toBe('@aiinstaller/website')
      expect(packageJson.description).toBe('AI Installer official website')
    })

    it('should have VitePress scripts', () => {
      const packagePath = join(websiteRoot, 'package.json')
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'))

      expect(packageJson.scripts.dev).toBe('vitepress dev docs')
      expect(packageJson.scripts.build).toBe('vitepress build docs')
      expect(packageJson.scripts.preview).toBe('vitepress preview docs')
    })

    it('should have VitePress as dev dependency', () => {
      const packagePath = join(websiteRoot, 'package.json')
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'))

      expect(packageJson.devDependencies).toBeDefined()
      expect(packageJson.devDependencies.vitepress).toBeDefined()
    })
  })

  describe('Content Pages', () => {
    it('should have home page', () => {
      const indexFile = join(docsRoot, 'index.md')
      expect(existsSync(indexFile)).toBe(true)

      const content = readFileSync(indexFile, 'utf-8')
      expect(content).toContain('AI Installer')
      expect(content).toContain('layout: home')
    })

    it('should have download page', () => {
      const downloadFile = join(docsRoot, 'download.md')
      expect(existsSync(downloadFile)).toBe(true)

      const content = readFileSync(downloadFile, 'utf-8')
      expect(content).toContain('下载')
      expect(content).toContain('macOS')
      expect(content).toContain('Linux')
      expect(content).toContain('Windows')
    })

    it('should have FAQ page', () => {
      const faqFile = join(docsRoot, 'faq.md')
      expect(existsSync(faqFile)).toBe(true)

      const content = readFileSync(faqFile, 'utf-8')
      expect(content).toContain('常见问题')
      expect(content).toContain('FAQ')
    })

    it('should have pricing page', () => {
      const pricingFile = join(docsRoot, 'pricing.md')
      expect(existsSync(pricingFile)).toBe(true)

      const content = readFileSync(pricingFile, 'utf-8')
      expect(content).toContain('价格')
      expect(content).toContain('免费版')
      expect(content).toContain('专业版')
    })
  })

  describe('Guide Pages', () => {
    it('should have guide directory', () => {
      const guideDir = join(docsRoot, 'guide')
      expect(existsSync(guideDir)).toBe(true)
    })

    it('should have getting started guide', () => {
      const gettingStartedFile = join(docsRoot, 'guide/getting-started.md')
      expect(existsSync(gettingStartedFile)).toBe(true)

      const content = readFileSync(gettingStartedFile, 'utf-8')
      expect(content).toContain('快速开始')
      expect(content).toContain('安装')
    })

    it('should have usage guide', () => {
      const usageFile = join(docsRoot, 'guide/usage.md')
      expect(existsSync(usageFile)).toBe(true)

      const content = readFileSync(usageFile, 'utf-8')
      expect(content).toContain('使用说明')
    })
  })

  describe('Content Quality', () => {
    it('home page should have hero section', () => {
      const indexFile = join(docsRoot, 'index.md')
      const content = readFileSync(indexFile, 'utf-8')

      expect(content).toContain('hero:')
      expect(content).toContain('name:')
      expect(content).toContain('tagline:')
      expect(content).toContain('actions:')
    })

    it('home page should have features', () => {
      const indexFile = join(docsRoot, 'index.md')
      const content = readFileSync(indexFile, 'utf-8')

      expect(content).toContain('features:')
      expect(content).toContain('AI 智能分析')
      expect(content).toContain('自动错误修复')
      expect(content).toContain('跨平台支持')
    })

    it('download page should have installation instructions', () => {
      const downloadFile = join(docsRoot, 'download.md')
      const content = readFileSync(downloadFile, 'utf-8')

      expect(content).toContain('一键安装脚本')
      expect(content).toContain('curl -fsSL')
      expect(content).toContain('手动下载')
    })

    it('FAQ page should have Q&A format', () => {
      const faqFile = join(docsRoot, 'faq.md')
      const content = readFileSync(faqFile, 'utf-8')

      expect(content).toContain('###')
      // Check for Chinese full-width question mark or ASCII question mark
      expect(content.includes('？') || content.includes('?')).toBe(true)
    })

    it('pricing page should have pricing tiers', () => {
      const pricingFile = join(docsRoot, 'pricing.md')
      const content = readFileSync(pricingFile, 'utf-8')

      expect(content).toContain('免费版')
      expect(content).toContain('专业版')
      expect(content).toContain('企业版')
      expect(content).toContain('$')
    })
  })

  describe('VitePress Configuration', () => {
    it('config should export default configuration', () => {
      const configPath = join(docsRoot, '.vitepress/config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('defineConfig')
      expect(content).toContain('export default defineConfig')
      expect(content).toContain('title:')
      expect(content).toContain('description:')
    })

    it('config should have navigation', () => {
      const configPath = join(docsRoot, '.vitepress/config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('nav:')
      expect(content).toContain('首页')
      expect(content).toContain('下载')
      expect(content).toContain('FAQ')
      expect(content).toContain('价格')
    })

    it('config should have sidebar', () => {
      const configPath = join(docsRoot, '.vitepress/config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('sidebar:')
      expect(content).toContain('指南')
    })

    it('config should have social links', () => {
      const configPath = join(docsRoot, '.vitepress/config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('socialLinks:')
      expect(content).toContain('github')
    })
  })
})
