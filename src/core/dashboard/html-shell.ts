/**
 * HTML document wrapper for the Mink dashboard.
 * Assembles CSS, body HTML, and JS into a single self-contained page.
 */
export function htmlShell(content: {
  css: string;
  body: string;
  js: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mink Dashboard</title>
  <style>
${content.css}
  </style>
</head>
<body>
${content.body}
  <script>
${content.js}
  </script>
</body>
</html>`;
}
