const STORAGE_KEY = "soledo_static_state";
const LEGACY_STORAGE_KEY = "ledger_state";
const RATE_CACHE_KEY = "soledo_static_rates_v1";
const EXPORT_PREFIX = "soledo-static";
const RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
const RATE_BASE_CURRENCY = "USD";
const INTERNAL_BASE_CURRENCY = "BDT";
const DEFAULT_DISPLAY_CURRENCY = "USD";
const FALLBACK_RATES = {
  USD: 1,
  BDT: 110
};
const PINNED_CURRENCIES = [
  "USD",
  "BDT",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "CAD",
  "AUD",
  "SGD",
  "AED",
  "SAR",
  "MYR",
  "THB"
];

const { createPicker, getCurrencySymbol, getInputPrefix } = window.SoledoCurrencyPicker;

let rateState = {
  rates: { ...FALLBACK_RATES },
  source: "fallback",
  timeLastUpdate: null,
  timeNextUpdate: null
};
let state = {
  balance: 0,
  transactions: [],
  currency: DEFAULT_DISPLAY_CURRENCY
};
let currentType = "income";
let currentFilter = "all";
let toastTimer;

const formatterCache = new Map();
const currencyNameHelper = typeof Intl.DisplayNames === "function"
  ? new Intl.DisplayNames(["en"], { type: "currency" })
  : null;

const elements = {
  currencyPickerWrap: document.getElementById("currencyPickerWrap"),
  currencyTrigger: document.getElementById("currencyTrigger"),
  currencyDropdown: document.getElementById("currencyDropdown"),
  currencyDropdownList: document.getElementById("currencyDropdownList"),
  currencyDisplaySym: document.getElementById("currencyDisplaySym"),
  currencyDisplayCode: document.getElementById("currencyDisplayCode"),
  exportBtn: document.getElementById("exportBtn"),
  importTriggerBtn: document.getElementById("importTriggerBtn"),
  importFile: document.getElementById("importFile"),
  rateDot: document.getElementById("rateDot"),
  rateText: document.getElementById("rateText"),
  balanceDisplay: document.getElementById("balanceDisplay"),
  balanceSecondary: document.getElementById("balanceSecondary"),
  editBalanceBtn: document.getElementById("editBalanceBtn"),
  balanceEditArea: document.getElementById("balanceEditArea"),
  editCurrencySym: document.getElementById("editCurrencySym"),
  balanceInput: document.getElementById("balanceInput"),
  totalIn: document.getElementById("totalIn"),
  totalOut: document.getElementById("totalOut"),
  txnCount: document.getElementById("txnCount"),
  btnIncome: document.getElementById("btnIncome"),
  btnExpense: document.getElementById("btnExpense"),
  sourceLabel: document.getElementById("sourceLabel"),
  txnDesc: document.getElementById("txnDesc"),
  formCurrencyLabel: document.getElementById("formCurrencyLabel"),
  formCurrencySym: document.getElementById("formCurrencySym"),
  txnAmount: document.getElementById("txnAmount"),
  addBtn: document.getElementById("addBtn"),
  filterButtons: Array.from(document.querySelectorAll(".filter-btn")),
  txnList: document.getElementById("txnList"),
  emptyState: document.getElementById("emptyState"),
  toast: document.getElementById("toast"),
  setBalanceBtn: document.getElementById("setBalanceBtn")
};

const currencyPicker = createPicker({
  wrap: elements.currencyPickerWrap,
  trigger: elements.currencyTrigger,
  dropdown: elements.currencyDropdown,
  list: elements.currencyDropdownList,
  displaySym: elements.currencyDisplaySym,
  displayCode: elements.currencyDisplayCode,
  getCurrencies: getAvailableCurrencies,
  getCurrentCurrency: () => state.currency,
  getCurrencyName,
  getPinnedCurrencies: () => PINNED_CURRENCIES,
  onSelect: setCurrency
});

bindEvents();
hydrateRatesFromCache();
loadState();
populateCurrencyOptions();
ensureSupportedCurrency();
syncCurrencyUI();
syncCurrencySymbols();
saveState();
renderAll();
renderRateStatus();
fetchRates();

