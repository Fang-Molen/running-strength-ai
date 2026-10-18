import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';

/** Trust only the explicit development proxy CA already configured for Node.
 * Chromium does not inherit NODE_EXTRA_CA_CERTS. Never disable TLS validation
 * globally; an absent CA setting leaves normal browser trust unchanged.
 */
export function browserProxyTrustArgs() {
  const path = process.env.NODE_EXTRA_CA_CERTS;
  if (!path) return [];
  const certificates = readFileSync(path, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const pins = certificates.map(pem => {
    const cert = new X509Certificate(pem);
    if (!cert.ca) throw new Error('Configured browser proxy trust must be a CA certificate');
    const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(spki).digest('base64');
  });
  return pins.length ? [`--ignore-certificate-errors-spki-list=${pins.join(',')}`] : [];
}
