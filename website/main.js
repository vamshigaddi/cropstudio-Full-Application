const API_BASE_URL = (typeof window !== 'undefined' && window.VITE_API_BASE_URL) || 'https://api.cropstudio.automatexi.com/api/v1';
const WAITLIST_API = `${API_BASE_URL}/waitlist`;

const waitlistCategories = [
  { id: 'jewelry', icon: '💎', title: 'Jewelry Photography', desc: 'AI-enhanced jewelry shots with reflections, sparkle, and studio lighting perfected automatically.' },
  { id: 'food_beverage', icon: '🍕', title: 'Food & Beverage', desc: 'Stunning menu photography, packaged goods, and bottle shots with appetite-appeal AI.' },
  { id: 'electronics', icon: '📱', title: 'Electronics', desc: 'Crisp gadget, phone, and laptop shots with reflections and material rendering.' },
  { id: 'furniture', icon: '🛋️', title: 'Furniture & Home', desc: 'Room staging, lifestyle scenes, and clean product shots for home decor brands.' },
  { id: 'beauty_cosmetics', icon: '💄', title: 'Beauty & Cosmetics', desc: 'Makeup, skincare, and beauty product photography with premium color accuracy.' },
  { id: 'automotive', icon: '🚗', title: 'Automotive Parts', desc: 'Car parts, accessories, and detail photography with precision and clarity.' },
];

let waitlistCounts = {};

async function fetchWaitlistCounts() {
  try {
    const res = await fetch(`${WAITLIST_API}/counts`);
    if (res.ok) {
      const data = await res.json();
      waitlistCounts = {};
      (data.counts || []).forEach(item => {
        waitlistCounts[item.category] = item.count;
      });
    }
  } catch (e) {
    console.warn('Failed to fetch waitlist counts:', e);
  }
}

function getCategoryCount(categoryId) {
  return waitlistCounts[categoryId] || 0;
}

function initVideoLoop() {
  const videoContainer = document.querySelector('.sim-video-container');
  const promptBox = document.querySelector('.app-sim-main');
  const videoPrompt = document.getElementById('sim-video-prompt');
  const inputImg = document.getElementById('sim-input-img');
  const outputImg = document.getElementById('sim-output-img');

  if (!videoContainer || !promptBox) return;

  const loaderTextEl = document.getElementById('sim-video-loader-text');

  const sequence = [
    {
      tabId: 'sim-tab-generate',
      prompt: "Generate a lifestyle image using this yellow embroidered Kurta...",
      loaderText: "Generating lifestyle shot...",
      input: "images/landing/example-flatlay.png",
      output: "images/landing/card-onmodel.png",
      isSplit: false
    },
    {
      tabId: 'sim-tab-removebg',
      prompt: "Remove background...", //Shorten this for the demo
      loaderText: "Removing background...",
      input: "images/landing/removebg-input.png",
      output: "images/landing/removebg-output.png",
      isSplit: false
    },
    {
      tabId: 'sim-tab-onmodel',
      prompt: "Apply selected Kurta garment onto the target female model...",
      loaderText: "Applying AI Try-On...",
      garment: "images/landing/example-flatlay.png",
      model: "images/landing/avatar-female-2.png",
      output: "images/landing/example-tryon.png",
      isSplit: true
    },
    {
      tabId: 'sim-tab-flatlay',
      prompt: "Displaying styled flat lay photography result...",
      loaderText: "Arranging items...",
      input: "images/landing/example-flatlay.png",
      output: "images/landing/example-flatlay.png",
      isSplit: false
    },
    {
      tabId: 'sim-tab-folded',
      prompt: "Displaying styled folded product...",
      loaderText: "Arranging items...",
      input: "images/landing/example-flatlay.png",
      output: "images/landing/example-folded.png",
      isSplit: false
    },
    {
      tabId: 'sim-tab-ghost-mannequin',
      prompt: "Generate a Ghost mannequin image from this Kurta...",
      loaderText: "Generating Ghost Mannequin...",
      input: "images/landing/example-flatlay.png",
      output: "images/landing/example-ghost.png",
      isSplit: false
    }

  ];

  let currentIndex = 0;

  function playSequence() {
    // Reset animations
    videoContainer.classList.remove('sim-video-active');
    promptBox.classList.remove('sim-video-active');

    // Force reflow
    void videoContainer.offsetWidth;

    // Set data
    const step = sequence[currentIndex];

    document.querySelectorAll('.app-sim-sidebar-item').forEach(el => el.classList.remove('active'));
    const activeTab = document.getElementById(step.tabId);
    if (activeTab) activeTab.classList.add('active');

    videoPrompt.textContent = step.prompt;
    if (loaderTextEl) loaderTextEl.textContent = step.loaderText;

    const splitContainer = document.getElementById('sim-input-split');
    const inputLabel = document.getElementById('sim-input-label');

    if (step.isSplit) {
      // Show split layout
      inputImg.style.display = 'none';
      if (splitContainer) {
        splitContainer.style.display = 'flex';
        document.getElementById('sim-input-garment').src = step.garment;
        document.getElementById('sim-input-model').src = step.model;
      }
      if (inputLabel) inputLabel.textContent = 'Selected Inputs';
    } else {
      // Show single layout
      inputImg.style.display = 'block';
      if (splitContainer) splitContainer.style.display = 'none';
      inputImg.src = step.input;
      if (inputLabel) inputLabel.textContent = 'Original Image';
    }

    outputImg.src = step.output;

    // Start animations
    videoContainer.classList.add('sim-video-active');
    promptBox.classList.add('sim-video-active');

    currentIndex = (currentIndex + 1) % sequence.length;
  }

  // Start immediately
  playSequence();
  // Loop every 12 seconds
  setInterval(playSequence, 12000);
}

