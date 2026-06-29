// 跑全部 *.test.js 并汇总。用法：node test/run.js  或  npm test
const fs = require('fs');
const path = require('path');
const { report } = require('./harness');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
console.log('运行测试：' + files.join(', ') + '\n');
for (const f of files) require(path.join(dir, f)); // require 时用例同步执行

const ok = report();
process.exit(ok ? 0 : 1);
