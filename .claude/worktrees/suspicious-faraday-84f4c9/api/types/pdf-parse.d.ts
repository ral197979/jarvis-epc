/**
 * Minimal type declaration for pdf-parse.
 * The package ships no official types; we declare only what we use.
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    text:      string
    numpages?: number
    info?:     Record<string, unknown>
    metadata?: unknown
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>
  export = pdfParse
}