function bindEvents() {
  elements.exportBtn.addEventListener("click", exportData);
  elements.importTriggerBtn.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importData);
  elements.editBalanceBtn.addEventListener("click", toggleBalanceEdit);
  elements.setBalanceBtn.addEventListener("click", setBalance);
  elements.balanceInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      setBalance();
    }
  });
  elements.btnIncome.addEventListener("click", () => setType("income"));
  elements.btnExpense.addEventListener("click", () => setType("expense"));
  elements.addBtn.addEventListener("click", addTransaction);
  elements.txnAmount.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      addTransaction();
    }
  });
  elements.filterButtons.forEach(button => {
    button.addEventListener("click", () => setFilter(button.dataset.filter, button));
  });
  elements.txnList.addEventListener("click", event => {
    const button = event.target.closest(".txn-del");
    if (!button) {
      return;
    }
    deleteTransaction(Number(button.dataset.id));
  });
}

function hydrateRatesFromCache() {
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    if (!raw) {
      return;
    }

    const cached = JSON.parse(raw);
    if (isValidRatePayload(cached)) {
      applyRatePayload(cached, "cached");
    }
  } catch {
    rateState = {
      rates: { ...FALLBACK_RATES },
      source: "fallback",
      timeLastUpdate: null,
      timeNextUpdate: null
    };
  }
}

async function fetchRates() {
  if (rateState.source === "cached" && isRateCacheFresh(rateState.timeNextUpdate)) {
    return;
  }

  try {
    const response = await fetch(RATE_API_URL);
    const payload = await response.json();

    if (!isValidRatePayload(payload)) {
      throw new Error("Invalid rate payload");
    }

    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(payload));
    applyRatePayload(payload, "live");
  } catch {
    if (!hasRate(INTERNAL_BASE_CURRENCY) || !hasRate(RATE_BASE_CURRENCY)) {
      rateState = {
        rates: { ...FALLBACK_RATES },
        source: "fallback",
        timeLastUpdate: null,
        timeNextUpdate: null
      };
      populateCurrencyOptions();
      ensureSupportedCurrency();
      syncCurrencyUI();
      syncCurrencySymbols();
      renderAll();
    }

    renderRateStatus();
  }
}

function applyRatePayload(payload, source) {
  rateState = {
    rates: payload.rates,
    source,
    timeLastUpdate: toTimestamp(payload.time_last_update_unix),
    timeNextUpdate: toTimestamp(payload.time_next_update_unix)
  };

  populateCurrencyOptions();
  ensureSupportedCurrency();
  syncCurrencyUI();
  syncCurrencySymbols();
  renderAll();
  renderRateStatus();
}

function isValidRatePayload(payload) {
  return Boolean(
    payload &&
      payload.base_code === RATE_BASE_CURRENCY &&
      payload.rates &&
      typeof payload.rates[RATE_BASE_CURRENCY] === "number" &&
      typeof payload.rates[INTERNAL_BASE_CURRENCY] === "number"
  );
}

function isRateCacheFresh(nextUpdate) {
  return Number.isFinite(nextUpdate) && Date.now() < nextUpdate;
}

function toTimestamp(value) {
  return Number.isFinite(value) ? value * 1000 : null;
}

function getRate(currency) {
  const value = rateState.rates[currency];
  return typeof value === "number" && value > 0 ? value : null;
}

function hasRate(currency) {
  return Number.isFinite(getRate(currency));
}

function convertAmount(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const fromRate = getRate(fromCurrency);
  const toRate = getRate(toCurrency);
  if (!fromRate || !toRate) {
    return amount;
  }

  return (amount / fromRate) * toRate;
}

function toDisplay(amountInBdt) {
  return convertAmount(amountInBdt, INTERNAL_BASE_CURRENCY, state.currency);
}

function toBase(displayAmount) {
  return convertAmount(displayAmount, state.currency, INTERNAL_BASE_CURRENCY);
}

