import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PDFDocument, PDFName, PDFDict, PDFString } from 'pdf-lib';
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

  it('strips all /Info metadata fields (including Keywords, Producer, Dates, Custom keys) and XMP /Metadata streams across catalog, page, and object levels while preserving PDF validity and page content', async () => {
    // Build a representative PDF fixture with full /Info fields + custom /Info key + catalog/page/object XMP packets + /PieceInfo
    const baseBytes = await generateSamplePdf('Confidential RFC', 'Jane Doe', 2);
    const doc = await PDFDocument.load(baseBytes);
    doc.setKeywords(['secret-project', 'internal-audit']);
    doc.setProducer('Custom Producer v9.9');
    doc.setCreationDate(new Date('2025-05-10T12:00:00Z'));
    doc.setModificationDate(new Date('2025-06-15T15:30:00Z'));

    // Add a custom non-standard /Info key
    if (doc.context.trailerInfo.Info) {
      const infoDict = doc.context.lookup(doc.context.trailerInfo.Info);
      if (infoDict instanceof PDFDict) {
        infoDict.set(PDFName.of('CustomCompanyID'), PDFString.of('ACME-SECRET-998877'));
      }
    }

    // 1. Catalog-level XMP stream
    const catalogXmpXml =
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description dc:creator="XMP-Catalog-Secret-Author"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    const catalogXmpStream = doc.context.flateStream(catalogXmpXml, {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(catalogXmpStream));
    doc.catalog.set(PDFName.of('PieceInfo'), doc.context.obj({ PrivateCatalogApp: 'SecretCatalogTool' }));

    // 2. Page-level XMP stream & PieceInfo on Page 1
    const pageXmpXml =
      '<?xpacket begin="" id="page1"?><x:xmpmeta><rdf:Description dc:description="Page-Level-XMP-Secret"/></x:xmpmeta><?xpacket end="w"?>';
    const pageXmpStream = doc.context.flateStream(pageXmpXml, {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    doc.getPage(0).node.set(PDFName.of('Metadata'), doc.context.register(pageXmpStream));
    doc.getPage(0).node.set(PDFName.of('PieceInfo'), doc.context.obj({ PrivatePageApp: 'SecretPageTool' }));

    // 3. Component-level XMP stream attached to an indirect object dictionary
    const componentXmpXml =
      '<?xpacket begin="" id="comp1"?><x:xmpmeta><rdf:Description dc:rights="Component-Level-XMP-Secret"/></x:xmpmeta><?xpacket end="w"?>';
    const componentXmpRef = doc.context.register(
      doc.context.flateStream(componentXmpXml, {
        Type: 'Metadata',
        Subtype: 'XML',
      })
    );
    const customResourceDict = doc.context.obj({
      Subtype: 'Form',
      Metadata: componentXmpRef,
      PieceInfo: { PrivateResource: 'SecretComponentTool' },
    });
    const customResourceRef = doc.context.register(customResourceDict);

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
    expect(afterInfo.pages[0].width).toBe(beforeInfo.pages[0].width);
    expect(afterInfo.pages[0].height).toBe(beforeInfo.pages[0].height);
    expect(afterInfo.title).toBe('');
    expect(afterInfo.author).toBe('');
    expect(afterInfo.subject).toBe('');
    expect(afterInfo.keywords).toBe('');
    expect(afterInfo.creator).toBe('');
    expect(afterInfo.producer).toBe('');
    expect(afterInfo.creationDate).toBe('None');
    expect(afterInfo.modificationDate).toBe('None');
    expect(afterInfo.hasXmpMetadata).toBe(false);

    // Verify catalog, page, and component /Metadata & /PieceInfo were removed and page content streams remain intact
    const reloadedDoc = await PDFDocument.load(strippedBytes, { updateMetadata: false });
    expect(reloadedDoc.context.trailerInfo.Info).toBeUndefined();
    expect(reloadedDoc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(reloadedDoc.catalog.get(PDFName.of('PieceInfo'))).toBeUndefined();
    expect(reloadedDoc.getPage(0).node.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(reloadedDoc.getPage(0).node.get(PDFName.of('PieceInfo'))).toBeUndefined();
    expect(reloadedDoc.getPage(0).node.Contents()).toBeDefined();
    expect(reloadedDoc.getPage(1).node.Contents()).toBeDefined();

    const reloadedResource = reloadedDoc.context.lookup(customResourceRef);
    if (reloadedResource instanceof PDFDict) {
      expect(reloadedResource.get(PDFName.of('Metadata'))).toBeUndefined();
      expect(reloadedResource.get(PDFName.of('PieceInfo'))).toBeUndefined();
    }

    // Verify raw serialized output bytes do not contain the stripped /Info or XMP metadata strings
    const rawOutputText = new TextDecoder('latin1').decode(strippedBytes);
    expect(rawOutputText.startsWith('%PDF-')).toBe(true);
    expect(rawOutputText).not.toContain('secret-project');
    expect(rawOutputText).not.toContain('Custom Producer v9.9');
    expect(rawOutputText).not.toContain('ACME-SECRET-998877');
    expect(rawOutputText).not.toContain('XMP-Catalog-Secret-Author');
    expect(rawOutputText).not.toContain('Page-Level-XMP-Secret');
    expect(rawOutputText).not.toContain('Component-Level-XMP-Secret');
    expect(rawOutputText).not.toContain('SecretCatalogTool');
    expect(rawOutputText).not.toContain('SecretPageTool');
    expect(rawOutputText).not.toContain('SecretComponentTool');
  });

  it('detects page-level XMP metadata even when catalog /Metadata is absent', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const pageXmp = doc.context.flateStream('<x:xmpmeta>page-only</x:xmpmeta>', {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    page.node.set(PDFName.of('Metadata'), doc.context.register(pageXmp));
    const bytes = await doc.save();

    const inspectedBefore = await inspectPdfBuffer(bytes);
    expect(inspectedBefore.hasXmpMetadata).toBe(true);

    const sanitized = await stripPdfMetadata(bytes);
    const inspectedAfter = await inspectPdfBuffer(sanitized);
    expect(inspectedAfter.hasXmpMetadata).toBe(false);
  });

  it('fails safely with descriptive errors on empty, non-PDF, or corrupted byte buffers', async () => {
    const emptyBytes = new Uint8Array(0);
    await expect(inspectPdfBuffer(emptyBytes)).rejects.toThrow(/empty|too small/i);
    await expect(stripPdfMetadata(emptyBytes)).rejects.toThrow(/empty|too small/i);

    const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>Not a PDF</body></html>');
    await expect(inspectPdfBuffer(htmlBytes)).rejects.toThrow(/missing %PDF-/i);
    await expect(stripPdfMetadata(htmlBytes)).rejects.toThrow(/missing %PDF-/i);
    await expect(mergePdfBuffers([htmlBytes])).rejects.toThrow(/missing %PDF-/i);

    const corruptedPdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages CORRUPTED_STREAM');
    await expect(inspectPdfBuffer(corruptedPdfBytes)).rejects.toThrow();
    await expect(stripPdfMetadata(corruptedPdfBytes)).rejects.toThrow();
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
