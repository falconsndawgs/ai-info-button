/**
 * AI Product Info Button
 * Calls your backend proxy to fetch AI-generated product insights.
 * Set window.AI_PRODUCT_INFO_ENDPOINT to your proxy URL.
 * Default: /apps/ai-product-info  (Shopify App Proxy path)
 */
(function () {
  'use strict';

  const ENDPOINT =
    window.AI_PRODUCT_INFO_ENDPOINT || '/apps/ai-product-info';
  const FALLBACK_ENDPOINT = '/apps/ai-product-info';
  const DEFAULT_ERROR_MESSAGE =
    'AI Product Insights are temporarily unavailable. Please try again shortly.';
  const FETCH_TIMEOUT_MS = 30000;

  // Common Shopify theme product image container selectors (most → least specific)
  const IMAGE_CONTAINER_SELECTORS = [
    '.tm-desktop-panel > div',
    '.product__media-wrapper',
    '.product__media-item--image',
    '.product__media',
    '.product-single__photo-wrapper',
    '.product-single__photo',
    '.product-featured-img-wrapper',
    '[data-product-featured-image]',
    '.product__photo',
    '.featured-image',
  ];

  function attachButtonToImage() {
    const btn = document.querySelector('.ai-info-btn');
    if (!btn) return;

    let container = null;
    for (const sel of IMAGE_CONTAINER_SELECTORS) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (!container) return; // leave in original position if no match

    // Make sure the container is relatively positioned
    const pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';

    container.appendChild(btn);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachButtonToImage);
  } else {
    attachButtonToImage();
  }

  // ── DOM refs (lazily resolved once per page) ──────────────────────────────
  let overlay, modal, closeBtn, loadingEl, errorEl, contentEl, productNameEl, productImageEl;

  function resolveRefs() {
    overlay         = document.getElementById('aiInfoOverlay');
    modal           = overlay?.querySelector('.ai-info-modal');
    closeBtn        = overlay?.querySelector('.ai-info-modal__close');
    loadingEl       = overlay?.querySelector('.ai-info-modal__loading');
    errorEl         = overlay?.querySelector('.ai-info-modal__error');
    contentEl       = overlay?.querySelector('.ai-info-modal__content');
    productNameEl   = overlay?.querySelector('.ai-info-modal__product-name');
    productImageEl  = overlay?.querySelector('.ai-info-modal__product-image');
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let isFetching = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.hidden  = false;
    errorEl.hidden    = true;
    contentEl.innerHTML = '';
  }

  function showError(msg) {
    loadingEl.hidden = true;
    errorEl.hidden   = false;
    errorEl.textContent = msg;
  }

  function showContent(html) {
    loadingEl.hidden    = true;
    errorEl.hidden      = true;
    contentEl.innerHTML = html;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function truncateText(value, maxLength) {
    const text = cleanText(value);
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1).trim() + '...';
  }

  function uniqueTexts(texts) {
    const seen = new Set();
    return texts.map(cleanText).filter(function (text) {
      if (!text || seen.has(text.toLowerCase())) return false;
      seen.add(text.toLowerCase());
      return true;
    });
  }

  function readFirstText(scope, selectors) {
    for (const selector of selectors) {
      const node = scope.querySelector(selector) || document.querySelector(selector);
      const text = cleanText(node?.textContent);
      if (text) return text;
    }
    return '';
  }

  function collectVisibleTexts(scope, selectors, maxItems, maxLength) {
    const nodes = selectors.flatMap(function (selector) {
      return Array.from(scope.querySelectorAll(selector));
    });

    return uniqueTexts(nodes.map(function (node) {
      return truncateText(node.textContent, maxLength);
    })).slice(0, maxItems);
  }

  function getProductScope(btn) {
    return document.querySelector('[id^="MainProduct-"]') ||
      btn.closest('main') ||
      document.querySelector('product-info') ||
      btn.closest('.product') ||
      document;
  }

  function collectPageContext(btn) {
    const scope = getProductScope(btn);
    const accordions = Array.from(scope.querySelectorAll('details, .accordion, collapsible-content'))
      .map(function (section) {
        const heading = cleanText(
          section.querySelector('summary, .accordion__title, h2, h3, h4')?.textContent
        );
        const body = truncateText(section.textContent, 1400);
        if (!heading && !body) return null;
        return { heading: heading, text: body };
      })
      .filter(Boolean)
      .slice(0, 12);

    const context = {
      url: window.location.href,
      title: btn.dataset.productTitle || readFirstText(scope, ['h1', '.product__title']),
      vendor: btn.dataset.productVendor || '',
      type: btn.dataset.productType || '',
      tags: btn.dataset.productTags || '',
      description: truncateText(
        readFirstText(scope, ['.product__description', '[data-product-description]']) ||
          btn.dataset.productDescription,
        3000
      ),
      price: truncateText(readFirstText(scope, ['#vs-price-row', '.price', '.product__price']), 300),
      selectedOptions: collectVisibleTexts(
        scope,
        ['#vs-root [id^="vs-sel-"]', '.product-form__input input:checked + label', '.product-form__input select option:checked'],
        12,
        140
      ),
      highlights: collectVisibleTexts(
        scope,
        ['.product__text', '.product__subtitle', '.product__inventory', '.badge', '.rte li'],
        24,
        240
      ),
      sections: accordions,
      pageText: truncateText(scope.textContent, 12000),
    };

    return context;
  }

  function buildPageContextText(context) {
    const parts = [
      'URL: ' + context.url,
      'Product: ' + context.title,
      'Vendor: ' + context.vendor,
      'Type: ' + context.type,
      'Tags: ' + context.tags,
      'Price: ' + context.price,
      'Description: ' + context.description,
    ];

    if (context.selectedOptions.length) {
      parts.push('Selected options: ' + context.selectedOptions.join(' | '));
    }
    if (context.highlights.length) {
      parts.push('Page highlights: ' + context.highlights.join(' | '));
    }
    context.sections.forEach(function (section) {
      parts.push((section.heading || 'Product section') + ': ' + section.text);
    });
    parts.push('Visible product page text: ' + context.pageText);

    return truncateText(parts.filter(Boolean).join('\n'), 18000);
  }

  function openModal(btn) {
    if (!overlay) resolveRefs();
    if (!overlay) return;

    const title = btn.dataset.productTitle || '';
    const image = btn.dataset.productImage || '';
    productNameEl.textContent = title;

    if (image) {
      productImageEl.src    = image;
      productImageEl.alt    = title;
      productImageEl.hidden = false;
    } else {
      productImageEl.hidden = true;
    }
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();

    fetchProductInfo(btn);
  }

  function closeModal() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    isFetching = false;
  }

  // ── AI Fetch ──────────────────────────────────────────────────────────────
  async function fetchProductInfo(btn) {
    if (isFetching) return;
    isFetching = true;
    showLoading();

    const payload = {
      title:       btn.dataset.productTitle       || '',
      vendor:      btn.dataset.productVendor      || '',
      type:        btn.dataset.productType        || '',
      tags:        btn.dataset.productTags        || '',
      description: btn.dataset.productDescription || '',
    };
    const pageContext = collectPageContext(btn);
    payload.pageContext = pageContext;
    payload.page_context = buildPageContextText(pageContext);

    async function requestInfo(endpoint) {
      const controller = new AbortController();
      const timeout = setTimeout(function () {
        controller.abort();
      }, FETCH_TIMEOUT_MS);

      const response = await fetch(endpoint, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }).finally(function () {
        clearTimeout(timeout);
      });

      let data = null;
      let text = '';
      try {
        data = await response.clone().json();
      } catch (jsonErr) {
        text = await response.text();
      }

      if (!response.ok) {
        const detail = data?.error || data?.message || text || `Request failed (${response.status})`;
        throw new Error(detail);
      }

      if (!data || !data.html) {
        throw new Error(data?.error || data?.message || 'No information returned from AI.');
      }

      return data.html;
    }

    try {
      let html;
      try {
        html = await requestInfo(ENDPOINT);
      } catch (primaryErr) {
        if (ENDPOINT === FALLBACK_ENDPOINT) throw primaryErr;
        console.warn('[ai-product-info] primary endpoint failed, trying app proxy fallback:', primaryErr);
        html = await requestInfo(FALLBACK_ENDPOINT);
      }

      showContent(html);
    } catch (err) {
      if (isFetching) {
        console.error('[ai-product-info] request failed:', err);
        showError(DEFAULT_ERROR_MESSAGE);
      }
    } finally {
      isFetching = false;
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    // Open button
    const btn = e.target.closest('.ai-info-btn');
    if (btn) {
      openModal(btn);
      return;
    }

    // Close button
    if (e.target.closest('.ai-info-modal__close')) {
      closeModal();
      return;
    }

    // Click outside modal
    if (overlay && !overlay.hidden && e.target === overlay) {
      closeModal();
    }
  });

  // Keyboard: Escape to close
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && !overlay.hidden) {
      closeModal();
    }
  });

  // Trap focus inside modal while open
  document.addEventListener('keydown', function (e) {
    if (!overlay || overlay.hidden || e.key !== 'Tab') return;

    const focusable = Array.from(
      modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.disabled);

    if (!focusable.length) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();
