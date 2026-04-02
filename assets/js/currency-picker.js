(function attachCurrencyPicker(global) {
  const GENERIC_SYMBOL = "¤";
  const PREFERRED_SYMBOLS = {
    USD: "$",
    BDT: "৳",
    EUR: "€",
    GBP: "£",
    INR: "₹",
    JPY: "¥",
    CAD: "C$",
    AUD: "A$",
    SGD: "S$",
    AED: "د.إ",
    SAR: "ر.س",
    MYR: "RM",
    THB: "฿",
    CNY: "¥",
    HKD: "HK$",
    NZD: "NZ$",
    CHF: "CHF",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    PLN: "zł",
    CZK: "Kč",
    HUF: "Ft",
    RON: "lei",
    RUB: "₽",
    KRW: "₩",
    IDR: "Rp",
    PHP: "₱",
    VND: "₫",
    TRY: "₺",
    BRL: "R$",
    MXN: "MX$",
    ZAR: "R",
    NGN: "₦",
    UAH: "₴",
    KZT: "₸",
    BGN: "лв",
    BAM: "KM",
    AZN: "₼",
    GEL: "₾",
    AWG: "ƒ",
    ANG: "ƒ",
    BBD: "Bds$",
    BHD: "BD"
  };

  const symbolCache = new Map();

  function isCodeLikeSymbol(symbol, code) {
    const compact = symbol.replace(/\s+/g, "").toUpperCase();
    return compact === code || compact === `${code}${code}` || compact.includes(code);
  }

  function sanitizeCurrencySymbol(code, rawSymbol) {
    if (!rawSymbol) {
      return PREFERRED_SYMBOLS[code] || GENERIC_SYMBOL;
    }

    const symbol = rawSymbol.trim();
    if (!symbol) {
      return PREFERRED_SYMBOLS[code] || GENERIC_SYMBOL;
    }

    if (isCodeLikeSymbol(symbol, code)) {
      return PREFERRED_SYMBOLS[code] || GENERIC_SYMBOL;
    }

    return symbol;
  }

  function getCurrencySymbol(code) {
    if (!symbolCache.has(code)) {
      let symbol = PREFERRED_SYMBOLS[code] || "";

      if (!symbol) {
        try {
          const parts = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: code,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          }).formatToParts(0);

          symbol = parts.find(part => part.type === "currency")?.value || "";
        } catch {
          symbol = "";
        }
      }

      symbolCache.set(code, sanitizeCurrencySymbol(code, symbol));
    }

    return symbolCache.get(code);
  }

  function getInputPrefix(code) {
    const symbol = getCurrencySymbol(code);
    return symbol === GENERIC_SYMBOL ? code : symbol;
  }

  function renderCurrencyGroup(label, currencies, getCurrencyName) {
    return `
      <div class="cur-group">
        <span class="cur-group-label">${escapeHtml(label)}</span>
        ${currencies.map(code => renderCurrencyOption(code, getCurrencyName)).join("")}
      </div>
    `;
  }

  function renderCurrencyOption(code, getCurrencyName) {
    const name = getCurrencyName(code) || code;

    return `
      <button class="cur-option" type="button" role="option" data-currency="${code}" aria-selected="false">
        <span class="cur-option-main">
          <span class="cur-option-symbol">${escapeHtml(getCurrencySymbol(code))}</span>
          <span class="cur-option-code">${escapeHtml(code)}</span>
        </span>
        <span class="cur-option-name">${escapeHtml(name)}</span>
      </button>
    `;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createPicker(config) {
    const {
      wrap,
      trigger,
      dropdown,
      list,
      displaySym,
      displayCode,
      getCurrencies,
      getCurrentCurrency,
      getCurrencyName,
      getPinnedCurrencies,
      onSelect
    } = config;

    let open = false;

    trigger.addEventListener("click", event => {
      event.stopPropagation();
      open ? close() : show();
    });

    list.addEventListener("click", event => {
      const option = event.target.closest(".cur-option");
      if (!option) {
        return;
      }

      onSelect(option.dataset.currency);
      close();
    });

    document.addEventListener("click", event => {
      if (!wrap.contains(event.target)) {
        close();
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        close();
      }
    });

    function render() {
      const currencies = getCurrencies();
      const pinned = getPinnedCurrencies();
      const favorites = currencies.filter(code => pinned.includes(code));
      const others = currencies.filter(code => !pinned.includes(code));
      const parts = [];

      if (favorites.length) {
        parts.push(renderCurrencyGroup("Popular", favorites, getCurrencyName));
      }

      if (others.length) {
        parts.push(renderCurrencyGroup("All currencies", others, getCurrencyName));
      }

      list.innerHTML = parts.join("");
      sync();
    }

    function sync() {
      const currentCurrency = getCurrentCurrency();
      displaySym.textContent = getCurrencySymbol(currentCurrency);
      displayCode.textContent = currentCurrency;

      list.querySelectorAll(".cur-option").forEach(button => {
        const active = button.dataset.currency === currentCurrency;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
    }

    function show() {
      open = true;
      dropdown.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      wrap.classList.add("open");
    }

    function close() {
      open = false;
      dropdown.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      wrap.classList.remove("open");
    }

    return {
      render,
      sync,
      close
    };
  }

  global.SoledoCurrencyPicker = {
    createPicker,
    getCurrencySymbol,
    getInputPrefix
  };
})(window);
