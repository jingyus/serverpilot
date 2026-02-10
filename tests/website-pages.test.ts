import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const websiteRoot = join(__dirname, '../packages/website')
const docsRoot = join(websiteRoot, 'docs')

// Skip all tests if website package doesn't exist (Phase 3 in TODO.md)
const websiteExists = existsSync(websiteRoot)

function readPage(filename: string): string {
  const filePath = join(docsRoot, filename)
  expect(existsSync(filePath)).toBe(true)
  return readFileSync(filePath, 'utf-8')
}

describe.skipIf(!websiteExists)('Website Pages - Acceptance Criteria', () => {
  describe('首页 (index.md) - 产品介绍 + 一键安装命令 + 核心卖点', () => {
    let content: string

    it('should exist and use VitePress home layout', () => {
      content = readPage('index.md')
      expect(content).toContain('layout: home')
    })

    it('should have product introduction (hero section)', () => {
      content = readPage('index.md')
      expect(content).toContain('hero:')
      expect(content).toContain('name: AI Installer')
      expect(content).toContain('text:')
      expect(content).toContain('tagline:')
    })

    it('should have call-to-action buttons', () => {
      content = readPage('index.md')
      expect(content).toContain('actions:')
      expect(content).toContain('快速开始')
      expect(content).toContain('/guide/getting-started')
    })

    it('should have one-click install command', () => {
      content = readPage('index.md')
      expect(content).toContain('curl -fsSL https://install.aiinstaller.dev | sh')
    })

    it('should have core selling points (features)', () => {
      content = readPage('index.md')
      expect(content).toContain('features:')

      // At least 4 key features
      const featureMatches = content.match(/- icon:/g)
      expect(featureMatches).not.toBeNull()
      expect(featureMatches!.length).toBeGreaterThanOrEqual(4)
    })

    it('should highlight AI capability', () => {
      content = readPage('index.md')
      expect(content).toContain('AI 智能分析')
    })

    it('should highlight error auto-fix', () => {
      content = readPage('index.md')
      expect(content).toContain('自动错误修复')
    })

    it('should highlight cross-platform support', () => {
      content = readPage('index.md')
      expect(content).toContain('跨平台支持')
    })

    it('should highlight one-click install', () => {
      content = readPage('index.md')
      expect(content).toContain('一键安装')
    })

    it('should have usage example', () => {
      content = readPage('index.md')
      expect(content).toContain('aiinstaller openclaw')
    })

    it('should have comparison section (why choose)', () => {
      content = readPage('index.md')
      expect(content).toContain('为什么选择 AI Installer')
    })

    it('should have download links for multiple platforms', () => {
      content = readPage('index.md')
      expect(content).toContain('macOS')
      expect(content).toContain('Linux')
    })

    it('should have community/support section', () => {
      content = readPage('index.md')
      expect(content).toContain('社区')
      expect(content).toContain('FAQ')
    })
  })

  describe('下载页 (download.md) - 各平台二进制 + 一键脚本', () => {
    let content: string

    it('should exist with proper title', () => {
      content = readPage('download.md')
      expect(content).toContain('# 下载')
    })

    it('should have one-click install script', () => {
      content = readPage('download.md')
      expect(content).toContain('一键安装脚本')
      expect(content).toContain('curl -fsSL https://install.aiinstaller.dev | sh')
    })

    it('should describe what the install script does', () => {
      content = readPage('download.md')
      expect(content).toContain('检测你的操作系统')
      expect(content).toContain('下载适合的二进制文件')
    })

    it('should have macOS download links (both architectures)', () => {
      content = readPage('download.md')
      expect(content).toContain('macOS (Apple Silicon')
      expect(content).toContain('macOS (Intel)')
      expect(content).toContain('darwin-arm64')
      expect(content).toContain('darwin-x64')
    })

    it('should have Linux download links', () => {
      content = readPage('download.md')
      expect(content).toContain('Linux (x64)')
      expect(content).toContain('Linux (ARM64)')
      expect(content).toContain('linux-x64')
      expect(content).toContain('linux-arm64')
    })

    it('should have Windows download link', () => {
      content = readPage('download.md')
      expect(content).toContain('Windows (x64)')
      expect(content).toContain('win-x64')
    })

    it('should have installation instructions for each platform', () => {
      content = readPage('download.md')
      expect(content).toContain('chmod +x')
      expect(content).toContain('/usr/local/bin')
    })

    it('should have build from source instructions', () => {
      content = readPage('download.md')
      expect(content).toContain('从源码构建')
      expect(content).toContain('pnpm install')
      expect(content).toContain('pnpm build')
    })

    it('should have system requirements', () => {
      content = readPage('download.md')
      expect(content).toContain('系统要求')
      expect(content).toContain('Node.js')
    })

    it('should have version history link', () => {
      content = readPage('download.md')
      expect(content).toContain('版本历史')
      expect(content).toContain('GitHub Releases')
    })
  })

  describe('FAQ 页面 (faq.md) - 常见问题列表', () => {
    let content: string

    it('should exist with proper title', () => {
      content = readPage('faq.md')
      expect(content).toContain('# 常见问题')
    })

    it('should have general questions section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 通用问题')
      expect(content).toContain('AI Installer 是什么')
    })

    it('should explain pricing in FAQ', () => {
      content = readPage('faq.md')
      expect(content).toContain('免费')
      expect(content).toContain('5 次')
    })

    it('should list supported operating systems', () => {
      content = readPage('faq.md')
      expect(content).toContain('macOS')
      expect(content).toContain('Linux')
      expect(content).toContain('Windows')
    })

    it('should explain how it works', () => {
      content = readPage('faq.md')
      expect(content).toContain('环境检测')
      expect(content).toContain('AI 分析')
      expect(content).toContain('执行安装')
      expect(content).toContain('错误修复')
    })

    it('should have installation troubleshooting section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 安装问题')
      expect(content).toContain('无法连接到服务器')
      expect(content).toContain('权限错误')
    })

    it('should have feature questions section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 功能问题')
      expect(content).toContain('支持哪些软件')
    })

    it('should have account and quota section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 账户和配额')
      expect(content).toContain('剩余安装次数')
    })

    it('should have data and privacy section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 数据和隐私')
      expect(content).toContain('不会')
    })

    it('should have technical questions section', () => {
      content = readPage('faq.md')
      expect(content).toContain('## 技术问题')
      expect(content).toContain('离线')
    })

    it('should have at least 10 Q&A entries', () => {
      content = readPage('faq.md')
      const questionHeaders = content.match(/### /g)
      expect(questionHeaders).not.toBeNull()
      expect(questionHeaders!.length).toBeGreaterThanOrEqual(10)
    })

    it('should have contact information', () => {
      content = readPage('faq.md')
      expect(content).toContain('support@aiinstaller.dev')
    })
  })

  describe('价格页面 (pricing.md) - 免费版 vs 专业版对比', () => {
    let content: string

    it('should exist with proper title', () => {
      content = readPage('pricing.md')
      expect(content).toContain('# 价格')
    })

    it('should have free tier', () => {
      content = readPage('pricing.md')
      expect(content).toContain('## 免费版')
      expect(content).toContain('$0')
      expect(content).toContain('每月 5 次免费安装')
    })

    it('should have professional tier', () => {
      content = readPage('pricing.md')
      expect(content).toContain('## 专业版')
      expect(content).toContain('$9.99')
      expect(content).toContain('无限次数安装')
    })

    it('should have enterprise tier', () => {
      content = readPage('pricing.md')
      expect(content).toContain('## 企业版')
      expect(content).toContain('定制价格')
      expect(content).toContain('私有部署')
    })

    it('should have feature comparison table', () => {
      content = readPage('pricing.md')
      expect(content).toContain('## 功能对比')
      expect(content).toContain('| 功能')
      expect(content).toContain('| 免费版')
      expect(content).toContain('| 专业版')
      expect(content).toContain('| 企业版')
    })

    it('should list key features for each tier', () => {
      content = readPage('pricing.md')
      // Free tier features
      expect(content).toContain('AI 智能分析和安装计划生成')
      expect(content).toContain('自动错误诊断和修复建议')
      expect(content).toContain('跨平台支持')

      // Pro tier extras
      expect(content).toContain('优先支持')
      expect(content).toContain('提前体验新功能')

      // Enterprise tier extras
      expect(content).toContain('SSO 单点登录')
      expect(content).toContain('SLA 保障')
    })

    it('should have target audience for each tier', () => {
      content = readPage('pricing.md')
      expect(content).toContain('个人')
      expect(content).toContain('专业开发者')
      expect(content).toContain('企业')
    })

    it('should have annual pricing option', () => {
      content = readPage('pricing.md')
      expect(content).toContain('$99 / 年')
      expect(content).toContain('节省')
    })

    it('should have pricing FAQ section', () => {
      content = readPage('pricing.md')
      expect(content).toContain('如何支付')
      expect(content).toContain('随时取消')
    })

    it('should have payment methods', () => {
      content = readPage('pricing.md')
      expect(content).toContain('信用卡')
      expect(content).toContain('PayPal')
      expect(content).toContain('支付宝')
      expect(content).toContain('微信支付')
    })

    it('should have CTA buttons', () => {
      content = readPage('pricing.md')
      expect(content).toContain('开始使用')
      expect(content).toContain('升级到专业版')
      expect(content).toContain('联系销售')
    })

    it('should have contact section', () => {
      content = readPage('pricing.md')
      expect(content).toContain('## 联系我们')
      expect(content).toContain('sales@aiinstaller.dev')
    })
  })

  describe('Guide Pages - Supporting Content', () => {
    it('getting-started.md should have quick start guide', () => {
      const content = readPage('guide/getting-started.md')
      expect(content).toContain('# 快速开始')
      expect(content).toContain('安装')
      expect(content).toContain('第一次使用')
    })

    it('getting-started.md should have install script', () => {
      const content = readPage('guide/getting-started.md')
      expect(content).toContain('curl -fsSL https://install.aiinstaller.dev | sh')
    })

    it('getting-started.md should show AI workflow', () => {
      const content = readPage('guide/getting-started.md')
      expect(content).toContain('检测环境')
      expect(content).toContain('生成安装计划')
    })

    it('getting-started.md should have common commands', () => {
      const content = readPage('guide/getting-started.md')
      expect(content).toContain('--help')
      expect(content).toContain('--version')
      expect(content).toContain('--dry-run')
      expect(content).toContain('--verbose')
    })

    it('usage.md should have detailed usage docs', () => {
      const content = readPage('guide/usage.md')
      expect(content).toContain('# 使用说明')
      expect(content).toContain('命令行参数')
    })

    it('usage.md should have command reference table', () => {
      const content = readPage('guide/usage.md')
      expect(content).toContain('| 参数')
      expect(content).toContain('--server')
      expect(content).toContain('--dry-run')
      expect(content).toContain('--yes')
      expect(content).toContain('--verbose')
    })

    it('usage.md should have installation workflow', () => {
      const content = readPage('guide/usage.md')
      expect(content).toContain('环境检测')
      expect(content).toContain('AI 分析')
      expect(content).toContain('确认执行')
      expect(content).toContain('错误处理')
    })

    it('usage.md should have troubleshooting section', () => {
      const content = readPage('guide/usage.md')
      expect(content).toContain('故障排查')
      expect(content).toContain('连接问题')
      expect(content).toContain('权限问题')
      expect(content).toContain('超时问题')
    })
  })

  describe('Cross-Page Consistency', () => {
    it('all pages should reference the same install command', () => {
      const installCmd = 'curl -fsSL https://install.aiinstaller.dev | sh'
      const index = readPage('index.md')
      const download = readPage('download.md')
      const gettingStarted = readPage('guide/getting-started.md')

      expect(index).toContain(installCmd)
      expect(download).toContain(installCmd)
      expect(gettingStarted).toContain(installCmd)
    })

    it('pricing should be consistent across pages', () => {
      const pricing = readPage('pricing.md')
      const faq = readPage('faq.md')

      // Both mention 5 free installs per month
      expect(pricing).toContain('5 次')
      expect(faq).toContain('5 次')
    })

    it('all pages should mention supported platforms consistently', () => {
      const index = readPage('index.md')
      const download = readPage('download.md')
      const faq = readPage('faq.md')

      for (const content of [index, download, faq]) {
        expect(content).toContain('macOS')
        expect(content).toContain('Linux')
      }
    })

    it('navigation pages should all exist', () => {
      // All pages referenced in nav config should exist
      expect(existsSync(join(docsRoot, 'index.md'))).toBe(true)
      expect(existsSync(join(docsRoot, 'download.md'))).toBe(true)
      expect(existsSync(join(docsRoot, 'faq.md'))).toBe(true)
      expect(existsSync(join(docsRoot, 'pricing.md'))).toBe(true)
      expect(existsSync(join(docsRoot, 'guide/getting-started.md'))).toBe(true)
      expect(existsSync(join(docsRoot, 'guide/usage.md'))).toBe(true)
    })
  })
})
