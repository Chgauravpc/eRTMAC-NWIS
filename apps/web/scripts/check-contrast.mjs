// PRD FE-17: text contrast >= 4.5:1 (rig view >= 7:1). Static check of the Tailwind classes in src/**/*.jsx.
//
// Each JSX element's text colour is tested against the background it really sits on: its own background
// class if it has one, otherwise the one it inherits from the nearest ancestor in the same file (translucent
// backgrounds are blended over what is behind them). A component that is rendered inside another file's
// surface (for example a workspace tab inside the dark workspace) starts from the surface listed in
// FILE_SURFACE below.
//
// Rules: 4.5:1 for text, 3:1 for large text (>= 24 px, or >= 20 px bold) and for icons, 7:1 in the rig view.
// Skipped on purpose: hover:/focus:/disabled: variants (state styles) and colours that are not Tailwind
// tokens (CSS variables). When one element lists several backgrounds (a selected / unselected state),
// every one of them is tested.
//
//   node scripts/check-contrast.mjs            # exit 1 when something fails
//   node scripts/check-contrast.mjs --list     # every checked pair, worst first
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const colors = require('tailwindcss/colors');
const { parse } = require('@babel/parser');

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LIST = process.argv.includes('--list');
const SKIP_DIR = new Set(['mocks', 'test', 'dev']);

const WHITE = '#ffffff';
const PAGE = '#f4f6f9'; // the light app shell behind every page (Layout.jsx)
const DARK = '#0f172a'; // dark workspace surface (WorkspaceLayout)
const RIG = '#111111'; // .rig theme background

/** Surface a file starts from when none of its own ancestors set one (first matching prefix wins). */
const FILE_SURFACE = [
  ['features/rig/', RIG],
  ['app/RigShell.jsx', RIG],
  ['features/workspace/', DARK],
  ['features/correlation/', DARK],
  ['features/risk/', DARK],
  ['features/landing/', WHITE],
];
const RIG_FILES = (rel) => rel.startsWith('features/rig/') || rel === 'app/RigShell.jsx';

// ---------------------------------------------------------------- colour maths
const hex = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.replace(/(.)/g, '$1$1') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg, bg, alpha) => {
  const f = hex(fg);
  const b = hex(bg);
  return `#${f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
};

function colorOf(token) {
  if (token === 'white') return WHITE;
  if (token === 'black') return '#000000';
  if (token === 'transparent' || token === 'current' || token === 'inherit') return null;
  const arb = token.match(/^\[(#[0-9a-fA-F]{3,6})\]$/);
  if (arb) return arb[1].length === 4 ? `#${arb[1].slice(1).replace(/(.)/g, '$1$1')}`.toLowerCase() : arb[1].toLowerCase();
  const m = token.match(/^([a-z]+)-(\d{2,3})$/);
  if (m && colors[m[1]] && colors[m[1]][m[2]]) return colors[m[1]][m[2]].toLowerCase();
  return null;
}

// ---------------------------------------------------------------- class parsing
const COLOR_TOKEN = '(?:white|black|\\[#[0-9a-fA-F]{3,6}\\]|[a-z]+-\\d{2,3})';
const TEXT_RE = new RegExp(`^text-(${COLOR_TOKEN})(?:/(\\d{1,3}))?$`);
const BG_RE = new RegExp(`^bg-(${COLOR_TOKEN})(?:/(\\d{1,3}))?$`);
const PLACEHOLDER_RE = new RegExp(`^placeholder:text-(${COLOR_TOKEN})(?:/(\\d{1,3}))?$`);
const SIZE_PX = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36, 'text-5xl': 48, 'text-6xl': 60, 'text-7xl': 72 };
const BOLD = new Set(['font-bold', 'font-semibold', 'font-extrabold', 'font-black']);

function parseClasses(str) {
  const tokens = str.split(/\s+/).filter(Boolean);
  const out = { text: [], bg: [], placeholder: [], px: 16, bold: false };
  for (const t of tokens) {
    if (SIZE_PX[t]) out.px = SIZE_PX[t];
    const arb = t.match(/^text-\[(\d+)px\]$/);
    if (arb) out.px = Number(arb[1]);
    if (BOLD.has(t)) out.bold = true;
    let m;
    if ((m = t.match(TEXT_RE))) out.text.push({ color: colorOf(m[1]), name: t, alpha: m[2] ? Number(m[2]) / 100 : 1 });
    else if ((m = t.match(BG_RE))) out.bg.push({ color: colorOf(m[1]), name: t, alpha: m[2] ? Number(m[2]) / 100 : 1 });
    else if ((m = t.match(PLACEHOLDER_RE))) out.placeholder.push({ color: colorOf(m[1]), name: t, alpha: m[2] ? Number(m[2]) / 100 : 1 });
  }
  out.text = out.text.filter((x) => x.color);
  out.bg = out.bg.filter((x) => x.color);
  out.placeholder = out.placeholder.filter((x) => x.color);
  return out;
}

/** Every string literal that feeds an element's className (plain, template parts, cn() / ternary branches). */
function literalsOf(node, acc = []) {
  if (!node) return acc;
  switch (node.type) {
    case 'StringLiteral':
      acc.push(node.value);
      break;
    case 'TemplateLiteral':
      node.quasis.forEach((q) => acc.push(q.value.cooked ?? q.value.raw));
      break;
    case 'JSXExpressionContainer':
      literalsOf(node.expression, acc);
      break;
    case 'ConditionalExpression':
      literalsOf(node.consequent, acc);
      literalsOf(node.alternate, acc);
      break;
    case 'LogicalExpression':
      literalsOf(node.right, acc);
      literalsOf(node.left, acc);
      break;
    case 'CallExpression':
      node.arguments.forEach((a) => literalsOf(a, acc));
      break;
    case 'ArrayExpression':
      node.elements.forEach((a) => literalsOf(a, acc));
      break;
    case 'BinaryExpression':
      literalsOf(node.left, acc);
      literalsOf(node.right, acc);
      break;
    default:
      break;
  }
  return acc;
}

