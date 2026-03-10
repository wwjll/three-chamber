const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createDocument({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --panel: rgba(255, 252, 246, 0.86);
      --text: #1f2937;
      --line: rgba(31, 41, 55, 0.12);
      --link: #0057b8;
      --shadow: 0 18px 50px rgba(76, 61, 41, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(255, 255, 255, 0.95), transparent 35%),
        linear-gradient(180deg, #e8dcc7 0%, var(--bg) 48%, #efe7da 100%);
      line-height: 1.7;
    }

    main {
      width: min(960px, calc(100% - 32px));
      margin: 40px auto 72px;
      padding: 40px 32px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }

    h1, h2, h3, h4, h5, h6 {
      line-height: 1.2;
      margin: 1.6em 0 0.6em;
    }

    h1 {
      margin-top: 0;
      font-size: clamp(2.2rem, 6vw, 4rem);
      letter-spacing: -0.04em;
    }

    h2 {
      padding-top: 0.35em;
      border-top: 1px solid var(--line);
      font-size: clamp(1.5rem, 3vw, 2rem);
    }

    p, ul, pre {
      margin: 0 0 1.1em;
    }

    ul {
      padding-left: 1.35rem;
    }

    li + li {
      margin-top: 1rem;
    }

    a {
      color: var(--link);
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.15em;
    }

    code {
      padding: 0.12em 0.35em;
      background: rgba(17, 24, 39, 0.08);
      border-radius: 6px;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 0.92em;
    }

    pre {
      overflow-x: auto;
      padding: 16px 18px;
      background: #111827;
      color: #f9fafb;
      border-radius: 14px;
    }

    pre code {
      padding: 0;
      background: transparent;
      color: inherit;
    }

    img {
      display: block;
      width: 100%;
      max-width: 100%;
      margin-top: 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
    }

    @media (max-width: 640px) {
      main {
        width: calc(100% - 20px);
        margin: 20px auto 40px;
        padding: 24px 18px;
        border-radius: 18px;
      }
    }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>
`;
}

async function main() {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('README.md');
  const outputPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve('examples/bundle/index.html');
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const { marked } = await import('marked');
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(inputPath, path.extname(inputPath));

  // Markdown rendering is delegated to the community parser.
  // This file only wraps the rendered fragment in a full HTML document.
  marked.setOptions({
    gfm: true,
    breaks: true
  });

  const body = marked.parse(markdown);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createDocument({ title, body }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