function renderContent() {
  // Waitlist
  const waitlistGrid = document.getElementById('waitlist-grid');
  if (waitlistGrid) {
    waitlistGrid.innerHTML = waitlistCategories.map(cat => `
      <div class="waitlist-card" data-waitlist-category="${cat.id}">
        <div class="waitlist-card__icon">${cat.icon}</div>
        <div class="waitlist-card__title">${cat.title}</div>
        <div class="waitlist-card__desc">${cat.desc}</div>
        <div class="waitlist-card__meta">
          <span class="dot"></span>
          <span class="count-value">${getCategoryCount(cat.id)}</span> interested
        </div>
        <button class="waitlist-btn" data-category="${cat.id}" data-category-title="${cat.title}" id="waitlist-btn-${cat.id}">
          Join Waitlist
        </button>
      </div>
    `).join('');
  }

  // Testimonials
  // (Optional: add if needed for masonry)
}

function initEvents() {
  // Navbar scroll
  const nav = document.getElementById('landing-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  });

  // Smooth scroll
  document.querySelectorAll('[data-scroll]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(el.getAttribute('data-scroll'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });



  // Waitlist Buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('waitlist-btn')) {
      const cat = e.target.getAttribute('data-category');
      const title = e.target.getAttribute('data-category-title');
      openWaitlistModal(cat, title);
    }
  });

  // Pricing Toggle (Monthly vs Yearly)
  const btnMonthly = document.getElementById('btn-monthly');
  const btnYearly = document.getElementById('btn-yearly');
  const priceAmounts = document.querySelectorAll('.pricing-card__price .amount');

  if (btnMonthly && btnYearly) {
    const setBilling = (isYearly) => {
      if (isYearly) {
        btnMonthly.classList.remove('active');
        btnYearly.classList.add('active');
      } else {
        btnMonthly.classList.add('active');
        btnYearly.classList.remove('active');
      }

      priceAmounts.forEach(el => {
        const val = isYearly ? el.getAttribute('data-yearly') : el.getAttribute('data-monthly');
        // Format with commas if needed (e.g. 1499 -> 1,499)
        el.textContent = Number(val).toLocaleString('en-IN');
      });
    };

    btnMonthly.addEventListener('click', () => setBilling(false));
    btnYearly.addEventListener('click', () => setBilling(true));
  }
}

