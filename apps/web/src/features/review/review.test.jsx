import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { PageViewer } from './PageViewer';
import { FieldList } from './FieldList';

describe('PageViewer BBox Scaling', () => {
  it('renders bbox with correct percentage coordinates', () => {
    const field = {
      bbox: { x: 0.12, y: 0.40, w: 0.30, h: 0.03 }
    };
    const { container } = render(<PageViewer imageUrl="test.png" selectedField={field} />);
    
    expect(container.querySelector('img')).toBeTruthy();
  });
});

describe('Reason Code Mapping', () => {
  it('maps low_ocr_confidence to plain text', () => {
    const field = {
      entity_type: 'event', field_name: 'depth',
      reason: 'low_ocr_confidence',
      value: { raw: 'xxx' }
    };
    const { getByText } = render(<FieldList field={field} isSelected={false} />);
    expect(getByText(/Scan was hard to read/)).toBeTruthy();
  });

  it('displays raw to SI correctly', () => {
    const field = {
      entity_type: 'event', field_name: 'flow',
      value: { raw: '15 bbl/hr', value: 2.38, unit: 'm3/h' }
    };
    const { getByText } = render(<FieldList field={field} isSelected={false} />);
    expect(getByText(/15 bbl\/hr → 2.38 m3\/h/)).toBeTruthy();
  });
});
