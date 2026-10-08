// Placeholder runner for asset/doc scripts that land in later milestones.
// Usage: tsx tools/not-implemented.ts <script-name> <milestone>
const [name = 'script', milestone = 'M1'] = process.argv.slice(2);
console.log(`${name}: not implemented (${milestone})`);
