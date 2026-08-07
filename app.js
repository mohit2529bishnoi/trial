/* ===================== STORAGE ===================== */
const STORE_KEY = 'moneybook:data';

const defaultState = {
  accounts: [],
  transactions: [],
  budget: { base: 0, pctEssential: 50, pctFun: 30, pctInvestment: 20 },
  goals: {
    emergencyFund: { target: 1300000 },
    funGoal: { name: '', target: 0, date: '', current: 0 }
  },
  iou: [],
  fd: [],
  fxRates: {},
  lastBackupDate: null,
  lastReminderShownMonth: null
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(defaultState), parsed);
  } catch (e) {
    console.error('Load failed, starting fresh', e);
    return structuredClone(defaultState);
  }
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save — your browser storage may be full.');
  }
}

const uid = (p) => p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);
const thisMonthKey = () => todayStr().slice(0, 7);
const fmt = (n) => (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const SYM = { INR: '\u20b9', EUR: '\u20ac' };

const SUBCATS = {
  essential: ['Rent', 'Health insurance', 'Gym & fitness', 'Radio tax', 'Groceries'],
  fun: ['Travel', 'Shopping', 'Food orders', 'Subscriptions', 'Buy-goal saving', 'Outdoor eating', 'Fun with friends'],
  investment: ['RD (IndusInd)', 'Emergency fund', 'Other investment']
};

/* ===================== NAVIGATION ===================== */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  renderAll();
}
document.getElementById('quickAddBtn').addEventListener('click', () => showView('transactions'));

/* ===================== ACCOUNTS ===================== */
function accountBalance(accId) {
  const acc = state.accounts.find((a) => a.id === accId);
  if (!acc) return 0;
  let bal = acc.opening;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === accId) bal += t.amount;
    if (t.type === 'expense' && t.accountId === accId) bal -= t.amount;
    if (t.type === 'transfer') {
      if (t.accountId === accId) bal -= t.amount;
      if (t.toAccountId === accId) bal += t.toAmount;
    }
  }
  return bal;
}
// For credit cards, "balance" is inverted: opening=0, expenses INCREASE what you owe,
// payments (transfers in) DECREASE it.
function ccOwed(accId) {
  const acc = state.accounts.find((a) => a.id === accId);
  if (!acc) return 0;
  let owed = acc.opening || 0;
  for (const t of state.transactions) {
    if (t.type === 'expense' && t.accountId === accId) owed += t.amount;
    if (t.type === 'transfer' && t.toAccountId === accId) owed -= t.toAmount;
  }
  return owed;
}

document.getElementById('addAccountBtn').addEventListener('click', () => {
  const name = document.getElementById('accName').value.trim();
  if (!name) return;
  const acc = {
    id: uid('a'),
    name,
    type: document.getElementById('accType').value,
    currency: document.getElementById('accCurrency').value,
    opening: parseFloat(document.getElementById('accOpening').value) || 0,
    limit: parseFloat(document.getElementById('accLimit').value) || 0
  };
  state.accounts.push(acc);
  save();
  document.getElementById('accName').value = '';
  document.getElementById('accOpening').value = '';
  document.getElementById('accLimit').value = '';
  renderAll();
});

document.getElementById('transferFrom').addEventListener('change', updateTransferRateVisibility);
document.getElementById('transferTo').addEventListener('change', updateTransferRateVisibility);
function updateTransferRateVisibility() {
  const fromId = document.getElementById('transferFrom').value;
  const toId = document.getElementById('transferTo').value;
  const from = state.accounts.find((a) => a.id === fromId);
  const to = state.accounts.find((a) => a.id === toId);
  document.getElementById('transferRateRow').style.display = (from && to && from.currency !== to.currency) ? 'flex' : 'none';
}

document.getElementById('doTransferBtn').addEventListener('click', () => {
  const fromId = document.getElementById('transferFrom').value;
  const toId = document.getElementById('transferTo').value;
  const amount = parseFloat(document.getElementById('transferAmount').value);
  const date = document.getElementById('transferDate').value || todayStr();
  if (!fromId || !toId || fromId === toId || !amount) return;
  const from = state.accounts.find((a) => a.id === fromId);
  const to = state.accounts.find((a) => a.id === toId);
  let toAmount = amount;
  if (from.currency !== to.currency) {
    const rate = parseFloat(document.getElementById('transferRate').value);
    if (!rate) { alert('Enter a conversion rate'); return; }
    toAmount = amount * rate;
  }
  state.transactions.push({ id: uid('t'), type: 'transfer', date, accountId: fromId, toAccountId: toId, amount, toAmount, note: '' });
  save();
  document.getElementById('transferAmount').value = '';
  renderAll();
});

