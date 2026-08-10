/* ===================== STORAGE ===================== */
const STORE_KEY = 'moneybook:data';

const defaultState = {
  accounts: [],
  transactions: [],
  budget: { base: 0, pctEssential: 50, pctFun: 30, pctInvestment: 20 },
  goals: {
    emergencyFund: { target: 1300000 },
    funGoals: []
  },
  iou: [],
  fd: [],
  planned: [],
  fxRates: {},
  settings: { theme: 'ledger', themeCharts: false },
  lastBackupDate: null,
  lastReminderShownMonth: null
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    const merged = Object.assign(structuredClone(defaultState), parsed);
    merged.goals = Object.assign(structuredClone(defaultState.goals), parsed.goals || {});
    merged.settings = Object.assign(structuredClone(defaultState.settings), parsed.settings || {});
    // migrate old single funGoal shape if present
    if (parsed.goals && parsed.goals.funGoal && !parsed.goals.funGoals) {
      const fg = parsed.goals.funGoal;
      if (fg.target > 0) merged.goals.funGoals = [{ id: 'g_migrated', name: fg.name, target: fg.target, date: fg.date }];
    }
    return merged;
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
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const SYM = { INR: '\u20b9', EUR: '\u20ac' };

const SUBCATS = {
  essential: ['Rent', 'Health insurance', 'Gym & fitness', 'Radio tax', 'Groceries'],
  fun: ['Travel', 'Shopping', 'Food orders', 'Subscriptions', 'Buy-goal saving', 'Outdoor eating', 'Fun with friends'],
  investment: ['RD (IndusInd)', 'Emergency fund', 'Other investment']
};

/* ===================== THEME ===================== */
function applyTheme() {
  document.body.className = 'theme-' + (state.settings.theme || 'ledger');
  document.getElementById('themeSelect').value = state.settings.theme || 'ledger';
  document.getElementById('themeChartsToggle').checked = !!state.settings.themeCharts;
}
document.getElementById('themeSelect').addEventListener('change', (e) => {
  state.settings.theme = e.target.value;
  save(); applyTheme(); renderCharts();
});
document.getElementById('themeChartsToggle').addEventListener('change', (e) => {
  state.settings.themeCharts = e.target.checked;
  save(); renderCharts();
});
function envelopeChartColors() {
  if (state.settings.themeCharts) {
    const cs = getComputedStyle(document.body);
    return [cs.getPropertyValue('--essential-c').trim(), cs.getPropertyValue('--fun-c').trim(), cs.getPropertyValue('--invest-c').trim()];
  }
  return ['#378ADD', '#C97A3A', '#1D9E75'];
}

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
    id: uid('a'), name,
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
function removeAccount(id) {
  if (!confirm('Delete this account and its transactions?')) return;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.transactions = state.transactions.filter((t) => t.accountId !== id && t.toAccountId !== id);
  save();
  renderAll();
}
function renderAccounts() {
  const sel = (id, filterFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const list = filterFn ? state.accounts.filter(filterFn) : state.accounts;
    el.innerHTML = list.map((a) => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('');
    if ([...el.options].some((o) => o.value === cur)) el.value = cur;
  };
  sel('txAccount');
  sel('txToAccount');
  sel('plAccount', (a) => a.type !== 'creditcard');
  sel('ccPayFrom', (a) => a.type !== 'creditcard');
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

/* ===================== TRANSACTIONS (expense / income / transfer) ===================== */
document.getElementById('txTypeToggle').addEventListener('click', (e) => {
  if (!e.target.dataset.val) return;
  document.querySelectorAll('#txTypeToggle .toggle-btn').forEach((b) => b.classList.remove('active'));
  e.target.classList.add('active');
  updateTxFormVisibility();
});
function updateTxFormVisibility() {
  const type = document.querySelector('#txTypeToggle .toggle-btn.active').dataset.val;
  document.getElementById('txCategoryRow').style.display = type === 'expense' ? 'flex' : 'none';
  document.getElementById('txModeRow').style.display = type === 'transfer' ? 'none' : 'flex';
  document.getElementById('txToAccountRow').classList.toggle('hidden', type !== 'transfer');
  document.getElementById('txDesc').placeholder = type === 'transfer' ? 'Note (optional)' : 'Description';
  document.getElementById('txAccount').previousElementSibling; // no-op, kept for clarity
  updateTransferRateVisibility();
  updateFunGoalPickerVisibility();
}
function updateTransferRateVisibility() {
  const type = document.querySelector('#txTypeToggle .toggle-btn.active').dataset.val;
  if (type !== 'transfer') { document.getElementById('txTransferRateRow').classList.add('hidden'); return; }
  const from = state.accounts.find((a) => a.id === document.getElementById('txAccount').value);
  const to = state.accounts.find((a) => a.id === document.getElementById('txToAccount').value);
  document.getElementById('txTransferRateRow').classList.toggle('hidden', !(from && to && from.currency !== to.currency));
}
document.getElementById('txAccount').addEventListener('change', updateTransferRateVisibility);
document.getElementById('txToAccount').addEventListener('change', updateTransferRateVisibility);

document.getElementById('txEnvelope').addEventListener('change', () => { updateSubcatOptions(); updateFunGoalPickerVisibility(); });
document.getElementById('txSubcategory').addEventListener('change', updateFunGoalPickerVisibility);
function updateSubcatOptions() {
  const env = document.getElementById('txEnvelope').value;
  document.getElementById('txSubcategory').innerHTML = SUBCATS[env].map((s) => `<option>${s}</option>`).join('');
}
function updateFunGoalPickerVisibility() {
  const type = document.querySelector('#txTypeToggle .toggle-btn.active').dataset.val;
  const env = document.getElementById('txEnvelope').value;
  const sub = document.getElementById('txSubcategory').value;
  const show = type === 'expense' && env === 'fun' && sub === 'Buy-goal saving' && state.goals.funGoals.length > 0;
  document.getElementById('txFunGoalRow').classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('txFunGoalPicker').innerHTML = state.goals.funGoals.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
  }
}

document.getElementById('addTxBtn').addEventListener('click', () => {
  const type = document.querySelector('#txTypeToggle .toggle-btn.active').dataset.val;
  const date = document.getElementById('txDate').value || todayStr();
  const note = document.getElementById('txNote').value.trim();

  if (type === 'transfer') {
    const fromId = document.getElementById('txAccount').value;
    const toId = document.getElementById('txToAccount').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    if (!fromId || !toId || fromId === toId || !amount) { alert('Pick two different accounts and an amount.'); return; }
    const from = state.accounts.find((a) => a.id === fromId);
    const to = state.accounts.find((a) => a.id === toId);
    let toAmount = amount;
    if (from.currency !== to.currency) {
      const rate = parseFloat(document.getElementById('txTransferRate').value);
      if (!rate) { alert('Enter a conversion rate.'); return; }
      toAmount = amount * rate;
    }
    state.transactions.push({ id: uid('t'), type: 'transfer', date, accountId: fromId, toAccountId: toId, amount, toAmount, note });
  } else {
    const accountId = document.getElementById('txAccount').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    const desc = document.getElementById('txDesc').value.trim();
    if (!accountId || !amount || !desc) { alert('Description, account and amount are required.'); return; }
    const envelope = type === 'expense' ? document.getElementById('txEnvelope').value : null;
    const subcategory = type === 'expense' ? document.getElementById('txSubcategory').value : null;
    const goalId = (type === 'expense' && subcategory === 'Buy-goal saving' && !document.getElementById('txFunGoalRow').classList.contains('hidden'))
      ? document.getElementById('txFunGoalPicker').value : null;
    state.transactions.push({
      id: uid('t'), type, date, accountId, amount, desc, envelope, subcategory, goalId,
      mode: document.getElementById('txMode').value, note
    });
  }
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
  let rows = state.transactions.slice();
  if (month !== 'all') rows = rows.filter((t) => t.date.slice(0, 7) === month);
  if (env === 'transfer') rows = rows.filter((t) => t.type === 'transfer');
  else if (env !== 'all') rows = rows.filter((t) => t.envelope === env);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById('txList').innerHTML = rows.map((t) => {
    const acc = state.accounts.find((a) => a.id === t.accountId);
    if (t.type === 'transfer') {
      const toAcc = state.accounts.find((a) => a.id === t.toAccountId);
      return `<div class="row-item">
        <div><b>${t.note || 'Transfer'}</b><div class="meta">${t.date} · ${acc ? acc.name : '?'} &rarr; ${toAcc ? toAcc.name : '?'}</div></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="amt">${SYM[acc ? acc.currency : 'INR']}${fmt(t.amount)}</span>
          <button class="del-btn" onclick="removeTx('${t.id}')">&#10005;</button>
        </div>
      </div>`;
    }
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
    const pct = cap > 0 ? clamp((actual / cap) * 100, 0, 100) : 0;
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

/* ===================== GOALS (multiple fun goals) ===================== */
function investmentTotalAllTime() {
  return state.transactions.filter((t) => t.type === 'expense' && t.envelope === 'investment')
    .reduce((s, t) => s + t.amount, 0);
}
document.getElementById('saveFunGoalBtn').addEventListener('click', () => {
  const name = document.getElementById('funGoalName').value.trim();
  const target = parseFloat(document.getElementById('funGoalTarget').value);
  const date = document.getElementById('funGoalDate').value;
  if (!name || !target) { alert('Name and target amount are required.'); return; }
  state.goals.funGoals.push({ id: uid('g'), name, target, date });
  save();
  document.getElementById('funGoalName').value = '';
  document.getElementById('funGoalTarget').value = '';
  document.getElementById('funGoalDate').value = '';
  renderAll();
});
function removeFunGoal(id) {
  if (!confirm('Delete this goal? Logged contributions stay in your transaction history, just unlinked.')) return;
  state.goals.funGoals = state.goals.funGoals.filter((g) => g.id !== id);
  save(); renderAll();
}
function funGoalSaved(goalId) {
  return state.transactions.filter((t) => t.type === 'expense' && t.envelope === 'fun' && t.subcategory === 'Buy-goal saving' && t.goalId === goalId)
    .reduce((s, t) => s + t.amount, 0);
}
function renderGoals() {
  const target = state.goals.emergencyFund.target;
  const saved = investmentTotalAllTime();
  const pct = clamp((saved / target) * 100, 0, 100);
  document.getElementById('emergencyGoalDisplay').innerHTML = `
    <div class="envelope-top"><b>Emergency fund</b><span>${SYM.INR}${fmt(saved)} / ${SYM.INR}${fmt(target)}</span></div>
    <div class="progress-track"><div class="progress-fill fill-investment" style="width:${pct}%"></div></div>
    <p class="hint">${pct.toFixed(1)}% funded — logged from your Investment envelope entries.</p>`;

  document.getElementById('funGoalList').innerHTML = state.goals.funGoals.map((fg) => {
    const s = funGoalSaved(fg.id);
    const p = clamp((s / fg.target) * 100, 0, 100);
    const daysLeft = fg.date ? Math.ceil((new Date(fg.date) - new Date()) / 86400000) : null;
    return `<div class="card">
      <div class="envelope-top"><b>${fg.name}</b><button class="del-btn" onclick="removeFunGoal('${fg.id}')">&#10005;</button></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;"><span>${SYM.INR}${fmt(s)} / ${SYM.INR}${fmt(fg.target)}</span></div>
      <div class="progress-track"><div class="progress-fill fill-fun" style="width:${p}%"></div></div>
      <p class="hint">${daysLeft !== null ? daysLeft + ' days left. ' : ''}Log under Fun &rarr; "Buy-goal saving" and pick this goal.</p>
    </div>`;
  }).join('') || '<p class="hint">No fun goals yet — add one above.</p>';
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
    const inCredit = owed < 0;
    const pct = limit > 0 ? clamp((owed / limit) * 100, 0, 100) : 0;
    return `<div class="card">
      <div class="envelope-top"><b>${c.name}</b>
        <span class="${inCredit ? 'credit-note' : 'amt-expense'}" style="font-weight:700;">
          ${inCredit ? 'In credit ' + SYM.INR + fmt(-owed) : SYM.INR + fmt(owed) + ' owed'}
        </span></div>
      <div class="progress-track"><div class="progress-fill ${pct > 80 ? 'fill-over' : 'fill-essential'}" style="width:${pct}%"></div></div>
      <p class="hint">${limit > 0 ? (inCredit ? 'No amount currently owed' : fmt(owed) + ' of ' + fmt(limit) + ' limit (' + pct.toFixed(0) + '%)') : 'No limit set'}</p>
    </div>`;
  }).join('') || '<p class="hint">No credit cards added yet — add one from the Accounts tab.</p>';
}

/* ===================== PLANNED / RECURRING ===================== */
document.getElementById('plTypeToggle').addEventListener('click', (e) => {
  if (!e.target.dataset.val) return;
  document.querySelectorAll('#plTypeToggle .toggle-btn').forEach((b) => b.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('plCategoryRow').style.display = e.target.dataset.val === 'income' ? 'none' : 'flex';
});
document.getElementById('plEnvelope').addEventListener('change', () => {
  document.getElementById('plSubcategory').innerHTML = SUBCATS[document.getElementById('plEnvelope').value].map((s) => `<option>${s}</option>`).join('');
});
document.getElementById('addPlannedBtn').addEventListener('click', () => {
  const desc = document.getElementById('plDesc').value.trim();
  const amount = parseFloat(document.getElementById('plAmount').value);
  const day = parseInt(document.getElementById('plDay').value, 10);
  const accountId = document.getElementById('plAccount').value;
  if (!desc || !amount || !day || !accountId) { alert('Description, amount, day of month and account are required.'); return; }
  const type = document.querySelector('#plTypeToggle .toggle-btn.active').dataset.val;
  state.planned.push({
    id: uid('p'), desc, amount, day, accountId, type,
    envelope: type === 'expense' ? document.getElementById('plEnvelope').value : null,
    subcategory: type === 'expense' ? document.getElementById('plSubcategory').value : null,
    mode: document.getElementById('plMode').value
  });
  save();
  document.getElementById('plDesc').value = '';
  document.getElementById('plAmount').value = '';
  document.getElementById('plDay').value = '';
  renderAll();
});
function removePlanned(id) {
  if (!confirm('Delete this recurring item?')) return;
  state.planned = state.planned.filter((p) => p.id !== id);
  save(); renderAll();
}
function isPlannedPaidThisMonth(planId) {
  const mk = thisMonthKey();
  return state.transactions.some((t) => t.plannedId === planId && t.date.slice(0, 7) === mk);
}
function markPlannedPaid(id) {
  const p = state.planned.find((x) => x.id === id);
  if (!p) return;
  const amtStr = prompt(`Amount for "${p.desc}"?`, p.amount);
  if (amtStr === null) return;
  const amount = parseFloat(amtStr);
  if (!amount) return;
  state.transactions.push({
    id: uid('t'), type: p.type, date: todayStr(), accountId: p.accountId, amount, desc: p.desc,
    envelope: p.envelope, subcategory: p.subcategory, goalId: null, mode: p.mode, note: '', plannedId: p.id
  });
  save(); renderAll();
}
function renderPlanned() {
  document.getElementById('plannedList').innerHTML = state.planned.map((p) => {
    const paid = isPlannedPaidThisMonth(p.id);
    const acc = state.accounts.find((a) => a.id === p.accountId);
    return `<div class="row-item">
      <div><b>${p.desc}</b><div class="meta">Day ${p.day} · ${acc ? acc.name : '?'} · usually ${SYM.INR}${fmt(p.amount)}${paid ? ' · paid this month' : ''}</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="removePlanned('${p.id}')">Remove</button>
      </div>
    </div>`;
  }).join('') || '<p class="hint">No recurring items set up yet.</p>';

  const due = state.planned.filter((p) => !isPlannedPaidThisMonth(p.id));
  document.getElementById('dashPlanned').innerHTML = due.map((p) => {
    const acc = state.accounts.find((a) => a.id === p.accountId);
    return `<div class="row-item">
      <div><b>${p.desc}</b><div class="meta">Due day ${p.day} · ${acc ? acc.name : '?'} · ~${SYM.INR}${fmt(p.amount)}</div></div>
      <button class="btn-primary" style="font-size:12px;padding:6px 10px;" onclick="markPlannedPaid('${p.id}')">Mark paid</button>
    </div>`;
  }).join('') || '<p class="hint">Nothing recurring due — add items in the Recur tab.</p>';
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

  const target = state.goals.emergencyFund.target;
  const saved = investmentTotalAllTime();
  const pct = clamp((saved / target) * 100, 0, 100);
  let goalsHtml = `<div class="envelope-card">
    <div class="envelope-top"><b>Emergency fund</b><span>${pct.toFixed(0)}%</span></div>
    <div class="progress-track"><div class="progress-fill fill-investment" style="width:${pct}%"></div></div>
  </div>`;
  state.goals.funGoals.forEach((fg) => {
    const s = funGoalSaved(fg.id);
    const p = clamp((s / fg.target) * 100, 0, 100);
    goalsHtml += `<div class="envelope-card">
      <div class="envelope-top"><b>${fg.name}</b><span>${p.toFixed(0)}%</span></div>
      <div class="progress-track"><div class="progress-fill fill-fun" style="width:${p}%"></div></div>
    </div>`;
  });
  document.getElementById('dashGoals').innerHTML = goalsHtml;

  renderCharts();
}

let pieChartInstance = null, lineChartInstance = null;
function renderCharts() {
  const mk = thisMonthKey();
  const actuals = ['essential', 'fun', 'investment'].map((e) => monthEnvelopeActual(mk, e));
  const colors = envelopeChartColors();

  const pieCtx = document.getElementById('pieChart');
  if (pieChartInstance) pieChartInstance.destroy();
  pieChartInstance = new Chart(pieCtx, {
    type: 'doughnut',
    data: { labels: ['Essential', 'Fun', 'Investment'], datasets: [{ data: actuals, backgroundColor: colors }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }
  });

  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(dt.toISOString().slice(0, 7));
  }
  const totals = months.map((m) => state.transactions.filter((t) => t.type === 'expense' && t.date.slice(0, 7) === m).reduce((s, t) => s + t.amount, 0));
  const lineColor = state.settings.themeCharts ? getComputedStyle(document.body).getPropertyValue('--ink').trim() : '#22301F';
  const lineCtx = document.getElementById('lineChart');
  if (lineChartInstance) lineChartInstance.destroy();
  lineChartInstance = new Chart(lineCtx, {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'Total spend', data: totals, borderColor: lineColor, backgroundColor: lineColor + '1a', fill: true, tension: 0.2 }] },
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
  if (!confirm("This will make a one-time network request to fetch today's EUR to INR rate. Continue?")) return;
  const statusEl = document.getElementById('fxStatus');
  statusEl.textContent = 'Fetching…';
  const endpoints = [
    'https://api.frankfurter.app/latest?from=EUR&to=INR',
    'https://api.frankfurter.dev/v1/latest?from=EUR&to=INR',
    'https://open.er-api.com/v6/latest/EUR'
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = (data.rates && data.rates.INR) || (data.conversion_rates && data.conversion_rates.INR);
      if (rate) {
        document.getElementById('fxRate').value = rate;
        document.getElementById('fxMonth').value = thisMonthKey();
        statusEl.textContent = 'Fetched from ' + new URL(url).hostname + ' — review and hit Save.';
        return;
      }
    } catch (e) {
      // try next endpoint
    }
  }
  statusEl.textContent = 'Could not reach any rate source — you may be offline, or your browser/network is blocking it. Enter the rate manually.';
});
function renderFx() {
  if (!document.getElementById('fxMonth').value) document.getElementById('fxMonth').value = thisMonthKey();
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
    rows.push([t.date, t.type, t.envelope || '', t.subcategory || '', t.desc || t.note || '', acc ? acc.name : '', t.mode || '', t.amount, t.note || '']);
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
      state = loadStateFromObject(imported);
      save();
      applyTheme();
      renderAll();
      alert('Import complete.');
    } catch (err) {
      alert('That file could not be read as a valid backup.');
    }
  };
  reader.readAsText(file);
});
function loadStateFromObject(parsed) {
  const merged = Object.assign(structuredClone(defaultState), parsed);
  merged.goals = Object.assign(structuredClone(defaultState.goals), parsed.goals || {});
  merged.settings = Object.assign(structuredClone(defaultState.settings), parsed.settings || {});
  if (parsed.goals && parsed.goals.funGoal && !parsed.goals.funGoals) {
    const fg = parsed.goals.funGoal;
    if (fg.target > 0) merged.goals.funGoals = [{ id: 'g_migrated', name: fg.name, target: fg.target, date: fg.date }];
  }
  return merged;
}
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
      "It's the 7th+ — update your EUR/INR rate and this month's budget in the Data and Budget tabs. Consider a backup too.";
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
  updateTxFormVisibility();
  renderBudgetForm();
  renderEnvelopeCards('budgetDetail', true);
  renderGoals();
  renderIou();
  renderFd();
  renderCC('ccDetailList');
  renderPlanned();
  renderDataView();
  renderDashboard();
}