function getAvailableCurrencies() {
  return Object.keys(rateState.rates)
    .filter(code => hasRate(code))
    .sort(sortCurrencyCodes);
}

function sortCurrencyCodes(left, right) {
  const leftPinned = PINNED_CURRENCIES.indexOf(left);
  const rightPinned = PINNED_CURRENCIES.indexOf(right);

  if (leftPinned !== -1 || rightPinned !== -1) {
    if (leftPinned === -1) {
      return 1;
    }
    if (rightPinned === -1) {
      return -1;
    }
    return leftPinned - rightPinned;
  }

  return getCurrencyOptionLabel(left).localeCompare(getCurrencyOptionLabel(right));
}

function populateCurrencyOptions() {
  currencyPicker.render();
}

function getCurrencyOptionLabel(code) {
  const name = getCurrencyName(code);
  return name ? `${code} - ${name}` : code;
}

function getCurrencyName(code) {
  try {
    return currencyNameHelper?.of(code) ?? "";
  } catch {
    return "";
  }
}

function ensureSupportedCurrency() {
  const availableCurrencies = getAvailableCurrencies();
  const fallbackCurrency = hasRate(DEFAULT_DISPLAY_CURRENCY)
    ? DEFAULT_DISPLAY_CURRENCY
    : availableCurrencies[0] ?? RATE_BASE_CURRENCY;

  if (!hasRate(state.currency)) {
    state.currency = fallbackCurrency;
  }
}

function setCurrency(currency) {
  if (!hasRate(currency)) {
    syncCurrencyUI();
    return;
  }

  if (state.currency === currency) {
    syncCurrencyUI();
    return;
  }

  state.currency = currency;
  syncCurrencyUI();
  syncCurrencySymbols();
  elements.balanceDisplay.classList.add("switching");
  renderRateStatus();

  setTimeout(() => {
    renderAll();
    elements.balanceDisplay.classList.remove("switching");
  }, 150);

  saveState();
  toast(`Viewing in ${currency}`);
}

function syncCurrencyUI() {
  currencyPicker.sync();
}

function syncCurrencySymbols() {
  elements.formCurrencySym.textContent = getInputPrefix(state.currency);
  elements.editCurrencySym.textContent = getInputPrefix(state.currency);
  elements.formCurrencyLabel.textContent = state.currency;
}

