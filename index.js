// Cloudflare Worker script for Sesame AI proxy

// Configuration — change this to your actual worker domain once deployed
const WORKER_DOMAIN = "csmcfproxy.nvv1d.workers.dev";

addEventListener('fetch', event => {
  const upgradeHeader = event.request.headers.get('Upgrade');
  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
    return event.respondWith(handleWebSocketRequest(event.request));
  }
  return event.respondWith(handleHttpRequest(event.request));
});

/**
 * Handles standard HTTP requests
 */
async function handleHttpRequest(request) {
  try {
    const url = new URL(request.url);
    let targetUrl;

    // Default path → Sesame AI app
    if (url.pathname === '/' || url.pathname === '') {
      targetUrl = 'https://app.sesame.com';
    } else {
      targetUrl = 'https://app.sesame.com' + url.pathname + url.search + url.hash;
    }

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      headers: new Headers(request.headers),
      redirect: 'follow',
    });

    // Tweak headers for the upstream request
    modifiedRequest.headers.delete('host');
    modifiedRequest.headers.delete('origin');
    modifiedRequest.headers.set('host', new URL(targetUrl).hostname);
    modifiedRequest.headers.set('origin', 'https://app.sesame.com');
    modifiedRequest.headers.set('referer', 'https://app.sesame.com/');
    modifiedRequest.headers.set(
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/98.0.4758.102 Safari/537.36'
    );

    const response = await fetch(modifiedRequest);
    const contentType = response.headers.get('content-type') || '';

    // If text-based, rewrite all sesame URLs → your worker
    if (/(html|javascript|json)/.test(contentType)) {
      let text = await response.text();

      // 1) Rewrite Sesame app domain
      text = text.replace(
        /https:\/\/(www\.)?sesame\.com/g,
        `https://${WORKER_DOMAIN}`
      );

      // 2) Rewrite WebSocket endpoints (ws:// or wss://)
      text = text.replace(
        /(ws|wss):\/\/sesameai\.app/g,
        (_, scheme) => `${scheme}://${WORKER_DOMAIN}`
      );

      // 3) Rewrite any bare sesameai.app references
      text = text.replace(
        /sesameai\.app/g,
        WORKER_DOMAIN
      );

      // CORS headers
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // Binary passthrough
    const passthroughHeaders = new Headers(response.headers);
    passthroughHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: passthroughHeaders,
    });
  } catch (error) {
    console.error('Error in HTTP handler:', error);
    return new Response(`
      <!DOCTYPE html>
      <html><head><title>Connection Issue</title></head>
      <body>
        <h1>Connection Issue</h1>
        <p>We're unable to connect to the Sesame AI servers right now. Please try again later.</p>
        <footer>© 2025 Sesame AI Inc.</footer>
      </body>
      </html>
    `, {
      status: 503,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handles WebSocket connections
 */
async function handleWebSocketRequest(request) {
  try {
    const url = new URL(request.url);
    const pathAndQuery = url.pathname + url.search;

    // Preserve ws vs. wss based on incoming protocol
    const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:';

    // Forward every path to sesameai.app
    const wsTarget = `${wsScheme}//sesameai.app${pathAndQuery}`;

    // Create the Cloudflare WebSocket pair
    const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
    serverSocket.accept();

    // Prepare headers for upstream WS
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('host');
    proxyHeaders.set('host', new URL(wsTarget).hostname);
    proxyHeaders.set('origin', 'https://app.sesame.com');

    // Connect to upstream WebSocket
    const proxyWs = new WebSocket(wsTarget);

    proxyWs.addEventListener('open', () => {
      // Client → Upstream
      serverSocket.addEventListener('message', evt => {
        if (proxyWs.readyState === WebSocket.OPEN) {
          proxyWs.send(evt.data);
        }
      });
      // Upstream → Client
      proxyWs.addEventListener('message', evt => {
        if (serverSocket.readyState === WebSocket.OPEN) {
          serverSocket.send(evt.data);
        }
      });
    });

    // Error and close handlers
    proxyWs.addEventListener('error', err => {
      console.error('Upstream WS error:', err);
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close(1011, 'Upstream error');
      }
    });
    proxyWs.addEventListener('close', evt => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close(evt.code, evt.reason);
      }
    });
    serverSocket.addEventListener('close', evt => {
      if (proxyWs.readyState === WebSocket.OPEN) {
        proxyWs.close(evt.code, evt.reason);
      }
    });
    serverSocket.addEventListener('error', err => {
      console.error('Client WS error:', err);
      if (proxyWs.readyState === WebSocket.OPEN) {
        proxyWs.close(1011, 'Client error');
      }
    });

    // Return the client socket to the browser
    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  } catch (error) {
    console.error('Error in WebSocket handler:', error);
    return new Response('WebSocket connection failed', { status: 500 });
  }
}
