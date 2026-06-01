export const apiDocsHtml = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dovetail API Reference</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/vendor/scalar-api-reference.js"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/api/openapi.json',
        telemetry: false
      })
    </script>
  </body>
</html>
`;
