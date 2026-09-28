/* =========================================================
 * fetch_official.js — 从澳客竞彩页拉取官方比赛数据更新 data.js
 * 数据源：https://www.okooo.com/jingcai/（页面含昨日已完场比分+今日全量场次）
 * 用法：
 *   node fetch_official.js                 拉取并合并（保留已有 preds/final）
 *   node fetch_official.js --migrate 名字  先把现有 final 迁移为 preds[名字] 再合并
 * 说明：赛果请在次日拉取（页面只保留近几天场次）
 * ======================================================= */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const URL_PAGE = 'https://www.okooo.com/jingcai/';
const URL_KAIJIANG = 'https://www.okooo.com/jingcai/kaijiang/';
const URL_500 = 'https://trade.500.com/jczq/index.php?date=';
const DATA_FILE = path.join(__dirname, 'data.js');
const WDL_DEFAULT = { wdl: '', tg: '', hf: '', sc: '', note: '' };

function log(s) { console.log(s); }

async function getPage(url) {
  url = url || URL_PAGE;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.okooo.com/' } });
    if (r.ok) return new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
    log('fetch 状态异常(' + r.status + ')，改用 curl 兜底');
  } catch (e) {
    log('fetch 失败(' + e.message + ')，改用 curl 兜底');
  }
  const tmp = path.join(os.tmpdir(), 'okooo_fetch_' + Math.random().toString(36).slice(2) + '.html');
  execFileSync('curl.exe', ['-sL', '-A', UA, '-o', tmp, url]);
  return new TextDecoder('gbk').decode(fs.readFileSync(tmp));
}

/* 赛果大厅：按 <tr> 行切分，解析 编号 / 队名(客队名可能为空) / 半场 / 全场。
 * 注意：不能跨行贪婪匹配，否则客队名为空时会串行到下一行的队名与比分。 */
function parseKaijiang(html) {
  const out = {};
  const trRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(html))) {
    const seg = tr[0];
    const idM = seg.match(/class="noborder">(周[一二三四五六日]\d{3})</);
    if (!idM) continue;
    /* 行内队名：namebox link_blue 前两个（第二个允许空串） */
    const names = [...seg.matchAll(/class="namebox link_blue"[^>]*>([^<]*)</g)].map((x) => x[1].trim());
    /* 队名 a 标签之后：第一个普通 td=半场，第一个 border2 td=全场 */
    const afterNames = names.length ? seg.slice(seg.indexOf(names[0] !== '' ? names[0] : 'link_blue')) : seg;
    const hfM = afterNames.match(/<td>\s*(\d{1,2}-\d{1,2}|-)\s*<\/td>/);
    const scM = seg.match(/<td class="border2">\s*(\d{1,2}-\d{1,2}|-)\s*<\/td>/);
    const norm = (s) => (s && s !== '-') ? s.replace('-', ':') : '';
    const score = scM ? norm(scM[1]) : '';
    if (!score) continue; /* 未完场是 - */
    out[idM[1]] = {
      score,
      half: hfM ? norm(hfM[1]) : '',
      home: names[0] || '',
      away: names[1] || ''
    };
  }
  return out;
}

