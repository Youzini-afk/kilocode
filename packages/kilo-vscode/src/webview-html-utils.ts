/**
 * Build the Content-Security-Policy connect-src directive value.
 * If a port is specified, restricts connections to that port.
 * Otherwise, allows any localhost/127.0.0.1 port.
 */
export function buildConnectSrc(port?: number): string {
  if (port) {
    return `http://127.0.0.1:${port} http://localhost:${port} ws://127.0.0.1:${port} ws://localhost:${port}`
  }
  return "http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
}

/**
 * Build the Content-Security-Policy frame-src directive value for local plugin settings iframes.
 */
export function buildFrameSrc(port?: number): string {
  if (port) {
    return `http://127.0.0.1:${port} http://localhost:${port}`
  }
  return "http://127.0.0.1:* http://localhost:*"
}

/**
 * Join an array of CSP directives into a policy string.
 */
function joinCspDirectives(directives: string[]): string {
  return directives.join("; ")
}

/**
 * Build the full CSP policy string for a webview.
 */
export function buildCspString(cspSource: string, nonce: string, port?: number): string {
  const connectSrc = buildConnectSrc(port)
  const frameSrc = buildFrameSrc(port)
  const directives = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${cspSource}`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource} ${connectSrc}`,
    `frame-src ${cspSource} ${frameSrc}`,
    `child-src ${cspSource} ${frameSrc}`,
    `img-src ${cspSource} data: https:`,
  ]
  return joinCspDirectives(directives)
}
