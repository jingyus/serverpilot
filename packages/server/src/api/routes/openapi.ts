// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAPI documentation routes.
 *
 * Serves the OpenAPI JSON spec and a Swagger UI page
 * for interactive API exploration and testing.
 *
 * - GET /api-docs           → Swagger UI (HTML)
 * - GET /api-docs/openapi.json → OpenAPI 3.0 spec
 *
 * @module api/routes/openapi
 */

import { Hono } from 'hono';
import { generateOpenAPIDocument } from './openapi-spec.js';

const openapi = new Hono();

// ============================================================================
// GET /api-docs/openapi.json — Raw OpenAPI spec
// ============================================================================

openapi.get('/openapi.json', (c) => {
  const doc = generateOpenAPIDocument();
  return c.json(doc);
});

// ============================================================================
// GET /api-docs — Swagger UI
// ============================================================================

openapi.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ServerPilot API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .info .title { font-size: 2rem; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api-docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

export { openapi };