function parseRows(html) {
  const segs = html.split('class="touzhu_1"').slice(1);
  const rows = [];
  for (const seg0 of segs) {
    let seg = seg0;
    const cut = seg.search(/<script|<\/body/i);
    if (cut > -1) seg = seg.slice(0, cut);
    const attr = (n) => { const m = seg.match(new RegExp('data-' + n + '="([^"]*)"')); return m ? m[1] : ''; };
    const ordercn = attr('ordercn');
    if (!/^周[一二三四五六日]\d{3}$/.test(ordercn)) continue;
    const lg = seg.match(/class="saiming[^"]*"[^>]*title="([^"]+)"/) || seg.match(/class="saiming[^"]*"[^>]*>([^<]+)<\/a>/);
    const tm = seg.match(/title="比赛时间:([\d-]+)\s+([\d:]+)"/);
    const names = [...seg.matchAll(/class="zhum[^"]*"\s+title="([^"]+)"/g)].map((m) => m[1]);
    const awayIdx = names[1] ? seg.indexOf('title="' + names[1] + '"') : -1;
    const tail = seg.slice(awayIdx > -1 ? awayIdx : 0).replace(/<[^>]+>/g, ' ');
    const sm = tail.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    const score = sm && +sm[1] <= 15 && +sm[2] <= 15 ? sm[1] + ':' + sm[2] : null;
    /* 参考赔率：段内前三个 peilv 文本 = 胜/平/负 */
    const pv = [...seg.matchAll(/class="peilv[^"]*">\s*([\d.]+)\s*</g)].map((x) => +x[1]);
    const odds = pv.length >= 3 ? { h: pv[0], d: pv[1], a: pv[2] } : null;
    rows.push({
      id: ordercn,
      league: lg ? lg[1] : '',
      date: tm ? tm[1] : '',
      time: tm ? tm[2].slice(0, 5) : '',
      home: names[0] || attr('hname'),
      away: names[1] || attr('aname'),
      rq: attr('rq'),
      odds,
      score
    });
  }
  return rows;
}

/* 每个编号前缀（周五/周六…）的业务日 = 组内观测日期中，星期与编号前缀一致、离今天最近的那天 */
function groupByBusinessDate(rows) {
  const groups = {};
  for (const r of rows) {
    const pre = r.id.slice(0, 3);
    (groups[pre] = groups[pre] || []).push(r);
  }
  const WD = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = {};
  for (const [pre, list] of Object.entries(groups)) {
    const dates = [...new Set(list.map((r) => r.date).filter(Boolean))];
    let best = '';
    let bestDiff = Infinity;
    const wd = WD[pre.slice(0, 2)];
    for (const ds of dates) {
      if (wd === undefined || new Date(ds + 'T00:00:00').getDay() !== wd) continue;
      const diff = Math.abs((new Date(ds + 'T00:00:00') - today) / 86400000);
      if (diff < bestDiff) { bestDiff = diff; best = ds; }
    }
    if (!best) { /* 兜底：取组内多数日期 */
      const freq = {};
      list.forEach((r) => { if (r.date) freq[r.date] = (freq[r.date] || 0) + 1; });
      let n = 0; for (const [dt, c] of Object.entries(freq)) if (c > n) { n = c; best = dt; }
    }
    out[best] = (out[best] || []).concat(list);
  }
  return out;
}

const similar = (a, b) => {
  a = String(a || '').replace(/\s/g, ''); b = String(b || '').replace(/\s/g, '');
  return !a || !b || a.includes(b) || b.includes(a);
};

function loadAppData() {
  const code = fs.readFileSync(DATA_FILE, 'utf8');
  return new Function('window', code + '\nreturn window.APP_DATA;')({});
}

function saveAppData(d) {
  const header = '/* =========================================================\n'
    + ' * 竞足预测汇总 - 数据文件\n'
    + ' * 比赛列表/赛果/赔率由 fetch_official.js 自动拉取合并；preds（各模型预测）\n'
    + ' * 与 final（最终预测，safe=稳健玩法）在模型对比页录入/点选后更新。result: {score:"2:1", half:"1:0"}\n'
    + ' * ======================================================= */\n';
  fs.writeFileSync(DATA_FILE, header + 'window.APP_DATA = ' + JSON.stringify(d, null, 2) + ';\n');
}

/* ---------- 500彩票网历史源：按业务日期补全已滚出澳客页面的场次 ---------- */
async function get500(date) {
  const tmp = path.join(os.tmpdir(), 'w500_' + date + '_' + Math.random().toString(36).slice(2) + '.html');
  try {
    const r = await fetch(URL_500 + date, { headers: { 'User-Agent': UA, 'Referer': 'https://trade.500.com/' } });
    if (r.ok) return new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
  } catch (e) { log('500 fetch 失败(' + e.message + ')，改用 curl'); }
  execFileSync('curl.exe', ['-sL', '-A', UA, '-o', tmp, URL_500 + date]);
  return new TextDecoder('gbk').decode(fs.readFileSync(tmp));
}

function parse500(html) {
  const rows = [];
  const re = /<tr\b[^>]*data-matchnum="(周[一二三四五六日]\d{3})"([\s\S]*?)(?=<tr\b|<\/tbody>)/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1], seg = m[2];
    const attr = (n) => { const x = seg.match(new RegExp('data-' + n + '="([^"]*)"')); return x ? x[1] : ''; };
    const fidM = m[0].match(/data-fixtureid="(\d+)"/); /* tr 标签属性，用于详情页补半场 */
    /* 队名：历史完场页 data-* 属性常被移除，优先取 team-l / team-r 链接的 title */
    const tl = seg.match(/class="team-l"[^>]*title="([^"]+)"/);
    const tr2 = seg.match(/class="team-r"[^>]*title="([^"]+)"/);
    const sm = seg.match(/class="score"[^>]*>\s*(\d{1,2})\s*:\s*(\d{1,2})\s*</);
    const nspf = seg.match(/itm-rangB1[\s\S]*?<\/div>/);
    const pv = nspf ? [...nspf[0].matchAll(/data-sp="([\d.]+)"/g)].map((x) => +x[1]) : [];
    rows.push({
      id,
      date: attr('matchdate'),
      time: attr('matchtime').slice(0, 5),
      league: attr('simpleleague'),
      home: (tl && tl[1]) || attr('homesxname'),
      away: (tr2 && tr2[1]) || attr('awaysxname'),
      rq: attr('rangqiu'),
      score: sm ? sm[1] + ':' + sm[2] : null,
      fid: fidM ? fidM[1] : '',
      odds: pv.length >= 3 ? { h: pv[0], d: pv[1], a: pv[2] } : null
    });
  }
  return rows;
}

