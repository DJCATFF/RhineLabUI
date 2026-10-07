// Minimal synthetic Office package: content types, root relationships and a single paragraph.
export const docx = Buffer.from(
  'UEsDBBQAAAAIAPd+R11hey9DkAAAAPIAAAALAAAAX3JlbHMvLnJlbHOMzzEOAiEQBdCrkDnAzmphYYDKZluzFyAwuxCBIYBxvb2NxWosbH9+3s+XV4qmB87Nh9LElmJuCnzv5YzYrKdk2sCF8pbiwjWZ3gauKxZjb2YlPI7jCeveAC33ppicgjq5A4j5Wegfm5clWLqwvSfK/cfEVwPEbOpKXcGDq0P3joctRUAt8eOifgEAAP//AwBQSwMEFAAAAAgA935HXcGQa6aTAAAAqAAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLIpt0rJTy7NTc0rUajIzckrtiq3VcooKSmw0tcvTs5IzU0s1ssvSM2ryM1Jyy/KTSwp1ssvStcvzy9KKSjKT04tLs7MS8/N0TcyMDDTz03MzFOysym3SspPqQTRBSCiCESU2DkGuEYouPg7Ryg82bH22bT2l6t6XqxvtNEHyYHIIjBZACYh+vURbrMDAAAA//8DAFBLAwQUAAAACAD3fkdddCScU8UAAAA+AQAAEwAAAFtDb250ZW50X1R5cGVzXS54bWyUkDFOxEAMRa8STYt2vKKgQEkaoAUKLmBNnGTE2B6NvUu4PcoCW9BR+/3/vty/fVaybuMiNoTVvd4DWFqJ0aJWko3LrI3RLWpboGJ6x4Xg9ni8g6TiJH7wvSOM/SPNeCrePW1OYlllCI2Khe7hG9xdQ8BaS07oWQXOMv2xHH4MsVG5MLbmajcblwBj/3Km1vJE3Ss2f0amIcCHtgkmTScm8biD//LpPOdE1/zeVpsmMsuycInXC2OW3x1wedv4BQAA//8DAFBLAQIUABQAAAAIAPd+R11hey9DkAAAAPIAAAALAAAAAAAAAAAAAAAAAAAAAABfcmVscy8ucmVsc1BLAQIUABQAAAAIAPd+R13BkGumkwAAAKgAAAARAAAAAAAAAAAAAAAAALkAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUABQAAAAIAPd+R110JJxTxQAAAD4BAAATAAAAAAAAAAAAAAAAAHsBAABbQ29udGVudF9UeXBlc10ueG1sUEsFBgAAAAADAAMAuQAAAHECAAAAAA==',
  'base64',
);

// One-page PDF with a real text stream and calculated cross-reference offsets.
const stream = 'BT /F1 12 Tf 72 720 Td (APEX PDF extraction verification) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let source = '%PDF-1.4\n';
const offsets = [0];
for (const [i, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(source));
  source += `${i + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(source);
source += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
export const pdf = Buffer.from(source);
