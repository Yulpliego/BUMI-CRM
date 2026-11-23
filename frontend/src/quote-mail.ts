const crlf = '\r\n';

function mimeBase64(bytes: Uint8Array) {
  const chunks: string[] = [];
  // 57 bytes produce exactly 76 Base64 characters without padding between lines.
  for (let offset = 0; offset < bytes.length; offset += 57) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 57))));
  }
  return chunks.join(crlf);
}

export async function quoteMail(pdf: Blob, filename: string, email?: string) {
  const recipient = email?.trim();
  const lines = ['X-Unsent: 1', 'MIME-Version: 1.0'];
  if (recipient && /^[\w.!#$%&'*+/=?^_{}|~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipient)) lines.push('To: ' + recipient);
  const safeName = filename.replace(/[^a-z0-9._-]/gi, '_');
  const boundary = 'bumi-quote-pdf';
  const body = 'Hola,\r\n\r\nTe comparto la propuesta comercial de BUMI para tu revisión.\r\n\r\nSaludos.';
  return new Blob([lines.concat(
    'Subject: Propuesta comercial ' + safeName.replace(/\.pdf$/i, ''),
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    mimeBase64(new TextEncoder().encode(body)),
    '--' + boundary,
    'Content-Type: application/pdf; name="' + safeName + '"',
    'Content-Disposition: attachment; filename="' + safeName + '"',
    'Content-Transfer-Encoding: base64',
    '',
    mimeBase64(new Uint8Array(await pdf.arrayBuffer())),
    '--' + boundary + '--',
    '',
  ).join(crlf)], {type: 'message/rfc822'});
}