/* 500 赛事详情页：取半场比分（列表页行内没有半场数据，用于回补缺失） */
async function get500Half(fid) {
  const url = 'https://live.500.com/detail.php?fid=' + fid;
  let html = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://trade.500.com/' } });
    if (r.ok) html = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
  } catch (e) { /* 走 curl */ }
  if (!html) {
    const tmp = path.join(os.tmpdir(), 'w500d_' + fid + '_' + Math.random().toString(36).slice(2) + '.html');
    try { execFileSync('curl.exe', ['-sL', '-A', UA, '-o', tmp, url]); html = new TextDecoder('gbk').decode(fs.readFileSync(tmp)); } catch (e) { return ''; }
  }
  const m = html.match(/半场[：:]?\s*(\d{1,2})\s*[-:：]\s*(\d{1,2})/);
  return m ? m[1] + ':' + m[2] : '';
}

/* ---------- 体彩官方接口：全部玩法赔率（胜平负/让球/比分/总进球/半全场） ----------
 * 返回 { "周一001": { h,d,a, rq:{line,h,d,a}, tg:{0..7}, hf:{hh..aa}, sc:{"1:0":..}, upd } }
 * 仅含在售场次；历史完场场次沿用库内已有赔率。 */
async function getSportteryOdds() {
  const url = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,crs,ttg,hafu,sxds&channel=c';
  let j = null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.sporttery.cn/' } });
    if (r.ok) j = await r.json();
  } catch (e) { log('体彩接口 fetch 失败(' + e.message + ')'); return {}; }
  const lists = (j && j.value && j.value.matchInfoList) || [];
  const out = {};
  const num = (v) => (v == null || v === '') ? null : String(v);
  for (const g of lists) {
    for (const m of (g.subMatchList || [])) {
      if (!m.matchNumStr) continue;
      const o = {};
      if (m.had) {
        o.h = num(m.had.h); o.d = num(m.had.d); o.a = num(m.had.a);
        if (m.had.single != null) o.single = m.had.single === 1; /* 官方单关标识 */
      }
      if (m.hhad && m.hhad.h != null) {
        o.rq = { line: num(m.hhad.goalLine), h: num(m.hhad.h), d: num(m.hhad.d), a: num(m.hhad.a) };
      }
      if (m.ttg) {
        o.tg = {};
        for (let i = 0; i <= 7; i++) { const v = num(m.ttg['s' + i]); if (v) o.tg[String(i)] = v; }
      }
      if (m.hafu) {
        o.hf = {};
        ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'].forEach((k) => { const v = num(m.hafu[k]); if (v) o.hf[k] = v; });
      }
      if (m.crs) {
        o.sc = {};
        Object.keys(m.crs).forEach((k) => {
          if (!/^s\d/.test(k) || k.endsWith('f')) return; /* 只要 sXXsYY / s1sX 主键，排除 *f 标志位 */
          const v = num(m.crs[k]);
          if (!v) return;
          let label;
          if (k === 's1sh') label = '胜其他';
          else if (k === 's1sd') label = '平其他';
          else if (k === 's1sa') label = '负其他';
          else {
            const mm = k.match(/^s(\d{2})s(\d{2})$/);
            if (!mm) return;
            label = (+mm[1]) + ':' + (+mm[2]);
          }
          o.sc[label] = v;
        });
      }
      if (m.sxds) {
        const s = num(m.sxds.sd), s2 = num(m.sxds.ss), x = num(m.sxds.xd), x2 = num(m.sxds.xs);
        if (s && s2 && x && x2) o.sxds = { sd: s, ss: s2, xd: x, xs: x2 };
      }
      if (m.had && m.had.updateDate) o.upd = m.had.updateDate + ' ' + (m.had.updateTime || '').slice(0, 5);
      if (o.h != null) out[m.matchNumStr] = o;
    }
  }
  return out;
}

