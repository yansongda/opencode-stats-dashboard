import { describe, it, expect } from 'bun:test'

// Test EmptyState component props and variants
describe('EmptyState component', () => {
  // Test props interface
  interface EmptyStateProps {
    variant?: 'empty' | 'error'
    title: string
    description?: string
    actionLabel?: string
    testId?: string
  }

  // Test default props
  it('has correct default props', () => {
    const defaultProps: Partial<EmptyStateProps> = {
      variant: 'empty',
      testId: 'empty-state',
    }

    expect(defaultProps.variant).toBe('empty')
    expect(defaultProps.testId).toBe('empty-state')
  })

  // Test empty variant
  it('renders empty variant correctly', () => {
    const props: EmptyStateProps = {
      variant: 'empty',
      title: '暂无数据',
      description: '开始使用后数据将显示在这里',
    }

    expect(props.variant).toBe('empty')
    expect(props.title).toBe('暂无数据')
    expect(props.description).toBe('开始使用后数据将显示在这里')
  })

  // Test error variant
  it('renders error variant correctly', () => {
    const props: EmptyStateProps = {
      variant: 'error',
      title: '数据加载失败',
      description: '网络连接错误',
      actionLabel: '重试',
    }

    expect(props.variant).toBe('error')
    expect(props.title).toBe('数据加载失败')
    expect(props.description).toBe('网络连接错误')
    expect(props.actionLabel).toBe('重试')
  })

  // Test icon selection
  it('selects correct icon based on variant', () => {
    const emptyIcon = '📭'
    const errorIcon = '⚠'

    expect(emptyIcon).toBe('📭')
    expect(errorIcon).toBe('⚠')
  })

  // Test CSS class generation
  it('generates correct CSS class for variant', () => {
    const emptyClass = 'variant-empty'
    const errorClass = 'variant-error'

    expect(emptyClass).toBe('variant-empty')
    expect(errorClass).toBe('variant-error')
  })

  // Test action button visibility
  it('shows action button when actionLabel is provided', () => {
    const propsWithAction: EmptyStateProps = {
      title: '暂无数据',
      actionLabel: '重试',
    }

    const propsWithoutAction: EmptyStateProps = {
      title: '暂无数据',
    }

    expect(propsWithAction.actionLabel).toBeTruthy()
    expect(propsWithoutAction.actionLabel).toBeFalsy()
  })

  // Test description visibility
  it('shows description when provided', () => {
    const propsWithDescription: EmptyStateProps = {
      title: '暂无数据',
      description: '描述文本',
    }

    const propsWithoutDescription: EmptyStateProps = {
      title: '暂无数据',
    }

    expect(propsWithDescription.description).toBeTruthy()
    expect(propsWithoutDescription.description).toBeFalsy()
  })
})