const SURFACE_NAMES = { light: WHITE, page: PAGE, dark: DARK, rig: RIG, sidebar: '#11161d' };
let skipped = 0;

/** `// @surface light|page|dark|rig|#rrggbb` or `// @contrast-skip <reason>` in the comments above a function. */
function annotationOf(node) {
  const comments = (node.leadingComments || []).map((c) => c.value);
  for (const text of comments) {
    const skip = text.match(/@contrast-skip\b/);
    if (skip) return { skip: true };
    const m = text.match(/@surface\s+(#[0-9a-fA-F]{6}|[a-z]+)/);
    if (m) {
      const color = m[1].startsWith('#') ? m[1].toLowerCase() : SURFACE_NAMES[m[1]];
      if (color) return { surface: color };
    }
  }
  return null;
}

const elementName = (el) => {
  const n = el.openingElement.name;
  return n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? n.property.name : '';
};

// ---------------------------------------------------------------- the check
const failures = [];
const pairs = [];

function checkFile(file) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    failures.push({ rel, line: 0, what: `could not parse: ${e.message}`, ratio: 0, need: 0 });
    return;
  }
  const rig = RIG_FILES(rel);
  const rule = FILE_SURFACE.find(([prefix]) => rel.startsWith(prefix));
  const startSurfaces = [rule ? rule[1] : PAGE];
  const lucide = new Set();
  for (const n of ast.program.body) {
    if (n.type === 'ImportDeclaration' && n.source.value === 'lucide-react') n.specifiers.forEach((s) => lucide.add(s.local.name));
  }

  const visit = (node, surfaces) => {
    if (!node || typeof node.type !== 'string') return;
    const note = ['FunctionDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'VariableDeclaration'].includes(node.type) ? annotationOf(node) : null;
    if (note?.skip) {
      skipped += 1;
      return;
    }
    if (note?.surface) surfaces = [note.surface];
    let next = surfaces;
    if (node.type === 'JSXElement') {
      const classAttr = node.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'className');
      const literals = classAttr ? literalsOf(classAttr.value) : [];
      const parsed = literals.map((l) => ({ ...parseClasses(l.split(/\s+/).filter((t) => !t.includes(':') || t.startsWith('placeholder:')).join(' ')), raw: l }));
      const ownBgs = [...new Map(parsed.flatMap((p) => p.bg).map((b) => [b.name, b])).values()];
      const isIcon = lucide.has(elementName(node));
      const line = node.loc.start.line;

      const surfaceFor = (inLiteral) => {
        // a background in the same literal as the text is the one that belongs to it
        const own = inLiteral.bg.length ? inLiteral.bg : ownBgs;
        const bases = own.length ? own : null;
        if (!bases) return surfaces;
        return [...new Set(bases.flatMap((b) => surfaces.map((s) => (b.alpha < 1 ? blend(b.color, s, b.alpha) : b.color))))];
      };

      for (const p of parsed) {
        const here = surfaceFor(p);
        const large = p.px >= 24 || (p.px >= 20 && p.bold);
        const need = rig ? 7 : isIcon || large ? 3 : 4.5;
        for (const t of [...p.text, ...p.placeholder.map((x) => ({ ...x, placeholder: true }))]) {
          for (const bg of here) {
            const fg = t.alpha < 1 ? blend(t.color, bg, t.alpha) : t.color;
            const r = ratio(fg, bg);
            pairs.push({ rel, line, what: `${t.name}${t.placeholder ? ' (placeholder)' : ''} on ${bg}${isIcon ? ' (icon)' : ''}`, ratio: r, need });
            if (r < need) failures.push({ rel, line, what: `${t.name} on ${bg}${isIcon ? ' (icon)' : ''}`, ratio: r, need });
          }
        }
      }

      // what the children sit on
      const childSurfaces = ownBgs.length
        ? [...new Set(ownBgs.flatMap((b) => surfaces.map((s) => (b.alpha < 1 ? blend(b.color, s, b.alpha) : b.color))))]
        : surfaces;
      next = childSurfaces;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => visit(c, next));
      else if (v && typeof v.type === 'string') visit(v, next);
    }
  };
  visit(ast.program, startSurfaces);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(full, out);
    } else if (/\.jsx$/.test(name) && !/\.test\.jsx$/.test(name)) out.push(full);
  }
  return out;
}

for (const f of walk(ROOT)) checkFile(f);

const fmt = (r) => r.toFixed(2);
console.log(`check:contrast: ${pairs.length} text/background pairs checked` + (skipped ? ` (${skipped} annotated components skipped, see @contrast-skip)` : ''));
if (LIST) {
  for (const p of [...pairs].sort((a, b) => a.ratio - b.ratio).slice(0, 60)) console.log(`  ${p.rel}:${p.line}  ${p.what}  ${fmt(p.ratio)}:1 (need ${p.need})`);
}
const seen = new Set();
const unique = failures.filter((f) => {
  const k = `${f.rel}:${f.line}:${f.what}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (unique.length) {
  console.error(`\n${unique.length} contrast failure(s):`);
  for (const f of unique.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)) console.error(`  ${f.rel}:${f.line}  ${f.what}  ${fmt(f.ratio)}:1 < ${f.need}:1`);
  process.exit(1);
}
console.log('check:contrast OK');
