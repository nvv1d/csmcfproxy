// pages/api/[[...path]].js
import { NextResponse } from 'next/server';

// Configuration
const VERCEL_DOMAIN = process.env.VERCEL_URL || "https://csmcfproxy.vercel.app";

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    // Only allow access to the demo page
    const demoUrl = 'https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice#demo';
    
    // Extract path for WebSocket handling
    const url = new URL(req.url);
    
    // Handle WebSocket connections
    if (req.headers.get('Upgrade') === 'websocket') {
      // This is a WebSocket connection request
      let wsTarget;
      if (url.pathname.includes('agent-service')) {
        wsTarget = "wss://sesameai.app/agent-service-0/v1/connect";
      } else {
        wsTarget = "wss://sesameai.app" + url.pathname;
      }
      
      // For websocket connections, we need to return a 101 response
      // Note: Next.js Edge Runtime doesn't directly support WebSockets
      // You'd need to use a WebSocket-capable service behind this
      return new Response('WebSockets not supported directly in this version', { status: 501 });
    }
    
    // Regular HTTP request - always redirect to the demo page
    const modifiedRequest = new Request(demoUrl, {
      method: req.method,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : null,
      headers: new Headers(req.headers),
      redirect: 'follow',
    });
    
    // Clean up headers
    modifiedRequest.headers.delete('host');
    modifiedRequest.headers.set('host', 'www.sesame.com');
    modifiedRequest.headers.set('origin', 'https://www.sesame.com');
    modifiedRequest.headers.set('referer', 'https://www.sesame.com/');
    modifiedRequest.headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');
    
    // Fetch from the original site
    const response = await fetch(modifiedRequest);
    const contentType = response.headers.get('content-type') || '';
    
    // Process the response content for text-based responses
    if (contentType.includes('text/html') || 
        contentType.includes('application/javascript') || 
        contentType.includes('text/javascript') ||
        contentType.includes('application/json')) {
      
      let text = await response.text();
      
      // Replace domain references
      text = text.replace(/https:\/\/www\.sesame\.com/g, `https://${VERCEL_DOMAIN}`);
      text = text.replace(/https:\/\/sesame\.com/g, `https://${VERCEL_DOMAIN}`);
      text = text.replace(/wss:\/\/sesameai\.app/g, `wss://${VERCEL_DOMAIN}`);
      
      // Add JavaScript to ensure we only see the demo section
      text = text.replace('</body>', `
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
                document.querySelectorAll('body > *:not(:has(#demo))').forEach(el => {
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
    } else {
      // For binary responses
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
  } catch (error) {
    console.error('Error in handler:', error);
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
