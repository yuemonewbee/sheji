// 极简零依赖测试框架。各 *.test.js 用 test()/assert 注册用例，run.js 汇总。
let total = 0, passed = 0;
const failures = [];
let suite = '';

function describe(name) { suite = name; }
function test(name, fn) {
  total++;
  const full = (suite ? suite + ' › ' : '') + name;
  try { fn(); passed++; }
  catch (e) { failures.push({ name: full, msg: e.message }); }
}

const assert = {
  ok(c, m) { if (!c) throw new Error(m || '期望为真'); },
  notOk(c, m) { if (c) throw new Error(m || '期望为假'); },
  equal(a, b, m) {
    if (a !== b) throw new Error((m ? m + '：' : '') + '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
  },
  near(a, b, eps, m) {
    if (Math.abs(a - b) > (eps == null ? 0.001 : eps)) throw new Error((m ? m + '：' : '') + '期望 ≈' + b + '，实际 ' + a);
  },
  throws(fn, m) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error(m || '期望抛异常但没有');
  },
};

function report() {
  console.log('');
  if (failures.length) {
    console.log('失败用例：');
    for (const f of failures) console.log('  ✗ ' + f.name + '\n      ' + f.msg);
    console.log('');
  }
  console.log((failures.length ? '✗' : '✓') + ' ' + passed + '/' + total + ' 通过');
  return failures.length === 0;
}

module.exports = { describe, test, assert, report };
