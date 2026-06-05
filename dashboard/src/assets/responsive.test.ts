import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const cssPath = resolve(import.meta.dir, '../assets/responsive.css')
const css = readFileSync(cssPath, 'utf-8')

describe('Responsive CSS', () => {
  describe('breakpoint system (§11.9)', () => {
    it('defines tablet breakpoint at 1279px (768-1279px range)', () => {
      expect(css).toContain('@media (max-width: 1279px)')
    })

    it('defines mobile breakpoint at 767px (<768px)', () => {
      expect(css).toContain('@media (max-width: 767px)')
    })

    it('does NOT use non-standard breakpoints (640px, 900px, 1024px)', () => {
      // These were the old inconsistent breakpoints
      const nonStandard = ['max-width: 640px', 'max-width: 900px', 'max-width: 1024px']
      for (const bp of nonStandard) {
        expect(css).not.toContain(bp)
      }
    })
  })

  describe('metric card grid classes', () => {
    it('defines resp-metrics-5 with 5-column grid (desktop)', () => {
      expect(css).toContain('.resp-metrics-5')
      expect(css).toContain('grid-template-columns: repeat(5, 1fr)')
    })

    it('defines resp-metrics-4 with 4-column grid (desktop)', () => {
      expect(css).toContain('.resp-metrics-4')
      expect(css).toContain('grid-template-columns: repeat(4, 1fr)')
    })

    it('collapses resp-metrics-5 to 2 columns on tablet', () => {
      // Find tablet media query block
      const tabletBlock = css.match(/@media \(max-width: 1279px\)\s*\{([\s\S]*?)\n\}/)
      expect(tabletBlock).not.toBeNull()
      expect(tabletBlock![1]).toContain('.resp-metrics-5')
      expect(tabletBlock![1]).toContain('grid-template-columns: repeat(2, 1fr)')
    })

    it('collapses resp-metrics-5 to 1 column on mobile', () => {
      // Find mobile media query block for resp-metrics-5
      const mobileBlocks = css.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/g)
      expect(mobileBlocks).not.toBeNull()
      const hasSingleCol = mobileBlocks!.some(
        (block) => block.includes('.resp-metrics-5') && block.includes('grid-template-columns: 1fr')
      )
      expect(hasSingleCol).toBe(true)
    })
  })

  describe('two-column layout class', () => {
    it('defines resp-two-col with 2-column grid', () => {
      expect(css).toContain('.resp-two-col')
    })

    it('collapses resp-two-col to single column on mobile', () => {
      const mobileBlocks = css.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/g)
      expect(mobileBlocks).not.toBeNull()
      const hasCollapse = mobileBlocks!.some(
        (block) => block.includes('.resp-two-col') && block.includes('grid-template-columns: 1fr')
      )
      expect(hasCollapse).toBe(true)
    })
  })

  describe('responsive header', () => {
    it('defines resp-header as flex', () => {
      expect(css).toContain('.resp-header')
    })

    it('stacks resp-header on mobile', () => {
      const mobileBlocks = css.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/g)
      expect(mobileBlocks).not.toBeNull()
      const hasStack = mobileBlocks!.some(
        (block) => block.includes('.resp-header') && block.includes('flex-direction: column')
      )
      expect(hasStack).toBe(true)
    })
  })

  describe('hamburger navigation', () => {
    it('defines nav-hamburger class', () => {
      expect(css).toContain('.nav-hamburger')
    })

    it('hides hamburger by default (desktop)', () => {
      expect(css).toContain('display: none')
    })

    it('shows hamburger on mobile', () => {
      const mobileBlocks = css.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/g)
      expect(mobileBlocks).not.toBeNull()
      const hasHamburger = mobileBlocks!.some(
        (block) => block.includes('.nav-hamburger') && block.includes('display: flex')
      )
      expect(hasHamburger).toBe(true)
    })

    it('defines collapsible nav links for mobile', () => {
      expect(css).toContain('.nav-links-collapsible')
      expect(css).toContain('.nav-links-collapsible.open')
    })
  })

  describe('responsive table', () => {
    it('defines resp-table-wrapper with overflow scroll', () => {
      expect(css).toContain('.resp-table-wrapper')
      expect(css).toContain('overflow-x: auto')
    })
  })

  describe('design system integration', () => {
    it('uses design tokens (CSS variables), not hardcoded values', () => {
      expect(css).toContain('var(--spacing-')
      expect(css).toContain('var(--border)')
      expect(css).toContain('var(--surface)')
      expect(css).toContain('var(--text)')
    })

    it('uses design system border-radius tokens', () => {
      expect(css).toContain('var(--radius-sm)')
    })
  })
})