applyTheme();
updateSubcatOptions();
document.getElementById('txDate').value = todayStr();
document.getElementById('iouDate').value = todayStr();
document.getElementById('fdStartDate').value = todayStr();
document.getElementById('ccPayDate').value = todayStr();
document.getElementById('plEnvelope').dispatchEvent(new Event('change'));
renderAll();
checkReminder();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

function renderChartImage(labels, values, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = 500; canvas.height = 350;
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
    options: {
      responsive: false, animation: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 14 } } } }
    }
  });
  const url = canvas.toDataURL('image/png');
  chart.destroy();
  return url;
}
function envelopeTotalsAllTime() {
  return {
    labels: ['Essential', 'Fun', 'Investment'],
    values: ['essential', 'fun', 'investment'].map((env) =>
      state.transactions.filter((t) => t.type === 'expense' && t.envelope === env).reduce((s, t) => s + t.amount, 0)),
    colors: ['#378ADD', '#C97A3A', '#1D9E75']
  };
}

/* ===================== REPORTS ===================== */
document.getElementById('reportFormatToggle').addEventListener('click', (e) => {
  if (!e.target.dataset.val) return;
  document.querySelectorAll('#reportFormatToggle .toggle-btn').forEach((b) => b.classList.remove('active'));
  e.target.classList.add('active');
});

