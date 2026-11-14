import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(new URL('../design-tokens.json', import.meta.url), 'utf8'));
function flatten(object, path = [], result = {}) { for (const [key, value] of Object.entries(object)) { if ('$value' in value) result[[...path,key].join('-')] = value.$value; else flatten(value,[...path,key],result); } return result; }
const base = flatten(data.semantic), light = flatten(data.modes.light);
for (const key of Object.keys(light)) if (!(key in base)) throw new Error(`Unknown light theme token: ${key}`);
const declarations = values => Object.entries(values).map(([key,value])=>`  --${key}: ${value};`).join('\n');
const previews = {};
for (const [mode,palette] of [['dark',base],['light',{...base,...light}]]) for (const key of ['surface-page','surface-card','surface-chrome','action-primary']) previews[`preview-${mode}-${key}`] = palette[key];
fs.writeFileSync(new URL('../src/theme.css', import.meta.url), `/* Generated from design-tokens.json by scripts/theme.mjs. */\n:root {\n${declarations({...base,...previews})}\n  color-scheme: dark;\n  font-family: var(--font-body);\n}\n:root[data-theme="light"] {\n${declarations(light)}\n  color-scheme: light;\n}\n@media (prefers-contrast: more) { :root,:root[data-theme] { --border-default: var(--border-strong); --border-subtle: var(--border-strong); } }\n`);
