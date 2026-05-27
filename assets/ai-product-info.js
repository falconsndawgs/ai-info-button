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

  // Common Shopify theme product image container selectors (most → least specific)
  const IMAGE_CONTAINER_SELECTORS = [
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

    try {
      const response = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = await response.json();

      if (!data || !data.html) {
        throw new Error('No information returned from AI.');
      }

      showContent(data.html);
    } catch (err) {
      if (isFetching) {
        showError(
          err.message || 'Something went wrong. Please try again.'
        );
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