/* 把体彩全玩法赔率合并进库：未开赛=刷新全部玩法；已完场=保留终盘 */
function mergeSportteryOdds(d, sp) {
  let updN = 0, keepN = 0;
  for (const day of Object.values(d.days)) {
    for (const m of (day.matches || [])) {
      const s = sp[m.id];
      if (!s) continue;
      if (m.result) { keepN++; continue; } /* 已完场保留终盘赔率 */
      if (!m.odds) m.odds = {};
      if (s.h != null) { m.odds.h = s.h; m.odds.d = s.d; m.odds.a = s.a; }
      if (s.single != null) m.odds.single = s.single;
      if (s.rq) m.odds.rq = s.rq;
      if (s.tg) m.odds.tg = s.tg;
      if (s.hf) m.odds.hf = s.hf;
      if (s.sc) m.odds.sc = s.sc;
      if (s.sxds) m.odds.sxds = s.sxds;
      if (s.upd) m.odds.upd = s.upd;
      /* 盘口缺失时用体彩让球数回填（命中判定的权威来源） */
      if (!m.rq && s.rq && s.rq.line) m.rq = s.rq.line;
      updN++;
    }
  }
  log('体彩赔率合并：刷新 ' + updN + ' 场（未开赛），保留终盘 ' + keepN + ' 场');
}

async function merge500(date) {
  log('从 500 拉取历史场次 ' + date);
  const html = await get500(date);
  const rows = parse500(html);
  log('500 解析到 ' + rows.length + ' 场');
  if (!rows.length) { log('未解析到比赛，保持 data.js 不变'); return; }
  const d = loadAppData();
  const day = d.days[date] || (d.days[date] = { matches: [] });
  let added = 0, scored = 0, oddsN = 0, fixedName = 0;
  rows.forEach((p) => {
    let m = day.matches.find((x) => x.id === p.id);
    if (!m) {
      m = { id: p.id, time: p.time, league: p.league, home: p.home, away: p.away,
        rq: p.rq, odds: null, preds: {}, final: { ...WDL_DEFAULT }, result: null };
      day.matches.push(m); added++;
    }
    if (p.time && !m.time) m.time = p.time;
    if (p.league && !m.league) m.league = p.league;
    if (!m.rq && p.rq) m.rq = p.rq;
    if (!m.odds && p.odds) { m.odds = p.odds; oddsN++; }
    /* 队名异常（缺失/主客同名=他源解析串行）时用500校正；先判定再赋值，避免条件互相影响 */
    const badName = !m.home || !m.away || m.home === m.away;
    if (badName && p.home) { m.home = p.home; fixedName++; }
    if (badName && p.away) { m.away = p.away; fixedName++; }
    if (p.score && (!m.result || !m.result.score)) {
      m.result = { score: p.score, half: m.result ? (m.result.half || '') : '' };
      scored++;
    }
  });
  day.matches.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
  /* 回补缺失的半场比分（赛果大厅已滚出的场次，走500详情页） */
  let halfN = 0;
  const needHalf = day.matches.filter((x) => x.result && x.result.score && !x.result.half);
  for (const x of needHalf) {
    const p = rows.find((r) => r.id === x.id);
    if (!p || !p.fid) continue;
    const half = await get500Half(p.fid);
    if (half) { x.result.half = half; halfN++; log('补半场 ' + x.id + ' ' + half); }
  }
  saveAppData(d);
  log(date + ' 合并完成：新增 ' + added + ' 场，补比分 ' + scored + ' 处，补赔率 ' + oddsN + ' 处，校正队名 ' + fixedName + ' 处，补半场 ' + halfN + ' 处');
}