function buildReportData(type) {
  const acctName = (id) => { const a = state.accounts.find((x) => x.id === id); return a ? a.name : '?'; };

  if (type === 'month') {
    const months = Array.from(new Set(state.transactions.filter((t) => t.type !== 'transfer').map((t) => t.date.slice(0, 7)))).sort();
    const header = ['Month', 'Income', 'Essential', 'Fun', 'Investment', 'Total Expense', 'Net'];
    const rows = months.map((m) => {
      const income = state.transactions.filter((t) => t.type === 'income' && t.date.slice(0, 7) === m).reduce((s, t) => s + t.amount, 0);
      const ess = monthEnvelopeActual(m, 'essential');
      const fun = monthEnvelopeActual(m, 'fun');
      const inv = monthEnvelopeActual(m, 'investment');
      const totalExp = ess + fun + inv;
      return [m, income.toFixed(2), ess.toFixed(2), fun.toFixed(2), inv.toFixed(2), totalExp.toFixed(2), (income - totalExp).toFixed(2)];
    });
    return { title: 'Month-wise Report', header, rows };
  }

  if (type === 'account') {
    const header = ['Account', 'Type', 'Currency', 'Balance', 'Total Income', 'Total Expense'];
    const rows = state.accounts.map((a) => {
      const inc = state.transactions.filter((t) => t.type === 'income' && t.accountId === a.id).reduce((s, t) => s + t.amount, 0);
      const exp = state.transactions.filter((t) => t.type === 'expense' && t.accountId === a.id).reduce((s, t) => s + t.amount, 0);
      const bal = a.type === 'creditcard' ? -ccOwed(a.id) : accountBalance(a.id);
      return [a.name, a.type, a.currency, bal.toFixed(2), inc.toFixed(2), exp.toFixed(2)];
    });
    return { title: 'Account-wise Report', header, rows };
  }

  if (type === 'expenditure') {
    const header = ['Envelope', 'Subcategory', 'Amount', '% of envelope'];
    const rows = [];
    ['essential', 'fun', 'investment'].forEach((env) => {
      const envTotal = state.transactions.filter((t) => t.type === 'expense' && t.envelope === env).reduce((s, t) => s + t.amount, 0);
      SUBCATS[env].forEach((sc) => {
        const amt = state.transactions.filter((t) => t.type === 'expense' && t.envelope === env && t.subcategory === sc).reduce((s, t) => s + t.amount, 0);
        if (amt > 0) rows.push([env, sc, amt.toFixed(2), envTotal > 0 ? ((amt / envTotal) * 100).toFixed(1) + '%' : '0%']);
      });
    });
    return { title: 'Expenditure-wise Report (all time)', header, rows };
  }

  if (type === 'goal') {
    const header = ['Goal', 'Target', 'Saved', 'Remaining', '% Complete', 'Target Date'];
    const rows = [];
    const efSaved = investmentTotalAllTime();
    const efTarget = state.goals.emergencyFund.target;
    rows.push(['Emergency fund', efTarget.toFixed(2), efSaved.toFixed(2), Math.max(0, efTarget - efSaved).toFixed(2), Math.min(100, (efSaved / efTarget) * 100).toFixed(1) + '%', '—']);
    state.goals.funGoals.forEach((fg) => {
      const s = funGoalSaved(fg.id);
      rows.push([fg.name, fg.target.toFixed(2), s.toFixed(2), Math.max(0, fg.target - s).toFixed(2), Math.min(100, (s / fg.target) * 100).toFixed(1) + '%', fg.date || '—']);
    });
    return { title: 'Goal-wise Report', header, rows };
  }

  if (type === 'budget') {
    const months = Array.from(new Set(state.transactions.filter((t) => t.type === 'expense').map((t) => t.date.slice(0, 7)))).sort();
    const header = ['Month', 'Envelope', 'Cap', 'Actual', 'Variance', 'Status'];
    const rows = [];
    months.forEach((m) => {
      ['essential', 'fun', 'investment'].forEach((env) => {
        const cap = envelopeCap(env);
        const actual = monthEnvelopeActual(m, env);
        const variance = cap - actual;
        rows.push([m, env, cap.toFixed(2), actual.toFixed(2), variance.toFixed(2), variance >= 0 ? 'Under' : 'Over']);
      });
    });
    return { title: 'Budget-tracking Analysis', header, rows };
  }

  if (type === 'itr') {
    const sources = {};
    state.transactions.filter((t) => t.type === 'income').forEach((t) => {
      const key = t.desc || 'Unlabelled';
      sources[key] = (sources[key] || 0) + t.amount;
    });
    const header = ['Income Source', 'Total Amount', 'Entries'];
    const rows = Object.entries(sources).map(([src, amt]) => {
      const count = state.transactions.filter((t) => t.type === 'income' && (t.desc || 'Unlabelled') === src).length;
      return [src, amt.toFixed(2), String(count)];
    });
    return {
      title: 'ITR-format Income Summary',
      header, rows,
      note: 'This groups your logged income by description only — it is NOT a certified tax document and does not map to official ITR income heads (Salary, Business, Capital Gains, Other Sources). Use this as a starting point and confirm classification with a CA before filing.'
    };
  }
  return { title: 'Report', header: [], rows: [] };
}