function removeAccount(id) {
  if (!confirm('Delete this account and its transactions?')) return;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.transactions = state.transactions.filter((t) => t.accountId !== id && t.toAccountId !== id);
  save();
  renderAll();
}

function renderAccounts() {
  const sel = (id, includeCC = true) => {
    const el = document.getElementById(id);
    const cur = el.value;
    el.innerHTML = state.accounts.filter((a) => includeCC || a.type !== 'creditcard')
      .map((a) => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('');
    if ([...el.options].some((o) => o.value === cur)) el.value = cur;
  };
  sel('transferFrom'); sel('transferTo');
  sel('txAccount');
  sel('ccPayFrom', false);
  document.getElementById('ccPayTo').innerHTML = state.accounts.filter((a) => a.type === 'creditcard')
    .map((a) => `<option value="${a.id}">${a.name}</option>`).join('');

  const list = document.getElementById('accountList');
  list.innerHTML = state.accounts.map((a) => {
    const bal = a.type === 'creditcard' ? -ccOwed(a.id) : accountBalance(a.id);
    return `<div class="row-item">
      <div><b>${a.name}</b><div class="meta">${a.type} · ${a.currency}</div></div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="amt ${bal >= 0 ? 'amt-income' : 'amt-expense'}">${SYM[a.currency]}${fmt(bal)}</span>
        <button class="del-btn" onclick="removeAccount('${a.id}')">&#10005;</button>
      </div>
    </div>`;
  }).join('') || '<p class="hint">No accounts yet.</p>';
}

/* ===================== TRANSACTIONS ===================== */
document.getElementById('txTypeToggle').addEventListener('click', (e) => {
  if (!e.target.dataset.val) return;
  document.querySelectorAll('#txTypeToggle .toggle-btn').forEach((b) => b.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('txCategoryRow').style.display = e.target.dataset.val === 'income' ? 'none' : 'flex';
});
document.getElementById('txEnvelope').addEventListener('change', updateSubcatOptions);
function updateSubcatOptions() {
  const env = document.getElementById('txEnvelope').value;
  document.getElementById('txSubcategory').innerHTML = SUBCATS[env].map((s) => `<option>${s}</option>`).join('');
}

document.getElementById('addTxBtn').addEventListener('click', () => {
  const type = document.querySelector('#txTypeToggle .toggle-btn.active').dataset.val;
  const accountId = document.getElementById('txAccount').value;
  const amount = parseFloat(document.getElementById('txAmount').value);
  const desc = document.getElementById('txDesc').value.trim();
  if (!accountId || !amount || !desc) return;
  const tx = {
    id: uid('t'), type, date: document.getElementById('txDate').value || todayStr(),
    accountId, amount, desc,
    envelope: type === 'expense' ? document.getElementById('txEnvelope').value : null,
    subcategory: type === 'expense' ? document.getElementById('txSubcategory').value : null,
    mode: document.getElementById('txMode').value,
    note: document.getElementById('txNote').value.trim()
  };
  state.transactions.push(tx);
  save();
  document.getElementById('txDesc').value = '';
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';
  renderAll();
});

function removeTx(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  save();
  renderAll();
}

function renderTxFilters() {
  const months = Array.from(new Set(state.transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const sel = document.getElementById('txFilterMonth');
  const cur = sel.value;
  sel.innerHTML = '<option value="all">All time</option>' + months.map((m) => `<option value="${m}">${m}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
document.getElementById('txFilterMonth').addEventListener('change', renderTxList);
document.getElementById('txFilterEnvelope').addEventListener('change', renderTxList);

function renderTxList() {
  const month = document.getElementById('txFilterMonth').value;
  const env = document.getElementById('txFilterEnvelope').value;
  let rows = state.transactions.filter((t) => t.type !== 'transfer');
  if (month !== 'all') rows = rows.filter((t) => t.date.slice(0, 7) === month);
  if (env !== 'all') rows = rows.filter((t) => t.envelope === env);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById('txList').innerHTML = rows.map((t) => {
    const acc = state.accounts.find((a) => a.id === t.accountId);
    return `<div class="row-item">
      <div><b>${t.desc}</b><div class="meta">${t.date} · ${acc ? acc.name : '?'} · ${t.mode}${t.envelope ? ' · ' + t.subcategory : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="amt ${t.type === 'income' ? 'amt-income' : 'amt-expense'}">${t.type === 'income' ? '+' : '\u2212'}${SYM[acc ? acc.currency : 'INR']}${fmt(t.amount)}</span>
        <button class="del-btn" onclick="removeTx('${t.id}')">&#10005;</button>
      </div>
    </div>`;
  }).join('') || '<p class="hint">No transactions for this filter.</p>';
}

/* ===================== BUDGET ===================== */
document.getElementById('saveBudgetBaseBtn').addEventListener('click', () => {
  state.budget.base = parseFloat(document.getElementById('budgetBase').value) || 0;
  save(); renderAll();
});
['pctEssential', 'pctFun', 'pctInvestment'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updatePctTotal);
});
function updatePctTotal() {
  const e = parseFloat(document.getElementById('pctEssential').value) || 0;
  const f = parseFloat(document.getElementById('pctFun').value) || 0;
  const i = parseFloat(document.getElementById('pctInvestment').value) || 0;
  const total = e + f + i;
  const el = document.getElementById('pctTotal');
  el.textContent = `Total: ${total}%` + (total !== 100 ? '  — must equal 100%' : '  — good');
  el.style.color = total === 100 ? 'var(--income)' : 'var(--expense)';
}
document.getElementById('savePctBtn').addEventListener('click', () => {
  const e = parseFloat(document.getElementById('pctEssential').value) || 0;
  const f = parseFloat(document.getElementById('pctFun').value) || 0;
  const i = parseFloat(document.getElementById('pctInvestment').value) || 0;
  if (e + f + i !== 100) { alert('Percentages must add up to 100.'); return; }
  state.budget.pctEssential = e; state.budget.pctFun = f; state.budget.pctInvestment = i;
  save(); renderAll();
});

function monthEnvelopeActual(monthKey, envelope) {
  return state.transactions
    .filter((t) => t.type === 'expense' && t.envelope === envelope && t.date.slice(0, 7) === monthKey)
    .reduce((s, t) => s + t.amount, 0);
}
function envelopeCap(envelope) {
  const pct = { essential: state.budget.pctEssential, fun: state.budget.pctFun, investment: state.budget.pctInvestment }[envelope];
  return state.budget.base * (pct / 100);
}

function renderBudgetForm() {
  document.getElementById('budgetBase').value = state.budget.base || '';
  document.getElementById('pctEssential').value = state.budget.pctEssential;
  document.getElementById('pctFun').value = state.budget.pctFun;
  document.getElementById('pctInvestment').value = state.budget.pctInvestment;
  updatePctTotal();
}

function renderEnvelopeCards(targetId, detailed) {
  const mk = thisMonthKey();
  const envs = ['essential', 'fun', 'investment'];
  const html = envs.map((env) => {
    const cap = envelopeCap(env);
    const actual = monthEnvelopeActual(mk, env);
    const pct = cap > 0 ? Math.min(100, (actual / cap) * 100) : 0;
    const over = actual > cap && cap > 0;
    let subHtml = '';
    if (detailed) {
      subHtml = '<div style="margin-top:10px;">' + SUBCATS[env].map((sc) => {
        const amt = state.transactions.filter((t) => t.type === 'expense' && t.envelope === env && t.subcategory === sc && t.date.slice(0, 7) === mk)
          .reduce((s, t) => s + t.amount, 0);
        return amt > 0 ? `<div class="meta" style="display:flex;justify-content:space-between;padding:3px 0;">${sc}<span>${SYM.INR}${fmt(amt)}</span></div>` : '';
      }).join('') + '</div>';
    }
    return `<div class="envelope-card">
      <div class="envelope-top"><b style="text-transform:capitalize;">${env}</b><span>${SYM.INR}${fmt(actual)} / ${SYM.INR}${fmt(cap)}</span></div>
      <div class="progress-track"><div class="progress-fill ${over ? 'fill-over' : 'fill-' + env}" style="width:${pct}%"></div></div>
      ${subHtml}
    </div>`;
  }).join('');
  document.getElementById(targetId).innerHTML = html;
}

/* ===================== GOALS ===================== */
function investmentTotalAllTime() {
  return state.transactions.filter((t) => t.type === 'expense' && t.envelope === 'investment')
    .reduce((s, t) => s + t.amount, 0);
}
document.getElementById('saveFunGoalBtn').addEventListener('click', () => {
  state.goals.funGoal.name = document.getElementById('funGoalName').value.trim();
  state.goals.funGoal.target = parseFloat(document.getElementById('funGoalTarget').value) || 0;
  state.goals.funGoal.date = document.getElementById('funGoalDate').value;
  save(); renderAll();
});
function funGoalSaved() {
  return state.transactions.filter((t) => t.type === 'expense' && t.envelope === 'fun' && t.subcategory === 'Buy-goal saving')
    .reduce((s, t) => s + t.amount, 0);
}

function renderGoals() {
  const target = state.goals.emergencyFund.target;
  const saved = investmentTotalAllTime();
  const pct = Math.min(100, (saved / target) * 100);
  document.getElementById('emergencyGoalDisplay').innerHTML = `
    <div class="envelope-top"><b>Emergency fund</b><span>${SYM.INR}${fmt(saved)} / ${SYM.INR}${fmt(target)}</span></div>
    <div class="progress-track"><div class="progress-fill fill-investment" style="width:${pct}%"></div></div>
    <p class="hint">${pct.toFixed(1)}% funded — logged from your Investment envelope entries.</p>`;

  const fg = state.goals.funGoal;
  document.getElementById('funGoalName').value = fg.name || '';
  document.getElementById('funGoalTarget').value = fg.target || '';
  document.getElementById('funGoalDate').value = fg.date || '';
  if (fg.target > 0) {
    const s = funGoalSaved();
    const p = Math.min(100, (s / fg.target) * 100);
    const daysLeft = fg.date ? Math.ceil((new Date(fg.date) - new Date()) / 86400000) : null;
    document.getElementById('funGoalDisplay').innerHTML = `
      <div class="envelope-top"><b>${fg.name || 'Your goal'}</b><span>${SYM.INR}${fmt(s)} / ${SYM.INR}${fmt(fg.target)}</span></div>
      <div class="progress-track"><div class="progress-fill fill-fun" style="width:${p}%"></div></div>
      <p class="hint">${daysLeft !== null ? daysLeft + ' days left. ' : ''}Log entries under Fun &rarr; "Buy-goal saving" to count toward this.</p>`;
  } else {
    document.getElementById('funGoalDisplay').innerHTML = '';
  }
}

/* ===================== IOU ===================== */
document.getElementById('iouDirToggle').addEventListener('click', (e) => {
  if (!e.target.dataset.val) return;
  document.querySelectorAll('#iouDirToggle .toggle-btn').forEach((b) => b.classList.remove('active'));
  e.target.classList.add('active');
});
document.getElementById('addIouBtn').addEventListener('click', () => {
  const person = document.getElementById('iouPerson').value.trim();
  const amount = parseFloat(document.getElementById('iouAmount').value);
  const date = document.getElementById('iouDate').value;
  if (!person || !amount || !date) { alert('Person, amount and date are all required.'); return; }
  const direction = document.querySelector('#iouDirToggle .toggle-btn.active').dataset.val;
  state.iou.push({ id: uid('i'), person, amount, direction, date, note: document.getElementById('iouNote').value.trim(), settled: false });
  save();
  document.getElementById('iouPerson').value = '';
  document.getElementById('iouAmount').value = '';
  document.getElementById('iouNote').value = '';
  renderAll();
});
function toggleIouSettled(id) {
  const item = state.iou.find((i) => i.id === id);
  if (item) item.settled = !item.settled;
  save(); renderAll();
}
function removeIou(id) {
  state.iou = state.iou.filter((i) => i.id !== id);
  save(); renderAll();
}

function renderIou() {
  const people = Array.from(new Set(state.iou.map((i) => i.person)));
  document.getElementById('iouList').innerHTML = people.map((p) => {
    const entries = state.iou.filter((i) => i.person === p);
    const net = entries.reduce((s, i) => s + (i.direction === 'lent' ? i.amount : -i.amount) * (i.settled ? 0 : 1), 0);
    const entryHtml = entries.map((i) => `<div class="row-item" style="opacity:${i.settled ? 0.5 : 1}">
      <div><b>${i.direction === 'lent' ? 'You gave' : 'You received'} ${SYM.INR}${fmt(i.amount)}</b>
        <div class="meta">${i.date}${i.note ? ' · ' + i.note : ''}${i.settled ? ' · settled' : ''}</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="toggleIouSettled('${i.id}')">${i.settled ? 'Reopen' : 'Settle'}</button>
        <button class="del-btn" onclick="removeIou('${i.id}')">&#10005;</button>
      </div>
    </div>`).join('');
    return `<div class="card">
      <div class="envelope-top"><b>${p}</b><span class="${net >= 0 ? 'amt-income' : 'amt-expense'}" style="font-weight:700;">
        ${net >= 0 ? 'Owes you ' : 'You owe '}${SYM.INR}${fmt(Math.abs(net))}</span></div>
      <div class="card-list">${entryHtml}</div>
    </div>`;
  }).join('') || '<p class="hint">No IOU entries yet.</p>';
}

/* ===================== FD TRACKER ===================== */
document.getElementById('addFdBtn').addEventListener('click', () => {
  const principal = parseFloat(document.getElementById('fdPrincipal').value);
  const rate = parseFloat(document.getElementById('fdRate').value);
  const tenure = parseFloat(document.getElementById('fdTenure').value);
  const bank = document.getElementById('fdBank').value.trim();
  const start = document.getElementById('fdStartDate').value || todayStr();
  const n = parseFloat(document.getElementById('fdCompounding').value);
  if (!principal || !rate || !tenure || !bank) return;
  state.fd.push({ id: uid('f'), bank, principal, rate, tenureMonths: tenure, start, compoundingPerYear: n, reminded: false });
  save();
  document.getElementById('fdBank').value = '';
  document.getElementById('fdPrincipal').value = '';
  document.getElementById('fdRate').value = '';
  document.getElementById('fdTenure').value = '';
  renderAll();
});
function fdMaturity(fd) {
  const t = fd.tenureMonths / 12;
  const amount = fd.principal * Math.pow(1 + (fd.rate / 100) / fd.compoundingPerYear, fd.compoundingPerYear * t);
  const maturityDate = new Date(fd.start);
  maturityDate.setMonth(maturityDate.getMonth() + fd.tenureMonths);
  return { amount, date: maturityDate };
}
function removeFd(id) { state.fd = state.fd.filter((f) => f.id !== id); save(); renderAll(); }

function renderFd() {
  document.getElementById('fdList').innerHTML = state.fd.map((fd) => {
    const m = fdMaturity(fd);
    const daysLeft = Math.ceil((m.date - new Date()) / 86400000);
    const matured = daysLeft <= 0;
    return `<div class="row-item" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;">
        <b>${fd.bank}</b>
        <button class="del-btn" onclick="removeFd('${fd.id}')">&#10005;</button>
      </div>
      <div class="meta">Principal ${SYM.INR}${fmt(fd.principal)} at ${fd.rate}% · ${fd.tenureMonths} months</div>
      <div style="margin-top:6px;display:flex;justify-content:space-between;">
        <span>Maturity value</span><b>${SYM.INR}${fmt(m.amount)}</b>
      </div>
      <div class="meta" style="color:${matured ? 'var(--expense)' : 'var(--ink-soft)'}">
        ${matured ? 'Matured — reinvest now to keep compounding' : 'Matures ' + m.date.toISOString().slice(0, 10) + ' (' + daysLeft + ' days)'}
      </div>
    </div>`;
  }).join('') || '<p class="hint">No fixed deposits tracked yet.</p>';
}

/* ===================== CREDIT CARDS ===================== */
document.getElementById('ccPayBtn').addEventListener('click', () => {
  const fromId = document.getElementById('ccPayFrom').value;
  const toId = document.getElementById('ccPayTo').value;
  const amount = parseFloat(document.getElementById('ccPayAmount').value);
  const date = document.getElementById('ccPayDate').value || todayStr();
  if (!fromId || !toId || !amount) return;
  state.transactions.push({ id: uid('t'), type: 'transfer', date, accountId: fromId, toAccountId: toId, amount, toAmount: amount, note: 'Credit card payment' });
  save();
  document.getElementById('ccPayAmount').value = '';
  renderAll();
});

function renderCC(targetId) {
  const cards = state.accounts.filter((a) => a.type === 'creditcard');
  document.getElementById(targetId).innerHTML = cards.map((c) => {
    const owed = ccOwed(c.id);
    const limit = c.limit || 0;
    const pct = limit > 0 ? Math.min(100, (owed / limit) * 100) : 0;
    return `<div class="card">
      <div class="envelope-top"><b>${c.name}</b><span class="amt-expense" style="font-weight:700;">${SYM.INR}${fmt(owed)} owed</span></div>
      <div class="progress-track"><div class="progress-fill ${pct > 80 ? 'fill-over' : 'fill-essential'}" style="width:${pct}%"></div></div>
      <p class="hint">${limit > 0 ? fmt(owed) + ' of ' + fmt(limit) + ' limit (' + pct.toFixed(0) + '%)' : 'No limit set'}</p>
    </div>`;
  }).join('') || '<p class="hint">No credit cards added yet — add one from the Accounts tab.</p>';
}

/* ===================== DASHBOARD ===================== */
function renderDashboard() {
  const grid = document.getElementById('dashAccountSummary');
  const nonCC = state.accounts.filter((a) => a.type !== 'creditcard');
  const byCurrency = {};
  nonCC.forEach((a) => { byCurrency[a.currency] = (byCurrency[a.currency] || 0) + accountBalance(a.id); });
  grid.innerHTML = Object.entries(byCurrency).map(([cur, val]) => `
    <div class="summary-card"><div class="label">Balance (${cur})</div><div class="value">${SYM[cur]}${fmt(val)}</div></div>
  `).join('') || '<p class="hint">Add an account to get started.</p>';

  renderEnvelopeCards('dashEnvelopes', false);
  renderCC('dashCC');

  // Goals mini view
  const target = state.goals.emergencyFund.target;
  const saved = investmentTotalAllTime();
  const pct = Math.min(100, (saved / target) * 100);
  let goalsHtml = `<div class="envelope-card">
    <div class="envelope-top"><b>Emergency fund</b><span>${pct.toFixed(0)}%</span></div>
    <div class="progress-track"><div class="progress-fill fill-investment" style="width:${pct}%"></div></div>
  </div>`;
  const fg = state.goals.funGoal;
  if (fg.target > 0) {
    const s = funGoalSaved();
    const p = Math.min(100, (s / fg.target) * 100);
    goalsHtml += `<div class="envelope-card">
      <div class="envelope-top"><b>${fg.name || 'Fun goal'}</b><span>${p.toFixed(0)}%</span></div>
      <div class="progress-track"><div class="progress-fill fill-fun" style="width:${p}%"></div></div>
    </div>`;
  }
  document.getElementById('dashGoals').innerHTML = goalsHtml;

  renderCharts();
}

let pieChartInstance = null, lineChartInstance = null;
function renderCharts() {
  const mk = thisMonthKey();
  const caps = ['essential', 'fun', 'investment'].map(envelopeCap);
  const actuals = ['essential', 'fun', 'investment'].map((e) => monthEnvelopeActual(mk, e));
  const colors = ['#378ADD', '#C97A3A', '#1D9E75'];

  const pieCtx = document.getElementById('pieChart');
  if (pieChartInstance) pieChartInstance.destroy();
  pieChartInstance = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: ['Essential', 'Fun', 'Investment'],
      datasets: [{ data: actuals, backgroundColor: colors }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }
  });

  // last 6 months line chart
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(dt.toISOString().slice(0, 7));
  }
  const totals = months.map((m) => state.transactions.filter((t) => t.type === 'expense' && t.date.slice(0, 7) === m).reduce((s, t) => s + t.amount, 0));
  const lineCtx = document.getElementById('lineChart');
  if (lineChartInstance) lineChartInstance.destroy();
  lineChartInstance = new Chart(lineCtx, {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'Total spend', data: totals, borderColor: '#22301F', backgroundColor: 'rgba(34,48,31,0.1)', fill: true, tension: 0.2 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

/* ===================== FX RATES ===================== */
document.getElementById('fxSaveBtn').addEventListener('click', () => {
  const month = document.getElementById('fxMonth').value;
  const rate = parseFloat(document.getElementById('fxRate').value);
  if (!month || !rate) return;
  state.fxRates[month] = rate;
  save();
  renderFx();
});
document.getElementById('fxFetchBtn').addEventListener('click', async () => {
  if (!confirm('This will make a one-time network request to fetch today\'s EUR to INR rate. Continue?')) return;
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=INR');
    const data = await res.json();
    document.getElementById('fxRate').value = data.rates.INR;
    document.getElementById('fxMonth').value = thisMonthKey();
  } catch (e) {
    alert('Could not fetch — you may be offline. Enter the rate manually.');
  }
});
function renderFx() {
  document.getElementById('fxMonth').value = document.getElementById('fxMonth').value || thisMonthKey();
  const entries = Object.entries(state.fxRates).sort().reverse();
  document.getElementById('fxHistory').innerHTML = entries.map(([m, r]) =>
    `<div class="row-item"><span>${m}</span><span>1 EUR = ${SYM.INR}${r}</span></div>`
  ).join('') || '<p class="hint">No rates saved yet.</p>';
}

/* ===================== EXPORT / IMPORT ===================== */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById('exportJsonBtn').addEventListener('click', () => {
  downloadFile(`moneybook-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  state.lastBackupDate = todayStr(); save(); renderDataView();
});
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const rows = [['Date', 'Type', 'Envelope', 'Subcategory', 'Description', 'Account', 'Mode', 'Amount', 'Note']];
  state.transactions.forEach((t) => {
    const acc = state.accounts.find((a) => a.id === t.accountId);
    rows.push([t.date, t.type, t.envelope || '', t.subcategory || '', t.desc || '', acc ? acc.name : '', t.mode || '', t.amount, t.note || '']);
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile(`moneybook-transactions-${todayStr()}.csv`, csv, 'text/csv');
  state.lastBackupDate = todayStr(); save(); renderDataView();
});
document.getElementById('importJsonBtn').addEventListener('click', () => {
  const file = document.getElementById('importFile').files[0];
  if (!file) { alert('Choose a JSON file first.'); return; }
  if (!confirm('This will replace all current data with the backup. Continue?')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      state = Object.assign(structuredClone(defaultState), imported);
      save();
      renderAll();
      alert('Import complete.');
    } catch (err) {
      alert('That file could not be read as a valid backup.');
    }
  };
  reader.readAsText(file);
});
function renderDataView() {
  renderFx();
  document.getElementById('lastBackupText').textContent = state.lastBackupDate
    ? `Last backup: ${state.lastBackupDate}` : 'No backup taken yet.';
}

/* ===================== 7TH-OF-MONTH REMINDER ===================== */
function checkReminder() {
  const now = new Date();
  const mk = thisMonthKey();
  if (now.getDate() >= 7 && state.lastReminderShownMonth !== mk) {
    document.getElementById('reminderText').textContent =
      'It\'s the 7th+ — update your EUR/INR rate and set this month\'s budget in the Data and Budget tabs. Consider taking a backup too.';
    document.getElementById('reminderBanner').classList.remove('hidden');
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('My Money Book', { body: 'Time for your monthly budget & FX rate update.' }); } catch (e) {}
    }
  }
}
document.getElementById('reminderDismiss').addEventListener('click', () => {
  state.lastReminderShownMonth = thisMonthKey();
  save();
  document.getElementById('reminderBanner').classList.add('hidden');
});

/* ===================== INIT ===================== */
function renderAll() {
  renderAccounts();
  renderTxFilters();
  renderTxList();
  renderBudgetForm();
  renderEnvelopeCards('budgetDetail', true);
  renderGoals();
  renderIou();
  renderFd();
  renderCC('ccDetailList');
  renderDataView();
  renderDashboard();
}

updateSubcatOptions();
document.getElementById('txDate').value = todayStr();
document.getElementById('transferDate').value = todayStr();
document.getElementById('iouDate').value = todayStr();
document.getElementById('fdStartDate').value = todayStr();
document.getElementById('ccPayDate').value = todayStr();
renderAll();
checkReminder();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
