// Exact replacements for the existing official Apps Script. Preserve signingSecret_,
// requireSession_, sameUser_ and assertOwner_. Do not add a route or alter credentials.
function createToken_(user, role, expiresAt, aclRevision) {
  const serialized = JSON.stringify(Object.assign({ user: user, role: role, exp: expiresAt, nonce: Utilities.getUuid() }, role === 'fiscal' ? { aclRevision: aclRevision } : {}));
  const body = Utilities.base64EncodeWebSafe(serialized, Utilities.Charset.UTF_8).replace(/=+$/, '');
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, signingSecret_())).replace(/=+$/, '');
  return body + '.' + signature;
}

function verifyToken_(token) {
  try {
    const parts = String(token || '').split('.'); if (parts.length !== 2) return null;
    const expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], signingSecret_())).replace(/=+$/, '');
    if (!constantTimeEquals_(parts[1], expected)) return null;
    const data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
    if (!data.user || !data.role || Number(data.exp) <= Date.now()) return null; return data;
  } catch (error) { return null; }
}
