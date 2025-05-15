// server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const WebSocket = require('ws');
const app = express();

// Configuration
const PORT = process.env.PORT || 8080;
const RAILWAY_DOMAIN = process.env.RAILWAY_STATIC_URL || "https://csmcfproxy-production.up.railway.app";

// WebSocket server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  
  // Determine target based on the request path
  let wsTarget;
  if (pathname.includes('agent-service')) {
    wsTarget = "wss://sesameai.app/agent-service-0/v1/connect";
  } else {
    wsTarget = "wss://sesameai.app" + pathname;
  }
  
  // Create a WebSocket connection to the target
  const targetWs = new WebSocket(wsTarget, {
    headers: {
      'Origin': 'https://www.sesame.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
    }
  });
  
  // Handle the connection setup
  targetWs.on('open', () => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Create bidirectional message forwarding
      targetWs.on('message', (message) => {
        ws.send(message);
      });
      
      ws.on('message', (message) => {
        targetWs.send(message);
      });
      
      // Handle connection closures
      targetWs.on('close', (code, reason) => {
        ws.close(code, reason);
      });
      
      ws.on('close', (code, reason) => {
        targetWs.close(code, reason);
      });
      
      // Handle errors
      targetWs.on('error', (err) => {
        console.error('Target WebSocket error:', err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'Error in target WebSocket');
        }
      });
      
      ws.on('error', (err) => {
        console.error('Client WebSocket error:', err);
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.close(1011, 'Error in client WebSocket');
        }
      });
    });
  });
  
  targetWs.on('error', (err) => {
    console.error('Error connecting to target WebSocket:', err);
    socket.destroy();
  });
});

// Create middleware to modify HTML responses
const modifyResponse = (proxyRes, req, res) => {
  // Only process HTML responses
  if (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html')) {
    let body = '';
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });
    
    proxyRes.on('end', () => {
      // Replace domain references
      let modifiedBody = body;
      modifiedBody = modifiedBody.replace(/https:\/\/www\.sesame\.com/g, `https://${RAILWAY_DOMAIN}`);
      modifiedBody = modifiedBody.replace(/https:\/\/sesame\.com/g, `https://${RAILWAY_DOMAIN}`);
      modifiedBody = modifiedBody.replace(/wss:\/\/sesameai\.app/g, `wss://${RAILWAY_DOMAIN}`);
      
      // Add script to focus on demo section
      modifiedBody = modifiedBody.replace('</body>', `
        <script>
          // Wait for the page to fully load
          window.addEventListener('load', function() {
            // Function to focus on the demo section
            function focusOnDemo() {
              // Check if the demo section exists
              const demoSection = document.querySelector('[id="demo"]');
              if (demoSection) {
                // Scroll to demo section
                demoSection.scrollIntoView();
                
                // Optional: Hide other content
                document.querySelectorAll('body > *').forEach(el => {
                  if (!el.contains(demoSection) && !demoSection.contains(el)) {
                    el.style.display = 'none';
                  }
                });
                
                // Make demo section more prominent
                demoSection.style.padding = '20px';
                demoSection.style.margin = '0 auto';
                demoSection.style.maxWidth = '1200px';
                
                return true;
              }
              return false;
            }
            
            // Try immediately, then retry a few times if the demo section isn't loaded yet
            let attempts = 0;
            const maxAttempts = 10;
            const checkInterval = setInterval(() => {
              if (focusOnDemo() || ++attempts >= maxAttempts) {
                clearInterval(checkInterval);
              }
            }, 500);
          });
        </script>
      </body>`);
      
      // Send the modified response
      // IMPORTANT: Don't try to set headers individually after sending the body
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'content-length': Buffer.byteLength(modifiedBody)
      });
      res.end(modifiedBody);
    });
    
    return true; // Indicates that we'll handle the response body
  }
  // For non-HTML responses, let the proxy middleware handle it normally
  return false;
};

// Create proxy middleware specifically for the demo page
const proxyOptions = {
  target: 'https://www.sesame.com',
  changeOrigin: true,
  pathRewrite: function (path) {
    // Always rewrite to the demo URL path regardless of the requested path
    return '/research/crossing_the_uncanny_valley_of_voice';
  },
  selfHandleResponse: true,  // We'll handle the response ourselves
  onProxyRes: modifyResponse,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
    'Origin': 'https://www.sesame.com',
    'Referer': 'https://www.sesame.com/'
  }
};

// Apply the proxy middleware to all routes
app.use('/', createProxyMiddleware(proxyOptions));

// Handle errors
app.use((err, req, res, next) => {
  console.error('Error in proxy:', err);
  if (!res.headersSent) {
    res.status(500).send(`
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
    `);
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
