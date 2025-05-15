// Cloudflare Worker script for Sesame AI proxy

// Configuration - change this to your actual worker domain once deployed
const WORKER_DOMAIN = "csmcfproxy.nvv1d.workers.dev";

// Main handler for incoming requests
addEventListener('fetch', event => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = event.request.headers.get('Upgrade');
  if (upgradeHeader === 'websocket') {
    return event.respondWith(handleWebSocketRequest(event.request));
  } else {
    return event.respondWith(handleHttpRequest(event.request));
  }
});

/**
 * Handles standard HTTP requests
 */
async function handleHttpRequest(request) {
  try {
    // Parse the URL
    const url = new URL(request.url);
    let targetUrl;
    
    // Default path redirects to the demo page
    if (url.pathname === '/' || url.pathname === '') {
      targetUrl = 'https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice#demo';
    } else {
      // Otherwise, forward the request to the appropriate path on sesame.com
      targetUrl = 'https://www.sesame.com' + url.pathname + url.search + url.hash;
    }

    // Create a new request with the original method, body, and headers
    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
      headers: new Headers(request.headers),
      redirect: 'follow',
    });

    // Remove headers that might cause issues
    modifiedRequest.headers.delete('host');
    modifiedRequest.headers.delete('origin');
    
    // Set host header to match target
    modifiedRequest.headers.set('host', new URL(targetUrl).hostname);
    modifiedRequest.headers.set('origin', 'https://www.sesame.com');
    modifiedRequest.headers.set('referer', 'https://www.sesame.com/');
    
    // Add a good user agent to avoid being blocked
    modifiedRequest.headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');

    // Fetch from the original site
    const response = await fetch(modifiedRequest);
    
    // Handle different content types
    const contentType = response.headers.get('content-type') || '';
    
    // For text-based responses, we need to modify URLs
    if (contentType.includes('text/html') || 
        contentType.includes('application/javascript') || 
        contentType.includes('text/javascript') ||
        contentType.includes('application/json')) {
      
      let text = await response.text();
      
      // Replace all references to Sesame domains with our worker domain
      text = text.replace(/https:\/\/www\.sesame\.com/g, `https://${WORKER_DOMAIN}`);
      text = text.replace(/https:\/\/sesame\.com/g, `https://${WORKER_DOMAIN}`);
      text = text.replace(/wss:\/\/sesameai\.app/g, `wss://${WORKER_DOMAIN}`);
      
      // Create new response with modified content
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } 
    // For binary responses, just pass through
    else {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
  } catch (error) {
    console.error('Error in HTTP handler:', error);
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sesame Voice Research Demo</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            text-align: center;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 600px;
            padding: 30px;
            background-color: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
          .footer { margin-top: 30px; font-size: 12px; color: #888; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Connection Issue</h1>
          <p>We're unable to connect to the Sesame Voice Research Demo server at this time. Please try again later.</p>
          <div class="footer">© 2025 Sesame AI Inc. All rights reserved.</div>
        </div>
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
    // Extract path from request URL
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Create appropriate WebSocket target URL
    let wsTarget;
    if (path.includes('agent-service')) {
      // Use the specific WebSocket endpoint you provided
      wsTarget = "wss://sesameai.app/agent-service-0/v1/connect";
    } else {
      // Default to the path with sesameai.app domain
      wsTarget = "wss://sesameai.app" + path;
    }
    
    // Accept the WebSocket connection
    const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
    
    // Accept our end of the connection
    serverSocket.accept();
    
    // Connect to upstream WebSocket (using fetch API with WebSocket)
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('host');
    proxyHeaders.set('host', new URL(wsTarget).hostname);
    proxyHeaders.set('origin', 'https://www.sesame.com');
    
    // Setup message forwarding
    const proxyWs = new WebSocket(wsTarget);
    
    // We need to handle the WebSocket connection manually
    proxyWs.addEventListener('open', () => {
      // When connection is established, setup bidirectional message forwarding
      
      // Forward messages from client to upstream server
      serverSocket.addEventListener('message', event => {
        if (proxyWs.readyState === WebSocket.OPEN) {
          proxyWs.send(event.data);
        }
      });
      
      // Forward messages from upstream server to client
      proxyWs.addEventListener('message', event => {
        if (serverSocket.readyState === WebSocket.OPEN) {
          serverSocket.send(event.data);
        }
      });
    });
    
    // Handle WebSocket errors and closures
    proxyWs.addEventListener('error', error => {
      console.error('Upstream WebSocket error:', error);
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close(1011, 'Upstream WebSocket error');
      }
    });
    
    proxyWs.addEventListener('close', event => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close(event.code, event.reason);
      }
    });
    
    serverSocket.addEventListener('close', event => {
      if (proxyWs.readyState === WebSocket.OPEN) {
        proxyWs.close(event.code, event.reason);
      }
    });
    
    serverSocket.addEventListener('error', error => {
      console.error('Client WebSocket error:', error);
      if (proxyWs.readyState === WebSocket.OPEN) {
        proxyWs.close(1011, 'Client WebSocket error');
      }
    });
    
    // Return the client end of the WebSocket to the client
    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  } catch (error) {
    console.error('Error in WebSocket handler:', error);
    return new Response('WebSocket connection failed', { status: 500 });
  }
}
