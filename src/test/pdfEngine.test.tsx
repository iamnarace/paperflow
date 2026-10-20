import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  formatBytes,
  parsePageRanges,
  generateSamplePdf,
  inspectPdfBuffer,
  mergePdfBuffers,
  organizePdfPages,
  updatePdfMetadata,
} from '../utils/pdfEngine';
import App from '../App';

describe('PaperFlow PDF Engine Unit & Integration Tests', () => {
  it('formats byte sizes accurately', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('parses human page range expressions and rejects invalid ranges', () => {
    expect(parsePageRanges('1-3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges('2, 4-5, 2', 5)).toEqual([1, 3, 4]);
    expect(() => parsePageRanges('', 5)).toThrow(/enter at least one/i);
    expect(() => parsePageRanges('1-7', 5)).toThrow(/out of bounds/i);
    expect(() => parsePageRanges('4-2', 5)).toThrow(/cannot be greater/i);
  });

  it('generates valid multi-page PDFs and inspects their metadata accurately', async () => {
    const bytes = await generateSamplePdf('Test Spec Doc', 'Unit Test Runner', 3);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const info = await inspectPdfBuffer(bytes);
    expect(info.pageCount).toBe(3);
    expect(info.title).toBe('Test Spec Doc');
    expect(info.author).toBe('Unit Test Runner');
    expect(info.pages).toHaveLength(3);
  });

  it('merges two distinct PDF buffers into a combined PDF with all pages', async () => {
    const pdfA = await generateSamplePdf('Doc A', 'Author A', 2);
    const pdfB = await generateSamplePdf('Doc B', 'Author B', 3);

    const merged = await mergePdfBuffers([pdfA, pdfB]);
    const info = await inspectPdfBuffer(merged);
    expect(info.pageCount).toBe(5);
  });

  it('extracts, reorders, and rotates selected pages from a PDF', async () => {
    const source = await generateSamplePdf('Source Doc', 'Author', 4);
    const info = await inspectPdfBuffer(source);

    // Keep only page 3 (rotated 90) and page 1 (in reverse order)
    const customConfig = [
      { ...info.pages[2], included: true, rotation: 90 },
      { ...info.pages[0], included: true, rotation: 0 },
      { ...info.pages[1], included: false, rotation: 0 },
      { ...info.pages[3], included: false, rotation: 0 },
    ];

    const resultBytes = await organizePdfPages(source, customConfig);
    const resultInfo = await inspectPdfBuffer(resultBytes);
    expect(resultInfo.pageCount).toBe(2);
    expect(resultInfo.pages[0].rotation).toBe(90);
    expect(resultInfo.pages[1].rotation).toBe(0);
  });

  it('updates and sanitizes PDF metadata fields', async () => {
    const source = await generateSamplePdf('Original Title', 'Original Author', 1);
    const updated = await updatePdfMetadata(source, {
      title: 'Sanitized Title',
      author: '',
    });
    const info = await inspectPdfBuffer(updated);
    expect(info.title).toBe('Sanitized Title');
    expect(info.author).toBe('');
  });

  it('renders the PaperFlow workbench UI and switches tool tabs cleanly', () => {
    render(<App />);
    expect(screen.getByText('PaperFlow')).toBeInTheDocument();
    expect(screen.getByText(/100% On-Device Processing/i)).toBeInTheDocument();

    const organizeTab = screen.getByRole('button', { name: /Split & Reorder Pages/i });
    fireEvent.click(organizeTab);
    expect(screen.getByText(/Split, Extract & Reorder Pages/i)).toBeInTheDocument();

    const inspectTab = screen.getByRole('button', { name: /Inspector & Metadata/i });
    fireEvent.click(inspectTab);
    expect(
      screen.getByText(/Document Inspector & Metadata Sanitizer/i)
    ).toBeInTheDocument();
  });
});