(async () => {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (dateArg) { await merge500(dateArg); return; }
  const migrateIdx = args.indexOf('--migrate');
  const migrateName = migrateIdx > -1 ? args[migrateIdx + 1] : null;

  log('拉取页面 ' + URL_PAGE);
  const [html, kjHtml] = await Promise.all([getPage(), getPage(URL_KAIJIANG)]);
  const rows = parseRows(html);
  log('解析到 ' + rows.length + ' 行');
  if (!rows.length) { log('未解析到任何比赛，保持 data.js 不变'); return; }
  const kj = parseKaijiang(kjHtml);
  log('赛果大厅解析到 ' + Object.keys(kj).length + ' 个编号（含半场比分）');

  const d = loadAppData();

  if (migrateName) {
    let n = 0;
    for (const day of Object.values(d.days)) for (const m of day.matches || []) {
      if (m.preds && !m.preds[migrateName] && m.final && m.final.wdl && m.final.wdl !== '待分析') {
        m.preds[migrateName] = { wdl: m.final.wdl, tg: m.final.tg, hf: m.final.hf, sc: m.final.sc };
        n++;
      }
    }
    log('已迁移 ' + n + ' 场 final -> preds[' + migrateName + ']');
  }

  const byDate = groupByBusinessDate(rows);
  for (const [date, list] of Object.entries(byDate)) {
    const day = d.days[date] || (d.days[date] = { matches: [] });
    delete day.sample;
    const old = [...(day.matches || [])];
    /* 业务日内编号唯一，直接按编号承接旧记录（队名常有全称/简称差异，不能据此判为新场） */
    const seen = new Set();
    day.matches = list.map((p) => {
      const base = old.find((x) => x.id === p.id) || {};
      seen.add(p.id);
      return {
        id: p.id,
        time: base.time || p.time,
        league: base.league || p.league,
        home: base.home || p.home,   /* 已有队名优先，避免页面简称覆盖全称 */
        away: base.away || p.away,
        rq: p.rq || base.rq || '',
        /* 赔率会变动：未开赛场次每次拉取都刷新为最新（p.odds 优先），已完场保留终盘赔率 */
        odds: base.result ? (base.odds || p.odds || null) : (p.odds || base.odds || null),
        preds: base.preds || {},
        final: base.final || { ...WDL_DEFAULT },
        result: base.result || (p.score ? { score: p.score, half: '' } : null)
      };
    });
    /* 已从在售页滚出的历史场次（含延期场）原样保留，不丢预测/赛果 */
    old.forEach((x) => { if (!seen.has(x.id)) day.matches.push(x); });
    day.matches.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
    const withScore = day.matches.filter((m) => m.result).length;
    log(date + '（' + list[0].id.slice(0, 3) + '）: ' + day.matches.length + ' 场，其中 ' + withScore + ' 场已有比分');
  }

  /* 赛果大厅合并：按编号覆盖全场比分 + 补充半场比分（权威来源，优先于 sale 页 tail 解析） */
  let sc = 0, hf = 0, nm = 0;
  for (const day of Object.values(d.days)) for (const m of day.matches || []) {
    const k = kj[m.id];
    if (!k) continue;
    if (!m.result || m.result.score !== k.score) sc++;
    if (!m.result || m.result.half !== k.half) hf++;
    m.result = { score: k.score, half: k.half };
    /* 队名缺失/主客同名（在售页解析串行的典型坏数据）时用赛果大厅行内队名补；先判定再赋值 */
    const badName = !m.home || !m.away || m.home === m.away;
    if (badName && k.home) { m.home = k.home; nm++; }
    if (badName && k.away) { m.away = k.away; nm++; }
  }
  log('赛果合并：更新比分 ' + sc + ' 处、半场 ' + hf + ' 处');

  /* 体彩官方接口：全部玩法赔率（胜平负/让球/比分/总进球/半全场），未开赛场次每次刷新 */
  const sp = await getSportteryOdds();
  log('体彩接口返回 ' + Object.keys(sp).length + ' 场赔率');
  mergeSportteryOdds(d, sp);

  saveAppData(d);
  log('已写回 ' + DATA_FILE);
})();