function generatePDF(data, chartImage) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const marginX = 14;
  let y = 18;
  doc.setFontSize(15);
  doc.text(data.title, marginX, y);
  y += 6;
  doc.setFontSize(9);
  doc.text('My Money Book — generated ' + todayStr(), marginX, y);
  y += 8;

  if (chartImage) {
    const imgW = 90, imgH = 63;
    doc.addImage(chartImage, 'PNG', marginX, y, imgW, imgH);
    y += imgH + 8;
  }

  const colCount = data.header.length;
  const pageWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  const colWidth = pageWidth / colCount;
  const rowHeight = 7;
  const pageHeight = doc.internal.pageSize.getHeight();

  function drawRow(cells, bold) {
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    cells.forEach((c, i) => {
      doc.text(String(c).slice(0, 24), marginX + i * colWidth, y);
    });
    y += rowHeight;
  }

  doc.setFontSize(8);
  drawRow(data.header, true);
  doc.setLineWidth(0.2);
  doc.line(marginX, y - 5, marginX + pageWidth, y - 5);

  data.rows.forEach((row) => {
    if (y > pageHeight - 20) {
      doc.addPage();
      y = 18;
      drawRow(data.header, true);
      doc.line(marginX, y - 5, marginX + pageWidth, y - 5);
    }
    drawRow(row, false);
  });

  if (data.note) {
    y += 6;
    if (y > pageHeight - 30) { doc.addPage(); y = 18; }
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    const split = doc.splitTextToSize(data.note, pageWidth);
    doc.text(split, marginX, y);
  }

  doc.save(`moneybook-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayStr()}.pdf`);
}

