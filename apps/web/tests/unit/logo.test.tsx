import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BrandMark, Logo } from '@bhd-r/ui';

describe('BHD R logo', () => {
  it('exposes the product and descriptor as one accessible label', () => {
    render(createElement(Logo, { descriptor: 'إدارة العقارات' }));
    expect(screen.getByLabelText('BHD R — إدارة العقارات')).toBeInTheDocument();
  });

  it('renders the official wordmark image for placeholders', () => {
    const { container } = render(createElement(BrandMark));
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/brand/bhd-official-symbol.svg');
  });
});
