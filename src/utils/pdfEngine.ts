import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

export interface PageConfig {
  pageNumber: number; // 1-based original page index
  rotation: number;   // 0, 90, 180, 270
  included: boolean;
  width: number;
  height: number;
}

export interface PdfMetadataInfo {
  pageCount: number;
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  creationDate: string;
  modificationDate: string;
  pages: PageConfig[];
}

/**
 * Formats byte count into human-readable file size string.
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Parses human page range syntax like "1-3, 5, 7-9" into 0-based page indices.
 * Throws a descriptive error if syntax is invalid or out of bounds.
 */
export function parsePageRanges(rangeInput: string, maxPages: number): number[] {
  const cleaned = rangeInput.trim();
  if (!cleaned) {
    throw new Error('Please enter at least one page number or range (e.g., 1-3, 5).');
  }

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  const selectedIndices: number[] = [];
  const seen = new Set<number>();

  for (const part of parts) {
    if (part.includes('-')) {
      const segments = part.split('-').map((s) => s.trim());
      if (segments.length !== 2 || !segments[0] || !segments[1]) {
        throw new Error(`Invalid range format "${part}". Expected "start-end" like "1-3".`);
      }
      const start = Number(segments[0]);
      const end = Number(segments[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Page numbers in "${part}" must be whole integers.`);
      }
      if (start < 1 || end < 1 || start > maxPages || end > maxPages) {
        throw new Error(`Range "${part}" is out of bounds. Document has ${maxPages} page${maxPages === 1 ? '' : 's'}.`);
      }
      if (start > end) {
        throw new Error(`Range start cannot be greater than end in "${part}".`);
      }
      for (let p = start; p <= end; p++) {
        const idx = p - 1;
        if (!seen.has(idx)) {
          seen.add(idx);
          selectedIndices.push(idx);
        }
      }
    } else {
      const pageNum = Number(part);
      if (!Number.isInteger(pageNum)) {
        throw new Error(`Invalid page number "${part}". Must be an integer.`);
      }
      if (pageNum < 1 || pageNum > maxPages) {
        throw new Error(`Page ${pageNum} is out of bounds. Document has ${maxPages} page${maxPages === 1 ? '' : 's'}.`);
      }
      const idx = pageNum - 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        selectedIndices.push(idx);
      }
    }
  }

  if (selectedIndices.length === 0) {
    throw new Error('No valid pages selected.');
  }

  return selectedIndices;
}

/**
 * Inspects a PDF buffer and returns metadata and per-page dimensions/rotations.
 */
export async function inspectPdfBuffer(buffer: Uint8Array): Promise<PdfMetadataInfo> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const pageCount = doc.getPageCount();
  const pages: PageConfig[] = [];

  for (let i = 0; i < pageCount; i++) {
    const p = doc.getPage(i);
    const { width, height } = p.getSize();
    const rot = p.getRotation().angle || 0;
    pages.push({
      pageNumber: i + 1,
      rotation: rot,
      included: true,
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  const creationDate = doc.getCreationDate();
  const modDate = doc.getModificationDate();

  return {
    pageCount,
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    creationDate: creationDate ? creationDate.toISOString().slice(0, 10) : 'Unknown',
    modificationDate: modDate ? modDate.toISOString().slice(0, 10) : 'Unknown',
    pages,
  };
}

/**
 * Merges multiple PDF byte buffers into a single PDF document.
 */
export async function mergePdfBuffers(buffers: Uint8Array[]): Promise<Uint8Array> {
  if (buffers.length === 0) {
    throw new Error('At least one PDF document is required to merge.');
  }

  const mergedPdf = await PDFDocument.create();
  for (const buf of buffers) {
    const sourcePdf = await PDFDocument.load(buf);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of copiedPages) {
      mergedPdf.addPage(page);
    }
  }

  mergedPdf.setProducer('PaperFlow Local PDF Engine (pdf-lib)');
  return await mergedPdf.save();
}

/**
 * Extracts, reorders, and rotates selected pages from a source PDF buffer.
 */
export async function organizePdfPages(
  sourceBuffer: Uint8Array,
  pageConfigs: PageConfig[]
): Promise<Uint8Array> {
  const activeConfigs = pageConfigs.filter((c) => c.included);
  if (activeConfigs.length === 0) {
    throw new Error('At least one page must remain included to build a PDF.');
  }

  const sourcePdf = await PDFDocument.load(sourceBuffer);
  const outputPdf = await PDFDocument.create();

  const indicesToCopy = activeConfigs.map((c) => c.pageNumber - 1);
  const copiedPages = await outputPdf.copyPages(sourcePdf, indicesToCopy);

  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    const targetRotation = activeConfigs[i].rotation % 360;
    page.setRotation(degrees(targetRotation));
    outputPdf.addPage(page);
  }

  outputPdf.setProducer('PaperFlow Local PDF Engine (pdf-lib)');
  return await outputPdf.save();
}

/**
 * Updates metadata fields in a PDF buffer and returns the updated PDF bytes.
 */
export async function updatePdfMetadata(
  sourceBuffer: Uint8Array,
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBuffer);
  if (metadata.title !== undefined) doc.setTitle(metadata.title);
  if (metadata.author !== undefined) doc.setAuthor(metadata.author);
  if (metadata.subject !== undefined) doc.setSubject(metadata.subject);
  if (metadata.creator !== undefined) doc.setCreator(metadata.creator);
  doc.setModificationDate(new Date());
  return await doc.save();
}

export interface ImageItemInput {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  name: string;
}

export interface ImageToPdfOptions {
  pageSize: 'A4' | 'LETTER' | 'FIT';
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  margin: number; // in points
}

/**
 * Converts an ordered list of PNG/JPEG images into a multi-page PDF.
 */
export async function convertImagesToPdf(
  images: ImageItemInput[],
  options: ImageToPdfOptions
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new Error('Please add at least one PNG or JPEG image to convert.');
  }

  const pdfDoc = await PDFDocument.create();

  for (const imgInput of images) {
    const embedded =
      imgInput.mimeType === 'image/png'
        ? await pdfDoc.embedPng(imgInput.bytes)
        : await pdfDoc.embedJpg(imgInput.bytes);

    const imgDims = embedded.scale(1);

    if (options.pageSize === 'FIT') {
      const m = options.margin * 2;
      const page = pdfDoc.addPage([imgDims.width + m, imgDims.height + m]);
      page.drawImage(embedded, {
        x: options.margin,
        y: options.margin,
        width: imgDims.width,
        height: imgDims.height,
      });
    } else {
      const baseDims =
        options.pageSize === 'A4'
          ? { width: 595.28, height: 841.89 }
          : { width: 612, height: 792 };

      const pageWidth =
        options.orientation === 'PORTRAIT' ? baseDims.width : baseDims.height;
      const pageHeight =
        options.orientation === 'PORTRAIT' ? baseDims.height : baseDims.width;

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const availWidth = Math.max(50, pageWidth - options.margin * 2);
      const availHeight = Math.max(50, pageHeight - options.margin * 2);

      const scale = Math.min(
        availWidth / imgDims.width,
        availHeight / imgDims.height,
        1
      );

      const drawWidth = imgDims.width * scale;
      const drawHeight = imgDims.height * scale;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;

      page.drawImage(embedded, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
      });
    }
  }

  pdfDoc.setProducer('PaperFlow Local PDF Engine (pdf-lib)');
  return await pdfDoc.save();
}

/**
 * Generates realistic multi-page sample PDF documents in-memory so users can test
 * merging, splitting, reordering, and metadata inspection immediately with one click.
 */
export async function generateSamplePdf(
  title: string,
  author: string,
  pageCount: number,
  accentHex: [number, number, number] = [0.85, 0.32, 0.22]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject('Sample Document Generated Locally by PaperFlow');
  doc.setCreator('PaperFlow Workbench');

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    // Header band
    page.drawRectangle({
      x: 48,
      y: height - 96,
      width: width - 96,
      height: 36,
      color: rgb(accentHex[0], accentHex[1], accentHex[2]),
    });

    page.drawText(`${title} — Section ${i}`, {
      x: 62,
      y: height - 83,
      size: 14,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText(`Author: ${author}  |  Local Sample Document`, {
      x: 48,
      y: height - 125,
      size: 10,
      font: fontRegular,
      color: rgb(0.35, 0.33, 0.31),
    });

    page.drawText(
      `This is page ${i} of ${pageCount}. PaperFlow processes all PDF byte streams directly inside your browser memory using pdf-lib without uploading files to any external server.`,
      {
        x: 48,
        y: height - 165,
        size: 11,
        font: fontRegular,
        color: rgb(0.15, 0.14, 0.13),
        maxWidth: width - 96,
        lineHeight: 16,
      }
    );

    // Footer
    page.drawText(`Page ${i} of ${pageCount}`, {
      x: width / 2 - 30,
      y: 42,
      size: 10,
      font: fontBold,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return await doc.save();
}