function generateExcel(data) {
  const wb = XLSX.utils.book_new();
  const aoa = [[data.title], ['Generated ' + todayStr()], [], data.header, ...data.rows];
  if (data.note) aoa.push([], [data.note]);
  aoa.push([], ['Note: chart images are only included in the PDF export — select the data above and use Insert > Chart in Excel/Sheets if you want a visual here.']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = data.header.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws, data.title.slice(0, 28));
  XLSX.writeFile(wb, `moneybook-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayStr()}.xlsx`);
}

document.getElementById('generateReportBtn').addEventListener('click', () => {
  const type = document.getElementById('reportType').value;
  const format = document.querySelector('#reportFormatToggle .toggle-btn.active').dataset.val;
  const data = buildReportData(type);
  if (data.rows.length === 0) { alert('No data yet for this report — log some transactions first.'); return; }
  try {
    if (format === 'pdf') {
      let chartImage = null;
      if (['month', 'expenditure', 'budget'].includes(type)) {
        const et = envelopeTotalsAllTime();
        if (et.values.some((v) => v > 0)) chartImage = renderChartImage(et.labels, et.values, et.colors);
      }
      generatePDF(data, chartImage);
    } else {
      generateExcel(data);
    }
  } catch (e) {
    alert('Report generation failed: ' + e.message + '. If you are offline, this needs the PDF/Excel library to have loaded at least once while online.');
  }
});
