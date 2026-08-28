import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the product name', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Vigil' })).toBeInTheDocument()
  })

  it('states that it is not an operational system', () => {
    render(<App />)
    expect(screen.getByText(/not for operational use/i)).toBeInTheDocument()
  })
})