function openWaitlistModal(category, categoryTitle) {
  const existing = document.getElementById('waitlist-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'waitlist-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal__close" id="modal-close">✕</button>
      <h3 class="modal__title">Join the waitlist</h3>
      <p class="modal__subtitle">Be the first to know when we launch AI photography tools for ${categoryTitle.toLowerCase()}.</p>
      <form class="modal-form" id="waitlist-form">
        <input type="text" class="modal-input" id="waitlist-name" placeholder="Full name" required />
        <input type="email" class="modal-input" id="waitlist-email" placeholder="Email address" required />
        <input type="text" class="modal-input" id="waitlist-business" placeholder="Company/Brand (optional)" />
        <button type="submit" class="modal-btn" id="waitlist-submit">Join now</button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('waitlist-submit');
    btn.textContent = 'Submitting...';
    btn.disabled = true;

    const payload = {
      name: document.getElementById('waitlist-name').value.trim(),
      email: document.getElementById('waitlist-email').value.trim(),
      business_name: document.getElementById('waitlist-business').value.trim() || null,
      category: category
    };

    try {
      const res = await fetch(`${WAITLIST_API}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed');

      const modal = overlay.querySelector('.modal');
      modal.innerHTML = `
        <button class="modal__close" id="modal-close-success">✕</button>
        <h3 class="modal__title">You're on the list!</h3>
        <p class="modal__subtitle" style="margin-bottom:0;">Thanks ${payload.name}! We'll email ${payload.email} when it's ready.</p>
      `;
      document.getElementById('modal-close-success').addEventListener('click', close);

      const cardBtn = document.getElementById(`waitlist-btn-${category}`);
      if (cardBtn) {
        cardBtn.textContent = 'Joined';
        cardBtn.style.background = '#dcfce7';
        cardBtn.style.color = '#16a34a';
        cardBtn.disabled = true;
      }

      await fetchWaitlistCounts();
      const countEl = document.querySelector(`[data-waitlist-category="${category}"] .count-value`);
      if (countEl) countEl.textContent = getCategoryCount(category);

    } catch (err) {
      btn.textContent = 'Already Joined';
      btn.style.background = '#dcfce7';
      btn.style.color = '#16a34a';
    }
  });
}

function initRoiCalculator() {
  const slider = document.getElementById('roi-sku-slider');
  const countBadge = document.getElementById('roi-sku-count');
  const savingsAmount = document.getElementById('roi-savings-val');
  const studioCost = document.getElementById('roi-studio-cost');
  const cropStudioCost = document.getElementById('roi-cropstudio-cost');
  const daysSaved = document.getElementById('roi-days-saved');

  if (!slider) return;

  function update() {
    const skus = parseInt(slider.value, 10) || 50;
    if (countBadge) countBadge.textContent = `${skus} SKUs / mo`;

    const tradCost = skus * 800; // Average ₹800 per SKU
    let csCost = 699;
    if (skus > 30 && skus <= 100) csCost = 1999;
    else if (skus > 100) csCost = 5999;

    const netSavings = Math.max(0, tradCost - csCost);
    const days = Math.max(2, Math.round(skus * 0.25));

    if (savingsAmount) savingsAmount.textContent = `₹${netSavings.toLocaleString('en-IN')} / mo`;
    if (studioCost) studioCost.textContent = `₹${tradCost.toLocaleString('en-IN')}`;
    if (cropStudioCost) cropStudioCost.textContent = `₹${csCost.toLocaleString('en-IN')}`;
    if (daysSaved) daysSaved.textContent = `${days} Days`;
  }

  slider.addEventListener('input', update);
  update();
}

function initInteractiveSandbox() {
  const sandbox = document.querySelector('.sandbox-widget');
  if (!sandbox) return;

  const sampleBtns = sandbox.querySelectorAll('.sandbox-sample-btn');
  const dropzone = sandbox.querySelector('.sandbox-dropzone');
  const fileInput = sandbox.querySelector('.sandbox-file-input');
  const canvasContainer = sandbox.querySelector('.sandbox-canvas-container');
  const imgBefore = sandbox.querySelector('.sandbox-img-before');
  const imgAfter = sandbox.querySelector('.sandbox-img-after');
  const afterWrapper = sandbox.querySelector('.sandbox-after-wrapper');
  const handle = sandbox.querySelector('.sandbox-handle');
  const statusText = sandbox.querySelector('.sandbox-cta-status');

  if (!canvasContainer || !handle || !afterWrapper) return;

  // Preset Data Mapping with root-relative paths so it works on all subpages
  const presetMap = {
    'kurti': {
      before: '/images/landing/example-flatlay.png',
      after: '/images/landing/example-tryon.png',
      status: '✨ AI Model Try-On Applied'
    },
    'saree': {
      before: '/images/landing/saree-before.jpg',
      after: '/images/landing/saree-after.jpg',
      status: '✨ Silk Saree Model Draped'
    },
    'ghost': {
      before: '/images/landing/ghost-before.jpg',
      after: '/images/landing/ghost-after.jpg',
      status: '✨ 3D Ghost Mannequin Generated'
    },
    'amazon': {
      before: '/images/landing/amazon-before.jpg',
      after: '/images/landing/amazon-after.jpg',
      status: '✨ 100% Pure White BG Generated'
    }
  };

  // Switch Samples
  sampleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sandbox.classList.remove('is-user-upload');
      sampleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const type = btn.dataset.preset || 'kurti';
      const data = presetMap[type] || presetMap['kurti'];

      if (imgBefore) imgBefore.src = data.before;
      if (imgAfter) imgAfter.src = data.after;
      if (statusText) statusText.innerHTML = `<span>⚡</span> ${data.status}`;
      
      // Reset Slider position to 50%
      setTimeout(() => setSliderPosition(50), 50);
    });
  });

  // Slider Dragging Logic with pixel-perfect width alignment
  let isDragging = false;

  function setSliderPosition(percentage) {
    const clamped = Math.max(0, Math.min(100, percentage));
    afterWrapper.style.width = `${clamped}%`;
    handle.style.left = `${clamped}%`;

    // Ensure the clipped image matches the container width exactly
    const containerWidth = canvasContainer.clientWidth;
    if (imgAfter) {
      imgAfter.style.width = `${containerWidth}px`;
    }
  }

  window.addEventListener('resize', () => setSliderPosition(50));

  function handleMove(e) {
    if (!isDragging || sandbox.classList.contains('is-user-upload')) return;
    const rect = canvasContainer.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const offset = clientX - rect.left;
    const percentage = (offset / rect.width) * 100;
    setSliderPosition(percentage);
  }

  canvasContainer.addEventListener('mousedown', (e) => { 
    if (!sandbox.classList.contains('is-user-upload')) {
      isDragging = true; 
      handleMove(e); 
    }
  });
  canvasContainer.addEventListener('touchstart', (e) => { 
    if (!sandbox.classList.contains('is-user-upload')) {
      isDragging = true; 
      handleMove(e); 
    }
  });

  window.addEventListener('mousemove', handleMove);
  window.addEventListener('touchmove', handleMove);

  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('touchend', () => { isDragging = false; });

  // File Drag & Drop Simulation
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files && files[0]) handleFileSelect(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0]);
    });
  }

  function handleFileSelect(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target.result;
      if (imgBefore) imgBefore.src = src;
      sandbox.classList.add('is-user-upload');
      sampleBtns.forEach(b => b.classList.remove('active'));
      if (statusText) statusText.innerHTML = `<span>✨</span> Custom Photo Loaded! Click below to Process with 4K AI Model Engine`;
    };
    reader.readAsDataURL(file);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await fetchWaitlistCounts();
  renderContent();
  initVideoLoop();
  initEvents();
  initRoiCalculator();
  initInteractiveSandbox();
});

