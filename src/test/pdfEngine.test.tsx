import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  formatBytes,
  parsePageRanges,
  generateSamplePdf,
  inspectPdfBuffer,
  mergePdfBuffers,
  organizePdfPages,
  updatePdfMetadata,
  stripPdfMetadata,
} from '../utils/pdfEngine';
import App from '../App';

describe('PaperFlow PDF Engine Unit & Integration Tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

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
    expect(info.keywords).toContain('paperflow');
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

  it('updates individual PDF metadata fields without clobbering unspecified fields', async () => {
    const source = await generateSamplePdf('Original Title', 'Original Author', 1);
    const updated = await updatePdfMetadata(source, {
      title: 'Sanitized Title',
      author: '',
      keywords: 'alpha, beta',
    });
    const info = await inspectPdfBuffer(updated);
    expect(info.title).toBe('Sanitized Title');
    expect(info.author).toBe('');
    expect(info.keywords).toContain('alpha');
    expect(info.keywords).toContain('beta');
  });

  it('strips all /Info metadata fields (including Keywords, Producer, Dates) and XMP /Metadata streams while preserving PDF validity', async () => {
    // Build a representative PDF fixture with full /Info fields + embedded XMP packet + /PieceInfo
    const baseBytes = await generateSamplePdf('Confidential RFC', 'Jane Doe', 2);
    const doc = await PDFDocument.load(baseBytes);
    doc.setKeywords(['secret-project', 'internal-audit']);
    doc.setProducer('Custom Producer v9.9');
    doc.setCreationDate(new Date('2025-05-10T12:00:00Z'));
    doc.setModificationDate(new Date('2025-06-15T15:30:00Z'));

    const xmpXml =
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description dc:creator="XMP-Secret-Author-Tag"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    const xmpStream = doc.context.flateStream(xmpXml, {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    const xmpRef = doc.context.register(xmpStream);
    doc.catalog.set(PDFName.of('Metadata'), xmpRef);
    doc.catalog.set(PDFName.of('PieceInfo'), doc.context.obj({ PrivateApp: 'Secret' }));

    const fixtureBytes = await doc.save({ useObjectStreams: false });
    const beforeInfo = await inspectPdfBuffer(fixtureBytes);
    expect(beforeInfo.title).toBe('Confidential RFC');
    expect(beforeInfo.author).toBe('Jane Doe');
    expect(beforeInfo.keywords).toContain('secret-project');
    expect(beforeInfo.producer).toBe('Custom Producer v9.9');
    expect(beforeInfo.creationDate).toBe('2025-05-10');
    expect(beforeInfo.modificationDate).toBe('2025-06-15');
    expect(beforeInfo.hasXmpMetadata).toBe(true);

    // Execute full metadata sanitization
    const strippedBytes = await stripPdfMetadata(fixtureBytes);
    const afterInfo = await inspectPdfBuffer(strippedBytes);

    expect(afterInfo.pageCount).toBe(2);
    expect(afterInfo.title).toBe('');
    expect(afterInfo.author).toBe('');
    expect(afterInfo.subject).toBe('');
    expect(afterInfo.keywords).toBe('');
    expect(afterInfo.creator).toBe('');
    expect(afterInfo.producer).toBe('');
    expect(afterInfo.creationDate).toBe('None');
    expect(afterInfo.modificationDate).toBe('None');
    expect(afterInfo.hasXmpMetadata).toBe(false);

    // Verify catalog /PieceInfo was also removed
    const reloadedDoc = await PDFDocument.load(strippedBytes, { updateMetadata: false });
    expect(reloadedDoc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(reloadedDoc.catalog.get(PDFName.of('PieceInfo'))).toBeUndefined();
  });

  it('releases object URLs when images are removed or cleared without revoking URLs still in use', async () => {
    let urlCounter = 0;
    const createSpy = vi.fn(() => `blob:paperflow-test-${++urlCounter}`);
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createSpy,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeSpy,
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Images to PDF/i }));

    const fileInput = document.querySelector(
      'input[accept="image/png,image/jpeg,.png,.jpg,.jpeg"]'
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const makeFile = (name: string) => {
      const f = new File([new Uint8Array([137, 80, 78, 71])], name, {
        type: 'image/png',
      });
      Object.defineProperty(f, 'arrayBuffer', {
        value: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      });
      return f;
    };

    const fileA = makeFile('slide-a.png');
    const fileB = makeFile('slide-b.png');

    fireEvent.change(fileInput, { target: { files: [fileA, fileB] } });

    await waitFor(() => {
      expect(screen.getByText('slide-a.png')).toBeInTheDocument();
      expect(screen.getByText('slide-b.png')).toBeInTheDocument();
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).not.toHaveBeenCalled();

    // Remove slide-a.png -> only blob:paperflow-test-1 is revoked; blob:paperflow-test-2 stays active
    fireEvent.click(screen.getByRole('button', { name: /Remove slide-a\.png/i }));
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:paperflow-test-1');
    expect(screen.getByText('slide-b.png')).toBeInTheDocument();

    // Click Clear Images -> blob:paperflow-test-2 is now revoked
    fireEvent.click(screen.getByRole('button', { name: /Clear Images/i }));
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith('blob:paperflow-test-2');
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