function getFormatter(currency) {
  if (!formatterCache.has(currency)) {
    formatterCache.set(
      currency,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  return formatterCache.get(currency);
}

function formatMoney(value, currency = state.currency, absolute = false) {
  const normalized = absolute ? Math.abs(value) : value;

  try {
    return getFormatter(currency).format(normalized);
  } catch {
    const prefix = !absolute && normalized < 0 ? "-" : "";
    const magnitude = Math.abs(normalized).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${prefix}${currency} ${magnitude}`;
  }
}

function formatMoneyWithCode(value, currency = state.currency, absolute = false) {
  const formatted = formatMoney(value, currency, absolute);
  return formatted.toUpperCase().includes(currency) ? formatted : `${formatted} ${currency}`;
}

function formatReferenceAmount(amountInBdt, absolute = true) {
  if (state.currency === RATE_BASE_CURRENCY) {
    return "";
  }

  const converted = convertAmount(amountInBdt, INTERNAL_BASE_CURRENCY, RATE_BASE_CURRENCY);
  return `~ ${formatMoney(converted, RATE_BASE_CURRENCY, absolute)} USD`;
}

function formatInputAmount(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);

  if (!raw) {
    state = {
      balance: 0,
      transactions: [],
      currency: DEFAULT_DISPLAY_CURRENCY
    };
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state = normalizeState(parsed);
  } catch {
    state = {
      balance: 0,
      transactions: [],
      currency: DEFAULT_DISPLAY_CURRENCY
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeState(candidate) {
  const requestedCurrency = normalizeCurrencyCode(candidate?.currency);
  const currency = requestedCurrency || DEFAULT_DISPLAY_CURRENCY;
  const balance = Number.isFinite(candidate?.balance) ? candidate.balance : 0;
  const transactions = Array.isArray(candidate?.transactions)
    ? candidate.transactions
        .map(normalizeTransaction)
        .filter(Boolean)
        .sort((left, right) => new Date(right.date) - new Date(left.date))
    : [];

  return { balance, transactions, currency };
}

function normalizeCurrencyCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function normalizeTransaction(txn) {
  if (!txn || (txn.type !== "income" && txn.type !== "expense")) {
    return null;
  }

  const amount = Number(txn.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const date = new Date(txn.date);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const id = Number.isFinite(Number(txn.id)) ? Number(txn.id) : Date.now() + Math.random();
  const desc = String(txn.desc ?? "").trim();
  if (!desc) {
    return null;
  }

  return {
    id,
    type: txn.type,
    desc,
    amount,
    date: date.toISOString()
  };
}

function toggleBalanceEdit() {
  const open = elements.balanceEditArea.classList.contains("visible");
  elements.balanceEditArea.classList.toggle("visible", !open);
  elements.editBalanceBtn.textContent = open ? "Edit" : "Cancel";

  if (!open) {
    elements.balanceInput.value = formatInputAmount(toDisplay(state.balance));
    elements.balanceInput.focus();
    elements.balanceInput.select();
  }
}

function setBalance() {
  const value = parseFloat(elements.balanceInput.value);

  if (Number.isNaN(value)) {
    toast("Enter a valid amount");
    return;
  }

  state.balance = toBase(value);
  elements.balanceEditArea.classList.remove("visible");
  elements.editBalanceBtn.textContent = "Edit";
  saveState();
  renderBalance();
  toast("Balance updated");
}

function setType(type) {
  currentType = type;
  elements.btnIncome.classList.toggle("active", type === "income");
  elements.btnExpense.classList.toggle("active", type === "expense");
  elements.sourceLabel.textContent = type === "income" ? "Source" : "Reason / Spent at";
  elements.txnDesc.placeholder = type === "income" ? "e.g. Salary, Freelance..." : "e.g. Groceries, Rent...";
  elements.addBtn.className = `btn-add ${type}`;
  elements.addBtn.textContent = type === "income" ? "Record Income" : "Record Expense";
}

function addTransaction() {
  const desc = elements.txnDesc.value.trim();
  const displayAmount = parseFloat(elements.txnAmount.value);

  if (!desc) {
    toast("Please fill in the description");
    return;
  }

  if (Number.isNaN(displayAmount) || displayAmount <= 0) {
    toast("Enter a valid amount");
    return;
  }

  const amount = toBase(displayAmount);
  const txn = {
    id: Date.now(),
    type: currentType,
    desc,
    amount,
    date: new Date().toISOString()
  };

  state.transactions.unshift(txn);
  state.balance += currentType === "income" ? amount : -amount;

  elements.txnDesc.value = "";
  elements.txnAmount.value = "";
  saveState();
  renderAll();

  const signedAmount = currentType === "income" ? displayAmount : -displayAmount;
  toast(`${signedAmount > 0 ? "+" : "-"}${formatMoney(signedAmount, state.currency, true)} saved`);
}

function deleteTransaction(id) {
  const txn = state.transactions.find(item => item.id === id);
  if (!txn) {
    return;
  }

  state.balance += txn.type === "income" ? -txn.amount : txn.amount;
  state.transactions = state.transactions.filter(item => item.id !== id);
  saveState();
  renderAll();
  toast("Transaction removed");
}

function setFilter(filter, button) {
  currentFilter = filter;
  elements.filterButtons.forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  renderTransactions();
}

function renderAll() {
  renderBalance();
  renderStats();
  renderTransactions();
}

function renderBalance() {
  const balance = state.balance;
  const displayBalance = toDisplay(balance);
  elements.balanceDisplay.textContent = formatMoney(displayBalance, state.currency);
  elements.balanceDisplay.className = `balance-amount ${balance > 0 ? "positive" : balance < 0 ? "negative" : "zero"}`;
  elements.balanceSecondary.textContent = formatReferenceAmount(balance, false);
}

function renderStats() {
  const income = state.transactions
    .filter(txn => txn.type === "income")
    .reduce((sum, txn) => sum + txn.amount, 0);
  const expense = state.transactions
    .filter(txn => txn.type === "expense")
    .reduce((sum, txn) => sum + txn.amount, 0);

  elements.totalIn.textContent = formatMoney(toDisplay(income), state.currency, true);
  elements.totalOut.textContent = formatMoney(toDisplay(expense), state.currency, true);
  elements.txnCount.textContent = String(state.transactions.length);
}

function renderTransactions() {
  const txns = state.transactions.filter(txn => currentFilter === "all" || txn.type === currentFilter);

  if (!txns.length) {
    elements.txnList.innerHTML = "";
    elements.emptyState.textContent = state.transactions.length
      ? `No ${currentFilter} transactions to show.`
      : "No transactions yet - start by setting your balance.";
    elements.emptyState.style.display = "block";
    return;
  }

  elements.emptyState.style.display = "none";
  elements.txnList.innerHTML = txns.map(renderTransactionItem).join("");
}

function renderTransactionItem(txn) {
  const date = new Date(txn.date);
  const dateText = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const timeText = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const displayAmount = toDisplay(txn.amount);
  const signedAmount = txn.type === "income" ? displayAmount : -displayAmount;
  const secondaryAmount = formatReferenceAmount(txn.amount);

  return `
    <li class="txn-item">
      <div class="txn-dot ${txn.type}"></div>
      <div class="txn-body">
        <div class="txn-desc">${escapeHtml(txn.desc)}</div>
        <div class="txn-meta-row">
          <span class="txn-tag ${txn.type}">${txn.type}</span>
          <span class="txn-date">${dateText} &middot; ${timeText}</span>
        </div>
      </div>
      <div class="txn-amounts">
        <span class="txn-amount ${txn.type}">${signedAmount > 0 ? "+" : "-"}${formatMoney(signedAmount, state.currency, true)}</span>
        ${secondaryAmount ? `<span class="txn-amount-secondary">${secondaryAmount}</span>` : ""}
      </div>
      <button class="txn-del" type="button" data-id="${txn.id}" title="Delete">x</button>
    </li>
  `;
}

function renderRateStatus() {
  const quotedCurrency = state.currency;
  const quotedAmount = convertAmount(1, RATE_BASE_CURRENCY, quotedCurrency);
  elements.rateDot.classList.toggle("stale", rateState.source === "fallback");

  if (rateState.source === "fallback") {
    elements.rateText.textContent = `1 USD = ${formatMoneyWithCode(quotedAmount, quotedCurrency, true)} - fallback rate`;
    return;
  }

  elements.rateText.textContent = `1 USD = ${formatMoneyWithCode(quotedAmount, quotedCurrency, true)} - ${rateState.source === "live" ? "live" : "cached rate"}`;
}

function exportData() {
  const payload = {
    ...state,
    exportedAt: new Date().toISOString(),
    rateBase: RATE_BASE_CURRENCY,
    ratesUpdatedAt: rateState.timeLastUpdate ? new Date(rateState.timeLastUpdate).toISOString() : null
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `${EXPORT_PREFIX}-${new Date().toISOString().slice(0, 10)}.json`
  });

  link.click();
  URL.revokeObjectURL(link.href);
  toast("Exported successfully");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = loadEvent => {
    try {
      const imported = JSON.parse(loadEvent.target.result);
      if (typeof imported?.balance !== "number" || !Array.isArray(imported?.transactions)) {
        toast("Invalid file format");
        return;
      }

      state = normalizeState(imported);
      ensureSupportedCurrency();
      syncCurrencyUI();
      syncCurrencySymbols();
      saveState();
      renderAll();
      renderRateStatus();
      toast(`Imported ${state.transactions.length} transactions`);
    } catch {
      toast("Failed to read file");
    }
  };

  reader.readAsText(file);
  event.target.value = "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2400);
}
