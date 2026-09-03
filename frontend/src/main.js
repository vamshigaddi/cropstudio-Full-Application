import JSZipModule from 'jszip';
const JSZip = JSZipModule || (typeof window !== 'undefined' && window.JSZip);
import './styles/variables.css';
import './styles/reset.css';
import './styles/global.css';
import './styles/sidebar.css';
import './styles/main.css';
import './styles/onmodel.css';
import './styles/removebg.css';
import './styles/upscale.css';
import './styles/edit.css';
import './styles/auth.css';
import './styles/admin.css';
import { icons } from './icons.js';

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ─── Global App State ───
const appState = {
  token: localStorage.getItem('cs_token') || '',
  user: null, // Response from /users/me
  currentView: 'home',
  batchState: {
    view: 'upload', // 'upload', 'workspace', 'progress'
    batchId: null,
    pollingInterval: null,
    targetPlatform: 'flipkart',
    targetResolution: null,
    exportPlatform: 'flipkart',
    exportResolution: null
  },
  onModelState: {
    clothImages: [], // Array of { id, url, name }
    selectedModel: null,
  },
  removeBgState: {
    image: null, // { id, url, name }
    processing: false,
    resultUrl: null,
  },
  upscaleState: {
    image: null, // { id, url, name }
    processing: false,
    resultUrl: null,
  },
  editState: {
    image: null, // { id, url, name }
    processing: false,
    resultUrl: null,
  },
  assetsState: {
    view: 'folders',
    selectedDate: null,
    uploads: [],
    processed: [],
    detailTab: 'all',
  },
  billingState: {
    activeTab: 'usage',
    data: null,
    timeRange: 'all',
    selectedModes: [],
    currentPage: 1,
    isModesMenuOpen: false,
  },
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:8000/api/v1' : 'https://api.cropstudio.automatexi.com/api/v1');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vhooqkuiiwskjymselhp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_jKsXovWfGyHsjtAt14MAiQ_iDLEdVoZ';
let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient && typeof window !== 'undefined' && window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

if (typeof window !== 'undefined' && window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function getBase64FromUrl(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── API Helper Functions ───
function handleSessionExpired(msg = 'Your session has expired. Please sign in again.') {
  localStorage.removeItem('cs_token');
  appState.token = '';
  appState.user = null;
  if (window.history && window.history.pushState) {
    window.history.pushState({}, '', '/signin');
  }
  renderAuth('signin', msg);
}

async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (appState.token) {
    headers['Authorization'] = `Bearer ${appState.token}`;
  }
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    cache: 'no-store',
    ...options,
    headers,
  });
  if (response.status === 401) {
    handleSessionExpired('Your session has expired. Please sign in again.');
    throw new Error('Session expired');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || 'API request failed');
  }
  return response.json();
}

async function apiUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  const headers = {};
  if (appState.token) {
    headers['Authorization'] = `Bearer ${appState.token}`;
  }

  const response = await fetch(`${API_BASE_URL}/uploads/`, {
    method: 'POST',
    body: formData,
    headers,
  });
  if (response.status === 401) {
    handleSessionExpired('Your session has expired. Please sign in again.');
    throw new Error('Session expired');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || 'File upload failed');
  }
  return response.json();
}

// ─── Profile and Quota Sync ───
async function syncUserProfile() {
  const userProfile = await apiFetch('/users/me');
  appState.user = userProfile;
  updateCreditsDisplay();
}

function updateCreditsDisplay() {
  const el = document.getElementById('sidebar-credits-value');
  if (el && appState.user) {
    el.textContent = `${appState.user.profile.credit_balance} credits`;
  }
}

// ─── Sidebar Navigation Data ───
const sidebarNav = [
  {
    items: [
      { id: 'home', label: 'Home', icon: 'home', active: true },
      { id: 'on-model', label: 'On Model', icon: 'onModel', badge: 'AI' },
      { id: 'generate', label: 'Generate', icon: 'generate' },
      { id: 'batch', label: 'Batch Studio', icon: 'batch', badge: 'New' },
      { id: 'edit', label: 'Edit Canvas', icon: 'edit' },
      { id: 'assets', label: 'Assets Library', icon: 'assets' },
      { id: 'billing', label: 'Billing & Usage', icon: 'billing' },
    ],
  },
  /*
  {
    label: 'Tools',
    items: [
      { id: 'video-studio', label: 'Video Studio', icon: 'videoStudio' },
      { id: 'product-studio', label: 'Product Studio', icon: 'productStudio' },
      { id: 'on-model', label: 'On Model', icon: 'onModel' },
      { id: 'ghost-mannequin', label: 'Ghost Mannequin', icon: 'ghostMannequin' },
      { id: 'flat-lay', label: 'Flat Lay', icon: 'flatLay' },
      { id: 'folded', label: 'Folded', icon: 'folded' },
      { id: 'closeup', label: 'Closeup', icon: 'closeup' },
      { id: 'smart-resize', label: 'Smart Resize', icon: 'smartResize' },
      { id: 'translate', label: 'Translate', icon: 'translate' },
    ],
  },
  {
    label: 'Folders',
    items: [
      { id: 'new-folder', label: 'New folder', icon: 'folderPlus' },
    ],
  },
  */
];

// ─── Feature Cards Data ───
const featureCards = [
  { id: 'fc-onmodel', label: 'On Model', img: '/images/card-onmodel.png', color: '#E11D48', iconEmoji: '👤' },
  { id: 'fc-batch', label: 'Batch Studio', img: '/images/card-batch.png', color: '#4F46E5', iconEmoji: '⊞' },
  { id: 'fc-generate', label: 'AI Studio', img: '/images/card-generate.png', color: '#7C3AED', iconEmoji: '✨' },
  { id: 'fc-removebg', label: 'Remove BG', img: '/images/card-removebg.png', color: '#059669', iconEmoji: '🔲' },
  { id: 'fc-upscale', label: 'Upscale HD', img: '/images/card-upscale.png', color: '#D97706', iconEmoji: 'HD' },
  { id: 'fc-edit', label: 'Edit Canvas', img: '/images/card-edit.png', color: '#0284C7', iconEmoji: '✏️' },
];

// ─── Quick Edits Data ───
const quickEdits = [
  { id: 'qe-removebg', title: 'Remove Background', desc: 'Marketplace-ready clean white or transparent BG', icon: 'removeBg', color: 'violet' },
  { id: 'qe-onmodel', title: 'On-Model Try-On', desc: 'Dress realistic AI human fashion models', icon: 'onModel', color: 'rose' },
  { id: 'qe-ai-bg', title: 'AI Lifestyle Studio', desc: 'Generate aesthetic studio & outdoor scenes', icon: 'aiBg', color: 'teal' },
  { id: 'qe-upscale', title: 'Upscale HD / 4K', desc: 'Enhance clarity for crisp product zooms', icon: 'upscale', color: 'sky' },
  { id: 'qe-batch', title: 'Batch Processing', desc: 'Process 50+ catalog SKUs in bulk simultaneously', icon: 'batch', color: 'amber' },
  { id: 'qe-prompt-edit', title: 'Prompt to Edit', desc: 'Modify colors, lighting & details with AI', icon: 'promptEdit', color: 'emerald' },
];

// ─── Render Sidebar ───
function renderSidebar() {
  const groups = sidebarNav.map(group => {
    const label = group.label
      ? `<div class="sidebar__group-label">${group.label}</div>`
      : '';

    const items = group.items.map(item => {
      const activeClass = item.active ? ' sidebar__item--active' : '';
      const badge = item.badge
        ? `<span class="badge badge--new sidebar__item-badge">${item.badge}</span>`
        : '';

      return `
        <div class="sidebar__item${activeClass}" data-nav="${item.id}" id="nav-${item.id}">
          <span class="sidebar__item-icon">${icons[item.icon] || ''}</span>
          <span>${item.label}</span>
          ${badge}
        </div>
      `;
    }).join('');

    return `<div class="sidebar__group">${label}${items}</div>`;
  }).join('');

  const adminNavGroup = appState.user && appState.user.role === 'admin' ? `
    <div class="sidebar__group">
      <div class="sidebar__group-label">Administration</div>
      <div class="sidebar__item" data-nav="admin" id="nav-admin">
        <span class="sidebar__item-icon">${icons.pipeline || ''}</span>
        <span>Admin Panel</span>
      </div>
    </div>
  ` : '';

  const creditBalance = appState.user ? appState.user.profile.credit_balance : 0;

  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar__logo">
        <img src="/logo-mark.svg" alt="CropStudio AI" class="sidebar__logo-icon" style="width:34px; height:34px; border-radius:9px; box-shadow:0 4px 12px rgba(99,102,241,0.25); object-fit:contain;" />
        <div class="sidebar__logo-text">CropStudio <span>AI</span></div>
      </div>

      <div class="sidebar__search">
        <div class="sidebar__search-wrapper">
          <span class="sidebar__search-icon">${icons.search}</span>
          <input
            type="text"
            class="sidebar__search-input"
            placeholder="Search tools..."
            id="sidebar-search"
            aria-label="Search tools"
          />
        </div>
      </div>

      <nav class="sidebar__nav">
        ${groups}
        ${adminNavGroup}
      </nav>

      <div class="sidebar__footer">
        <div class="sidebar__credits">
          <div class="sidebar__credits-icon"></div>
          <span id="sidebar-credits-value">${creditBalance} credits</span>
        </div>
        <button class="sidebar__cta" id="btn-upgrade">Get more credits</button>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const displayEmail = (appState.user && appState.user.email) ? appState.user.email : 'User';
  const initial = displayEmail.substring(0, 1).toUpperCase();
  const tier = appState.user && appState.user.profile ? appState.user.profile.subscription_tier : 'free';
  const tierLabels = {
    'free': 'Free Plan',
    'creator_lite': 'Creator Lite',
    'brand_pro': 'Brand Pro',
    'enterprise_studio': 'Enterprise Studio'
  };
  const displayTier = tierLabels[tier] || 'Free Plan';

  let billingCycleHtml = '';
  if (appState.user && appState.user.profile && appState.user.profile.subscription_period_end) {
    const end = new Date(appState.user.profile.subscription_period_end).toLocaleDateString();
    billingCycleHtml = `<div class="profile-dropdown__period" style="font-size:11px;color:var(--color-gray-500);margin-top:4px;">Renews on ${end}</div>`;
  }

  let pendingDowngradeHtml = '';
  if (appState.user && appState.user.profile && appState.user.profile.pending_downgrade_tier) {
    const target = tierLabels[appState.user.profile.pending_downgrade_tier] || appState.user.profile.pending_downgrade_tier;
    const end = new Date(appState.user.profile.subscription_period_end).toLocaleDateString();
    pendingDowngradeHtml = `
      <div style="margin: 8px 12px; padding: 10px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; font-size: 11px; color: #92400E; line-height: 1.4;">
        ⚠️ Downgrading to <strong>${target}</strong> on ${end}
      </div>
    `;
  }

  const creditBal = (appState.user && appState.user.profile) ? (appState.user.profile.credit_balance ?? 0) : 0;
  const isLowCredits = creditBal <= 20;

  return `
    <header class="topbar" id="topbar">
      <div class="topbar__left">
        <span class="topbar__breadcrumb">Home</span>
      </div>
      <div class="topbar__right">
        ${isLowCredits ? `
          <div class="topbar-low-credit-pill btn-open-pricing-cta" title="Click to Top Up Credits" style="display:inline-flex; align-items:center; gap:6px; background:#fff1f2; border:1px solid #fecdd3; padding:5px 12px; border-radius:20px; font-size:12px; font-weight:700; color:#e11d48; cursor:pointer; transition:all 0.15s ease;">
            <span style="font-size:14px;">⚠️</span>
            <span>Low Balance: ${creditBal} credits</span>
            <span style="background:#e11d48; color:#fff; padding:2px 6px; border-radius:10px; font-size:10px; margin-left:2px;">Top Up ⚡</span>
          </div>
        ` : ''}
        <button class="topbar__icon-btn" id="btn-search" aria-label="Search">
          ${icons.search}
        </button>
        <button class="topbar__icon-btn" id="btn-notifications" aria-label="Notifications">
          ${icons.bell}
        </button>
        <div class="topbar__avatar" id="btn-profile" title="${displayEmail}">${initial}</div>
        
        <div class="profile-dropdown" id="profile-dropdown">
          <div class="profile-dropdown__header">
            <div class="profile-dropdown__email" title="${displayEmail}">${displayEmail}</div>
            <div class="profile-dropdown__plan">
              <span class="profile-dropdown__plan-badge">${displayTier}</span>
            </div>
            ${billingCycleHtml}
          </div>
          ${pendingDowngradeHtml}
          <div class="profile-dropdown__items">
            <button class="profile-dropdown__item" id="dropdown-btn-upgrade">
              <span class="profile-dropdown__item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
              </span>
              <span>Upgrade & Billing</span>
            </button>
            <button class="profile-dropdown__item" id="dropdown-btn-settings">
              <span class="profile-dropdown__item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </span>
              <span>Account Settings</span>
            </button>
            <button class="profile-dropdown__item" id="dropdown-btn-support">
              <span class="profile-dropdown__item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              </span>
              <span>Help & Support</span>
            </button>
            <div class="profile-dropdown__divider"></div>
            <button class="profile-dropdown__item profile-dropdown__item--signout" id="btn-signout">
              <span class="profile-dropdown__item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderGenerate() {
  const suggestedPrompts = [
    "White background product shot",
    "Lifestyle photo in a bright cafe",
    "Model wearing outfit in park",
  ];

  const ratioPresets = [
    { id: 'amazon', label: 'Amazon', ratio: '1:1', desc: '1000×1000' },
    { id: 'flipkart', label: 'Flipkart', ratio: '3:4', desc: '768×1024' },
    { id: 'meesho', label: 'Meesho', ratio: '1:1', desc: '800×800' },
    { id: 'instagram', label: 'Instagram', ratio: '4:5', desc: '1080×1350' },
    { id: 'custom', label: 'Custom', ratio: '3:4', desc: '' },
  ];

  const activeRatioId = (appState.generateState && appState.generateState.selectedRatio) || 'flipkart';
  const activeRatioVal = (appState.generateState && appState.generateState.selectedRatioVal) || '3:4';

  return `
    <div class="generate-view">
      <div class="generate-main" id="generate-results-panel">
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--color-gray-400); gap:var(--space-2);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <p>Describe your image below and hit Generate</p>
        </div>
      </div>
      
      <div class="generate-bottom">
        <div class="prompt-suggestions">
          ${suggestedPrompts.map(p => `<button class="prompt-pill">${p}</button>`).join('')}
        </div>
        
        <div class="prompt-box">
          <textarea class="prompt-input" id="generate-prompt" placeholder="Describe what you want to create..." rows="2"></textarea>
          
          <div class="prompt-actions">
            <div class="prompt-actions__left">
              <div class="prompt-ref-preview" id="prompt-ref-preview-container" style="display: none;">
                <img id="prompt-ref-thumbnail-img" src="" alt="Reference Thumbnail" class="prompt-ref-thumbnail" />
                <button id="btn-prompt-ref-remove" class="prompt-ref-remove-btn" title="Remove reference">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <button class="prompt-reference-btn" id="btn-reference-upload">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Reference
              </button>
              <input type="file" id="reference-upload-hidden" accept="image/*" style="display:none;" />

              <div class="ratio-dropdown-wrap">
                <button class="prompt-ratio-btn" id="btn-ratio-toggle">
                  <div class="ratio-icon ratio-${activeRatioVal.replace(':', '-')}"></div>
                  <span id="ratio-label">${activeRatioVal}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="ratio-dropdown" id="ratio-dropdown">
                  ${ratioPresets.map(p => `
                    <button class="ratio-dropdown__item${p.id === activeRatioId ? ' active' : ''}" data-ratio="${p.ratio}" data-id="${p.id}">
                      <span class="ratio-dropdown__name">${p.label}</span>
                      <span class="ratio-dropdown__size">${p.desc || p.ratio}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
            
            <button class="prompt-submit-btn" id="btn-generate-submit" title="Generate">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Image Modal for Generate -->
    <div class="image-modal" id="image-modal">
      <div class="image-modal__content">
        <button class="image-modal__close" id="modal-close" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <img class="image-modal__img" id="modal-img" src="" alt="Preview" />
      </div>
    </div>
  `;
}

const onModelAvatars = [
  { id: '/images/avatar-male.png', name: 'Male Model', tag: 'Male' },
  { id: '/images/avatar-female.png', name: 'Female Model', tag: 'Female' },
  { id: '/images/tanuj.jpeg', name: 'Tanuj Model', tag: 'Male' }
];

function renderModelPickerModal() {
  return `
    <div class="model-picker-overlay" id="model-picker-overlay">
      <div class="model-picker-modal">
        <div class="model-picker-header">
          <div>
            <h2>Choose a Model</h2>
            <p>${onModelAvatars.length} AI models available</p>
          </div>
          <button class="model-picker-close" id="btn-model-picker-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="model-picker-grid">
          ${onModelAvatars.map(a => `
            <div class="model-picker-card ${appState.onModelState.selectedModel === a.id ? 'selected' : ''}" data-model-pick="${a.id}">
              <div class="model-picker-card__img-wrap">
                <img src="${a.id}" alt="${a.name}" />
                ${appState.onModelState.selectedModel === a.id ? `
                  <div class="model-picker-card__check">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                ` : ''}
              </div>
              <div class="model-picker-card__info">
                <span class="model-picker-card__name">${a.name}</span>
                <span class="model-picker-card__tag">${a.tag}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderOnModel() {
  const isProcessEnabled = appState.onModelState.clothImages.length > 0 && appState.onModelState.selectedModel !== null;
  const selectedAvatar = onModelAvatars.find(a => a.id === appState.onModelState.selectedModel);

  const slots = [0, 1, 2].map(index => {
    const cloth = appState.onModelState.clothImages[index];
    if (cloth) {
      return `
        <div class="onmodel-slot has-image">
          <img src="${cloth.url}" alt="${cloth.name}" class="onmodel-slot__img" />
          <button class="onmodel-slot__remove" data-index="${index}" title="Remove image">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    }
    return `
      <div class="onmodel-slot empty">
        <span class="onmodel-slot__placeholder">${index + 1}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="onmodel-view">
      <div class="onmodel-left">
        <div class="onmodel-header">
          <h2>Upload Clothes (Max 3)</h2>
          <p>Upload photos of clothing you want to visualize on a model.</p>
        </div>
        
        <div class="onmodel-slots-container" id="onmodel-slots-panel">
          ${slots}
        </div>
        
        <div class="onmodel-upload-actions">
          <input type="file" id="onmodel-upload-hidden" multiple accept="image/*,image/heic" style="display:none" />
          <button class="onmodel-upload-btn" id="btn-onmodel-upload" ${appState.onModelState.clothImages.length >= 3 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload Cloth Image
          </button>
        </div>
      </div>
      
      <div class="onmodel-right">
        <div class="onmodel-header">
          <h3>Select Model</h3>
          <p>Pick an AI model to wear your clothing.</p>
        </div>

        <div class="onmodel-selected-preview">
          ${selectedAvatar ? `
            <div class="onmodel-selected-avatar">
              <img src="${selectedAvatar.id}" alt="${selectedAvatar.name}" />
              <div class="onmodel-selected-avatar__info">
                <span class="onmodel-selected-avatar__name">${selectedAvatar.name}</span>
                <span class="onmodel-selected-avatar__tag">${selectedAvatar.tag}</span>
              </div>
              <button class="onmodel-selected-avatar__change" id="btn-open-model-picker">Change</button>
            </div>
          ` : `
            <div class="onmodel-no-model">
              <div class="onmodel-no-model__icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              </div>
              <p>No model selected yet</p>
            </div>
          `}
        </div>

        <button class="onmodel-browse-btn" id="btn-open-model-picker">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          Browse All Models
        </button>
        
        <div class="onmodel-right__footer">
          <button class="onmodel-process-btn" id="btn-onmodel-process" ${isProcessEnabled ? '' : 'disabled'}>
            ✨ Process On Model
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderRemoveBg() {
  const canvasContent = appState.removeBgState.image ?
    `<img src="${appState.removeBgState.image.url}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:var(--radius-2xl);" />` :
    `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-gray-400);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
     <p>Upload an image to remove background</p>
     <button class="onmodel-upload-btn" id="btn-removebg-upload">Upload Image</button>`;

  const isBtnDisabled = !appState.removeBgState.image || appState.removeBgState.processing;

  return `
    <input type="file" id="removebg-upload-hidden" accept="image/*" style="display:none" />
    <div class="content--removebg">
      <div class="removebg-view">
        <div class="removebg-left">
          <div class="removebg-canvas-container" id="removebg-canvas">
            ${canvasContent}
          </div>
        </div>
        
        <div class="removebg-right">
          <div class="tool-header">
            <h2>Remove Background</h2>
            <p>Automatically extract the subject from your image.</p>
          </div>
          
          <div class="tool-section">
            <h4>Background Type</h4>
            <div class="bg-options-grid">
              <div class="bg-option-btn selected">
                <div class="checker-preview"></div>
                <span>Transparent</span>
              </div>
              <div class="bg-option-btn">
                <div class="white-preview"></div>
                <span>Solid White</span>
              </div>
            </div>
          </div>
          
          <div class="tool-section">
            <h4>Options</h4>
            <div class="toggle-row">
              <span>Refine Edges</span>
              <label class="switch">
                <input type="checkbox" checked>
                <span class="slider"></span>
              </label>
            </div>
          </div>
          
          <div class="tool-right-footer">
            <button class="process-action-btn" id="btn-removebg-process" ${isBtnDisabled ? 'disabled' : ''}>
              ${appState.removeBgState.processing ? '<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></span> Processing...' : 'Remove Background'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderUpscale() {
  const canvasContent = appState.upscaleState.image ?
    `<img src="${appState.upscaleState.image.url}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:var(--radius-2xl);" />` :
    `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-gray-400);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
     <p>Upload an image to enhance and upscale</p>
     <button class="onmodel-upload-btn" id="btn-upscale-upload">Upload Image</button>`;

  const isBtnDisabled = !appState.upscaleState.image || appState.upscaleState.processing;

  return `
    <input type="file" id="upscale-upload-hidden" accept="image/*" style="display:none" />
    <div class="content--upscale">
      <div class="upscale-view">
        <div class="upscale-left">
          <div class="upscale-canvas-container" id="upscale-canvas">
            ${canvasContent}
          </div>
        </div>
        
        <div class="upscale-right">
          <div class="tool-header">
            <h2>Upscale Image</h2>
            <p>Enhance resolution and recover details.</p>
          </div>
          
          <div class="tool-section">
            <h4>Upscale Factor</h4>
            <div class="scale-options-grid">
              <div class="scale-option-btn">2x</div>
              <div class="scale-option-btn selected">4x</div>
              <div class="scale-option-btn">8x</div>
            </div>
          </div>
          
          <div class="tool-right-footer">
            <button class="process-action-btn" id="btn-upscale-process" ${isBtnDisabled ? 'disabled' : ''}>
              ${appState.upscaleState.processing ? '<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></span> Upscaling Image...' : '✨ Upscale Image'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEdit() {
  const canvasContent = appState.editState.image ?
    `<img src="${appState.editState.image.url}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:var(--radius-2xl);" />` :
    `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-gray-400);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
     <p>Upload an image to start editing</p>
     <button class="onmodel-upload-btn" id="btn-edit-upload">Upload Image</button>`;

  const isBtnDisabled = !appState.editState.image || appState.editState.processing;

  return `
    <input type="file" id="edit-upload-hidden" accept="image/*" style="display:none" />
    <div class="content--edit">
      <div class="edit-view">
        <div class="edit-left">
          <div class="edit-canvas-container" id="edit-canvas">
            ${canvasContent}
          </div>
        </div>
        
        <div class="edit-right">
          <div class="tool-header">
            <h2>Prompt to Edit</h2>
            <p>Describe what you want to change.</p>
          </div>
          
          <div class="tool-section" style="flex: 1;">
            <h4>Prompt Description</h4>
            <div class="edit-prompt-box">
              <textarea id="edit-prompt-text" placeholder="e.g. Change the color of the shirt to navy blue..."></textarea>
            </div>
          </div>
          
          <div class="tool-right-footer">
            <button class="process-action-btn" id="btn-edit-process" ${isBtnDisabled ? 'disabled' : ''}>
              ${appState.editState.processing ? '<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></span> Generating Edit...' : '✨ Generate Edit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHome() {
  return `
    ${renderFeatureCards()}
    ${renderQuickEdits()}
  `;
}

// ─── Marketplace Platforms & Export Presets Data ───
const marketplacePlatforms = [
  {
    id: 'flipkart',
    name: 'Flipkart',
    icon: '🛍️',
    ratio: '3:4',
    ratioLabel: '3:4 Portrait',
    dimensions: {
      '1k': '768 × 1024 px',
      '2k': '1536 × 2048 px',
      '4k': '3072 × 4096 px'
    },
    desc: 'Catalog Standard (3:4)'
  },
  {
    id: 'meesho',
    name: 'Meesho',
    icon: '📦',
    ratio: '1:1',
    ratioLabel: '1:1 Square',
    dimensions: {
      '1k': '800 × 800 px',
      '2k': '1600 × 1600 px',
      '4k': '3200 × 3200 px'
    },
    desc: 'Square Portal (1:1)'
  },
  {
    id: 'amazon',
    name: 'Amazon',
    icon: '🛒',
    ratio: '1:1',
    ratioLabel: '1:1 Square',
    dimensions: {
      '1k': '1000 × 1000 px',
      '2k': '2000 × 2000 px',
      '4k': '4000 × 4000 px'
    },
    desc: 'High-Res Zoom (1:1)'
  },
  {
    id: 'myntra',
    name: 'Myntra',
    icon: '👗',
    ratio: '3:4',
    ratioLabel: '3:4 Fashion',
    dimensions: {
      '1k': '1080 × 1440 px',
      '2k': '2160 × 2880 px',
      '4k': '4320 × 5760 px'
    },
    desc: 'Editorial Lookbook (3:4)'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '📱',
    ratio: '4:5',
    ratioLabel: '4:5 Portrait',
    dimensions: {
      '1k': '1080 × 1350 px',
      '2k': '2160 × 2700 px',
      '4k': '4320 × 5400 px'
    },
    desc: 'Social Feed & Ads (4:5)'
  }
];

// ─── Resolution Tiers Data ───
const resolutionTiers = [
  {
    id: '1k',
    name: '1K Standard HD',
    badge: 'Starter',
    badgeClass: 'badge--starter',
    desc: '1080p · Included in Starter Plan'
  },
  {
    id: '2k',
    name: '2K Ultra HD',
    badge: 'Pro Default',
    badgeClass: 'badge--pro',
    desc: '2048p · 4x Sharper Zoom (Brand Pro)'
  },
  {
    id: '4k',
    name: '4K Master Studio',
    badge: 'Business',
    badgeClass: 'badge--biz',
    desc: '4096p · Master Studio Quality (Enterprise)'
  }
];

function getUserAllowedResolutions() {
  const tier = (appState.user && appState.user.profile) ? appState.user.profile.subscription_tier : 'free';
  if (tier === 'enterprise_studio') return ['1k', '2k', '4k'];
  if (tier === 'brand_pro') return ['1k', '2k'];
  if (tier === 'creator_lite') return ['1k'];
  return ['1k']; // free default
}

function getDefaultResolutionForUser() {
  const tier = (appState.user && appState.user.profile) ? appState.user.profile.subscription_tier : 'free';
  if (tier === 'enterprise_studio') return '4k';
  if (tier === 'brand_pro') return '2k';
  return '1k'; // creator_lite / free
}

// Helper to crop and scale an image to target marketplace platform dimensions
async function processImageForMarketplace(imageUrl, platformId, resolutionTier) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const platform = marketplacePlatforms.find(p => p.id === platformId) || marketplacePlatforms[0];
        
        let targetWidth = img.naturalWidth;
        let targetHeight = img.naturalHeight;

        if (platform.ratio === '1:1') {
          const dim = resolutionTier === '4k' ? 3200 : (resolutionTier === '2k' ? 2000 : 1000);
          targetWidth = dim;
          targetHeight = dim;
        } else if (platform.ratio === '3:4') {
          const w = resolutionTier === '4k' ? 3072 : (resolutionTier === '2k' ? 1536 : 768);
          const h = resolutionTier === '4k' ? 4096 : (resolutionTier === '2k' ? 2048 : 1024);
          targetWidth = w;
          targetHeight = h;
        } else if (platform.ratio === '4:5') {
          const w = resolutionTier === '4k' ? 3200 : (resolutionTier === '2k' ? 1600 : 1080);
          const h = resolutionTier === '4k' ? 4000 : (resolutionTier === '2k' ? 2000 : 1350);
          targetWidth = w;
          targetHeight = h;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (platform.ratio === 'custom') {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
        } else {
          const srcRatio = img.naturalWidth / img.naturalHeight;
          const targetRatio = targetWidth / targetHeight;

          let renderW, renderH, offsetX, offsetY;
          if (srcRatio > targetRatio) {
            renderW = targetWidth;
            renderH = targetWidth / srcRatio;
            offsetX = 0;
            offsetY = (targetHeight - renderH) / 2;
          } else {
            renderH = targetHeight;
            renderW = targetHeight * srcRatio;
            offsetX = (targetWidth - renderW) / 2;
            offsetY = 0;
          }

          ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
        }

        // ─── Free Trial Watermarking Engine ───
        const userTier = (appState.user && appState.user.profile) ? appState.user.profile.subscription_tier : 'free';
        if (userTier === 'free') {
          const fontSize = Math.max(14, Math.round(targetWidth * 0.022));
          ctx.save();
          ctx.font = `600 ${fontSize}px sans-serif`;
          const text = 'Created with CropStudio AI';
          const textMetrics = ctx.measureText(text);
          const textWidth = textMetrics.width;
          const paddingX = 12;
          const paddingY = 6;
          const rectX = targetWidth - textWidth - (paddingX * 2) - 20;
          const rectY = targetHeight - fontSize - (paddingY * 2) - 20;
          const rectW = textWidth + (paddingX * 2);
          const rectH = fontSize + (paddingY * 2);

          // Translucent dark background pill
          ctx.fillStyle = 'rgba(15, 23, 42, 0.70)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(rectX, rectY, rectW, rectH, 6);
          } else {
            ctx.rect(rectX, rectY, rectW, rectH);
          }
          ctx.fill();

          // White crisp text
          ctx.fillStyle = '#ffffff';
          ctx.fillText(text, rectX + paddingX, rectY + paddingY + fontSize - 3);
          ctx.restore();
        }

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png', 0.95);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      fetch(imageUrl)
        .then(r => r.blob())
        .then(resolve)
        .catch(reject);
    };
    img.src = imageUrl;
  });
}

// ─── Batch Processing Options Data ───
const batchOptions = [
  {
    id: 'white-bg',
    title: 'White Background',
    desc: 'Amazon, Flipkart, Meesho compliance',
    img: '/images/example-whitebg.png',
    checked: true,
    emoji: '🤍',
    mode: 'white_background'
  },
  {
    id: 'lifestyle',
    title: 'Lifestyle Photo',
    desc: 'Place in realistic luxury settings',
    img: '/images/example-lifestyle.png',
    checked: false,
    emoji: '🏡',
    mode: 'lifestyle'
  },
  {
    id: 'virtual-tryon',
    title: 'Virtual Try-on',
    desc: 'Show garment on an AI fashion model',
    img: '/images/example-tryon.png',
    checked: false,
    emoji: '👗',
    mode: 'try_on'
  },
  {
    id: 'ghost-mannequin',
    title: 'Ghost Mannequin',
    desc: 'Invisible mannequin 3D effect',
    img: '/images/example-ghost.png',
    checked: false,
    emoji: '👻',
    mode: 'ghost_mannequin'
  },
  {
    id: 'flat-lay',
    title: 'Flat Lay',
    desc: 'Top-down styled aesthetic arrangement',
    img: '/images/example-flatlay.png',
    checked: false,
    emoji: '📐',
    mode: 'flat_lay'
  },
  {
    id: 'folded',
    title: 'Folded',
    desc: 'Neatly folded retail presentation',
    img: '/images/example-folded.png',
    checked: false,
    emoji: '👔',
    mode: 'folded'
  },
  {
    id: 'closeup',
    title: 'Closeup & Fabric Detail',
    desc: 'Fabric texture & detail macro shots',
    img: '/images/example-closeup.png',
    checked: false,
    emoji: '🔍',
    mode: 'closeup'
  },
];

let uploadedFiles = [];
let selectedAvatar = null;

function renderBatchWorkspace() {
  const isVirtualTryon = batchOptions.find(o => o.id === 'virtual-tryon')?.checked;
  const allHaveModels = uploadedFiles.every(f => f.model);
  const processDisabled = isVirtualTryon && !allHaveModels;

  const selectedImagesCount = uploadedFiles.filter(f => f.selected).length;
  const allSelected = uploadedFiles.length > 0 && selectedImagesCount === uploadedFiles.length;

  const activePlatformId = appState.batchState.targetPlatform || 'flipkart';
  const currentPlatform = marketplacePlatforms.find(p => p.id === activePlatformId) || marketplacePlatforms[0];

  const allowedResolutions = getUserAllowedResolutions();
  const activeResolution = appState.batchState.targetResolution || getDefaultResolutionForUser();

  const thumbs = uploadedFiles.map((file, i) => {
    let badgeText = '';
    if (file.model) {
      badgeText = file.model.includes('male') ? 'M' : 'F';
      if (file.model.includes('female')) badgeText = 'F';
    }
    return `
    <div class="batch-thumb" data-index="${i}">
      <input type="checkbox" class="batch-thumb__checkbox" data-index="${i}" ${file.selected ? 'checked' : ''} />
      <img src="${file.url}" alt="${file.name}" />
      ${file.model ? `<span class="batch-thumb__model-badge" title="Model Assigned">${badgeText}</span>` : ''}
      <div class="batch-thumb__overlay">
        <span class="batch-thumb__name">${file.name}</span>
        <span class="batch-thumb__size">${file.size}</span>
      </div>
      <button class="batch-thumb__delete" data-index="${i}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `}).join('');

  const selectedCount = batchOptions.filter(o => o.checked).length;

  const optionCards = batchOptions.map(opt => `
    <label class="setting-card${opt.checked ? ' selected' : ''}" data-option="${opt.id}">
      <input type="checkbox" name="batch-opt" value="${opt.id}" ${opt.checked ? 'checked' : ''} />
      <div class="setting-card__preview">
        <img src="${opt.img}" alt="${opt.title}" />
      </div>
      <div class="setting-info">
        <span class="setting-title">${opt.emoji} ${opt.title}</span>
        <span class="setting-desc">${opt.desc}</span>
      </div>
    </label>
  `).join('');

  const checkedOptions = batchOptions.filter(o => o.checked);
  const paidModes = checkedOptions.filter(o => o.mode !== 'background_removal' && o.mode !== 'white_background');
  const freeModes = checkedOptions.filter(o => o.mode === 'background_removal' || o.mode === 'white_background');
  const requiredCredits = uploadedFiles.length * paidModes.length * 10;
  const userBalance = (appState.user && appState.user.profile) ? (appState.user.profile.credit_balance ?? 0) : 0;
  const isInsufficientCredits = userBalance < requiredCredits;

  return `
    <input type="file" id="file-input-hidden" multiple accept="image/*,image/heic" style="display:none" />
    <div class="batch-workspace">
      <div class="batch-left">
        <div class="batch-toolbar">
          <div class="batch-toolbar__left" style="display:flex; align-items:center; gap: 8px;">
            <input type="checkbox" id="check-select-all" ${allSelected ? 'checked' : ''} style="cursor:pointer;" />
            <span class="batch-toolbar__count">${uploadedFiles.length} image${uploadedFiles.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="batch-toolbar__right" style="display:flex; gap: 8px;">
            <button class="batch-toolbar__btn" id="btn-assign-model" ${selectedImagesCount === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
              🧍 Assign Model
            </button>
            <button class="batch-toolbar__btn" id="btn-add-more">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Add images
            </button>
          </div>
        </div>
        <div class="batch-grid">
          ${thumbs}
        </div>
      </div>

      <div class="batch-right">
        <div class="batch-right__header">
          <h3 class="batch-right__title">What do you need?</h3>
          <span class="batch-right__subtitle">Select target modes · <strong>${selectedCount} selected</strong></span>
        </div>

        <div class="batch-options-list">
          ${optionCards}
        </div>

        ${isVirtualTryon ? `
        <div class="batch-models-summary">
          <span class="batch-models-summary__title">Models in use:</span>
          <div class="batch-models-summary__faces">
            ${[...new Set(uploadedFiles.map(f => f.model).filter(Boolean))].map(m => `<img src="${m}" alt="Assigned Model" class="batch-models-summary__face" data-src="${m}" />`).join('')}
            ${uploadedFiles.every(f => !f.model) ? '<span style="font-size: 12px; color: var(--color-gray-500);">None assigned</span>' : ''}
          </div>
        </div>
        ` : ''}

        <div class="batch-right__footer">
          <!-- ─── Transparent Cost & Credit Breakdown ─── -->
          <div class="batch-cost-summary-card">
            <div class="batch-cost-row">
              <span class="batch-cost-label">
                <span>🪙</span> Required Credits:
              </span>
              <span class="batch-cost-value">
                <strong>${requiredCredits}</strong> credits
                <span class="batch-cost-detail">(${uploadedFiles.length} images × ${paidModes.length} AI mode${paidModes.length !== 1 ? 's' : ''} × 10 cr)</span>
              </span>
            </div>

            ${freeModes.length > 0 ? `
            <div class="batch-cost-row batch-cost-row--free">
              <span class="batch-cost-label">
                <span>🆓</span> Unlimited Free:
              </span>
              <span class="batch-cost-value" style="color: #10b981;">
                0 credits (${freeModes.map(f => f.title).join(', ')})
              </span>
            </div>
            ` : ''}

            <div class="batch-cost-divider"></div>

            <div class="batch-cost-row">
              <span class="batch-cost-label">💳 Your Balance:</span>
              <span class="batch-cost-value">${userBalance.toLocaleString()} credits</span>
            </div>

            <div class="batch-cost-row">
              <span class="batch-cost-label">📉 After Processing:</span>
              <span class="batch-cost-value">
                ${isInsufficientCredits 
                  ? `<span style="color:#ef4444; font-weight:700;">-${(requiredCredits - userBalance).toLocaleString()} credits needed</span>` 
                  : `${(userBalance - requiredCredits).toLocaleString()} credits`}
              </span>
            </div>
          </div>

          ${isInsufficientCredits ? `
          <div class="batch-insufficient-credits-alert">
            <div style="display:flex; align-items:center; gap:8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style="font-size:12px; font-weight:600; color:#991b1b;">Not enough credits for this batch.</span>
            </div>
            <button class="batch-upgrade-btn-inline" id="btn-batch-buy-credits">
              ⚡ Upgrade Plan / Top-up Credits
            </button>
          </div>
          ` : ''}

          <button class="process-btn" id="btn-process-batch" ${(processDisabled || isInsufficientCredits) ? `disabled title="${isInsufficientCredits ? 'Insufficient credits. Please top up or reduce options.' : 'Please assign a model to all images for Virtual Try-on'}"` : ''}>
            ${isInsufficientCredits ? '⚠️ Insufficient Credits' : `✨ Process ${uploadedFiles.length} Image${uploadedFiles.length !== 1 ? 's' : ''} (${requiredCredits} cr)`}
          </button>
        </div>
      </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="image-modal">
      <div class="image-modal__content">
        <button class="image-modal__close" id="modal-close" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <img class="image-modal__img" id="modal-img" src="" alt="Preview" />
      </div>
    </div>

    <!-- Avatar Selection Modal -->
    <div class="avatar-modal" id="avatar-modal">
      <div class="avatar-modal__content">
        <div class="avatar-modal__header">
          <h3 class="avatar-modal__title">Assign Model</h3>
          <button class="avatar-modal__close" id="avatar-modal-close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="avatar-modal__grid">
          <div class="avatar-card" data-avatar="/images/avatar-male.png">
            <img src="/images/avatar-male.png" alt="Male Model" />
            <span>Male Model</span>
          </div>
          <div class="avatar-card" data-avatar="/images/avatar-female.png">
            <img src="/images/avatar-female.png" alt="Female Model" />
            <span>Female Model</span>
          </div>
        </div>
        <div class="avatar-modal__footer">
          <button class="avatar-modal__apply" id="btn-apply-avatar" disabled>Assign Model</button>
        </div>
      </div>
    </div>
  `;
}

function renderBatch() {
  if (appState.batchState.view === 'workspace') {
    return renderBatchWorkspace();
  }
  if (appState.batchState.view === 'progress') {
    return renderBatchProgress();
  }

  return `
    <input type="file" id="file-input-hidden" multiple accept="image/*,image/heic" style="display:none" />
    <div class="batch-page">
      <div class="batch-upload-card" id="batch-drop-zone">
        <div class="batch-upload-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 12 12 17 22 12"></polyline>
            <polyline points="2 17 12 22 22 17"></polyline>
          </svg>
        </div>
        <h2>Batch edit up to 10,000 images at once</h2>
        <p>Drag and drop images or click to upload</p>
        <button class="batch-upload-btn" id="btn-trigger-upload">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Upload Images
        </button>
        <div class="batch-formats">
          <span class="format-badge">JPG</span>
          <span class="format-badge">PNG</span>
          <span class="format-badge">WebP</span>
          <span class="format-badge">HEIC</span>
        </div>
      </div>
    </div>
  `;
}

function renderAssets() {
  const { view, selectedDate, uploads, processed } = appState.assetsState;

  function getLocalDateString(dateStr) {
    if (!dateStr) return 'unknown';
    const date = new Date(dateStr);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const groups = {};
  
  // First, group processed jobs by their date
  processed.forEach(p => {
    const key = getLocalDateString(p.created_at);
    if (!groups[key]) groups[key] = { uploads: [], processed: [] };
    groups[key].processed.push(p);
  });

  // Next, associate each upload with the date group(s) it was processed on
  uploads.forEach(u => {
    let placed = false;
    for (const key of Object.keys(groups)) {
      const usedInJob = groups[key].processed.some(p => p.image_id === u.id);
      if (usedInJob) {
        if (!groups[key].uploads.some(existing => existing.id === u.id)) {
          groups[key].uploads.push(u);
        }
        placed = true;
      }
    }
    // If it was never processed, group it by its original upload date
    if (!placed) {
      const key = getLocalDateString(u.created_at);
      if (!groups[key]) groups[key] = { uploads: [], processed: [] };
      if (!groups[key].uploads.some(existing => existing.id === u.id)) {
        groups[key].uploads.push(u);
      }
    }
  });

  const sortedDates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));

  if (view === 'folders') {
    let foldersHtml = '';
    if (sortedDates.length === 0) {
      foldersHtml = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--color-gray-500); width:100%;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <p>No assets found. Go to the workspace page to start creating!</p>
        </div>
      `;
    } else {
      const cardsHtml = sortedDates.map(dateKey => {
        const dateObj = new Date(dateKey + 'T00:00:00');
        const formattedDate = dateObj.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });

        const group = groups[dateKey];
        const totalCount = group.uploads.length + group.processed.length;

        // Collect up to 3 preview thumbnails
        const previewThumbs = [
          ...group.processed.filter(p => p.result_url).map(p => p.result_url),
          ...group.uploads.filter(u => u.url).map(u => u.url)
        ].slice(0, 3);

        const thumbsHtml = previewThumbs.length > 0
          ? previewThumbs.map((url, i) => `<img src="${url}" class="folder-thumb-layer" alt="Preview ${i + 1}" loading="lazy" />`).join('')
          : `<div style="color:var(--color-gray-400); font-size:12px; display:flex; align-items:center; gap:6px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Empty folder</div>`;

        return `
          <div class="asset-folder-card-modern" data-date="${dateKey}">
            <div class="folder-thumb-stack">
              ${thumbsHtml}
            </div>
            <div class="folder-meta-modern">
              <div>
                <h4 class="folder-meta-title">${formattedDate}</h4>
                <p class="folder-meta-subtitle">${totalCount} total asset${totalCount !== 1 ? 's' : ''}</p>
              </div>
              <div class="folder-meta-badges">
                ${group.processed.length > 0 ? `<span class="folder-meta-badge folder-meta-badge--ai">✨ ${group.processed.length} AI</span>` : ''}
                ${group.uploads.length > 0 ? `<span class="folder-meta-badge">📸 ${group.uploads.length} Raw</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      foldersHtml = `
        <div class="assets-folders-grid-modern">
          ${cardsHtml}
        </div>
      `;
    }

    return `
      <div class="assets-container">
        <div class="assets-header">
          <div>
            <h1>Asset Library</h1>
            <p>Access your uploads and AI output files grouped by date.</p>
          </div>
        </div>
        ${foldersHtml}
      </div>
    `;
  }

  const group = groups[selectedDate] || { uploads: [], processed: [] };
  
  const dateObj = new Date(selectedDate + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const modeLabels = {
    try_on: 'Try-on',
    white_background: 'White BG',
    lifestyle: 'Lifestyle',
    ghost_mannequin: 'Ghost Mannequin',
    flat_lay: 'Flat Lay',
    folded: 'Folded',
    closeup: 'Closeup',
    upscale: 'Upscale',
    background_removal: 'Rembg'
  };

  const activeTab = appState.assetsState.detailTab || 'all';

  let uploadsCardsHtml = group.uploads.map(asset => {
    const imageUrl = asset.url;
    const filename = asset.original_filename || 'clothing_item.png';
    return `
      <div class="asset-card" data-asset-id="${asset.id}" data-type="upload">
        <div class="asset-card-thumbnail" style="position: relative;">
          <img src="${imageUrl}" alt="${filename}" loading="lazy" />
          <div class="job-card-mode-tag" style="background:#64748b;">Raw Upload</div>
          <button class="asset-card-preview-btn btn-asset-preview" data-url="${imageUrl}" data-title="${filename}" title="Preview full image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
        <div class="asset-card-info">
          <span class="asset-card-name" title="${filename}">${filename}</span>
        </div>
        <div class="asset-card-actions">
          <button class="asset-card-btn asset-card-btn--primary btn-asset-edit" data-url="${imageUrl}">
            Edit
          </button>
          <button class="asset-card-btn btn-asset-download" data-url="${imageUrl}" data-filename="${filename}">
            Download
          </button>
        </div>
      </div>
    `;
  }).join('');

  let processedCardsHtml = group.processed.map(asset => {
    const isCompleted = asset.status === 'completed';
    const isFailed = asset.status === 'failed';
    const isProcessing = asset.status === 'processing' || asset.status === 'pending';

    const imageUrl = isCompleted ? asset.result_url : asset.input_image_url;
    const modeName = modeLabels[asset.generation_mode] || asset.generation_mode;
    const filename = `AI Output (${modeName})`;

    let badgeHtml = '';
    let overlayHtml = '';
    let actionsHtml = '';

    if (isCompleted) {
      badgeHtml = `<div class="job-card-mode-tag" style="background:#7c3aed;">✨ ${modeName}</div>`;
      actionsHtml = `
        <button class="asset-card-btn asset-card-btn--primary btn-asset-edit" data-url="${imageUrl}">
          Edit
        </button>
        <button class="asset-card-btn btn-asset-download" data-url="${imageUrl}" data-filename="cropstudio_${asset.generation_mode}_${asset.id}.png">
          Download
        </button>
      `;
    } else if (isFailed) {
      badgeHtml = `<div class="job-card-mode-tag" style="background:#ef4444;">Failed</div>`;
      overlayHtml = `
        <div style="position: absolute; inset: 0; background: rgba(239, 68, 68, 0.4); display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.5); padding: 8px; text-align: center;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:4px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span style="font-size: 13px;">Generation Failed</span>
        </div>
      `;
    } else {
      badgeHtml = `<div class="job-card-mode-tag" style="background:#f59e0b;">Processing</div>`;
      overlayHtml = `
        <div class="cs-processing-overlay">
          <div class="cs-spinner cs-spinner--white"></div>
          <span>Generating...</span>
        </div>
      `;
    }

    return `
      <div class="asset-card" data-asset-id="${asset.id}" data-type="processed">
        <div class="asset-card-thumbnail" style="position: relative;">
          <img src="${imageUrl}" alt="${filename}" loading="lazy" style="${isProcessing ? 'filter: blur(2px);' : ''}" />
          ${badgeHtml}
          ${overlayHtml}
          ${imageUrl && !isProcessing ? `
            <button class="asset-card-preview-btn btn-asset-preview" data-url="${imageUrl}" data-title="${filename}" title="Preview full image">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          ` : ''}
        </div>
        <div class="asset-card-info">
          <span class="asset-card-name" title="${filename}">${filename}</span>
        </div>
        <div class="asset-card-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join('');

  let displayedCardsHtml = '';
  if (activeTab === 'processed') {
    displayedCardsHtml = group.processed.length > 0 ? processedCardsHtml : `<p style="grid-column: 1/-1; color:var(--color-gray-500); font-size:14px; text-align:center; padding: 40px 0;">No AI generated outputs for this date.</p>`;
  } else if (activeTab === 'uploads') {
    displayedCardsHtml = group.uploads.length > 0 ? uploadsCardsHtml : `<p style="grid-column: 1/-1; color:var(--color-gray-500); font-size:14px; text-align:center; padding: 40px 0;">No uploads for this date.</p>`;
  } else {
    displayedCardsHtml = (group.processed.length + group.uploads.length > 0)
      ? `${processedCardsHtml}${uploadsCardsHtml}`
      : `<p style="grid-column: 1/-1; color:var(--color-gray-500); font-size:14px; text-align:center; padding: 40px 0;">No assets found for this date.</p>`;
  }

  return `
    <div class="assets-container">
      <div class="assets-detail-header">
        <button class="asset-back-btn" id="btn-assets-back" title="Back to Folders">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div>
          <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 2px 0;">${formattedDate}</h1>
          <p style="font-size: 13px; color: #64748b; margin: 0;">${group.processed.length + group.uploads.length} total files</p>
        </div>
      </div>

      <div class="assets-segment-tabs">
        <button class="assets-segment-tab${activeTab === 'all' ? ' active' : ''}" data-asset-tab="all">
          All Files (${group.processed.length + group.uploads.length})
        </button>
        <button class="assets-segment-tab${activeTab === 'processed' ? ' active' : ''}" data-asset-tab="processed">
          ✨ Generated Outputs (${group.processed.length})
        </button>
        <button class="assets-segment-tab${activeTab === 'uploads' ? ' active' : ''}" data-asset-tab="uploads">
          📸 Raw Uploads (${group.uploads.length})
        </button>
      </div>
      
      <div class="assets-grid" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
        ${displayedCardsHtml}
      </div>
    </div>

    <!-- Image Modal for Assets -->
    <div class="image-modal" id="image-modal">
      <div class="image-modal__content">
        <button class="image-modal__close" id="modal-close" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <img class="image-modal__img" id="modal-img" src="" alt="Preview" />
      </div>
    </div>
  `;
}

function initAssetsEvents() {
  const pageContent = document.getElementById('page-content');
  if (!pageContent) return;

  pageContent.addEventListener('click', async (e) => {
    // 1. Click Date Folder Card
    const folderCard = e.target.closest('.asset-folder-card') || e.target.closest('.asset-folder-card-modern');
    if (folderCard) {
      const dateKey = folderCard.getAttribute('data-date');
      appState.assetsState.view = 'folder-detail';
      appState.assetsState.selectedDate = dateKey;
      appState.assetsState.detailTab = 'all';
      pageContent.innerHTML = renderAssets();
      return;
    }

    // 1b. Click Segment Tab inside Folder
    const segmentTab = e.target.closest('.assets-segment-tab');
    if (segmentTab) {
      appState.assetsState.detailTab = segmentTab.getAttribute('data-asset-tab');
      pageContent.innerHTML = renderAssets();
      return;
    }

    // 2. Click Back Button
    const backBtn = e.target.closest('#btn-assets-back');
    if (backBtn) {
      appState.assetsState.view = 'folders';
      appState.assetsState.selectedDate = null;
      pageContent.innerHTML = renderAssets();
      return;
    }

    // 3. Edit button
    const editBtn = e.target.closest('.btn-asset-edit');
    if (editBtn) {
      const url = editBtn.getAttribute('data-url');
      switchToEditView({ url: url, name: 'cropstudio_asset.png' });
      return;
    }

    // 4. Download button
    const downloadBtn = e.target.closest('.btn-asset-download');
    if (downloadBtn) {
      const url = downloadBtn.getAttribute('data-url');
      const filename = downloadBtn.getAttribute('data-filename') || 'asset.png';

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // 5. Preview button (Eye icon)
    const previewBtn = e.target.closest('.btn-asset-preview');
    if (previewBtn) {
      e.stopPropagation();
      const url = previewBtn.getAttribute('data-url');
      const modal = document.getElementById('image-modal');
      const modalImg = document.getElementById('modal-img');
      if (modal && modalImg && url) {
        modalImg.src = url;
        modal.classList.add('active');
        modal.classList.add('open');
      }
      return;
    }

    // 6. Modal Close
    const modalCloseBtn = e.target.closest('#modal-close');
    const isModalBg = e.target.id === 'image-modal';
    if (modalCloseBtn || isModalBg) {
      const modal = document.getElementById('image-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('open');
      }
      return;
    }
  });
}

// ─── Billing & Usage Dashboard ───
async function fetchAndRenderBilling(page = null) {
  if (page !== null) {
    appState.billingState.currentPage = page;
  }
  const timeRange = appState.billingState.timeRange || 'all';
  const selectedModes = appState.billingState.selectedModes || [];
  const modesParam = (selectedModes.length > 0 && !selectedModes.includes('all')) ? selectedModes.join(',') : 'all';
  const currentPage = appState.billingState.currentPage || 1;

  try {
    const res = await apiFetch(`/billing/usage-history?time_range=${timeRange}&modes=${modesParam}&page=${currentPage}&page_size=10`);
    appState.billingState.data = res;
    const pageContent = document.getElementById('page-content');
    if (pageContent) {
      pageContent.innerHTML = renderBilling();
    }
  } catch (err) {
    console.error('Failed to fetch filtered billing usage data:', err);
  }
}

function renderBilling() {
  const data = appState.billingState?.data || {
    plan: {
      tier: 'free',
      display_name: 'Free Plan',
      price_inr: 0,
      credit_balance: 10,
      monthly_image_quota: 50,
      subscription_period_start: null,
      subscription_period_end: null,
      total_credits_spent: 0,
      total_images_processed: 0
    },
    usage_logs: [],
    pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 1 },
    invoices: [],
    available_plans: {}
  };

  const plan = data.plan;
  const usageLogs = data.usage_logs || [];
  const invoices = data.invoices || [];
  const pagination = data.pagination || { page: 1, page_size: 10, total_count: usageLogs.length, total_pages: 1 };
  const activeTab = appState.billingState?.activeTab || 'usage';

  // Format Dates
  let renewalText = 'No active recurring subscription';
  if (plan.subscription_period_end) {
    const d = new Date(plan.subscription_period_end);
    renewalText = `Renews on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  // Quota Gauge Percentage
  const creditsLeft = plan.credit_balance || 0;
  const planTotalCredits = plan.tier === 'enterprise_studio' ? 3000 : (plan.tier === 'brand_pro' ? 1000 : (plan.tier === 'creator_lite' ? 300 : 50));
  const percentRemaining = Math.min(100, Math.round((creditsLeft / planTotalCredits) * 100));

  // Plan Tier Badge Style
  const tierBadges = {
    enterprise_studio: { label: '👑 Business Plan', class: 'badge--biz' },
    brand_pro: { label: '✨ Pro Plan', class: 'badge--pro' },
    creator_lite: { label: '📦 Starter Plan', class: 'badge--starter' },
    free: { label: '🌱 Free Plan', class: 'badge--starter' }
  };
  const activeBadge = tierBadges[plan.tier] || { label: plan.display_name, class: 'badge--starter' };

  // Mode Labels Helper
  const modeLabels = {
    try_on: '👗 On-Model',
    white_background: '🤍 White BG',
    lifestyle: '🏡 Lifestyle',
    ghost_mannequin: '👻 Mannequin',
    flat_lay: '📦 Flat Lay',
    folded: '📁 Folded',
    closeup: '🔍 Closeup',
    upscale: '✨ Upscale',
    background_removal: '🔲 Rembg'
  };

  const timeRange = appState.billingState?.timeRange || 'all';
  const selectedModes = appState.billingState?.selectedModes || [];
  const isModesMenuOpen = appState.billingState?.isModesMenuOpen || false;

  // Compute modes trigger label
  let modesLabel = 'All Modes (Default)';
  if (selectedModes.length === 1 && selectedModes[0] !== 'all') {
    modesLabel = modeLabels[selectedModes[0]] || selectedModes[0];
  } else if (selectedModes.length > 1 && !selectedModes.includes('all')) {
    modesLabel = `${selectedModes.length} Modes Selected`;
  }

  // 1. Usage Logs Table HTML
  let usageTableHtml = '';
  if (usageLogs.length === 0) {
    usageTableHtml = `
      <tr>
        <td colspan="5" style="text-align:center; padding: 40px 16px; color:#64748b;">
          <div style="font-size:32px; margin-bottom:8px;">📊</div>
          <strong>No generation activity found for this filter.</strong>
          <p style="margin:4px 0 0 0; font-size:12px;">Try adjusting the period or modes filters above.</p>
        </td>
      </tr>
    `;
  } else {
    usageTableHtml = usageLogs.map(log => {
      const dateObj = log.created_at ? new Date(log.created_at) : new Date();
      const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const formattedTime = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      const modesHtml = (log.modes || []).map(m => `
        <span class="export-res-tag" style="background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-size:11px; margin-right:4px;">
          ${modeLabels[m] || m}
        </span>
      `).join('') || '<span style="color:#94a3b8; font-size:11px;">Standard</span>';

      const isFreeOnly = log.credits_used === 0;

      return `
        <tr>
          <td>
            <div style="font-weight:600; color:#0f172a;">${formattedDate}</div>
            <div style="font-size:11px; color:#64748b;">${formattedTime}</div>
          </td>
          <td>
            <div style="font-weight:600; color:#0f172a; margin-bottom:2px;">${log.name}</div>
            <div style="display:flex; flex-wrap:wrap; gap:2px;">${modesHtml}</div>
          </td>
          <td>
            <strong>${log.images_count}</strong> visual${log.images_count !== 1 ? 's' : ''}
            <span style="font-size:11px; color:#64748b; display:block;">(${log.unique_skus || 1} SKU${(log.unique_skus || 1) !== 1 ? 's' : ''})</span>
          </td>
          <td>
            ${isFreeOnly 
              ? `<span class="badge-credit-free">✓ 0 cr (Unlimited Free)</span>`
              : `<span class="badge-credit-spent">-${log.credits_used} credits</span>`}
          </td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; color:${log.status === 'completed' ? '#10b981' : (log.status === 'failed' ? '#ef4444' : '#7c3aed')};">
              <span style="width:6px; height:6px; border-radius:50%; background:currentColor;"></span>
              ${log.status.toUpperCase()}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 2. Invoices Table HTML
  let invoicesTableHtml = '';
  if (invoices.length === 0) {
    invoicesTableHtml = `
      <tr>
        <td colspan="6" style="text-align:center; padding: 40px 16px; color:#64748b;">
          <div style="font-size:32px; margin-bottom:8px;">🧾</div>
          <strong>No payment invoices found.</strong>
          <p style="margin:4px 0 0 0; font-size:12px;">When you purchase or renew a subscription plan, your official receipts will appear here.</p>
        </td>
      </tr>
    `;
  } else {
    invoicesTableHtml = invoices.map(inv => `
      <tr>
        <td><strong>${inv.invoice_id}</strong></td>
        <td>${inv.date}</td>
        <td>
          <div style="font-weight:600; color:#0f172a;">${inv.description}</div>
          <span style="font-size:11px; color:#64748b;">+${inv.credits_granted?.toLocaleString()} credits included</span>
        </td>
        <td><strong style="color:#0f172a;">₹${inv.amount_inr?.toLocaleString()}</strong></td>
        <td><span class="badge-invoice-paid">✓ ${inv.status}</span></td>
        <td>
          <button class="billing-btn billing-btn--outline btn-view-invoice" data-invoice-id="${inv.invoice_id}" data-desc="${inv.description}" data-amount="${inv.amount_inr}" data-date="${inv.date}">
            📄 View Receipt
          </button>
        </td>
      </tr>
    `).join('');
  }

  return `
    <div class="billing-container">
      <div class="billing-header">
        <div>
          <h1>Billing & Usage Hub</h1>
          <p>Monitor your AI generation consumption, manage subscription tiers, and download payment receipts.</p>
        </div>
        <div class="billing-header-actions">
          <button class="billing-btn billing-btn--primary btn-open-pricing-cta" id="btn-billing-upgrade" data-pricing-tab="plans">
            ⚡ Upgrade / Change Plan
          </button>
        </div>
      </div>

      <!-- ─── 3 KPI Cards ─── -->
      <div class="billing-kpi-grid">
        <!-- Card 1: Active Subscription -->
        <div class="billing-card">
          <div>
            <div class="billing-card-top">
              <span class="billing-card-label">Current Subscription</span>
              <span class="export-res-tag ${activeBadge.class}" style="font-weight:700; padding:3px 8px; border-radius:6px; font-size:11px;">
                ${activeBadge.label}
              </span>
            </div>
            <div class="billing-card-value" style="margin-top:8px;">
              ${plan.price_inr > 0 ? `₹${plan.price_inr.toLocaleString()} <span style="font-size:13px; font-weight:normal; color:#64748b;">/ month</span>` : 'Free Tier'}
            </div>
            <p class="billing-card-sub">${renewalText}</p>
          </div>
          <button class="billing-btn billing-btn--outline btn-open-pricing-cta" id="btn-manage-sub">
            Manage Subscription
          </button>
        </div>

        <!-- Card 2: Credit Balance & Gauge -->
        <div class="billing-card">
          <div>
            <div class="billing-card-top">
              <span class="billing-card-label">Available Balance</span>
              <span style="font-size:11px; font-weight:700; color:#7c3aed; background:#faf5ff; padding:2px 8px; border-radius:6px; border:1px solid #e9d5ff;">
                ${Math.floor(creditsLeft / 10)} AI shoots
              </span>
            </div>
            <div class="billing-card-value" style="margin-top:8px;">
              🪙 ${creditsLeft.toLocaleString()} <span style="font-size:13px; font-weight:normal; color:#64748b;">credits</span>
            </div>
            <div class="billing-gauge-track">
              <div class="billing-gauge-fill" style="width: ${percentRemaining}%;"></div>
            </div>
            <p class="billing-card-sub" style="font-size:11px;">${creditsLeft.toLocaleString()} of ${planTotalCredits.toLocaleString()} monthly credits available (${percentRemaining}%)</p>
          </div>
          <button class="billing-btn billing-btn--primary btn-open-pricing-cta" id="btn-topup-credits" data-pricing-tab="topup">
            + Buy Add-on Credits
          </button>
        </div>

        <!-- Card 3: Lifetime Usage Summary -->
        <div class="billing-card">
          <div>
            <div class="billing-card-top">
              <span class="billing-card-label">Account Activity</span>
              <span style="font-size:11px; font-weight:700; color:#10b981; background:#ecfdf5; padding:2px 8px; border-radius:6px;">
                99.8% Success
              </span>
            </div>
            <div class="billing-card-value" style="margin-top:8px;">
              ${plan.total_images_processed || 0} <span style="font-size:13px; font-weight:normal; color:#64748b;">visuals generated</span>
            </div>
            <p class="billing-card-sub">Total credits invested: <strong>${(plan.total_credits_spent || 0).toLocaleString()} cr</strong></p>
          </div>
          <div style="font-size:12px; color:#64748b; display:flex; align-items:center; gap:6px;">
            <span>🛡️ Auto-refund on failed generations active</span>
          </div>
        </div>
      </div>

      <!-- ─── Segmented Tabs ─── -->
      <div class="billing-tabs-bar">
        <button class="billing-tab-btn${activeTab === 'usage' ? ' active' : ''}" data-billing-tab="usage">
          📊 Credit Usage History (${usageLogs.length})
        </button>
        <button class="billing-tab-btn${activeTab === 'invoices' ? ' active' : ''}" data-billing-tab="invoices">
          🧾 Invoices & Receipts (${invoices.length})
        </button>
        <button class="billing-tab-btn${activeTab === 'plans' ? ' active' : ''}" data-billing-tab="plans">
          💎 Plan Comparison & Quotas
        </button>
      </div>

      <!-- ─── Tab Content ─── -->
      ${activeTab === 'usage' ? `
        <!-- Filter & Time Range Bar -->
        <div class="billing-filter-bar">
          <div class="billing-filter-controls">
            <!-- Period Dropdown -->
            <div class="billing-filter-group">
              <span class="billing-filter-label">📅 Period:</span>
              <select class="billing-select" id="select-billing-time">
                <option value="all" ${timeRange === 'all' ? 'selected' : ''}>All Time</option>
                <option value="this_month" ${timeRange === 'this_month' ? 'selected' : ''}>This Month</option>
                <option value="last_30_days" ${timeRange === 'last_30_days' ? 'selected' : ''}>Last 30 Days</option>
                <option value="last_7_days" ${timeRange === 'last_7_days' ? 'selected' : ''}>Last 7 Days</option>
              </select>
            </div>

            <!-- Modes Multi-select Popover Dropdown -->
            <div class="billing-filter-group">
              <span class="billing-filter-label">🎭 Modes:</span>
              <div class="billing-multiselect-wrap">
                <button class="billing-multiselect-trigger${selectedModes.length > 0 && !selectedModes.includes('all') ? ' active' : ''}" id="btn-billing-modes-trigger">
                  <span>${modesLabel}</span>
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                </button>
                <div class="billing-multiselect-menu${isModesMenuOpen ? ' open' : ''}" id="billing-modes-menu">
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="all" class="billing-mode-cb" ${selectedModes.length === 0 || selectedModes.includes('all') ? 'checked' : ''} />
                    <strong>All Modes (Default)</strong>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="try_on" class="billing-mode-cb" ${selectedModes.includes('try_on') ? 'checked' : ''} />
                    <span>👗 On-Model Try-On</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="white_background" class="billing-mode-cb" ${selectedModes.includes('white_background') ? 'checked' : ''} />
                    <span>🤍 White Background</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="lifestyle" class="billing-mode-cb" ${selectedModes.includes('lifestyle') ? 'checked' : ''} />
                    <span>🏡 Lifestyle Scene</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="ghost_mannequin" class="billing-mode-cb" ${selectedModes.includes('ghost_mannequin') ? 'checked' : ''} />
                    <span>👻 Ghost Mannequin</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="flat_lay" class="billing-mode-cb" ${selectedModes.includes('flat_lay') ? 'checked' : ''} />
                    <span>📦 Flat Lay</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="folded" class="billing-mode-cb" ${selectedModes.includes('folded') ? 'checked' : ''} />
                    <span>📁 Folded Garment</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="closeup" class="billing-mode-cb" ${selectedModes.includes('closeup') ? 'checked' : ''} />
                    <span>🔍 Fabric Closeup</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="upscale" class="billing-mode-cb" ${selectedModes.includes('upscale') ? 'checked' : ''} />
                    <span>✨ Upscale HD</span>
                  </label>
                  <label class="billing-multiselect-option">
                    <input type="checkbox" value="background_removal" class="billing-mode-cb" ${selectedModes.includes('background_removal') ? 'checked' : ''} />
                    <span>🔲 Background Removal</span>
                  </label>
                  <div class="billing-multiselect-actions">
                    <button class="billing-multiselect-link" id="btn-modes-select-all">Select All</button>
                    <button class="billing-multiselect-link" id="btn-modes-clear">Clear Filter</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style="font-size:12px; color:#64748b;">
            Total: <strong>${pagination.total_count} operations</strong>
          </div>
        </div>

        <div class="billing-table-card">
          <table class="billing-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Operation / Batch Name</th>
                <th>Visuals & SKUs</th>
                <th>Credits Spent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${usageTableHtml}
            </tbody>
          </table>

          <!-- Server-side Pagination Footer -->
          ${pagination.total_count > pagination.page_size ? `
          <div class="billing-pagination">
            <span>Showing ${(pagination.page - 1) * pagination.page_size + 1}–${Math.min(pagination.page * pagination.page_size, pagination.total_count)} of ${pagination.total_count} operations</span>
            <div class="billing-pagination-controls">
              <button class="billing-page-btn" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>← Previous</button>
              ${Array.from({ length: pagination.total_pages }, (_, i) => i + 1).map(p => `
                <button class="billing-page-btn${p === pagination.page ? ' active' : ''}" data-page="${p}">${p}</button>
              `).join('')}
              <button class="billing-page-btn" data-page="${pagination.page + 1}" ${pagination.page >= pagination.total_pages ? 'disabled' : ''}>Next →</button>
            </div>
          </div>
          ` : ''}
        </div>
      ` : ''}

      ${activeTab === 'invoices' ? `
        <div class="billing-table-card">
          <table class="billing-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Billing Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Payment Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${invoicesTableHtml}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${activeTab === 'plans' ? `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px;">
          <div class="billing-card" style="border: 2px solid ${plan.tier === 'creator_lite' ? '#7c3aed' : '#e2e8f0'}; background:${plan.tier === 'creator_lite' ? '#faf5ff' : '#ffffff'};">
            <div>
              <span class="export-res-tag badge--starter" style="padding:3px 8px; border-radius:6px; font-weight:700;">STARTER</span>
              <h3 style="font-size:20px; font-weight:800; margin:10px 0 4px 0;">₹699 <span style="font-size:13px; font-weight:normal; color:#64748b;">/ mo</span></h3>
              <p style="font-size:12px; color:#64748b; margin:0 0 14px 0;">Best for individual catalog creators</p>
              <ul style="font-size:13px; color:#475569; display:flex; flex-direction:column; gap:8px; padding-left:18px; margin:0 0 16px 0;">
                <li><strong>300 credits</strong> (30 AI Images)</li>
                <li>1K Standard HD Output</li>
                <li>Unlimited Free Background Removal</li>
                <li>Single-platform export</li>
              </ul>
            </div>
            <button class="billing-btn ${plan.tier === 'creator_lite' ? 'billing-btn--outline' : 'billing-btn--primary'} btn-open-pricing-cta">
              ${plan.tier === 'creator_lite' ? '✓ Current Plan' : 'Select Starter'}
            </button>
          </div>

          <div class="billing-card" style="border: 2px solid ${plan.tier === 'brand_pro' ? '#7c3aed' : '#e2e8f0'}; background:${plan.tier === 'brand_pro' ? '#faf5ff' : '#ffffff'}; position:relative;">
            <span style="position:absolute; top:-10px; right:16px; background:#7c3aed; color:#ffffff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px;">MOST POPULAR</span>
            <div>
              <span class="export-res-tag badge--pro" style="padding:3px 8px; border-radius:6px; font-weight:700;">PRO</span>
              <h3 style="font-size:20px; font-weight:800; margin:10px 0 4px 0;">₹1,999 <span style="font-size:13px; font-weight:normal; color:#64748b;">/ mo</span></h3>
              <p style="font-size:12px; color:#64748b; margin:0 0 14px 0;">For growing marketplace brands & agencies</p>
              <ul style="font-size:13px; color:#475569; display:flex; flex-direction:column; gap:8px; padding-left:18px; margin:0 0 16px 0;">
                <li><strong>1,000 credits</strong> (100 AI Images)</li>
                <li>2K Ultra HD Studio Quality</li>
                <li>Multi-platform exports (Flipkart, Meesho, Amazon)</li>
                <li>Priority queue rendering</li>
              </ul>
            </div>
            <button class="billing-btn ${plan.tier === 'brand_pro' ? 'billing-btn--outline' : 'billing-btn--primary'} btn-open-pricing-cta">
              ${plan.tier === 'brand_pro' ? '✓ Current Plan' : 'Upgrade to Pro'}
            </button>
          </div>

          <div class="billing-card" style="border: 2px solid ${plan.tier === 'enterprise_studio' ? '#7c3aed' : '#e2e8f0'}; background:${plan.tier === 'enterprise_studio' ? '#faf5ff' : '#ffffff'};">
            <div>
              <span class="export-res-tag badge--biz" style="padding:3px 8px; border-radius:6px; font-weight:700;">BUSINESS</span>
              <h3 style="font-size:20px; font-weight:800; margin:10px 0 4px 0;">₹5,999 <span style="font-size:13px; font-weight:normal; color:#64748b;">/ mo</span></h3>
              <p style="font-size:12px; color:#64748b; margin:0 0 14px 0;">High volume catalog production studio</p>
              <ul style="font-size:13px; color:#475569; display:flex; flex-direction:column; gap:8px; padding-left:18px; margin:0 0 16px 0;">
                <li><strong>3,000 credits</strong> (300 AI Images)</li>
                <li>✨ 4K Master Studio Native Quality</li>
                <li>Multi-Platform Bundle ZIP Exports</li>
                <li>Dedicated VIP rendering speeds</li>
              </ul>
            </div>
            <button class="billing-btn ${plan.tier === 'enterprise_studio' ? 'billing-btn--outline' : 'billing-btn--primary'} btn-open-pricing-cta">
              ${plan.tier === 'enterprise_studio' ? '✓ Current Plan' : 'Upgrade to Business'}
            </button>
          </div>
        </div>
      ` : ''}

      <!-- ─── Receipt Modal ─── -->
      <div class="image-modal" id="receipt-modal">
        <div class="image-modal__content" style="max-width:560px; padding:0; background:transparent; box-shadow:none;">
          <div class="receipt-paper" id="receipt-printable-area">
            <div class="receipt-header">
              <div>
                <div class="receipt-logo">CropStudio<span>AI</span></div>
                <p style="font-size:11px; color:#64748b; margin:2px 0 0 0;">Official Payment Receipt & Commercial License</p>
              </div>
              <button class="receipt-close-btn" id="btn-close-receipt" title="Close">
                ✕
              </button>
            </div>
            
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#475569; background:#f8fafc; padding:12px; border-radius:8px;">
              <div>
                <span style="font-weight:700; color:#0f172a; display:block;">Billed To:</span>
                <span id="receipt-customer-email">${(appState.user && appState.user.email) || 'Customer'}</span>
                <span style="display:block; font-size:11px; color:#64748b; margin-top:2px;">Standard Commercial License</span>
              </div>
              <div style="text-align:right;">
                <span style="font-weight:700; color:#0f172a; display:block;" id="receipt-inv-num">INV-001</span>
                <span id="receipt-date">Aug 26, 2026</span>
                <span style="display:block; font-size:10px; color:#10b981; font-weight:700; margin-top:2px;">✓ PAID (ONLINE)</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px;">
              <div class="receipt-row">
                <span id="receipt-desc" style="font-weight:600; color:#0f172a;">Plan Subscription</span>
                <span id="receipt-subtotal-amt" style="font-weight:700; color:#0f172a;">₹5,999</span>
              </div>
              <div class="receipt-row" style="font-size:12px; color:#64748b;">
                <span>Payment Gateway & Mode</span>
                <span>Razorpay (UPI / NetBanking / Cards)</span>
              </div>
              <div class="receipt-row" style="font-size:12px; color:#64748b;">
                <span>Commercial Usage Rights</span>
                <span style="color:#10b981; font-weight:600;">100% Royalty-Free Included</span>
              </div>
            </div>

            <div class="receipt-total" style="border-top: 2px dashed #e2e8f0; padding-top:14px; margin-top:4px;">
              <span>Total Paid:</span>
              <span id="receipt-total-amt" style="color:#7c3aed; font-size:18px; font-weight:800;">₹5,999</span>
            </div>

            <div style="font-size:11px; color:#94a3b8; text-align:center; margin-top:4px;">
              Thank you for choosing CropStudio AI. This is an electronic payment receipt.
            </div>

            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="billing-btn billing-btn--primary" id="btn-print-receipt" style="flex:1;">
                🖨️ Print / Download Receipt
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initBillingEvents() {
  const pageContent = document.getElementById('page-content');
  if (!pageContent) return;

  // Close multi-select dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.billing-multiselect-wrap')) {
      const menu = document.getElementById('billing-modes-menu');
      if (menu && menu.classList.contains('open')) {
        menu.classList.remove('open');
        if (appState.billingState) appState.billingState.isModesMenuOpen = false;
      }
    }
  });

  // Handle Select Change for Time Range (Period)
  pageContent.addEventListener('change', async (e) => {
    if (e.target.id === 'select-billing-time') {
      const selectedTime = e.target.value;
      if (appState.billingState) {
        appState.billingState.timeRange = selectedTime;
        appState.billingState.currentPage = 1;
        await fetchAndRenderBilling(1);
      }
      return;
    }

    // Handle Mode Checkbox Change
    if (e.target.classList.contains('billing-mode-cb')) {
      const val = e.target.value;
      let currentModes = appState.billingState.selectedModes || [];

      if (val === 'all') {
        currentModes = [];
      } else {
        currentModes = currentModes.filter(m => m !== 'all');
        if (e.target.checked) {
          if (!currentModes.includes(val)) currentModes.push(val);
        } else {
          currentModes = currentModes.filter(m => m !== val);
        }
      }

      appState.billingState.selectedModes = currentModes;
      appState.billingState.currentPage = 1;
      await fetchAndRenderBilling(1);
      return;
    }
  });

  pageContent.addEventListener('click', async (e) => {
    // 1. Switch Billing Segment Tab
    const tabBtn = e.target.closest('.billing-tab-btn');
    if (tabBtn) {
      const tabId = tabBtn.getAttribute('data-billing-tab');
      if (appState.billingState) {
        appState.billingState.activeTab = tabId;
        pageContent.innerHTML = renderBilling();
      }
      return;
    }

    // 1b. Toggle Modes Multi-Select Menu
    const triggerBtn = e.target.closest('#btn-billing-modes-trigger');
    if (triggerBtn) {
      e.stopPropagation();
      const menu = document.getElementById('billing-modes-menu');
      if (menu) {
        menu.classList.toggle('open');
        appState.billingState.isModesMenuOpen = menu.classList.contains('open');
      }
      return;
    }

    // 1c. Select All Modes
    if (e.target.closest('#btn-modes-select-all') || e.target.closest('#btn-modes-clear')) {
      e.preventDefault();
      e.stopPropagation();
      appState.billingState.selectedModes = [];
      appState.billingState.currentPage = 1;
      await fetchAndRenderBilling(1);
      return;
    }

    // 1d. Server-side Pagination Click
    const pageBtn = e.target.closest('.billing-page-btn');
    if (pageBtn && !pageBtn.disabled) {
      const targetPage = parseInt(pageBtn.getAttribute('data-page'));
      if (targetPage) {
        await fetchAndRenderBilling(targetPage);
      }
      return;
    }

    // 2. Open Pricing Modal (Upgrade / Top-up)
    const pricingBtn = e.target.closest('.btn-open-pricing-cta');
    if (pricingBtn) {
      const tab = pricingBtn.getAttribute('data-pricing-tab') || 'plans';
      openPricingModal(tab);
      return;
    }

    // 3. Open Add-On Top-Up Packs tab in Pricing Modal
    const buyTopupBtn = e.target.closest('#btn-buy-topup-pack');
    if (buyTopupBtn) {
      openPricingModal('topup');
      return;
    }

    // 4. View Receipt Modal
    const invoiceBtn = e.target.closest('.btn-view-invoice');
    if (invoiceBtn) {
      const invId = invoiceBtn.getAttribute('data-invoice-id') || 'INV-001';
      const desc = invoiceBtn.getAttribute('data-desc') || 'Subscription Plan';
      const amt = invoiceBtn.getAttribute('data-amount') || '0';
      const date = invoiceBtn.getAttribute('data-date') || 'Recent';
      const email = invoiceBtn.getAttribute('data-email') || (appState.user ? appState.user.email : 'Customer');
      openReceiptModal(invId, desc, amt, date, email);
      return;
    }

    // 5. Close Receipt Modal
    if (e.target.closest('#btn-close-receipt') || e.target.id === 'receipt-modal') {
      const modal = document.getElementById('receipt-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('open');
      }
      return;
    }

    // 6. Print Receipt
    if (e.target.closest('#btn-print-receipt')) {
      window.print();
      return;
    }
  });
}

function openReceiptModal(invId, desc, amt, date, email) {
  const modal = document.getElementById('receipt-modal');
  if (modal) {
    const totalAmount = parseInt(amt) || 0;
    const formattedAmt = `₹${totalAmount.toLocaleString('en-IN')}`;

    const invEl = document.getElementById('receipt-inv-num');
    const dateEl = document.getElementById('receipt-date');
    const descEl = document.getElementById('receipt-desc');
    const subtotalEl = document.getElementById('receipt-subtotal-amt');
    const totalEl = document.getElementById('receipt-total-amt');
    const custEmailEl = document.getElementById('receipt-customer-email');

    if (invEl) invEl.textContent = invId || 'INV-001';
    if (dateEl) dateEl.textContent = date || 'Recent';
    if (descEl) descEl.textContent = desc || 'Payment Receipt';
    if (subtotalEl) subtotalEl.textContent = formattedAmt;
    if (totalEl) totalEl.textContent = formattedAmt;
    if (custEmailEl) custEmailEl.textContent = email || (appState.user ? appState.user.email : 'Customer');

    modal.classList.add('active');
    modal.classList.add('open');
  }
}

function renderFeatureCards() {
  const cards = featureCards.map(card => `
    <div class="feature-card" id="${card.id}">
      <div class="feature-card__thumb">
        <img src="${card.img}" alt="${card.label}" loading="lazy" />
        <div class="feature-card__icon-badge" style="background: ${card.color}">
          <span style="font-size: 12px; line-height: 1;">${card.iconEmoji}</span>
        </div>
      </div>
      <span class="feature-card__label">${card.label}</span>
    </div>
  `).join('');

  return `
    <div class="feature-section">
      <h1 class="section-title">Let's start creating</h1>
      <div class="feature-grid">${cards}</div>
    </div>
  `;
}

function renderQuickEdits() {
  const cards = quickEdits.map(card => `
    <div class="quick-card" id="${card.id}">
      <div class="quick-card__icon quick-card__icon--${card.color}">
        ${icons[card.icon] || ''}
      </div>
      <div class="quick-card__info">
        <span class="quick-card__title">${card.title}</span>
        <span class="quick-card__desc">${card.desc}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="quick-edits">
      <h2 class="section-subtitle">Quick Edits</h2>
      <p class="section-desc">Tools for editing your images & videos</p>
      <div class="quick-grid">${cards}</div>
    </div>
  `;
}

function renderMain() {
  return `
    <main class="main" id="main-content">
      ${renderTopbar()}
      <div class="content" id="page-content">
        ${renderHome()}
      </div>
    </main>
  `;
}

// ─── Authentication View ───
function renderAuth(mode = 'signin', errorMsg = '') {
  const app = document.getElementById('app');
  const errorHtml = errorMsg ? `
    <div class="auth-error-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>${errorMsg}</span>
    </div>
  ` : '';

  app.innerHTML = `
    <div class="auth-page-wrapper">

      <!-- Split Screen -->
      <div class="auth-split-container">
        
        <!-- LEFT: Studio Showcase -->
        <div class="auth-showcase-panel">
          <!-- TOP: Brand & Headlines -->
          <div class="auth-showcase-top">
            <div class="auth-brand-badge">
              <span class="auth-brand-badge-dot"></span>
              <span>AI-Powered Product Studio</span>
            </div>

            <h1 class="auth-showcase-headline">
              Studio Photography.<br/>
              <span>Zero Cameras.</span>
            </h1>

            <p class="auth-showcase-subtext">
              Transform flat-lays, ghost mannequins, and raw product photos into high-converting studio imagery — in seconds, not days.
            </p>
          </div>

          <!-- CENTER: Centered Large Transformation Card & Feature Pills -->
          <div class="auth-showcase-center">
            <div class="auth-transformation-card">
              <div class="auth-transform-grid">
                <div class="auth-transform-item">
                  <img src="/images/example-flatlay.png" alt="Raw product photo" />
                  <span class="auth-transform-tag auth-transform-tag--before">Before</span>
                </div>
                <div class="auth-transform-arrow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div class="auth-transform-item">
                  <img src="/images/example-lifestyle.png" alt="AI studio output" />
                  <span class="auth-transform-tag auth-transform-tag--after">After</span>
                </div>
              </div>
            </div>

            <div class="auth-feature-pills">
              <div class="auth-pill">⚡ Background Removal</div>
              <div class="auth-pill">👤 AI Model Try-On</div>
              <div class="auth-pill">📦 Batch Export</div>
            </div>
          </div>

          <!-- BOTTOM: Trust Metrics -->
          <div class="auth-showcase-metrics">
            <div class="auth-metric-item">
              <span class="auth-metric-value">50,000+</span>
              <span class="auth-metric-label">Images Created</span>
            </div>
            <div class="auth-metric-item">
              <span class="auth-metric-value">85%</span>
              <span class="auth-metric-label">Cost Savings</span>
            </div>
            <div class="auth-metric-item">
              <span class="auth-metric-value">4K</span>
              <span class="auth-metric-label">Output Quality</span>
            </div>
          </div>
        </div>

        <!-- RIGHT: Auth Form -->
        <div class="auth-form-panel">
          <div class="auth-form-header">
            <div class="auth-header-brand">
              <img src="/logo-mark.svg" alt="CropStudio AI" class="auth-logo-ring" style="width:44px; height:44px; border-radius:12px; box-shadow:0 6px 18px rgba(99,102,241,0.3); object-fit:contain; border:none;" />
              <div class="auth-brand-name">CropStudio <span>AI</span></div>
            </div>

            <div class="auth-segmented-switch">
              <button class="auth-segment-btn ${mode === 'signin' ? 'auth-segment-btn--active' : ''}" data-mode="signin" id="btn-tab-signin">
                Sign In
              </button>
              <button class="auth-segment-btn ${mode === 'signup' ? 'auth-segment-btn--active' : ''}" data-mode="signup" id="btn-tab-signup">
                Create Account
              </button>
            </div>
          </div>

          ${errorHtml}

          <button type="button" class="auth-google-btn-modern" id="btn-google-auth">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
            </svg>
            <span>${mode === 'signin' ? 'Continue with Google' : 'Sign up with Google'}</span>
          </button>

          <div class="auth-divider-modern">
            <span>or with email</span>
          </div>

          <form class="auth-fields-wrapper" id="auth-form-submit">
            <div class="auth-field-group">
              <label class="auth-field-label">Email Address</label>
              <div class="auth-input-wrapper">
                <span class="auth-input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </span>
                <input type="email" id="auth-email" class="auth-input-modern" placeholder="name@company.com" required autocomplete="email" />
              </div>
            </div>

            <div class="auth-field-group">
              <label class="auth-field-label">${mode === 'signin' ? 'Password' : 'Create Password (min. 6 characters)'}</label>
              <div class="auth-input-wrapper">
                <span class="auth-input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </span>
                <input type="password" id="auth-password" class="auth-input-modern" placeholder="••••••••••••" ${mode === 'signup' ? 'minlength="6"' : ''} required autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" />
                <button type="button" class="auth-toggle-pwd" id="btn-toggle-pwd" aria-label="Toggle password visibility">
                  <svg id="icon-eye-show" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <svg id="icon-eye-hide" style="display:none;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                </button>
              </div>
            </div>

            <button type="submit" class="auth-primary-submit">
              <span>${mode === 'signin' ? 'Sign In' : 'Get Started Free'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </form>

          <div class="auth-security-footer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <span>256-bit SSL encrypted • SOC 2 compliant</span>
          </div>
        </div>

      </div>
    </div>
  `;

  initAuthEvents(mode);
}

function initAuthEvents(currentMode) {
  // Segment Switchers
  document.getElementById('btn-tab-signin')?.addEventListener('click', () => {
    if (currentMode !== 'signin') renderAuth('signin');
  });

  document.getElementById('btn-tab-signup')?.addEventListener('click', () => {
    if (currentMode !== 'signup') renderAuth('signup');
  });

  // Password Visibility Toggle
  const pwdInput = document.getElementById('auth-password');
  const toggleBtn = document.getElementById('btn-toggle-pwd');
  const eyeShow = document.getElementById('icon-eye-show');
  const eyeHide = document.getElementById('icon-eye-hide');

  if (toggleBtn && pwdInput) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = pwdInput.type === 'password';
      pwdInput.type = isPassword ? 'text' : 'password';
      if (eyeShow && eyeHide) {
        eyeShow.style.display = isPassword ? 'none' : 'block';
        eyeHide.style.display = isPassword ? 'block' : 'none';
      }
    });
  }

  // Google OAuth click listener
  const googleBtn = document.getElementById('btn-google-auth');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      try {
        const client = getSupabase();
        if (client && client.auth) {
          const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.origin
            }
          });
          if (error) throw error;
        } else {
          alert('Google OAuth requires configuring Supabase Client keys in production.');
        }
      } catch (err) {
        console.error('Google Sign In Error:', err);
        alert(err.message || 'Failed to initialize Google Sign In');
      }
    });
  }

  const form = document.getElementById('auth-form-submit');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Authenticating...</span>`;

      try {
        const client = getSupabase();
        if (!client) throw new Error('Supabase client is initializing. Please try again in a moment.');

        if (currentMode === 'signin') {
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) {
            if (error.message && error.message.toLowerCase().includes('invalid login credentials')) {
              throw new Error('Invalid email or password. If you haven\'t signed up yet, please click "Create one" below or sign in with Google.');
            }
            throw error;
          }
          if (!data || !data.session) {
            throw new Error('Please confirm your email address or check your login credentials.');
          }
          appState.token = data.session.access_token;
          localStorage.setItem('cs_token', appState.token);
          await bootApp();
        } else {
          const { data, error } = await client.auth.signUp({ email, password });
          if (error) throw error;
          if (data && data.session && data.session.access_token) {
            appState.token = data.session.access_token;
            localStorage.setItem('cs_token', appState.token);
            await bootApp();
          } else {
            renderAuth('signin', '🎉 Account created! Please log in with your credentials.');
          }
        }
      } catch (err) {
        renderAuth(currentMode, err.message);
      }
    });
  }
}

// ─── Batch Progress Tracking View ───
let batchDetailData = null;

function renderBatchProgress() {
  if (!batchDetailData) {
    return `
      <div class="cs-loading-screen">
        <div class="cs-spinner cs-spinner--lg"></div>
        <div>
          <p class="cs-loading-screen__title">Initializing Generation Batch...</p>
          <p class="cs-loading-screen__desc">Preparing your high-performance worker tasks</p>
        </div>
      </div>
    `;
  }

  const modeLabels = {
    try_on: 'Try-on',
    white_background: 'White BG',
    lifestyle: 'Lifestyle',
    ghost_mannequin: 'Ghost Mannequin',
    flat_lay: 'Flat Lay',
    folded: 'Folded',
    closeup: 'Closeup',
    upscale: 'Upscale',
    background_removal: 'Rembg'
  };

  const { id, name, status, total_jobs, completed_jobs, failed_jobs, jobs } = batchDetailData;
  const isTerminal = status === 'completed' || status === 'failed';
  const progressPercent = total_jobs > 0 ? Math.round(((completed_jobs + failed_jobs) / total_jobs) * 100) : 0;

  const allowedResolutions = getUserAllowedResolutions();
  const activeExportRes = appState.batchState.exportResolution || getDefaultResolutionForUser();
  const activeExportPlatformId = appState.batchState.exportPlatform || 'flipkart';
  const currentExportPlatform = marketplacePlatforms.find(p => p.id === activeExportPlatformId) || marketplacePlatforms[0];

  const activeModeFilter = appState.batchState.modeFilter || 'all';
  const selectedJobIds = appState.batchState.selectedJobIds || [];

  const modeFilterCounts = {
    all: jobs.length,
    try_on: jobs.filter(j => j.generation_mode === 'try_on').length,
    white_background: jobs.filter(j => j.generation_mode === 'white_background').length,
    lifestyle: jobs.filter(j => j.generation_mode === 'lifestyle').length,
    ghost_mannequin: jobs.filter(j => j.generation_mode === 'ghost_mannequin').length,
    flat_lay: jobs.filter(j => j.generation_mode === 'flat_lay').length,
    closeup: jobs.filter(j => j.generation_mode === 'closeup').length,
    folded: jobs.filter(j => j.generation_mode === 'folded').length,
  };

  const filteredJobs = activeModeFilter === 'all'
    ? jobs
    : jobs.filter(j => j.generation_mode === activeModeFilter);

  const filterTabsHtml = `
    <div class="results-filter-bar">
      <div class="results-filter-tabs">
        <button class="results-filter-tab${activeModeFilter === 'all' ? ' active' : ''}" data-mode-filter="all">
          All <span class="results-filter-tab__count">${modeFilterCounts.all}</span>
        </button>
        ${modeFilterCounts.try_on > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'try_on' ? ' active' : ''}" data-mode-filter="try_on">
            👗 On-Model <span class="results-filter-tab__count">${modeFilterCounts.try_on}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.white_background > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'white_background' ? ' active' : ''}" data-mode-filter="white_background">
            🤍 White BG <span class="results-filter-tab__count">${modeFilterCounts.white_background}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.lifestyle > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'lifestyle' ? ' active' : ''}" data-mode-filter="lifestyle">
            🏡 Lifestyle <span class="results-filter-tab__count">${modeFilterCounts.lifestyle}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.ghost_mannequin > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'ghost_mannequin' ? ' active' : ''}" data-mode-filter="ghost_mannequin">
            👻 Mannequin <span class="results-filter-tab__count">${modeFilterCounts.ghost_mannequin}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.flat_lay > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'flat_lay' ? ' active' : ''}" data-mode-filter="flat_lay">
            📦 Flat Lay <span class="results-filter-tab__count">${modeFilterCounts.flat_lay}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.closeup > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'closeup' ? ' active' : ''}" data-mode-filter="closeup">
            🔍 Closeup <span class="results-filter-tab__count">${modeFilterCounts.closeup}</span>
          </button>
        ` : ''}
        ${modeFilterCounts.folded > 0 ? `
          <button class="results-filter-tab${activeModeFilter === 'folded' ? ' active' : ''}" data-mode-filter="folded">
            📁 Folded <span class="results-filter-tab__count">${modeFilterCounts.folded}</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  const jobCardsHtml = filteredJobs.map((job, idx) => {
    const originalFile = uploadedFiles.find(f => f.id === job.image_id);
    const filename = originalFile ? originalFile.name : `Image #${idx + 1}`;

    let badgeHtml = '';
    let badgeClass = 'job-card-badge--processing';
    let statusText = 'Processing...';

    if (job.status === 'completed') {
      badgeClass = ''; // default success
      statusText = 'Completed';
    } else if (job.status === 'failed') {
      badgeClass = 'job-card-badge--failed';
      statusText = 'Failed';
    }
    badgeHtml = `<div class="job-card-badge ${badgeClass}">${statusText}</div>`;

    const thumbUrl = (job.status === 'completed' && job.result_url) ? job.result_url : (originalFile ? originalFile.url : '/images/placeholder.png');
    const originalGarmentUrl = originalFile ? originalFile.url : '';
    const modeLabel = modeLabels[job.generation_mode] || job.generation_mode;
    const modeTagHtml = `<div class="job-card-mode-tag">${modeLabel}</div>`;
    const platformTagHtml = `<div class="job-card-platform-tag">${currentExportPlatform.name} · ${currentExportPlatform.ratioLabel}</div>`;

    return `
      <div class="job-card" data-job-id="${job.id}">
        <div class="job-card-wrapper" style="position:relative;">
          <img src="${thumbUrl}" alt="${filename}" loading="lazy" class="job-card-img-main" />
          ${originalGarmentUrl ? `<img src="${originalGarmentUrl}" alt="Original Garment" loading="lazy" class="job-card-img-before" />` : ''}

          ${originalGarmentUrl && job.status === 'completed' ? `
            <button class="job-card-compare-pill btn-toggle-compare" data-job-id="${job.id}" title="Toggle raw garment / AI result">
              🔄 Compare
            </button>
          ` : ''}

          ${modeTagHtml}
          ${platformTagHtml}

          ${job.status === 'completed' && thumbUrl ? `
            <button class="asset-card-preview-btn btn-job-preview" data-url="${thumbUrl}" data-title="${filename}" title="Preview full image">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          ` : ''}
        </div>
        ${badgeHtml}
        <div class="job-card-footer">
          <span class="job-card-filename" title="${filename}">${filename}</span>
          <button class="job-card-btn btn-download-selected" data-url="${job.result_url}" data-filename="${filename}" ${job.status !== 'completed' ? 'disabled' : ''}>
            Download
          </button>
        </div>
      </div>
    `;
  }).join('');

  const gridRatioClass = `job-outlets-grid--ratio-${currentExportPlatform.ratio.replace(':', 'x')}`;

  const floatingBarHtml = `
    <div class="results-floating-action-bar${selectedJobIds.length > 0 ? ' visible' : ''}" id="results-floating-bar">
      <div class="floating-bar-info">
        <span class="floating-bar-badge">${selectedJobIds.length}</span>
        <span>images selected</span>
      </div>
      <button class="floating-bar-btn floating-bar-btn--download" id="btn-download-bulk-selected">
        📥 Download (${currentExportPlatform.name})
      </button>
      <button class="floating-bar-btn floating-bar-btn--clear" id="btn-clear-bulk-selected">
        Clear
      </button>
    </div>
  `;

  return `
    <div class="batch-grid-container">
      <div class="batch-overview-card">
        <div class="batch-overview-header">
          <div class="batch-overview-title">
            <h1>Batch: ${name || 'Bulk Generation'}</h1>
            <p>ID: ${id}</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="batch-btn batch-btn--secondary" id="btn-batch-back-workspace">
              Back to Workspace
            </button>
          </div>
        </div>
        
        <div class="batch-overview-status">
          <span>Overall Batch Status: <strong style="${isTerminal ? (status === 'completed' ? 'color:#10b981;' : 'color:#ef4444;') : 'color:#7c3aed;'}">${status.toUpperCase()}</strong></span>
          <span>${progressPercent}% Complete</span>
        </div>
        
        <div class="batch-progress-track">
          <div class="batch-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
        
        <div class="batch-overview-stats">
          <span>Total: <span>${total_jobs}</span></span>
          <span>Completed: <span>${completed_jobs}</span></span>
          <span class="${failed_jobs > 0 ? 'failed' : ''}">Failed: <span>${failed_jobs}</span></span>
        </div>
      </div>

      <!-- ─── Smart Marketplace Export Hub ─── -->
      <div class="smart-export-hub">
        <div class="smart-export-hub__header">
          <div class="smart-export-hub__title-wrap">
            <span class="smart-export-hub__badge">Smart Marketplace Export</span>
            <h2>Export & Multi-Channel Download</h2>
            <p>Select target platform presets and resolution tier for single-click formatted downloads.</p>
          </div>
          <div class="smart-export-hub__actions">
            <button class="export-hub-btn export-hub-btn--bundle" id="btn-export-bundle-zip" ${completed_jobs === 0 ? 'disabled' : ''}>
              📦 Multi-Platform Bundle ZIP
            </button>
            <button class="export-hub-btn export-hub-btn--primary" id="btn-export-platform-zip-hero" ${completed_jobs === 0 ? 'disabled' : ''}>
              📥 Download for ${currentExportPlatform.name} (ZIP)
            </button>
          </div>
        </div>

        <div class="smart-export-hub__controls">
          <!-- Marketplace Selection Tabs -->
          <div class="export-platform-tabs">
            ${marketplacePlatforms.map(p => `
              <button class="export-platform-tab${p.id === activeExportPlatformId ? ' active' : ''}" data-export-platform="${p.id}">
                <span class="export-platform-tab__icon">${p.icon}</span>
                <span class="export-platform-tab__name">${p.name}</span>
                <span class="export-platform-tab__dim">${p.dimensions[activeExportRes] || p.ratioLabel}</span>
              </button>
            `).join('')}
          </div>

          <!-- Plan-Based Resolution Display in Export Bar -->
          <div class="export-resolution-bar">
            <span class="export-resolution-label">Included Output Resolution:</span>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="export-res-tag ${resolutionTiers.find(r => r.id === activeExportRes)?.badgeClass || 'badge--biz'}" style="font-size:12px; font-weight:700; padding:4px 10px; border-radius:6px;">
                ✨ ${resolutionTiers.find(r => r.id === activeExportRes)?.name || '4K Master Studio'} (${activeExportRes.toUpperCase()})
              </span>
              ${activeExportRes === '1k' ? `<button class="export-res-btn btn-plan-upgrade-cta" style="font-size:11px; padding:4px 10px; color:#7c3aed; font-weight:600; border-color:#7c3aed; cursor:pointer;">⚡ Upgrade to Pro for 2K Ultra HD</button>` : ''}
              ${activeExportRes === '2k' ? `<button class="export-res-btn btn-plan-upgrade-cta" style="font-size:11px; padding:4px 10px; color:#92400e; font-weight:600; border-color:#f59e0b; cursor:pointer;">👑 Upgrade to Business for 4K Master Studio</button>` : ''}
              ${activeExportRes === '4k' ? `<span style="font-size:11px; color:#10b981; font-weight:600; background:rgba(16,185,129,0.1); padding:3px 8px; border-radius:4px; border:1px solid rgba(16,185,129,0.2);">👑 Max Studio Quality Unlocked</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="job-outlets-section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h2>Generated Visuals (${filteredJobs.length})</h2>
        </div>
        ${filterTabsHtml}
        <div class="job-outlets-grid ${gridRatioClass}">
          ${jobCardsHtml}
        </div>
      </div>
    </div>

    <!-- Image Modal for Batch Progress High-Res Preview -->
    <div class="image-modal" id="image-modal">
      <div class="image-modal__content">
        <button class="image-modal__close" id="modal-close" title="Close Preview">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <img class="image-modal__img" id="modal-img" src="" alt="Preview" />
      </div>
    </div>
  `;
}

function switchToEditView(imageObj) {
  appState.editState.image = imageObj;
  navigateToRoute('edit', true);
}

function startPollingBatch(batchId) {
  if (appState.batchState.pollingInterval) {
    clearInterval(appState.batchState.pollingInterval);
  }

  appState.batchState.batchId = batchId;
  appState.batchState.view = 'progress';

  const pageContent = document.getElementById('page-content');
  if (pageContent) {
    pageContent.className = 'content content--batch';
    pageContent.innerHTML = renderBatchProgress();
  }

  async function poll() {
    try {
      const data = await apiFetch(`/batches/${batchId}`);
      batchDetailData = data;

      if (pageContent && appState.batchState.view === 'progress') {
        pageContent.innerHTML = renderBatchProgress();
      }

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(appState.batchState.pollingInterval);
        appState.batchState.pollingInterval = null;
        await syncUserProfile(); // sync credit deductions
      }
    } catch (err) {
      console.error('Error polling batch', err);
    }
  }

  poll();
  appState.batchState.pollingInterval = setInterval(poll, 2000);
}

// ─── Admin Dashboard View ───
let adminLogs = [];
let adminCosts = null;
let currentFilters = {
  actor_id: '',
  action: '',
  resource_type: '',
  limit: 50,
  offset: 0
};

let adminActiveTab = 'users'; // 'users', 'prompts', 'spend', 'audit', 'waitlist'
let adminUsersList = [];
let adminUsersTotal = 0;
let adminStats = null;
let adminUserSearch = '';
let adminUserLimit = 15;
let adminUserOffset = 0;

let adminPromptsList = [];
let adminSelectedPromptName = null;
let adminProvidersList = [];
let adminPricingsList = [];

// Waitlist admin state
let adminWaitlistEntries = [];
let adminWaitlistTotal = 0;
let adminWaitlistCounts = [];
let adminWaitlistFilter = '';
let adminWaitlistEmailSearch = '';
let adminWaitlistLimit = 15;
let adminWaitlistOffset = 0;

// Admin Financials & Revenue State
let adminFinancials = null;
let adminRevenueSearch = '';
let adminRevenueTypeFilter = 'all';
let adminRevenueLimit = 5;
let adminRevenueOffset = 0;
let adminFailedJobs = [];
let adminFailedJobsTotal = 0;
let adminPlansData = { plans: [], credit_packs: [] };

function renderTabContentHtml() {
  if (adminActiveTab === 'users') {
    return `


      <div class="admin-custom-stats-grid">
        <!-- Card 1 -->
        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background: #eef2ff; color: #4f46e5;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Total Users</span>
            <span class="admin-custom-stat-value">${(adminStats?.total_users ?? 0).toLocaleString()}</span>
          </div>
        </div>

        <!-- Card 2 -->
        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background: #4f46e5; color: #ffffff;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="7"></circle>
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
            </svg>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Active Pro Plans</span>
            <span class="admin-custom-stat-value">${(adminStats?.active_pro_plans ?? 0).toLocaleString()}</span>
          </div>
        </div>

        <!-- Card 3 -->
        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background: #f1f5f9; color: #334155;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
              <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Avg. Credits</span>
            <span class="admin-custom-stat-value">
              ${(() => {
        const avg = adminStats?.avg_credits ?? 0;
        return avg >= 1000 ? (avg / 1000).toFixed(1) + 'k' : avg.toFixed(1);
      })()}
            </span>
          </div>
        </div>

        <!-- Card 4 -->
        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background: #fdf4ff; color: #c026d3;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Enterprise Plans</span>
            <span class="admin-custom-stat-value">${(adminStats?.enterprise_plans ?? 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div class="admin-card">
        <!-- Control Bar -->
        <div class="admin-control-bar">
          <div class="admin-control-buttons">
            <button class="admin-control-btn" id="btn-admin-export-csv">Export CSV</button>
            <button class="admin-control-btn" id="btn-admin-filter">Filter</button>
          </div>
          <div class="admin-search-box">
            <span class="admin-search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input type="text" id="admin-user-search-input" placeholder="Search users by email or ID..." value="${adminUserSearch}" />
          </div>
        </div>

        <!-- Table Container -->
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>EMAIL</th>
                <th>ROLE</th>
                <th>SUBSCRIPTION PLAN</th>
                <th>CREDITS</th>
                <th>PURCHASED ON</th>
                <th>EXPIRES / RENEWS</th>
                <th>REGISTERED</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${adminUsersList.map(user => {
        const tierLabels = {
          'free': 'Free Plan',
          'creator_lite': 'Starter (₹699)',
          'brand_pro': 'Pro (₹1,999)',
          'enterprise_studio': 'Business (₹5,999)'
        };
        const profile = user.profile || {};
        const isPaid = profile.subscription_tier && profile.subscription_tier !== 'free';
        const displayTier = tierLabels[profile.subscription_tier] || 'Free Plan';

        // Format dates as DD/MM/YYYY
        const formatDate = (isoStr) => {
          if (!isoStr) return '—';
          const d = new Date(isoStr);
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = d.getFullYear();
          return `${day}/${month}/${year}`;
        };

        const createdDate = formatDate(user.created_at);
        const purchasedDate = formatDate(profile.subscription_period_start);
        const expiryDate = formatDate(profile.subscription_period_end);

        // Check if subscription has expired
        let expiryBadge = '';
        if (isPaid && profile.subscription_period_end) {
          const isExpired = new Date(profile.subscription_period_end) < new Date();
          expiryBadge = isExpired 
            ? `<div style="font-size:10px; color:#ef4444; font-weight:700;">⚠️ Expired</div>`
            : `<div style="font-size:10px; color:#10b981; font-weight:700;">● Active</div>`;
        }

        const creditsStr = (profile.credit_balance ?? 0).toLocaleString();

        return `
                  <tr>
                    <td><span class="admin-user-email" title="${user.email}">${user.email || 'No email'}</span></td>
                    <td>
                      <span class="admin-badge ${user.role === 'admin' ? 'admin-badge--success' : 'admin-badge--info'}">
                        ${user.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td>
                      <span class="export-res-tag ${isPaid ? 'badge--pro' : 'badge--starter'}" style="padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">
                        ${displayTier}
                      </span>
                    </td>
                    <td><span class="admin-user-credits" style="font-weight:700;">${creditsStr}</span></td>
                    <td><span style="font-size:12px; color:#475569;">${purchasedDate}</span></td>
                    <td>
                      <div style="font-size:12px; color:#0f172a; font-weight:600;">${expiryDate}</div>
                      ${expiryBadge}
                    </td>
                    <td><span style="font-size:12px; color:#64748b;">${createdDate}</span></td>
                    <td>
                      <div style="display:flex; gap:8px; align-items:center;">
                        <button class="admin-table-action-btn admin-table-action-btn--primary btn-adjust-credits" data-user-id="${user.id}" data-email="${user.email}">
                          Credits
                        </button>
                        <button class="admin-table-action-btn btn-change-plan-mock" data-user-id="${user.id}" data-email="${user.email}" data-tier="${profile.subscription_tier || 'free'}">
                          Change Plan
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
      }).join('')}
              ${adminUsersList.length === 0 ? '<tr><td colspan="8" style="text-align:center; padding:32px; color:#94a3b8;">No users found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <!-- Pagination Footer -->
        ${(() => {
        const startNum = adminUsersTotal === 0 ? 0 : adminUserOffset + 1;
        const endNum = Math.min(adminUserOffset + adminUserLimit, adminUsersTotal);
        const totalPages = Math.ceil(adminUsersTotal / adminUserLimit);
        const currentPage = Math.floor(adminUserOffset / adminUserLimit) + 1;

        let pageButtonsHtml = '';
        if (totalPages > 1) {
          pageButtonsHtml += `
              <button class="admin-pagination-page-btn" id="btn-admin-users-prev-arrow" ${currentPage === 1 ? 'disabled' : ''}>
                &lt;
              </button>
            `;

          const range = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) range.push(i);
          } else {
            range.push(1);
            if (currentPage > 4) {
              range.push('...');
            }

            const start = Math.max(2, currentPage - 1);
            const end = Math.min(totalPages - 1, currentPage + 1);
            for (let i = start; i <= end; i++) {
              if (!range.includes(i)) range.push(i);
            }

            if (currentPage < totalPages - 3) {
              range.push('...');
            }
            range.push(totalPages);
          }

          range.forEach(p => {
            if (p === '...') {
              pageButtonsHtml += `<span style="color:#94a3b8; font-size:13px; font-weight:600; padding:0 4px;">...</span>`;
            } else {
              pageButtonsHtml += `
                  <button class="admin-pagination-page-btn ${p === currentPage ? 'admin-pagination-page-btn--active' : ''} btn-admin-users-page-num" data-page="${p}">
                    ${p}
                  </button>
                `;
            }
          });

          pageButtonsHtml += `
              <button class="admin-pagination-page-btn" id="btn-admin-users-next-arrow" ${currentPage === totalPages ? 'disabled' : ''}>
                &gt;
              </button>
            `;
        }

        return `
            <div class="admin-custom-pagination">
              <div class="admin-pagination-text">
                Showing ${startNum} to ${endNum} of ${adminUsersTotal.toLocaleString()} results
              </div>
              <div class="admin-pagination-controls">
                ${pageButtonsHtml}
              </div>
            </div>
          `;
      })()}
      </div>
    `;
  }

  if (adminActiveTab === 'prompts') {
    const selectedTemplate = adminPromptsList.find(t => t.name === adminSelectedPromptName);
    const versions = selectedTemplate ? selectedTemplate.versions || [] : [];
    versions.sort((a, b) => b.version - a.version);

    return `
      <div class="admin-main-grid" style="grid-template-columns: 1fr 2fr;">
        <!-- Left Pane: Templates List -->
        <div class="admin-card">
          <div class="admin-card-header">
            <span class="admin-card-title">Templates</span>
            <button class="admin-control-btn" id="btn-admin-create-template" style="font-size: 12px; padding: 4px 8px;">+ New</button>
          </div>
          <div style="display:flex; flex-direction:column; padding:var(--space-2); gap:4px;">
            ${adminPromptsList.map(t => `
              <button class="admin-prompt-list-item ${adminSelectedPromptName === t.name ? 'active' : ''}" data-prompt-name="${t.name}">
                <div class="icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                </div>
                <div class="details">
                  <span class="name">${t.name.replace(/_/g, ' ')}</span>
                  <span class="count">${t.versions?.length || 0} versions</span>
                </div>
              </button>
            `).join('')}
            ${adminPromptsList.length === 0 ? '<p style="padding:var(--space-4); text-align:center; color:var(--color-gray-400);">No templates created.</p>' : ''}
          </div>
        </div>

        <!-- Right Pane: Versions & Editor -->
        <div class="admin-card">
          ${selectedTemplate ? `
            <div class="admin-card-header">
              <div>
                <span class="admin-card-title">${selectedTemplate.name}</span>
                <p style="margin:2px 0 0 0; font-size:12px; color:var(--color-gray-400);">${selectedTemplate.description || 'No description'}</p>
              </div>
            </div>
            
            <div style="padding:var(--space-5); display:flex; flex-direction:column; gap:var(--space-5);">
              <!-- Add new version -->
              <div class="admin-form-group">
                <label>Add New Version (Template variables like {style} supported)</label>
                <textarea id="prompt-new-version-content" rows="4" class="admin-modal-input" placeholder="A premium photo of a model wearing {clothing}..."></textarea>
                <button class="process-action-btn" id="btn-admin-prompt-add-version" style="margin-top:var(--space-2); align-self:flex-end; padding:8px var(--space-4);">
                  Save Version
                </button>
              </div>

              <!-- Versions History -->
              <div>
                <h4 style="font-size:12px; text-transform:uppercase; color:var(--color-gray-400); margin-bottom:var(--space-3);">Version History (Latest is active)</h4>
                <div class="admin-prompt-versions-container">
                  ${versions.map(v => `
                    <div class="admin-prompt-version-row">
                      <div style="min-width: 80px;">
                        <strong>v${v.version}</strong>
                        <div style="font-size:10px; color:var(--color-gray-400);">${new Date(v.created_at).toLocaleDateString()}</div>
                      </div>
                      <div class="admin-prompt-version-text">${v.content}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : `
            <div style="padding:var(--space-6); text-align:center; color:var(--color-gray-400);">
              Select a template to view versions or create new templates.
            </div>
          `}
        </div>
      </div>
    `;
  }

  if (adminActiveTab === 'spend') {
    return `
      <!-- Costs Metric Dashboard -->
      <div class="admin-stats-grid" style="margin-bottom:var(--space-6);">
        <div class="admin-stat-card">
          <span class="admin-stat-label">Total API Spend</span>
          <span class="admin-stat-value">$${adminCosts.overall.total_cost.toFixed(4)}</span>
          <span class="admin-stat-desc">Accumulated spend across strategy requests</span>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Average Strategy Latency</span>
          <span class="admin-stat-value">${(adminCosts.overall.average_latency_ms / 1000).toFixed(2)}s</span>
          <span class="admin-stat-desc">Execution time average</span>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Success Rate</span>
          <span class="admin-stat-value">${(adminCosts.overall.success_count / (adminCosts.overall.total_requests || 1) * 100).toFixed(1)}%</span>
          <span class="admin-stat-desc">${adminCosts.overall.success_count} success / ${adminCosts.overall.failed_count} failed requests</span>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Total API Calls</span>
          <span class="admin-stat-value">${adminCosts.overall.total_requests}</span>
          <span class="admin-stat-desc">Inbound/Outbound request count</span>
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-header">
          <span class="admin-card-title">Provider & Model Spend</span>
        </div>
        <div class="provider-list">
          ${adminCosts.by_provider_model.map(modelGroup => `
            <div class="provider-row">
              <div>
                <span class="provider-name">${modelGroup.model || 'model'}</span>
                <div style="font-size:10px; color:var(--color-gray-400); text-transform:uppercase;">${modelGroup.provider_name}</div>
              </div>
              <div class="provider-details">
                <span class="provider-cost">$${modelGroup.cost.toFixed(5)}</span>
                <span class="provider-reqs">${modelGroup.request_count} requests (${modelGroup.success_count} OK / ${modelGroup.failed_count} ERR)</span>
              </div>
            </div>
          `).join('')}
          ${adminCosts.by_provider_model.length === 0 ? '<div style="text-align:center; color:var(--color-gray-400); padding:var(--space-4);">No model costs tracked yet.</div>' : ''}
        </div>
      </div>
    `;
  }

  if (adminActiveTab === 'audit') {
    return `
      <div class="admin-card">
        <div class="admin-card-header">
          <span class="admin-card-title">Immutable Audit Trail</span>
        </div>
        
        <div class="admin-filters">
          <input type="text" id="filter-actor" class="admin-filter-input" placeholder="Filter Actor UUID" value="${currentFilters.actor_id}" />
          <input type="text" id="filter-action" class="admin-filter-input" placeholder="Action (e.g. job.completed)" value="${currentFilters.action}" />
          <input type="text" id="filter-resource" class="admin-filter-input" placeholder="Resource Type" value="${currentFilters.resource_type}" />
          <button class="process-action-btn" id="btn-admin-filter-apply" style="padding: 8px var(--space-4);">Apply</button>
          <button class="prompt-ratio-btn" id="btn-admin-filter-clear" style="padding: 8px var(--space-4); border:1px solid var(--color-gray-300);">Reset</button>
        </div>

        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor ID</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Resource ID</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              ${adminLogs.map(log => {
      let actionBadge = '';
      if (log.action.includes('fail') || log.action.includes('exceed')) {
        actionBadge = `<span class="admin-badge admin-badge--error">${log.action}</span>`;
      } else if (log.action.includes('complete')) {
        actionBadge = `<span class="admin-badge admin-badge--success">${log.action}</span>`;
      } else {
        actionBadge = `<span class="admin-badge admin-badge--info">${log.action}</span>`;
      }

      return `
                  <tr>
                    <td>${new Date(log.created_at).toLocaleTimeString()}</td>
                    <td title="${log.actor_id || ''}">${log.actor_id ? log.actor_id.substring(0, 8) + '...' : 'System'}</td>
                    <td>${actionBadge}</td>
                    <td>${log.resource_type}</td>
                    <td title="${log.resource_id || ''}">${log.resource_id ? log.resource_id.substring(0, 8) + '...' : '-'}</td>
                    <td>${log.ip_address || '-'}</td>
                  </tr>
                `;
    }).join('')}
              ${adminLogs.length === 0 ? '<tr><td colspan="6" style="text-align:center; padding:var(--space-6); color:var(--color-gray-400);">No audit logs found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        <div class="admin-filters" style="justify-content:space-between; align-items:center;">
          <button class="admin-action-btn" id="btn-admin-logs-prev" ${currentFilters.offset === 0 ? 'disabled' : ''}>Previous</button>
          <span style="font-size:12px; color:var(--color-gray-500);">Page ${(currentFilters.offset / currentFilters.limit) + 1}</span>
          <button class="admin-action-btn" id="btn-admin-logs-next" ${adminLogs.length < currentFilters.limit ? 'disabled' : ''}>Next</button>
        </div>
    `;
  }

  if (adminActiveTab === 'models') {
    return `
      <div class="admin-card">
        <div class="admin-card-header">
          <span class="admin-card-title">AI Provider & Model Configurations</span>
        </div>
        <div style="padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4);">
          <p style="font-size: 13px; color: var(--color-gray-500); margin: 0 0 var(--space-2) 0; line-height: 1.5;">
            Granularly enable or disable AI models used in the generation pipeline. 
            Note: Provider API keys are configured via server-side environment variables (.env).
          </p>
          <div class="provider-list" style="display: flex; flex-direction: column; gap: var(--space-3);">
            ${(adminProvidersList || []).map(provider => {
              const displayName = provider.provider_name.toUpperCase();
              const isEnabled = provider.is_enabled;
              const isConfigured = provider.is_configured;
              
              let configBadge = '';
              if (isConfigured) {
                configBadge = `<span class="admin-badge admin-badge--success" style="font-size: 10px; margin-left: 8px;">Configured</span>`;
              } else {
                configBadge = `<span class="admin-badge admin-badge--error" style="font-size: 10px; margin-left: 8px;" title="API key is missing in server environment variables">Missing API Key</span>`;
              }

              return `
                <div class="provider-row" style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) 0; border-bottom: 1px solid var(--border-color);">
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center;">
                      <span class="provider-name" style="font-weight: 600; color: var(--color-gray-900); font-size: 14px;">${displayName}</span>
                      ${configBadge}
                    </div>
                    <span style="font-size: 12px; color: var(--color-gray-500); line-height: 1.4;">
                      ${provider.provider_name === 'grok' ? 'X.AI Grok provider for high-quality product photography.' : ''}
                      ${provider.provider_name === 'openai' ? 'OpenAI DALL-E image generation strategies.' : ''}
                      ${provider.provider_name === 'gemini' ? 'Google Gemini 3.1 Flash & Flash-Lite multimodal imaging.' : ''}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; justify-content: center;">
                    <label class="admin-toggle-switch">
                      <input type="checkbox" class="admin-provider-toggle" data-provider="${provider.provider_name}" ${isEnabled ? 'checked' : ''} ${!isConfigured ? 'disabled' : ''} />
                      <span class="admin-toggle-slider"></span>
                    </label>
                  </div>
                </div>
              `;
            }).join('')}
            ${(!adminProvidersList || adminProvidersList.length === 0) ? '<div style="text-align:center; color:var(--color-gray-400); padding:var(--space-6);">No providers loaded.</div>' : ''}
          </div>
        </div>
      </div>

      <div class="admin-card" style="margin-top: var(--space-6);">
        <div class="admin-card-header">
          <span class="admin-card-title">Model Resolution & Pricing Settings</span>
        </div>
        <div style="padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4);">
          <p style="font-size: 13px; color: var(--color-gray-500); margin: 0 0 var(--space-2) 0; line-height: 1.5;">
            Configure dynamic pricing rates and resolution maps per subscription tier for each model.
          </p>
          
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>MODEL</th>
                  <th>PROVIDER</th>
                  <th>TOKEN RATES / USD</th>
                  <th>RESOLUTIONS (SQ / LS / PT)</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${(adminPricingsList || []).map(pricing => {
                  const data = pricing.pricing_data || {};
                  const rates = data.token_rates || {};
                  
                  let ratesHtml = '';
                  if (pricing.provider_name === 'openai') {
                    ratesHtml = `
                      <div style="font-size: 11px; line-height:1.4;">
                        Image Input: $${(rates.input_image * 1000000).toFixed(2)}/1M<br/>
                        Text Input: $${(rates.input_text * 1000000).toFixed(2)}/1M<br/>
                        Image Output: $${(rates.output_image * 1000000).toFixed(2)}/1M
                      </div>
                    `;
                  } else if (pricing.provider_name === 'gemini') {
                    ratesHtml = `
                      <div style="font-size: 11px; line-height:1.4;">
                        Input Token: $${(rates.input_token * 1000000).toFixed(2)}/1M<br/>
                        Output Token: $${(rates.output_token * 1000000).toFixed(2)}/1M
                      </div>
                    `;
                  } else {
                    ratesHtml = `<span style="color: var(--color-gray-400);">Legacy fixed rates</span>`;
                  }

                  const res = data.resolutions || {};
                  const enterprise = res.enterprise_studio || {};
                  const brandpro = res.brand_pro || {};
                  const free = res.free || {};

                  const resHtml = `
                    <div style="font-size: 11px; line-height:1.4;">
                      <strong>Enterprise (4K):</strong> ${enterprise.square || 'N/A'} / ${enterprise.landscape || 'N/A'} / ${enterprise.portrait || 'N/A'}<br/>
                      <strong>Brand Pro (2K):</strong> ${brandpro.square || 'N/A'} / ${brandpro.landscape || 'N/A'} / ${brandpro.portrait || 'N/A'}<br/>
                      <strong>Free/Lite (1K):</strong> ${free.square || 'N/A'} / ${free.landscape || 'N/A'} / ${free.portrait || 'N/A'}
                    </div>
                  `;

                  return `
                    <tr>
                      <td style="font-weight: 600; font-size:13px; color: var(--color-primary);">${pricing.model_name}</td>
                      <td><span class="admin-badge admin-badge--info">${pricing.provider_name.toUpperCase()}</span></td>
                      <td>${ratesHtml}</td>
                      <td>${resHtml}</td>
                      <td>
                        <button class="admin-table-action-btn admin-table-action-btn--primary btn-edit-model-pricing" data-model="${pricing.model_name}">
                          Configure
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
                ${(!adminPricingsList || adminPricingsList.length === 0) ? '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--color-gray-400);">No model settings loaded.</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
  if (adminActiveTab === 'waitlist') {
    const categoryLabels = {
      jewelry: 'Jewelry Photography',
      food_beverage: 'Food & Beverage',
      electronics: 'Electronics',
      furniture: 'Furniture & Home',
      beauty_cosmetics: 'Beauty & Cosmetics',
      automotive: 'Automotive Parts',
    };

    const countsHtml = (adminWaitlistCounts || []).map(c => `
      <div class="admin-custom-stat-card">
        <div class="admin-custom-stat-info">
          <span class="admin-custom-stat-label">${categoryLabels[c.category] || c.category}</span>
          <span class="admin-custom-stat-value">${c.count}</span>
        </div>
      </div>
    `).join('');

    const tableRows = (adminWaitlistEntries || []).map(entry => `
      <tr>
        <td style="font-weight: 500;">${entry.name}</td>
        <td>${entry.email}</td>
        <td>${entry.business_name || '<span style="color: var(--color-gray-400);">—</span>'}</td>
        <td><span class="admin-badge admin-badge--info">${categoryLabels[entry.category] || entry.category}</span></td>
        <td style="font-size: 12px; color: var(--color-gray-500);">${new Date(entry.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      </tr>
    `).join('');

    const totalPages = Math.ceil(adminWaitlistTotal / adminWaitlistLimit);
    const currentPage = Math.floor(adminWaitlistOffset / adminWaitlistLimit) + 1;

    return `
      <div style="margin-bottom: var(--space-4);">
        <div class="admin-custom-stats-grid">
          ${countsHtml}
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-header">
          <span class="admin-card-title">Waitlist Entries (${adminWaitlistTotal})</span>
          <div style="display: flex; gap: var(--space-2); align-items: center;">
            <select class="admin-filter-select" id="admin-waitlist-category-filter">
              <option value="">All Categories</option>
              <option value="jewelry" ${adminWaitlistFilter === 'jewelry' ? 'selected' : ''}>Jewelry</option>
              <option value="food_beverage" ${adminWaitlistFilter === 'food_beverage' ? 'selected' : ''}>Food & Beverage</option>
              <option value="electronics" ${adminWaitlistFilter === 'electronics' ? 'selected' : ''}>Electronics</option>
              <option value="furniture" ${adminWaitlistFilter === 'furniture' ? 'selected' : ''}>Furniture</option>
              <option value="beauty_cosmetics" ${adminWaitlistFilter === 'beauty_cosmetics' ? 'selected' : ''}>Beauty & Cosmetics</option>
              <option value="automotive" ${adminWaitlistFilter === 'automotive' ? 'selected' : ''}>Automotive</option>
            </select>
            <input type="text" class="admin-filter-input" id="admin-waitlist-email-search" placeholder="Search email..." value="${adminWaitlistEmailSearch}" style="max-width: 200px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 12px;" />
            <button class="admin-action-btn" id="btn-admin-waitlist-export" style="font-size: 12px; padding: 6px 12px;">Export CSV</button>
          </div>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Business</th>
                <th>Category</th>
                <th>Signed Up</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
              ${adminWaitlistEntries.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--color-gray-400);">No waitlist entries found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border-color);">
          <button class="admin-action-btn" id="btn-admin-waitlist-prev" ${adminWaitlistOffset === 0 ? 'disabled' : ''}>Previous</button>
          <span style="font-size:12px; color:var(--color-gray-500);">Page ${currentPage} of ${totalPages || 1}</span>
          <button class="admin-action-btn" id="btn-admin-waitlist-next" ${adminWaitlistEntries.length < adminWaitlistLimit ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `;
  }

  // ─── Revenue & Financials Tab ───
  if (adminActiveTab === 'revenue') {
    const fin = adminFinancials || {
      mrr_inr: 0,
      topup_revenue_inr: 0,
      total_revenue_inr: 0,
      total_paid_subscribers: 0,
      plans_breakdown: {
        starter: { count: 0, price_inr: 699, total_inr: 0 },
        pro: { count: 0, price_inr: 1999, total_inr: 0 },
        business: { count: 0, price_inr: 5999, total_inr: 0 },
        free: { count: 0 }
      },
      recent_transactions: [],
      total_visuals_processed: 0,
      gross_margin_pct: 63.4
    };

    const allTxs = fin.recent_transactions || [];

    // Filter transactions
    const filteredTxs = allTxs.filter(tx => {
      const matchType = adminRevenueTypeFilter === 'all' || tx.type === adminRevenueTypeFilter;
      const q = adminRevenueSearch.toLowerCase();
      const matchSearch = !q ||
        (tx.invoice_id && tx.invoice_id.toLowerCase().includes(q)) ||
        (tx.user_email && tx.user_email.toLowerCase().includes(q)) ||
        (tx.description && tx.description.toLowerCase().includes(q)) ||
        (tx.payment_id && tx.payment_id.toLowerCase().includes(q));
      return matchType && matchSearch;
    });

    const totalTxCount = filteredTxs.length;
    const currentTxPage = Math.floor(adminRevenueOffset / adminRevenueLimit) + 1;
    const totalTxPages = Math.max(1, Math.ceil(totalTxCount / adminRevenueLimit));
    const paginatedTxs = filteredTxs.slice(adminRevenueOffset, adminRevenueOffset + adminRevenueLimit);

    return `
      <div class="admin-custom-stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background:#ecfdf5; color:#10b981;">
            <span style="font-size:20px; font-weight:800;">₹</span>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Total Collections</span>
            <span class="admin-custom-stat-value">₹${(fin.total_revenue_inr || fin.mrr_inr).toLocaleString()}</span>
          </div>
        </div>

        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background:#eef2ff; color:#4f46e5;">
            <span style="font-size:18px;">📅</span>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Subscription MRR</span>
            <span class="admin-custom-stat-value">₹${fin.mrr_inr.toLocaleString()}</span>
          </div>
        </div>

        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background:#faf5ff; color:#7c3aed;">
            <span style="font-size:18px;">🪙</span>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Top-Up Revenue</span>
            <span class="admin-custom-stat-value">₹${(fin.topup_revenue_inr || 0).toLocaleString()}</span>
          </div>
        </div>

        <div class="admin-custom-stat-card">
          <div class="admin-custom-stat-icon-wrapper" style="background:#fffbeb; color:#d97706;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          </div>
          <div class="admin-custom-stat-info">
            <span class="admin-custom-stat-label">Paid Subscribers</span>
            <span class="admin-custom-stat-value">${fin.total_paid_subscribers}</span>
          </div>
        </div>
      </div>

      <div class="admin-card" style="margin-bottom: 24px;">
        <div class="admin-card-header">
          <span class="admin-card-title">Subscription Tier MRR Breakdown</span>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Plan Tier</th>
                <th>Monthly Price (₹)</th>
                <th>Active Subscribers</th>
                <th>Monthly Run Rate (₹)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>📦 Starter Plan</strong></td>
                <td>₹699 / mo</td>
                <td>${fin.plans_breakdown.starter.count}</td>
                <td><strong style="color:#0f172a;">₹${fin.plans_breakdown.starter.total_inr.toLocaleString()}</strong></td>
                <td><span class="admin-badge admin-badge--success">Active</span></td>
              </tr>
              <tr>
                <td><strong>✨ Pro Plan</strong></td>
                <td>₹1,999 / mo</td>
                <td>${fin.plans_breakdown.pro.count}</td>
                <td><strong style="color:#0f172a;">₹${fin.plans_breakdown.pro.total_inr.toLocaleString()}</strong></td>
                <td><span class="admin-badge admin-badge--success">Active</span></td>
              </tr>
              <tr>
                <td><strong>👑 Business Plan</strong></td>
                <td>₹5,999 / mo</td>
                <td>${fin.plans_breakdown.business.count}</td>
                <td><strong style="color:#0f172a;">₹${fin.plans_breakdown.business.total_inr.toLocaleString()}</strong></td>
                <td><span class="admin-badge admin-badge--success">Active</span></td>
              </tr>
              <tr>
                <td><strong>🌱 Free Tier Trial</strong></td>
                <td>₹0 / mo</td>
                <td>${fin.plans_breakdown.free.count}</td>
                <td>₹0</td>
                <td><span class="admin-badge" style="background:#f1f5f9; color:#64748b;">Free Trial</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <span class="admin-card-title">Payment & Financial Activity Ledger</span>
            <div style="font-size:12px; color:#64748b; margin-top:2px;">Complete audit trail of all real-money payment receipts</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <select id="admin-revenue-type-filter" class="form-input" style="width:160px; font-size:12px; padding:6px 10px; border-radius:6px;">
              <option value="all" ${adminRevenueTypeFilter === 'all' ? 'selected' : ''}>All Transactions</option>
              <option value="subscription" ${adminRevenueTypeFilter === 'subscription' ? 'selected' : ''}>📅 Subscriptions</option>
              <option value="topup" ${adminRevenueTypeFilter === 'topup' ? 'selected' : ''}>🪙 Credit Top-Ups</option>
            </select>
            <div class="admin-search-input-wrapper" style="width: 220px;">
              <svg class="admin-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                id="admin-revenue-search-input"
                class="admin-search-input"
                style="padding:6px 10px 6px 30px; font-size:12px;"
                placeholder="Search email or invoice..."
                value="${escapeHtml(adminRevenueSearch)}"
              />
            </div>
          </div>
        </div>

        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>INVOICE / ID</th>
                <th>CUSTOMER</th>
                <th>TYPE</th>
                <th>DESCRIPTION</th>
                <th>AMOUNT (₹)</th>
                <th>CREDITS</th>
                <th>DATE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${paginatedTxs.length === 0 ? `
                <tr>
                  <td colspan="9" style="text-align:center; padding:32px; color:#94a3b8;">
                    No payment transactions matching your filter.
                  </td>
                </tr>
              ` : paginatedTxs.map(tx => `
                <tr>
                  <td>
                    <span style="font-family:monospace; font-weight:700; font-size:11px; color:#0f172a; background:#f8fafc; border:1px solid #e2e8f0; padding:2px 6px; border-radius:4px;">
                      ${tx.invoice_id || tx.id}
                    </span>
                  </td>
                  <td>
                    <div class="admin-user-email" style="font-weight:600;">${tx.user_email || 'Customer'}</div>
                    ${tx.payment_id ? `<div style="font-size:10px; color:#94a3b8; font-family:monospace;">${tx.payment_id}</div>` : ''}
                  </td>
                  <td>
                    <span class="admin-badge ${tx.type === 'topup' ? 'admin-badge--info' : 'admin-badge--success'}">
                      ${tx.type === 'topup' ? '🪙 Top-Up' : '📅 Subscription'}
                    </span>
                  </td>
                  <td style="color:#334155; font-size:12px;">${tx.description || 'Service Charge'}</td>
                  <td><strong style="color:#0f172a; font-size:13px;">₹${(tx.amount_inr || 0).toLocaleString()}</strong></td>
                  <td><span class="admin-user-credits" style="font-weight:700;">+${(tx.credits_granted || 0).toLocaleString()}</span></td>
                  <td><span style="font-size:12px; color:#64748b;">${tx.date || 'Recent'}</span></td>
                  <td><span class="admin-badge admin-badge--success">✓ ${tx.status || 'Paid'}</span></td>
                  <td>
                    <button
                      class="admin-table-action-btn btn-view-invoice"
                      data-invoice-id="${tx.invoice_id || tx.id}"
                      data-email="${tx.user_email || ''}"
                      data-date="${tx.date || ''}"
                      data-desc="${tx.description || ''}"
                      data-amount="${tx.amount_inr || 0}"
                      style="font-size:11px; padding:4px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                      Receipt
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Revenue Ledger Pagination Footer -->
        <div class="admin-pagination">
          <span class="admin-pagination-text">
            Showing <strong>${totalTxCount === 0 ? 0 : adminRevenueOffset + 1}</strong> to <strong>${Math.min(adminRevenueOffset + adminRevenueLimit, totalTxCount)}</strong> of <strong>${totalTxCount}</strong> transactions
          </span>
          <div class="admin-pagination-controls">
            <button class="admin-pagination-page-btn" id="btn-admin-revenue-prev" ${currentTxPage === 1 ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="admin-pagination-pages">
              ${Array.from({ length: totalTxPages }, (_, i) => i + 1).map(p => `
                <button class="admin-pagination-page-btn ${p === currentTxPage ? 'admin-pagination-page-btn--active' : ''} btn-admin-revenue-page-num" data-page="${p}">
                  ${p}
                </button>
              `).join('')}
            </div>
            <button class="admin-pagination-page-btn" id="btn-admin-revenue-next" ${currentTxPage === totalTxPages ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Issues & Failed Jobs Debugger Tab ───
  if (adminActiveTab === 'issues') {
    let rowsHtml = '';
    if (adminFailedJobs.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="7" style="text-align:center; padding: 40px; color:#64748b;">
            <div style="font-size:32px; margin-bottom:8px;">🎉</div>
            <strong>Zero failed jobs detected!</strong>
            <p style="margin:4px 0 0 0; font-size:12px;">All generation tasks have executed with 100% health.</p>
          </td>
        </tr>
      `;
    } else {
      rowsHtml = adminFailedJobs.map(job => `
        <tr>
          <td>
            <div style="font-family:monospace; font-size:11px; font-weight:700; color:#0f172a;">${job.job_id.slice(0, 8)}...</div>
            <div style="font-size:11px; color:#64748b;">${new Date(job.created_at).toLocaleDateString()}</div>
          </td>
          <td><strong>${job.user_email}</strong></td>
          <td>
            <span class="export-res-tag badge--starter" style="padding:2px 6px; border-radius:4px; font-size:11px;">
              ${job.generation_mode}
            </span>
          </td>
          <td>${job.attempts} retries</td>
          <td>
            <div style="max-width:280px; font-size:11px; color:#ef4444; word-break:break-word; font-family:monospace; background:#fef2f2; padding:4px 8px; border-radius:4px;">
              ${job.error_message}
            </div>
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="admin-action-btn btn-admin-retry-job" data-job-id="${job.job_id}" style="font-size:11px; padding:4px 8px;">
                🔁 Retry
              </button>
              <button class="admin-action-btn btn-admin-refund-job" data-job-id="${job.job_id}" style="font-size:11px; padding:4px 8px; color:#ef4444; border-color:#fca5a5;">
                🪙 Refund 10 Cr
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    return `
      <div class="admin-card">
        <div class="admin-card-header">
          <span class="admin-card-title">Failed Generation Jobs (${adminFailedJobsTotal})</span>
          <span style="font-size:12px; color:#64748b;">Live AI Provider Support & Debugging Feed</span>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Job / Date</th>
                <th>Customer Email</th>
                <th>Mode</th>
                <th>Attempts</th>
                <th>Error Reason</th>
                <th>Support Action</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (adminActiveTab === 'plans') {
    const plansHtml = (adminPlansData?.plans || []).map(p => `
      <div class="admin-plan-card" id="card-plan-${p.id}" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:20px; box-shadow:0 4px 12px rgba(0,0,0,0.03); transition:all 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h4 style="font-size:16px; font-weight:800; color:#0f172a; margin:0;">${p.display_name} Plan <span style="font-size:11px; font-weight:600; color:#64748b;">(${p.id})</span></h4>
          <span class="cs-badge ${p.is_active ? 'cs-badge--success' : 'cs-badge--neutral'}">${p.is_active ? 'Active' : 'Inactive'}</span>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">India Price (INR ₹)</label>
            <input type="number" id="plan-inr-${p.id}" value="${p.price_inr}" data-orig="${p.price_inr}" disabled onwheel="this.blur()" class="admin-modal-input plan-field-${p.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-weight:700; color:#0f172a; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">Global Price (USD $)</label>
            <input type="number" id="plan-usd-${p.id}" value="${p.price_usd}" data-orig="${p.price_usd}" disabled onwheel="this.blur()" class="admin-modal-input plan-field-${p.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-weight:700; color:#0f172a; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">Monthly Credits</label>
            <input type="number" id="plan-credits-${p.id}" value="${p.credits}" data-orig="${p.credits}" disabled onwheel="this.blur()" class="admin-modal-input plan-field-${p.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; color:#0f172a; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">Monthly Images</label>
            <input type="number" id="plan-quota-${p.id}" value="${p.monthly_quota}" data-orig="${p.monthly_quota}" disabled onwheel="this.blur()" class="admin-modal-input plan-field-${p.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; color:#0f172a; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
        </div>

        <div id="plan-action-default-${p.id}">
          <button class="admin-action-btn btn-edit-plan" data-plan-id="${p.id}" style="width:100%; padding:9px; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; border-radius:8px; cursor:pointer;">
            ✏️ Edit Plan
          </button>
        </div>

        <div id="plan-action-editing-${p.id}" style="display:none; gap:8px;">
          <button class="admin-action-btn btn-cancel-plan" data-plan-id="${p.id}" style="flex:1; padding:9px; font-size:12px; font-weight:600; border:1px solid #cbd5e1; background:#f1f5f9; color:#475569; border-radius:8px; cursor:pointer;">
            ✕ Cancel
          </button>
          <button class="process-action-btn btn-save-plan" data-plan-id="${p.id}" style="flex:2; padding:9px; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; background:#4f46e5; color:#ffffff; border-radius:8px; cursor:pointer;">
            💾 Save Changes
          </button>
        </div>
      </div>
    `).join('');

    const packsHtml = (adminPlansData?.credit_packs || []).map(pk => `
      <div class="admin-plan-card" id="card-pack-${pk.id}" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:20px; box-shadow:0 4px 12px rgba(0,0,0,0.03); transition:all 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h4 style="font-size:15px; font-weight:800; color:#0f172a; margin:0;">${pk.title}</h4>
          ${pk.badge ? `<span class="cs-badge cs-badge--primary">${pk.badge}</span>` : ''}
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">INR Price (₹)</label>
            <input type="number" id="pack-inr-${pk.id}" value="${pk.price_inr}" data-orig="${pk.price_inr}" disabled onwheel="this.blur()" class="admin-modal-input pack-field-${pk.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-weight:700; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">USD Price ($)</label>
            <input type="number" id="pack-usd-${pk.id}" value="${pk.price_usd}" data-orig="${pk.price_usd}" disabled onwheel="this.blur()" class="admin-modal-input pack-field-${pk.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-weight:700; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">Credits</label>
            <input type="number" id="pack-credits-${pk.id}" value="${pk.credits}" data-orig="${pk.credits}" disabled onwheel="this.blur()" class="admin-modal-input pack-field-${pk.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
          <div>
            <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:4px;">Images</label>
            <input type="number" id="pack-images-${pk.id}" value="${pk.images}" data-orig="${pk.images}" disabled onwheel="this.blur()" class="admin-modal-input pack-field-${pk.id}" style="width:100%; box-sizing:border-box; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0;">
          </div>
        </div>

        <div id="pack-action-default-${pk.id}">
          <button class="admin-action-btn btn-edit-pack" data-pack-id="${pk.id}" style="width:100%; padding:9px; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; border-radius:8px; cursor:pointer;">
            ✏️ Edit Pack
          </button>
        </div>

        <div id="pack-action-editing-${pk.id}" style="display:none; gap:8px;">
          <button class="admin-action-btn btn-cancel-pack" data-pack-id="${pk.id}" style="flex:1; padding:9px; font-size:12px; font-weight:600; border:1px solid #cbd5e1; background:#f1f5f9; color:#475569; border-radius:8px; cursor:pointer;">
            ✕ Cancel
          </button>
          <button class="process-action-btn btn-save-pack" data-pack-id="${pk.id}" style="flex:2; padding:9px; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; background:#059669; color:#ffffff; border-radius:8px; cursor:pointer;">
            💾 Save Changes
          </button>
        </div>
      </div>
    `).join('');

    return `
      <div class="admin-plans-manager-view">
        <div style="margin-bottom:24px;">
          <h3 style="font-size:20px; font-weight:800; color:#0f172a; margin-bottom:4px;">Dynamic Subscription Plans & Multi-Currency Pricing</h3>
          <p style="font-size:13px; color:#64748b; margin:0;">Edit INR and USD prices in real-time. Changes immediately update across landing pages, app checkout, and Razorpay orders with 0 downtime.</p>
        </div>

        <h4 style="font-size:16px; font-weight:800; color:#1e293b; margin-bottom:14px;">1. Monthly Subscription Plans</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:20px; margin-bottom:36px;">
          ${plansHtml}
        </div>

        <h4 style="font-size:16px; font-weight:800; color:#1e293b; margin-bottom:14px;">2. Add-On Credit Top-Up Packs (Lifetime Validity)</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:20px;">
          ${packsHtml}
        </div>
      </div>
    `;
  }

  return '';
}

function showEditModelPricingModal(modelName) {
  document.getElementById('admin-pricing-modal-overlay')?.remove();

  const pricing = adminPricingsList.find(p => p.model_name === modelName);
  if (!pricing) return;

  const overlay = document.createElement('div');
  overlay.id = 'admin-pricing-modal-overlay';
  overlay.className = 'admin-modal-overlay';

  overlay.innerHTML = `
    <div class="admin-modal" style="max-width: 600px; width: 90%;">
      <div class="admin-modal-header">
        <span class="admin-modal-title">Configure Model: ${modelName}</span>
        <button class="admin-modal-close" id="btn-close-pricing-modal">&times;</button>
      </div>
      <div class="admin-modal-body">
        <p style="font-size: 12px; color: var(--color-gray-500); margin-bottom: var(--space-3);">
          Edit the configuration and pricing JSON payload below. Ensure it is valid JSON before saving.
        </p>
        <div class="admin-form-group">
          <label>Configuration JSON</label>
          <textarea id="input-model-pricing-json" class="admin-modal-input" style="font-family: monospace; font-size: 12px; height: 350px; line-height: 1.5; padding: 8px;">${JSON.stringify(pricing.pricing_data, null, 2)}</textarea>
        </div>
      </div>
      <div class="admin-modal-footer">
        <button class="admin-action-btn" id="btn-cancel-pricing-modal" style="padding: 8px var(--space-4);">Cancel</button>
        <button class="process-action-btn" id="btn-submit-pricing-modal" style="padding: 8px var(--space-4);">Save Configuration</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  document.getElementById('btn-close-pricing-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-pricing-modal').addEventListener('click', closeModal);

  document.getElementById('btn-submit-pricing-modal').addEventListener('click', async () => {
    const textarea = document.getElementById('input-model-pricing-json');
    let parsedData;
    try {
      parsedData = JSON.parse(textarea.value);
    } catch (err) {
      alert('Invalid JSON syntax: ' + err.message);
      return;
    }

    try {
      const resp = await apiFetch(`/users/admin/pricings/${modelName}`, {
        method: 'PUT',
        body: JSON.stringify({ pricing_data: parsedData })
      });
      alert('Model configuration updated successfully.');
      closeModal();
      await renderAdminDashboard();
    } catch (err) {
      alert(err.message || 'Failed to update model configuration.');
    }
  });
}


function showAdjustCreditsModal(userId, email) {
  document.getElementById('admin-credits-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-credits-modal-overlay';
  overlay.className = 'admin-modal-overlay';

  overlay.innerHTML = `
    <div class="admin-modal">
      <div class="admin-modal-header">
        <span class="admin-modal-title">Adjust Credits</span>
        <button class="admin-modal-close" id="btn-close-credits-modal">&times;</button>
      </div>
      <div class="admin-modal-body">
        <div class="admin-form-group">
          <label>Target User</label>
          <input type="text" class="admin-modal-input" value="${email}" readonly style="background:var(--color-gray-50); color:var(--color-gray-500);" />
        </div>
        <div class="admin-form-group">
          <label>Adjustment Amount (use negative numbers to deduct)</label>
          <input type="number" id="input-credits-adjustment" class="admin-modal-input" placeholder="e.g. 50 or -20" value="50" step="1" />
        </div>
      </div>
      <div class="admin-modal-footer">
        <button class="admin-action-btn" id="btn-cancel-credits-modal" style="padding: 8px var(--space-4);">Cancel</button>
        <button class="process-action-btn" id="btn-submit-credits-modal" style="padding: 8px var(--space-4);">Apply Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  document.getElementById('btn-close-credits-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-credits-modal').addEventListener('click', closeModal);

  document.getElementById('btn-submit-credits-modal').addEventListener('click', async () => {
    const input = document.getElementById('input-credits-adjustment');
    const amount = parseInt(input.value, 10);
    if (isNaN(amount) || amount === 0) {
      alert('Please enter a valid, non-zero adjustment amount.');
      return;
    }

    try {
      const resp = await apiFetch('/users/admin/adjust-credits', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, amount })
      });
      alert(resp.message || 'Credits adjusted successfully.');
      closeModal();
      await renderAdminDashboard();
    } catch (err) {
      alert(err.message || 'Failed to adjust credits.');
    }
  });
}

function showChangePlanModal(userId, email, currentTier) {
  document.getElementById('admin-plan-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-plan-modal-overlay';
  overlay.className = 'admin-modal-overlay';

  overlay.innerHTML = `
    <div class="admin-modal">
      <div class="admin-modal-header">
        <span class="admin-modal-title">Change Subscription Plan</span>
        <button class="admin-modal-close" id="btn-close-plan-modal">&times;</button>
      </div>
      <div class="admin-modal-body">
        <div class="admin-form-group">
          <label>Target User</label>
          <input type="text" class="admin-modal-input" value="${email}" readonly style="background:var(--color-gray-50); color:var(--color-gray-500);" />
        </div>
        <div class="admin-form-group">
          <label>Select Subscription Tier</label>
          <select id="select-modal-change-tier" class="admin-modal-input">
            <option value="free" ${currentTier === 'free' ? 'selected' : ''}>Free Plan</option>
            <option value="creator_lite" ${currentTier === 'creator_lite' ? 'selected' : ''}>Creator Lite</option>
            <option value="brand_pro" ${currentTier === 'brand_pro' ? 'selected' : ''}>Brand Pro</option>
            <option value="enterprise_studio" ${currentTier === 'enterprise_studio' ? 'selected' : ''}>Enterprise Studio</option>
          </select>
        </div>
      </div>
      <div class="admin-modal-footer">
        <button class="admin-action-btn" id="btn-cancel-plan-modal" style="padding: 8px var(--space-4);">Cancel</button>
        <button class="process-action-btn" id="btn-submit-plan-modal" style="padding: 8px var(--space-4);">Apply Plan</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  document.getElementById('btn-close-plan-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-plan-modal').addEventListener('click', closeModal);

  document.getElementById('btn-submit-plan-modal').addEventListener('click', async () => {
    const select = document.getElementById('select-modal-change-tier');
    const selectedTier = select.value;

    closeModal();
    await handleChangeUserTier(userId, selectedTier);
  });
}

async function exportUsersToCsv() {
  try {
    let query = `/users/admin/list?limit=1000&offset=0`;
    if (adminUserSearch) query += `&email=${encodeURIComponent(adminUserSearch)}`;
    const res = await apiFetch(query);
    const users = res.users || [];

    if (users.length === 0) {
      alert("No user records found to export.");
      return;
    }

    const headers = ["Email", "Role", "Subscription Plan", "Credits", "Registered At"];
    const rows = users.map(user => {
      const profile = user.profile || {};
      return [
        user.email || '',
        user.role || '',
        profile.subscription_tier || 'free',
        profile.credit_balance ?? 0,
        user.created_at || ''
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(",")].concat(rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `users_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert("Failed to export users: " + err.message);
  }
}

async function handleChangeUserTier(userId, tier) {
  try {
    const resp = await apiFetch('/users/admin/change-tier', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, tier })
    });
    alert(resp.message || `Plan changed to ${tier} successfully.`);
    await renderAdminDashboard();
  } catch (err) {
    alert(err.message || 'Failed to change user tier.');
  }
}

function attachAdminEventListeners() {
  document.querySelectorAll('.admin-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      adminActiveTab = btn.getAttribute('data-tab');
      await renderAdminDashboard();
    });
  });

  document.querySelectorAll('.admin-provider-toggle').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const provider = checkbox.getAttribute('data-provider');
      const isEnabled = checkbox.checked;
      try {
        await apiFetch(`/users/admin/providers/${provider}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_enabled: isEnabled })
        });
        await renderAdminDashboard();
      } catch (err) {
        alert(err.message || 'Failed to update provider status.');
        checkbox.checked = !isEnabled;
      }
    });
  });

  document.querySelectorAll('.btn-edit-model-pricing').forEach(btn => {
    btn.addEventListener('click', () => {
      const model = btn.getAttribute('data-model');
      showEditModelPricingModal(model);
    });
  });

  document.querySelectorAll('.admin-prompt-list-item[data-prompt-name]').forEach(btn => {
    btn.addEventListener('click', () => {
      adminSelectedPromptName = btn.getAttribute('data-prompt-name');
      renderAdminDashboard();
    });
  });

  const btnSavePromptVersion = document.getElementById('btn-admin-prompt-add-version');
  if (btnSavePromptVersion) {
    btnSavePromptVersion.addEventListener('click', async () => {
      const textarea = document.getElementById('prompt-new-version-content');
      const content = textarea.value.trim();
      if (!content) {
        alert('Prompt content cannot be empty.');
        return;
      }
      try {
        await apiFetch(`/prompts/${adminSelectedPromptName}/versions`, {
          method: 'POST',
          body: JSON.stringify({ content })
        });
        alert('New prompt version saved and is now active.');
        await renderAdminDashboard();
      } catch (err) {
        alert(err.message || 'Failed to save version.');
      }
    });
  }

  // Issue Debugger retry and refund handlers
  document.querySelectorAll('.btn-admin-retry-job').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jobId = btn.getAttribute('data-job-id');
      btn.disabled = true;
      btn.textContent = 'Re-queuing...';
      try {
        await apiFetch(`/admin/audit/issues/retry/${jobId}`, { method: 'POST' });
        await renderAdminDashboard();
      } catch (err) {
        alert(err.message || 'Failed to retry job');
        btn.disabled = false;
        btn.textContent = '🔁 Retry';
      }
    });
  });

  document.querySelectorAll('.btn-admin-refund-job').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jobId = btn.getAttribute('data-job-id');
      if (!confirm('Are you sure you want to refund 10 credits to the user for this job?')) return;
      btn.disabled = true;
      btn.textContent = 'Refunding...';
      try {
        const res = await apiFetch(`/admin/audit/issues/refund/${jobId}`, { method: 'POST' });
        alert(res.message || 'Refund successful');
        await renderAdminDashboard();
      } catch (err) {
        alert(err.message || 'Failed to refund job');
        btn.disabled = false;
        btn.textContent = '🪙 Refund 10 Cr';
      }
    });
  });

  const btnCreateTemplate = document.getElementById('btn-admin-create-template');
  if (btnCreateTemplate) {
    btnCreateTemplate.addEventListener('click', async () => {
      const name = prompt('Enter new template name (e.g. virtual_try_on):');
      if (!name) return;
      const desc = prompt('Enter a short description:');
      const content = prompt('Enter the initial system prompt content:');
      if (!content) {
        alert('Prompt content is required.');
        return;
      }
      try {
        await apiFetch('/prompts/', {
          method: 'POST',
          body: JSON.stringify({ name, description: desc || '', content })
        });
        alert('Template created successfully.');
        adminSelectedPromptName = name;
        await renderAdminDashboard();
      } catch (err) {
        alert(err.message || 'Failed to create template.');
      }
    });
  }

  if (adminActiveTab === 'users') {
    // Export CSV
    document.getElementById('btn-admin-export-csv')?.addEventListener('click', async () => {
      await exportUsersToCsv();
    });

    // Filter button - focuses search for now
    document.getElementById('btn-admin-filter')?.addEventListener('click', () => {
      document.getElementById('admin-user-search-input')?.focus();
    });

    // Search input (Enter key to submit)
    const searchInput = document.getElementById('admin-user-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          adminUserSearch = searchInput.value.trim();
          adminUserOffset = 0;
          await renderAdminDashboard();
        }
      });
    }

    // Direct page numbers
    document.querySelectorAll('.btn-admin-users-page-num').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pageNum = parseInt(btn.getAttribute('data-page'), 10);
        adminUserOffset = (pageNum - 1) * adminUserLimit;
        await renderAdminDashboard();
      });
    });

    // Prev/Next arrows
    document.getElementById('btn-admin-users-prev-arrow')?.addEventListener('click', async () => {
      adminUserOffset = Math.max(0, adminUserOffset - adminUserLimit);
      await renderAdminDashboard();
    });

    document.getElementById('btn-admin-users-next-arrow')?.addEventListener('click', async () => {
      adminUserOffset += adminUserLimit;
      await renderAdminDashboard();
    });

    // Adjust credits
    document.querySelectorAll('.btn-adjust-credits').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.getAttribute('data-user-id');
        const email = btn.getAttribute('data-email');
        showAdjustCreditsModal(userId, email);
      });
    });

    // Change plan button mock modal
    document.querySelectorAll('.btn-change-plan-mock').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.getAttribute('data-user-id');
        const email = btn.getAttribute('data-email');
        const tier = btn.getAttribute('data-tier');
        showChangePlanModal(userId, email, tier);
      });
    });


  }

  if (adminActiveTab === 'revenue') {
    // 1. Search input
    const revSearchInput = document.getElementById('admin-revenue-search-input');
    if (revSearchInput) {
      revSearchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          adminRevenueSearch = revSearchInput.value.trim();
          adminRevenueOffset = 0;
          await renderAdminDashboard();
        }
      });
      revSearchInput.addEventListener('input', async () => {
        if (revSearchInput.value.trim() === '' && adminRevenueSearch !== '') {
          adminRevenueSearch = '';
          adminRevenueOffset = 0;
          await renderAdminDashboard();
        }
      });
    }

    // 2. Type filter select
    const revTypeFilter = document.getElementById('admin-revenue-type-filter');
    if (revTypeFilter) {
      revTypeFilter.addEventListener('change', async () => {
        adminRevenueTypeFilter = revTypeFilter.value;
        adminRevenueOffset = 0;
        await renderAdminDashboard();
      });
    }

    // 3. Direct page numbers
    document.querySelectorAll('.btn-admin-revenue-page-num').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pageNum = parseInt(btn.getAttribute('data-page'), 10);
        adminRevenueOffset = (pageNum - 1) * adminRevenueLimit;
        await renderAdminDashboard();
      });
    });

    // 4. Prev / Next arrows
    document.getElementById('btn-admin-revenue-prev')?.addEventListener('click', async () => {
      adminRevenueOffset = Math.max(0, adminRevenueOffset - adminRevenueLimit);
      await renderAdminDashboard();
    });

    document.getElementById('btn-admin-revenue-next')?.addEventListener('click', async () => {
      adminRevenueOffset += adminRevenueLimit;
      await renderAdminDashboard();
    });

    // 5. View receipt buttons in Admin
    document.querySelectorAll('.btn-view-invoice').forEach(btn => {
      btn.addEventListener('click', () => {
        const invId = btn.getAttribute('data-invoice-id') || 'INV-001';
        const desc = btn.getAttribute('data-desc') || 'Subscription Plan';
        const amt = btn.getAttribute('data-amount') || '0';
        const date = btn.getAttribute('data-date') || 'Recent';
        const email = btn.getAttribute('data-email') || (appState.user ? appState.user.email : 'Customer');
        openReceiptModal(invId, desc, amt, date, email);
      });
    });
  }

  if (adminActiveTab === 'audit') {
    document.getElementById('btn-admin-filter-apply')?.addEventListener('click', async () => {
      currentFilters.actor_id = document.getElementById('filter-actor').value.trim();
      currentFilters.action = document.getElementById('filter-action').value.trim();
      currentFilters.resource_type = document.getElementById('filter-resource').value.trim();
      currentFilters.offset = 0;
      await renderAdminDashboard();
    });

    document.getElementById('btn-admin-filter-clear')?.addEventListener('click', async () => {
      currentFilters = { actor_id: '', action: '', resource_type: '', limit: 50, offset: 0 };
      await renderAdminDashboard();
    });

    document.getElementById('btn-admin-logs-prev')?.addEventListener('click', async () => {
      currentFilters.offset = Math.max(0, currentFilters.offset - currentFilters.limit);
      await renderAdminDashboard();
    });

    document.getElementById('btn-admin-logs-next')?.addEventListener('click', async () => {
      currentFilters.offset += currentFilters.limit;
      await renderAdminDashboard();
    });
  }

  if (adminActiveTab === 'plans') {
    // ── Plans Event Handlers ──
    document.querySelectorAll('.btn-edit-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = btn.getAttribute('data-plan-id');
        document.querySelectorAll(`.plan-field-${planId}`).forEach(input => {
          input.disabled = false;
          input.style.background = '#ffffff';
          input.style.borderColor = '#6366f1';
          input.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
        });
        document.getElementById(`plan-action-default-${planId}`).style.display = 'none';
        const editingBox = document.getElementById(`plan-action-editing-${planId}`);
        if (editingBox) editingBox.style.display = 'flex';
      });
    });

    document.querySelectorAll('.btn-cancel-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = btn.getAttribute('data-plan-id');
        document.querySelectorAll(`.plan-field-${planId}`).forEach(input => {
          input.value = input.getAttribute('data-orig') || input.value;
          input.disabled = true;
          input.style.background = '#f8fafc';
          input.style.borderColor = '#e2e8f0';
          input.style.boxShadow = 'none';
        });
        document.getElementById(`plan-action-default-${planId}`).style.display = 'block';
        const editingBox = document.getElementById(`plan-action-editing-${planId}`);
        if (editingBox) editingBox.style.display = 'none';
      });
    });

    document.querySelectorAll('.btn-save-plan').forEach(btn => {
      btn.addEventListener('click', async () => {
        const planId = btn.getAttribute('data-plan-id');
        const inrInput = document.getElementById(`plan-inr-${planId}`);
        const usdInput = document.getElementById(`plan-usd-${planId}`);
        const creditsInput = document.getElementById(`plan-credits-${planId}`);
        const quotaInput = document.getElementById(`plan-quota-${planId}`);

        const inr = parseInt(inrInput?.value || '0');
        const usd = parseInt(usdInput?.value || '0');
        const credits = parseInt(creditsInput?.value || '0');
        const quota = parseInt(quotaInput?.value || '0');

        btn.disabled = true;
        btn.innerText = 'Saving...';
        try {
          await apiFetch(`/billing/admin/plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify({
              price_inr: inr,
              price_usd: usd,
              credits: credits,
              monthly_quota: quota,
              is_active: true
            })
          });

          // Update original values
          inrInput.setAttribute('data-orig', inr);
          usdInput.setAttribute('data-orig', usd);
          creditsInput.setAttribute('data-orig', credits);
          quotaInput.setAttribute('data-orig', quota);

          // Lock inputs back
          document.querySelectorAll(`.plan-field-${planId}`).forEach(input => {
            input.disabled = true;
            input.style.background = '#f8fafc';
            input.style.borderColor = '#e2e8f0';
            input.style.boxShadow = 'none';
          });

          document.getElementById(`plan-action-default-${planId}`).style.display = 'block';
          const editingBox = document.getElementById(`plan-action-editing-${planId}`);
          if (editingBox) editingBox.style.display = 'none';

          const editBtn = document.querySelector(`.btn-edit-plan[data-plan-id="${planId}"]`);
          if (editBtn) {
            editBtn.innerText = '✓ Saved Live!';
            editBtn.style.background = '#ecfdf5';
            editBtn.style.color = '#059669';
            editBtn.style.borderColor = '#6ee7b7';
            setTimeout(() => {
              editBtn.innerText = '✏️ Edit Plan';
              editBtn.style.background = '#ffffff';
              editBtn.style.color = '#334155';
              editBtn.style.borderColor = '#cbd5e1';
            }, 2500);
          }
        } catch (e) {
          alert('Failed to save plan: ' + e.message);
        } finally {
          btn.disabled = false;
          btn.innerText = '💾 Save Changes';
        }
      });
    });

    // ── Packs Event Handlers ──
    document.querySelectorAll('.btn-edit-pack').forEach(btn => {
      btn.addEventListener('click', () => {
        const packId = btn.getAttribute('data-pack-id');
        document.querySelectorAll(`.pack-field-${packId}`).forEach(input => {
          input.disabled = false;
          input.style.background = '#ffffff';
          input.style.borderColor = '#059669';
          input.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.15)';
        });
        document.getElementById(`pack-action-default-${packId}`).style.display = 'none';
        const editingBox = document.getElementById(`pack-action-editing-${packId}`);
        if (editingBox) editingBox.style.display = 'flex';
      });
    });

    document.querySelectorAll('.btn-cancel-pack').forEach(btn => {
      btn.addEventListener('click', () => {
        const packId = btn.getAttribute('data-pack-id');
        document.querySelectorAll(`.pack-field-${packId}`).forEach(input => {
          input.value = input.getAttribute('data-orig') || input.value;
          input.disabled = true;
          input.style.background = '#f8fafc';
          input.style.borderColor = '#e2e8f0';
          input.style.boxShadow = 'none';
        });
        document.getElementById(`pack-action-default-${packId}`).style.display = 'block';
        const editingBox = document.getElementById(`pack-action-editing-${packId}`);
        if (editingBox) editingBox.style.display = 'none';
      });
    });

    document.querySelectorAll('.btn-save-pack').forEach(btn => {
      btn.addEventListener('click', async () => {
        const packId = btn.getAttribute('data-pack-id');
        const inrInput = document.getElementById(`pack-inr-${packId}`);
        const usdInput = document.getElementById(`pack-usd-${packId}`);
        const creditsInput = document.getElementById(`pack-credits-${packId}`);
        const imagesInput = document.getElementById(`pack-images-${packId}`);

        const inr = parseInt(inrInput?.value || '0');
        const usd = parseInt(usdInput?.value || '0');
        const credits = parseInt(creditsInput?.value || '0');
        const images = parseInt(imagesInput?.value || '0');

        btn.disabled = true;
        btn.innerText = 'Saving...';
        try {
          await apiFetch(`/billing/admin/packs/${packId}`, {
            method: 'PUT',
            body: JSON.stringify({
              price_inr: inr,
              price_usd: usd,
              credits: credits,
              images: images,
              is_active: true
            })
          });

          // Update original values
          inrInput.setAttribute('data-orig', inr);
          usdInput.setAttribute('data-orig', usd);
          creditsInput.setAttribute('data-orig', credits);
          imagesInput.setAttribute('data-orig', images);

          // Lock inputs back
          document.querySelectorAll(`.pack-field-${packId}`).forEach(input => {
            input.disabled = true;
            input.style.background = '#f8fafc';
            input.style.borderColor = '#e2e8f0';
            input.style.boxShadow = 'none';
          });

          document.getElementById(`pack-action-default-${packId}`).style.display = 'block';
          const editingBox = document.getElementById(`pack-action-editing-${packId}`);
          if (editingBox) editingBox.style.display = 'none';

          const editBtn = document.querySelector(`.btn-edit-pack[data-pack-id="${packId}"]`);
          if (editBtn) {
            editBtn.innerText = '✓ Saved Live!';
            editBtn.style.background = '#ecfdf5';
            editBtn.style.color = '#059669';
            editBtn.style.borderColor = '#6ee7b7';
            setTimeout(() => {
              editBtn.innerText = '✏️ Edit Pack';
              editBtn.style.background = '#ffffff';
              editBtn.style.color = '#334155';
              editBtn.style.borderColor = '#cbd5e1';
            }, 2500);
          }
        } catch (e) {
          alert('Failed to save credit pack: ' + e.message);
        } finally {
          btn.disabled = false;
          btn.innerText = '💾 Save Changes';
        }
      });
    });
  }
}

async function renderAdminDashboard() {
  const pageContent = document.getElementById('page-content');
  pageContent.innerHTML = `
    <div class="cs-loading-screen">
      <div class="cs-spinner cs-spinner--lg"></div>
      <p class="cs-loading-screen__title">Loading Admin Console...</p>
    </div>
  `;

  try {
    if (adminActiveTab === 'users') {
      let query = `/users/admin/list?limit=${adminUserLimit}&offset=${adminUserOffset}`;
      if (adminUserSearch) query += `&email=${encodeURIComponent(adminUserSearch)}`;
      const res = await apiFetch(query);
      adminUsersList = res.users;
      adminUsersTotal = res.total;
      adminStats = await apiFetch('/users/admin/stats');
    } else if (adminActiveTab === 'plans') {
      adminPlansData = await apiFetch('/billing/admin/plans');
    } else if (adminActiveTab === 'prompts') {
      adminPromptsList = await apiFetch('/prompts/');
      if (adminPromptsList.length > 0 && !adminSelectedPromptName) {
        adminSelectedPromptName = adminPromptsList[0].name;
      }
    } else if (adminActiveTab === 'spend') {
      adminCosts = await apiFetch('/admin/audit/costs');
    } else if (adminActiveTab === 'revenue') {
      adminFinancials = await apiFetch('/admin/audit/financials/overview');
    } else if (adminActiveTab === 'issues') {
      const issuesRes = await apiFetch('/admin/audit/issues/failed-jobs');
      adminFailedJobs = issuesRes.failed_jobs || [];
      adminFailedJobsTotal = issuesRes.total || 0;
    } else if (adminActiveTab === 'audit') {
      let queryParams = `?limit=${currentFilters.limit}&offset=${currentFilters.offset}`;
      if (currentFilters.actor_id) queryParams += `&actor_id=${currentFilters.actor_id}`;
      if (currentFilters.action) queryParams += `&action=${currentFilters.action}`;
      if (currentFilters.resource_type) queryParams += `&resource_type=${currentFilters.resource_type}`;
      adminLogs = await apiFetch(`/admin/audit/${queryParams}`);
    } else if (adminActiveTab === 'models') {
      adminProvidersList = await apiFetch('/users/admin/providers');
      adminPricingsList = await apiFetch('/users/admin/pricings');
    } else if (adminActiveTab === 'waitlist') {
      let wQuery = `/waitlist/?limit=${adminWaitlistLimit}&offset=${adminWaitlistOffset}`;
      if (adminWaitlistFilter) wQuery += `&category=${adminWaitlistFilter}`;
      if (adminWaitlistEmailSearch) wQuery += `&email=${encodeURIComponent(adminWaitlistEmailSearch)}`;
      const wRes = await apiFetch(wQuery);
      adminWaitlistEntries = wRes.entries || [];
      adminWaitlistTotal = wRes.total || 0;
      // Also fetch counts
      try {
        const countsRes = await fetch(`${API_BASE_URL}/waitlist/counts`);
        if (countsRes.ok) {
          const countsData = await countsRes.json();
          adminWaitlistCounts = countsData.counts || [];
        }
      } catch (e) { /* ignore count fetch errors */ }
    }

    pageContent.innerHTML = `
      <div class="admin-view">


        <div class="admin-tabs">
          <button class="admin-tab ${adminActiveTab === 'users' ? 'admin-tab--active' : ''}" data-tab="users">Users & Plans</button>
          <button class="admin-tab ${adminActiveTab === 'plans' ? 'admin-tab--active' : ''}" data-tab="plans">💳 Plans & Pricing</button>
          <button class="admin-tab ${adminActiveTab === 'revenue' ? 'admin-tab--active' : ''}" data-tab="revenue">💰 Revenue & MRR</button>
          <button class="admin-tab ${adminActiveTab === 'issues' ? 'admin-tab--active' : ''}" data-tab="issues">🛠️ Issue Debugger</button>
          <button class="admin-tab ${adminActiveTab === 'prompts' ? 'admin-tab--active' : ''}" data-tab="prompts">Prompt Templates</button>
          <button class="admin-tab ${adminActiveTab === 'models' ? 'admin-tab--active' : ''}" data-tab="models">AI Models</button>
          <button class="admin-tab ${adminActiveTab === 'spend' ? 'admin-tab--active' : ''}" data-tab="spend">Infrastructure Spend</button>
          <button class="admin-tab ${adminActiveTab === 'audit' ? 'admin-tab--active' : ''}" data-tab="audit">Audit Trail</button>
          <button class="admin-tab ${adminActiveTab === 'waitlist' ? 'admin-tab--active' : ''}" data-tab="waitlist">Waitlist</button>
        </div>

        <div class="admin-tab-content">
          ${renderTabContentHtml()}
        </div>
      </div>
    `;

    attachAdminEventListeners();

  } catch (err) {
    pageContent.innerHTML = `
      <div class="admin-view" style="align-items:center; justify-content:center; height:300px; color:var(--color-error); text-align:center; padding: var(--space-6);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <h2 style="margin-top:12px;">Access Denied</h2>
        <p style="margin-top:8px; color:var(--color-gray-500); max-width:400px;">${err.message || 'You must have admin privileges to access the admin console.'}</p>
      </div>
    `;
  }
}

// ─── Razorpay Purchasing Interactivity ───
function openRazorpayCheckoutModal() {
  // Renders a beautiful custom overlay popup in case keys are empty/mock
  const modalContainer = document.createElement('div');
  modalContainer.id = 'credits-purchase-overlay';
  modalContainer.style = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:10000; font-family:var(--font-family);';

  modalContainer.innerHTML = `
    <div class="auth-card" style="width:380px; background:var(--color-white); color:var(--color-gray-900); padding:var(--space-6); border-radius:14px; box-shadow: 0 20px 40px rgba(0,0,0,0.25);">
      <h2 style="font-size:18px; font-weight:800; margin-bottom:var(--space-2); color:var(--color-gray-900);">Add-On Credit Top-Up</h2>
      <p style="font-size:12px; color:var(--color-gray-500); margin-bottom:var(--space-4);">Top-up credits have <strong>Lifetime Validity</strong> and never expire.</p>
      
      <div class="auth-group" style="margin-bottom:var(--space-4);">
        <label class="auth-label" style="color:var(--color-gray-700); font-weight:700;">Select Top-Up Package</label>
        <select id="credits-buy-select" class="admin-filter-select" style="width:100%; box-sizing:border-box; padding:10px; font-size:13px; border-radius:8px; border:1px solid #cbd5e1; background:#f8fafc; color:#0f172a; font-weight:600;">
          <option value="100">📦 100 Credits (10 AI Images) — ₹299</option>
          <option value="300">⚡ 300 Credits (30 AI Images) — ₹799</option>
          <option value="600" selected>✨ 600 Credits (60 AI Images) — ₹1,499 (Popular)</option>
          <option value="1500">👑 1,500 Credits (150 AI Images) — ₹3,499 (Best Value)</option>
        </select>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:var(--space-2); margin-top:8px;">
        <button class="prompt-ratio-btn" id="btn-purchase-cancel" style="border:1px solid var(--color-gray-300); padding: 8px var(--space-4); border-radius:8px;">Cancel</button>
        <button class="process-action-btn" id="btn-purchase-proceed" style="padding: 8px var(--space-5); border-radius:8px;">Proceed to Pay</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);

  document.getElementById('btn-purchase-cancel')?.addEventListener('click', () => {
    modalContainer.remove();
  });

  document.getElementById('btn-purchase-proceed')?.addEventListener('click', async () => {
    const selectEl = document.getElementById('credits-buy-select');
    const credits = parseInt(selectEl.value);

    // Change proceed button to spinner
    const proceedBtn = document.getElementById('btn-purchase-proceed');
    proceedBtn.disabled = true;
    proceedBtn.textContent = 'Contacting Payment Gateway...';

    try {
      // 1. Create order on backend
      const order = await apiFetch('/billing/razorpay/order', {
        method: 'POST',
        body: JSON.stringify({ credits })
      });

      modalContainer.remove(); // Close prompt select overlay

      // Check if mock order (Razorpay keys not configured)
      if (order.order_id.startsWith('order_mock_') || !order.key_id) {
        showMockPaymentProcessor(order);
      } else {
        // Launch real Razorpay SDK
        const rzpOptions = {
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'CropStudio AI',
          description: `Purchase ${credits} Credits`,
          order_id: order.order_id,
          handler: async function (response) {
            await verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              credits: order.credits
            });
          },
          prefill: {
            email: appState.user.email,
          },
          theme: {
            color: '#4F46E5'
          }
        };
        const rzp = new window.Razorpay(rzpOptions);
        rzp.open();
      }
    } catch (err) {
      alert(`Payment order creation failed: ${err.message}`);
      modalContainer.remove();
    }
  });
}

function showMockPaymentProcessor(order) {
  const modalContainer = document.createElement('div');
  modalContainer.id = 'credits-purchase-mock-overlay';
  modalContainer.style = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:10000; font-family:var(--font-family);';

  modalContainer.innerHTML = `
    <div class="auth-card" style="width:360px; background:var(--color-white); color:var(--color-gray-900); padding:var(--space-6); border-color:var(--color-primary-light);">
      <h2 style="font-size:18px; font-weight:700; margin-bottom:var(--space-2); color:var(--color-gray-900); display:flex; align-items:center; gap:var(--space-2);">
        <span style="color:var(--color-primary-light);">💸</span> Mock Razorpay Gateway
      </h2>
      <p style="font-size:12px; color:var(--color-gray-500); margin-bottom:var(--space-4);">API credentials are not configured, initiating simulated checkout checkout.</p>
      
      <div style="background:var(--color-gray-50); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:var(--space-3); font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:var(--space-4);">
        <div>Order ID: <strong style="font-family:monospace;">${order.order_id}</strong></div>
        <div>Amount: <strong>₹${(order.amount / 100).toFixed(2)}</strong></div>
        <div>Credits to add: <strong>${order.credits}</strong></div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:var(--space-2);">
        <button class="prompt-ratio-btn" id="btn-purchase-mock-cancel" style="border:1px solid var(--color-gray-300); padding: 8px var(--space-3);">Cancel</button>
        <button class="process-action-btn" id="btn-purchase-mock-approve" style="padding: 8px var(--space-4); background:var(--color-success); border-color:var(--color-success);">Simulate Success</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);

  document.getElementById('btn-purchase-mock-cancel')?.addEventListener('click', () => {
    modalContainer.remove();
  });

  document.getElementById('btn-purchase-mock-approve')?.addEventListener('click', async () => {
    modalContainer.remove();
    await verifyPayment({
      razorpay_order_id: order.order_id,
      razorpay_payment_id: 'pay_mock_payment_approved',
      razorpay_signature: 'mock_signature_approved',
      credits: order.credits
    });
  });
}

async function verifyPayment(verifyPayload) {
  try {
    const res = await apiFetch('/billing/razorpay/verify', {
      method: 'POST',
      body: JSON.stringify(verifyPayload)
    });

    if (res.status === 'success') {
      alert(`🎉 Payment Verified! Successfully added ${verifyPayload.credits} credits to your account.`);
      await syncUserProfile();
    } else {
      alert('Payment verification returned an invalid status.');
    }
  } catch (err) {
    alert(`Payment verification failed: ${err.message}`);
  }
}

// ─── Initialize App Layout & Handlers ───
function initApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      ${renderMain()}
    </div>
  `;

  // Attach nav and tool events
  initNavigation();
  initSearch();
  initFeatureCards();
  initBatchEvents();
  initGenerateEvents();
  initOnModelEvents();
  initAssetsEvents();
  initBillingEvents();
  initUpgradeEvent();
  initProfileDropdownAndPricing();
  initDevSimulator();

  // Load initial route based on URL hash if provided
  const initialRoute = window.location.hash.replace('#', '') || 'home';
  history.replaceState({ route: initialRoute }, '', window.location.hash || window.location.pathname);
  if (initialRoute !== 'home') {
    navigateToRoute(initialRoute, false);
  }
}

function initUpgradeEvent() {
  document.getElementById('btn-upgrade')?.addEventListener('click', () => {
    openPricingModal('topup');
  });
}

function openPricingModal(initialTab = 'plans') {
  let existing = document.getElementById('pricing-modal-overlay');
  if (existing) existing.remove();

  let activeTab = initialTab || 'plans';
  let modalCurrency = 'INR';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (!tz.includes('Calcutta') && !tz.includes('Kolkata') && !tz.includes('India')) {
      modalCurrency = 'USD';
    }
  } catch (e) {
    modalCurrency = 'INR';
  }

  const currentTier = appState.user && appState.user.profile ? appState.user.profile.subscription_tier : 'free';

  const modalContainer = document.createElement('div');
  modalContainer.id = 'pricing-modal-overlay';
  modalContainer.className = 'pricing-modal open';

  const closeModal = () => {
    modalContainer.classList.remove('open');
    modalContainer.remove();
  };

  const renderModalBody = () => {
    const sym = modalCurrency === 'INR' ? '₹' : '$';
    const starterPrice = modalCurrency === 'INR' ? '₹699' : '$12';
    const proPrice = modalCurrency === 'INR' ? '₹1,999' : '$29';
    const bizPrice = modalCurrency === 'INR' ? '₹5,999' : '$79';

    const p100Price = modalCurrency === 'INR' ? '₹299' : '$5';
    const p300Price = modalCurrency === 'INR' ? '₹799' : '$12';
    const p600Price = modalCurrency === 'INR' ? '₹1,499' : '$22';
    const p1500Price = modalCurrency === 'INR' ? '₹3,499' : '$49';

    modalContainer.innerHTML = `
      <div class="pricing-modal__content" style="max-width: 980px;">
        <button class="pricing-modal__close" id="btn-pricing-close" aria-label="Close pricing">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="pricing-modal__header">
          <h1 class="pricing-modal__title">${activeTab === 'plans' ? 'Upgrade Your Workspace' : 'Add-On Credit Top-Up'}</h1>
          <p class="pricing-modal__subtitle">${activeTab === 'plans' ? 'Choose the perfect monthly plan for your fashion catalog workflow. Upgrade or downgrade anytime.' : 'Top-up credits have <strong>Lifetime Validity</strong> and never expire.'}</p>
          
          <div class="pricing-modal__toggle">
            <button class="pricing-toggle-btn ${activeTab === 'plans' ? 'active' : ''}" id="tab-btn-plans">
              📅 Monthly Plans (Save 30%)
            </button>
            <button class="pricing-toggle-btn ${activeTab === 'topup' ? 'active' : ''}" id="tab-btn-topup">
              🪙 Add-On Top-Up Packs (No Expiry)
            </button>
          </div>
        </div>

        ${activeTab === 'plans' ? `
          <div class="pricing-modal__grid">
            <!-- Plan 1: Starter -->
            <div class="plan-card ${currentTier === 'creator_lite' ? 'plan-card--popular' : ''}">
              ${currentTier === 'creator_lite' ? '<div class="plan-card__badge">Current Plan</div>' : ''}
              <span class="plan-card__name">Starter</span>
              <div class="plan-card__price-wrap">
                <span class="plan-card__price">${starterPrice}</span>
                <span class="plan-card__period">/month</span>
              </div>
              <p class="plan-card__desc">Ideal for boutique stores, Meesho & Amazon sellers launching product catalogs.</p>
              <div class="plan-card__features">
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span><strong>300 Credits</strong> monthly</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>📸 Generate up to <strong>30 images</strong></span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>⚡ Unlimited Background Removal</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>📐 <strong>1K Standard HD</strong> Image Exports</span>
                </div>
              </div>
              <button class="plan-card__btn" data-plan-select="creator_lite">
                ${currentTier === 'creator_lite' ? 'Current Plan' : 'Subscribe Now'}
              </button>
            </div>

            <!-- Plan 2: Pro -->
            <div class="plan-card plan-card--popular ${currentTier === 'brand_pro' ? 'plan-card--active' : ''}">
              <div class="plan-card__badge">${currentTier === 'brand_pro' ? 'Current Plan' : 'Most Popular'}</div>
              <span class="plan-card__name">Pro</span>
              <div class="plan-card__price-wrap">
                <span class="plan-card__price">${proPrice}</span>
                <span class="plan-card__period">/month</span>
              </div>
              <p class="plan-card__desc">For scaling apparel brands, digital studios, and catalogs needing AI Models.</p>
              <div class="plan-card__features">
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span><strong>1,000 Credits</strong> monthly</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>📸 Generate up to <strong>100 images</strong></span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>💎 <strong>2K Ultra HD</strong> Studio Quality</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>👤 AI On-Model Try-On & Lifestyle scenes</span>
                </div>
              </div>
              <button class="plan-card__btn" data-plan-select="brand_pro">
                ${currentTier === 'brand_pro' ? 'Current Plan' : 'Subscribe Now'}
              </button>
            </div>

            <!-- Plan 3: Business -->
            <div class="plan-card ${currentTier === 'enterprise_studio' ? 'plan-card--popular' : ''}">
              ${currentTier === 'enterprise_studio' ? '<div class="plan-card__badge">Current Plan</div>' : ''}
              <span class="plan-card__name">Business</span>
              <div class="plan-card__price-wrap">
                <span class="plan-card__price">${bizPrice}</span>
                <span class="plan-card__period">/month</span>
              </div>
              <p class="plan-card__desc">For high-volume fashion retailers, agencies, and enterprise catalog operations.</p>
              <div class="plan-card__features">
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span><strong>3,000 Credits</strong> monthly</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>👑 <strong>4K Master Studio</strong> Native Quality</span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>📦 <strong>Multi-Platform Bundle ZIP</strong></span>
                </div>
                <div class="plan-card__feature">
                  <span class="plan-card__feature-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>
                  <span>📞 Dedicated VIP Processing</span>
                </div>
              </div>
              <button class="plan-card__btn" data-plan-select="enterprise_studio">
                ${currentTier === 'enterprise_studio' ? 'Current Plan' : 'Subscribe Now'}
              </button>
            </div>
          </div>
        ` : `
          <!-- Add-On Top-Up Grid (4 Packages) -->
          <div class="topup-grid">
            <div class="plan-card">
              <span class="export-res-tag badge--starter" style="align-self:flex-start; margin-bottom:8px;">ENTRY</span>
              <span class="plan-card__name">Quick Pack</span>
              <div class="plan-card__price-wrap" style="margin-top:8px;">
                <span class="plan-card__price">${p100Price}</span>
              </div>
              <p class="plan-card__desc">For quick single catalog runs.</p>
              <div class="plan-card__features" style="margin: 12px 0 16px 0; font-size:12px;">
                <div>🪙 <strong>100 Credits</strong></div>
                <div>📸 <strong>10 AI Images</strong></div>
                <div>⚡ Lifetime Validity</div>
              </div>
              <button class="plan-card__btn btn-buy-topup" data-topup-credits="100">Buy 100 Credits</button>
            </div>

            <div class="plan-card">
              <span class="export-res-tag badge--starter" style="align-self:flex-start; margin-bottom:8px;">STANDARD</span>
              <span class="plan-card__name">Standard Pack</span>
              <div class="plan-card__price-wrap" style="margin-top:8px;">
                <span class="plan-card__price">${p300Price}</span>
              </div>
              <p class="plan-card__desc">Ideal for small product catalog launches.</p>
              <div class="plan-card__features" style="margin: 12px 0 16px 0; font-size:12px;">
                <div>🪙 <strong>300 Credits</strong></div>
                <div>📸 <strong>30 AI Images</strong></div>
                <div>⚡ Lifetime Validity</div>
              </div>
              <button class="plan-card__btn btn-buy-topup" data-topup-credits="300">Buy 300 Credits</button>
            </div>

            <div class="plan-card plan-card--popular">
              <div class="plan-card__badge">Most Popular</div>
              <span class="plan-card__name">Studio Pack</span>
              <div class="plan-card__price-wrap" style="margin-top:8px;">
                <span class="plan-card__price">${p600Price}</span>
              </div>
              <p class="plan-card__desc">For full apparel catalog shoots.</p>
              <div class="plan-card__features" style="margin: 12px 0 16px 0; font-size:12px;">
                <div>🪙 <strong>600 Credits</strong></div>
                <div>📸 <strong>60 AI Images</strong></div>
                <div>⚡ Lifetime Validity</div>
              </div>
              <button class="plan-card__btn btn-buy-topup" data-topup-credits="600">Buy 600 Credits</button>
            </div>

            <div class="plan-card plan-card--popular">
              <div class="plan-card__badge" style="background:#10b981;">Best Value</div>
              <span class="plan-card__name">Mega Pack</span>
              <div class="plan-card__price-wrap" style="margin-top:8px;">
                <span class="plan-card__price">${p1500Price}</span>
              </div>
              <p class="plan-card__desc">Maximum volume studio top-up.</p>
              <div class="plan-card__features" style="margin: 12px 0 16px 0; font-size:12px;">
                <div>🪙 <strong>1,500 Credits</strong></div>
                <div>📸 <strong>150 AI Images</strong></div>
                <div>⚡ Lifetime Validity</div>
              </div>
              <button class="plan-card__btn btn-buy-topup" data-topup-credits="1500">Buy 1,500 Credits</button>
            </div>
          </div>
        `}
      </div>
    `;
  };

  // Robust Delegated Event Handler on the Modal Container
  modalContainer.addEventListener('click', async (e) => {
    // 1. Close Modal
    if (e.target.closest('#btn-pricing-close') || e.target === modalContainer) {
      closeModal();
      return;
    }

    // 2. Switch to Plans Tab
    if (e.target.closest('#tab-btn-plans')) {
      activeTab = 'plans';
      renderModalBody();
      return;
    }

    // 3. Switch to Top-Up Tab
    if (e.target.closest('#tab-btn-topup')) {
      activeTab = 'topup';
      renderModalBody();
      return;
    }

    // 4. Buy Top-Up Credits
    const topupBtn = e.target.closest('.btn-buy-topup');
    if (topupBtn) {
      const credits = parseInt(topupBtn.getAttribute('data-topup-credits'));
      topupBtn.disabled = true;
      topupBtn.textContent = 'Contacting Gateway...';

      try {
        const order = await apiFetch('/billing/razorpay/order', {
          method: 'POST',
          body: JSON.stringify({ credits, currency: modalCurrency })
        });

        if (order.order_id.startsWith('order_mock_') || !order.key_id) {
          showMockPaymentProcessor(order, async () => {
            await syncUserProfile();
            closeModal();
            initApp();
          });
        } else {
          const rzpOptions = {
            key: order.key_id,
            amount: order.amount,
            currency: order.currency,
            name: 'CropStudio AI',
            description: `Top-Up ${credits} Credits (Lifetime Validity)`,
            order_id: order.order_id,
            handler: async function (response) {
              try {
                await apiFetch('/billing/razorpay/verify', {
                  method: 'POST',
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    credits: credits,
                    currency: modalCurrency
                  })
                });
                await syncUserProfile();
                alert(`🎉 Success! Added ${credits} credits to your balance.`);
                closeModal();
                initApp();
              } catch (err) {
                alert(`Payment verification failed: ${err.message}`);
                topupBtn.disabled = false;
                topupBtn.textContent = `Buy ${credits} Credits`;
              }
            },
            prefill: { email: appState.user ? appState.user.email : '' },
            theme: { color: '#7C3AED' },
            modal: {
              ondismiss: () => {
                topupBtn.disabled = false;
                topupBtn.textContent = `Buy ${credits} Credits`;
              }
            }
          };
          const rzp = new window.Razorpay(rzpOptions);
          rzp.on('payment.failed', function (resp) {
            topupBtn.disabled = false;
            topupBtn.textContent = `Buy ${credits} Credits`;
            const reason = resp.error ? resp.error.description : 'Payment could not be completed.';
            alert(`⚠️ Payment Incomplete: ${reason}\n\nNo charges were deducted from your bank. You can try again with UPI or another payment method.`);
          });
          rzp.open();
        }
      } catch (err) {
        alert(`Failed to initiate payment: ${err.message}`);
        topupBtn.disabled = false;
        topupBtn.textContent = `Buy ${credits} Credits`;
      }
      return;
    }

    // 5. Select Subscription Plan
    const planBtn = e.target.closest('[data-plan-select]');
    if (planBtn) {
      const plan = planBtn.getAttribute('data-plan-select');
      if (plan === currentTier) {
        alert('You are already on this plan.');
        return;
      }

      planBtn.disabled = true;
      planBtn.textContent = 'Creating Order...';

      try {
        const order = await apiFetch('/billing/razorpay/order/subscription', {
          method: 'POST',
          body: JSON.stringify({ tier: plan, currency: modalCurrency })
        });

        if (order.status === 'scheduled') {
          showScheduledDowngradeModal(order, async () => {
            await syncUserProfile();
            closeModal();
            initApp();
          });
          return;
        }

        const handleCheckout = () => {
          planBtn.textContent = 'Opening Payment...';

          if (order.order_id.startsWith('order_mock_') || !order.key_id) {
            showSubscriptionMockPayment(order, async () => {
              try {
                await apiFetch('/billing/razorpay/verify/subscription', {
                  method: 'POST',
                  body: JSON.stringify({
                    razorpay_order_id: order.order_id,
                    razorpay_payment_id: 'pay_mock_sub_approved',
                    razorpay_signature: 'mock_signature_approved',
                    tier: order.tier
                  })
                });
                await syncUserProfile();
                showSubscriptionSuccess(order.display_name);
                closeModal();
                initApp();
              } catch (err) {
                alert(`Subscription activation failed: ${err.message}`);
                planBtn.disabled = false;
                planBtn.textContent = 'Subscribe Now';
              }
            });
          } else {
            const rzpOptions = {
              key: order.key_id,
              amount: order.amount,
              currency: order.currency,
              name: 'CropStudio AI',
              description: `${order.display_name} – Monthly Subscription`,
              order_id: order.order_id,
              handler: async function (response) {
                try {
                  await apiFetch('/billing/razorpay/verify/subscription', {
                    method: 'POST',
                    body: JSON.stringify({
                      razorpay_order_id: response.razorpay_order_id,
                      razorpay_payment_id: response.razorpay_payment_id,
                      razorpay_signature: response.razorpay_signature,
                      tier: order.tier
                    })
                  });
                  await syncUserProfile();
                  showSubscriptionSuccess(order.display_name);
                  closeModal();
                  initApp();
                } catch (err) {
                  alert(`Payment verification failed: ${err.message}`);
                  planBtn.disabled = false;
                  planBtn.textContent = 'Subscribe Now';
                }
              },
              prefill: { email: appState.user ? appState.user.email : '' },
              theme: { color: '#7C3AED' },
              modal: {
                ondismiss: () => {
                  planBtn.disabled = false;
                  planBtn.textContent = 'Subscribe Now';
                }
              }
            };
            const rzp = new window.Razorpay(rzpOptions);
            rzp.on('payment.failed', function (resp) {
              planBtn.disabled = false;
              planBtn.textContent = 'Subscribe Now';
              const reason = resp.error ? resp.error.description : 'Subscription payment could not be completed.';
              alert(`⚠️ Payment Incomplete: ${reason}\n\nNo charges were deducted. You can try again anytime.`);
            });
            rzp.open();
          }
        };

        if (order.prorated) {
          showProrationConfirmModal(order, handleCheckout, () => {
            planBtn.disabled = false;
            planBtn.textContent = 'Subscribe Now';
          });
        } else {
          handleCheckout();
        }
      } catch (err) {
        alert(`Payment initiation failed: ${err.message}`);
        planBtn.disabled = false;
        planBtn.textContent = 'Subscribe Now';
      }
      return;
    }
  });

  renderModalBody();
  document.body.appendChild(modalContainer);
}

// Show a confirm dialog for prorated plan upgrades
function showProrationConfirmModal(order, onProceed, onCancel) {
  const overlay = document.createElement('div');
  overlay.id = 'proration-confirm-overlay';
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:35000;font-family:var(--font-family);';

  const planColors = {
    creator_lite: '#059669',
    brand_pro: '#7C3AED',
    enterprise_studio: '#1D4ED8'
  };
  const accentColor = planColors[order.tier] || '#7C3AED';

  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;width:400px;padding:32px;box-shadow:0 30px 60px rgba(0,0,0,0.3);position:relative;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:56px;height:56px;background:${accentColor}15;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 4px;">Confirm Plan Upgrade</h2>
        <p style="font-size:13px;color:#6B7280;margin:0;">Prorated subscription adjustment</p>
      </div>

      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:20px;font-size:13px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#6B7280;">Target Plan</span>
          <span style="font-weight:600;color:#111827;">${order.display_name}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#6B7280;">Days remaining in cycle</span>
          <span style="font-weight:600;color:#111827;">${order.days_remaining} days</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#6B7280;">Full Price</span>
          <span style="font-weight:600;color:#6b7280;text-decoration:line-through;">₹${(order.original_amount / 100).toFixed(0)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid #E5E7EB;">
          <span style="font-weight:700;color:#111827;">Prorated Charge</span>
          <span style="font-size:16px;font-weight:800;color:${accentColor};">₹${(order.amount / 100).toFixed(0)}</span>
        </div>
        <div style="font-size:11px;color:#059669;text-align:right;margin-top:2px;">
          ✨ Proration savings: ₹${(order.proration_savings / 100).toFixed(0)}
        </div>
      </div>

      <div style="display:flex;gap:10px;">
        <button id="proration-cancel" style="flex:1;padding:12px;border:1px solid #E5E7EB;border-radius:10px;background:white;color:#374151;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="proration-proceed" style="flex:2;padding:12px;border:none;border-radius:10px;background:${accentColor};color:white;font-size:14px;font-weight:700;cursor:pointer;">
          Proceed to Pay
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('proration-cancel').addEventListener('click', () => {
    overlay.remove();
    onCancel();
  });

  document.getElementById('proration-proceed').addEventListener('click', () => {
    overlay.remove();
    onProceed();
  });
}

// Show scheduled downgrade confirmation
function showScheduledDowngradeModal(order, onConfirm) {
  const overlay = document.createElement('div');
  overlay.id = 'downgrade-confirm-overlay';
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:35000;font-family:var(--font-family);';

  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;width:380px;padding:32px;box-shadow:0 30px 60px rgba(0,0,0,0.3);position:relative;text-align:center;">
      <div style="width:56px;height:56px;background:#3B82F615;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 8 8 12 12 16"/><line x1="16" y1="12" x2="8" y2="12"/></svg>
      </div>
      <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">Downgrade Scheduled</h2>
      <p style="font-size:13px;color:#6B7280;line-height:1.5;margin:0 0 20px;">
        You've scheduled a transition to the <strong>${order.display_name}</strong> plan. This will automatically take effect at the end of your current cycle in <strong>${order.days_remaining} days</strong>. No payment is charged today.
      </p>

      <button id="downgrade-ok" style="width:100%;padding:12px;border:none;border-radius:10px;background:#3B82F6;color:white;font-size:14px;font-weight:700;cursor:pointer;">
        Got it, thanks!
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('downgrade-ok').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}


// Show a branded mock payment dialog for subscription (when Razorpay keys not set)
function showSubscriptionMockPayment(order, onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'sub-mock-pay-overlay';
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:30000;font-family:var(--font-family);';

  const planColors = {
    creator_lite: '#059669',
    brand_pro: '#7C3AED',
    enterprise_studio: '#1D4ED8'
  };
  const accentColor = planColors[order.tier] || '#7C3AED';

  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;width:380px;padding:32px;box-shadow:0 30px 60px rgba(0,0,0,0.3);position:relative;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:56px;height:56px;background:${accentColor}15;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 4px;">Complete Your Payment</h2>
        <p style="font-size:13px;color:#6B7280;margin:0;">Secure checkout via Razorpay</p>
      </div>

      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;color:#6B7280;">Plan</span>
          <span style="font-size:13px;font-weight:600;color:#111827;">${order.display_name}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;color:#6B7280;">Credits Included</span>
          <span style="font-size:13px;font-weight:600;color:#111827;">${order.credits.toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid #E5E7EB;margin-top:4px;">
          <span style="font-size:14px;font-weight:700;color:#111827;">Total</span>
          <span style="font-size:18px;font-weight:800;color:${accentColor};">₹${(order.amount / 100).toLocaleString()}</span>
        </div>
      </div>

      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#92400E;">
        ⚠️ <strong>Test Mode:</strong> Razorpay API keys not configured. This simulates a real payment.
      </div>

      <div style="display:flex;gap:10px;">
        <button id="sub-mock-cancel" style="flex:1;padding:12px;border:1px solid #E5E7EB;border-radius:10px;background:white;color:#374151;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="sub-mock-pay" style="flex:2;padding:12px;border:none;border-radius:10px;background:${accentColor};color:white;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Simulate Payment
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('sub-mock-cancel').addEventListener('click', () => {
    overlay.remove();
  });

  document.getElementById('sub-mock-pay').addEventListener('click', async () => {
    const payBtn = document.getElementById('sub-mock-pay');
    payBtn.disabled = true;
    payBtn.innerHTML = `<div class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></div> Upgrading Workspace...`;
    await new Promise(r => setTimeout(r, 1200)); // Simulate processing delay
    overlay.remove();
    onSuccess();
  });
}

// Show a success celebration after subscription activation
function showSubscriptionSuccess(planName) {
  const toast = document.createElement('div');
  toast.style = `
    position: fixed; bottom: 32px; right: 32px; z-index: 40000;
    background: linear-gradient(135deg, #7C3AED, #4F46E5);
    color: white; border-radius: 16px; padding: 20px 24px;
    box-shadow: 0 20px 40px rgba(124, 58, 237, 0.4);
    display: flex; align-items: center; gap: 16px;
    animation: toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    max-width: 380px; font-family: var(--font-family);
  `;
  toast.innerHTML = `
    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px;">🎉</div>
    <div>
      <div style="font-weight:700;font-size:15px;margin-bottom:2px;">Subscription Activated!</div>
      <div style="font-size:13px;opacity:0.85;">Welcome to <strong>${planName}</strong>. Your credits have been added.</div>
    </div>
  `;

  // Add animation keyframe if not present
  if (!document.getElementById('toast-anim-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'toast-anim-style';
    styleEl.textContent = `
      @keyframes toastSlideIn {
        from { opacity: 0; transform: translateY(24px) scale(0.95); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }
    `;
    document.head.appendChild(styleEl);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s, transform 0.4s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}


// ─── Account Settings Modal ───
function openAccountSettingsModal(activeTab = 'profile') {
  let modalContainer = document.getElementById('account-settings-modal-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'account-settings-modal-container';
    modalContainer.className = 'app-custom-modal';
    document.body.appendChild(modalContainer);
  }

  const user = appState.user || {};
  const profile = user.profile || {};
  const prefs = profile.preferences || {};
  const email = user.email || 'user@example.com';
  const displayName = profile.display_name || email.split('@')[0];
  const brandName = prefs.brand_name || '';
  const currency = prefs.currency || 'INR';
  const defaultRatio = prefs.default_ratio || '3:4';
  const defaultFormat = prefs.default_format || 'png';
  const autoEnhance = prefs.auto_enhance !== false;
  const modelStyle = prefs.model_style || 'indian_female';

  const renderContent = (currentTab) => {
    let bodyHtml = '';

    if (currentTab === 'profile') {
      bodyHtml = `
        <form class="modal-form-section" id="form-settings-profile">
          <div class="modal-form-row">
            <div class="modal-form-group">
              <label class="modal-form-label">Display Name</label>
              <input type="text" class="modal-form-input" id="settings-display-name" value="${escapeHtml(displayName)}" placeholder="Your full name" required />
            </div>
            <div class="modal-form-group">
              <label class="modal-form-label">Brand / Business Name</label>
              <input type="text" class="modal-form-input" id="settings-brand-name" value="${escapeHtml(brandName)}" placeholder="e.g. Kweka Apparel Studio" />
            </div>
          </div>

          <div class="modal-form-group">
            <label class="modal-form-label">Account Email Address</label>
            <div style="position:relative; display:flex; align-items:center;">
              <input type="email" class="modal-form-input" value="${escapeHtml(email)}" disabled style="padding-right: 90px;" />
              <span style="position:absolute; right:12px; font-size:11px; font-weight:700; color:#16a34a; background:#dcfce7; padding:3px 8px; border-radius:100px;">✓ Verified</span>
            </div>
          </div>

          <div class="modal-form-group">
            <label class="modal-form-label">Preferred Currency Display</label>
            <select class="modal-form-select" id="settings-currency">
              <option value="INR" ${currency === 'INR' ? 'selected' : ''}>₹ INR (Indian Rupee)</option>
              <option value="USD" ${currency === 'USD' ? 'selected' : ''}>$ USD (US Dollar)</option>
            </select>
          </div>

          <div id="settings-profile-msg" style="display:none; font-size:13px; font-weight:600; padding:8px 12px; border-radius:8px;"></div>

          <div class="modal-action-bar">
            <button type="submit" class="modal-btn-primary" id="btn-save-profile">Save Changes</button>
          </div>
        </form>
      `;
    } else if (currentTab === 'security') {
      bodyHtml = `
        <div class="modal-form-section">
          <!-- Password Change -->
          <form id="form-settings-password" style="display:flex; flex-direction:column; gap:14px;">
            <div class="modal-form-group">
              <label class="modal-form-label">New Password</label>
              <input type="password" class="modal-form-input" id="settings-new-password" placeholder="Min. 6 characters" minlength="6" required />
            </div>
            <div class="modal-form-group">
              <label class="modal-form-label">Confirm New Password</label>
              <input type="password" class="modal-form-input" id="settings-confirm-password" placeholder="Re-enter new password" minlength="6" required />
            </div>

            <div id="settings-password-msg" style="display:none; font-size:13px; font-weight:600; padding:8px 12px; border-radius:8px;"></div>

            <div style="display:flex; justify-content:flex-end;">
              <button type="submit" class="modal-btn-primary" id="btn-update-password">Update Password</button>
            </div>
          </form>

          <div style="border-top:1px solid #f1f5f9; padding-top:18px; margin-top:8px;">
            <label class="modal-form-label" style="margin-bottom:8px; display:block;">Authentication Method</label>
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                </svg>
                <div>
                  <div style="font-size:13px; font-weight:700; color:#0f172a;">Google Account Integration</div>
                  <div style="font-size:11px; color:#64748b;">Instant 1-click passwordless access</div>
                </div>
              </div>
              <span style="font-size:12px; font-weight:700; color:#4f46e5; background:#eef2ff; padding:4px 10px; border-radius:100px;">Enabled</span>
            </div>
          </div>
        </div>
      `;
    } else if (currentTab === 'studio') {
      bodyHtml = `
        <form class="modal-form-section" id="form-settings-studio">
          <div class="modal-form-row">
            <div class="modal-form-group">
              <label class="modal-form-label">Default Marketplace Aspect Ratio</label>
              <select class="modal-form-select" id="settings-default-ratio">
                <option value="3:4" ${defaultRatio === '3:4' ? 'selected' : ''}>Flipkart & Myntra (3:4 Catalog)</option>
                <option value="1:1" ${defaultRatio === '1:1' ? 'selected' : ''}>Amazon & Meesho (1:1 Square)</option>
                <option value="4:5" ${defaultRatio === '4:5' ? 'selected' : ''}>Instagram & Social (4:5 Portrait)</option>
                <option value="9:16" ${defaultRatio === '9:16' ? 'selected' : ''}>Story & Reels (9:16 Fullscreen)</option>
              </select>
            </div>
            <div class="modal-form-group">
              <label class="modal-form-label">Default Export Format</label>
              <select class="modal-form-select" id="settings-default-format">
                <option value="png" ${defaultFormat === 'png' ? 'selected' : ''}>PNG (Studio Master Lossless)</option>
                <option value="jpg" ${defaultFormat === 'jpg' ? 'selected' : ''}>JPG (Web High Speed)</option>
                <option value="webp" ${defaultFormat === 'webp' ? 'selected' : ''}>WEBP (Next-Gen Compressed)</option>
              </select>
            </div>
          </div>

          <div class="modal-form-group">
            <label class="modal-form-label">Default AI Model Styling Preference</label>
            <select class="modal-form-select" id="settings-default-model">
              <option value="indian_female" ${modelStyle === 'indian_female' ? 'selected' : ''}>Indian Female Studio Model (High-Fashion)</option>
              <option value="indian_male" ${modelStyle === 'indian_male' ? 'selected' : ''}>Indian Male Studio Model (Contemporary)</option>
              <option value="international_female" ${modelStyle === 'international_female' ? 'selected' : ''}>International / Editorial Female</option>
              <option value="international_male" ${modelStyle === 'international_male' ? 'selected' : ''}>International / Editorial Male</option>
            </select>
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
            <div>
              <div style="font-size:13px; font-weight:700; color:#0f172a;">Auto-Enhance Lighting & Shadows</div>
              <div style="font-size:11px; color:#64748b;">Automatically apply softbox daylight studio diffusion to raw product shots</div>
            </div>
            <input type="checkbox" id="settings-auto-enhance" ${autoEnhance ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;" />
          </div>

          <div id="settings-studio-msg" style="display:none; font-size:13px; font-weight:600; padding:8px 12px; border-radius:8px;"></div>

          <div class="modal-action-bar">
            <button type="submit" class="modal-btn-primary" id="btn-save-studio">Save Studio Defaults</button>
          </div>
        </form>
      `;
    } else if (currentTab === 'danger') {
      bodyHtml = `
        <div class="modal-form-section">
          <div class="danger-zone-box">
            <div class="danger-zone-text">
              <h4>Clear Workspace Cache</h4>
              <p>Reset local preview cache and sync freshly with the AI cluster.</p>
            </div>
            <button class="modal-btn-primary" id="btn-clear-cache" style="background:#475569;">Clear Cache</button>
          </div>

          <div class="danger-zone-box" style="border-color:#fca5a5;">
            <div class="danger-zone-text">
              <h4>Delete Account & Data</h4>
              <p>Permanently remove your account, generation history, and invoices.</p>
            </div>
            <button class="modal-btn-danger" id="btn-delete-account">Delete Account</button>
          </div>
        </div>
      `;
    }

    modalContainer.innerHTML = `
      <div class="app-modal-card">
        <div class="app-modal-header">
          <div class="app-modal-header-left">
            <div class="app-modal-icon-badge">⚙️</div>
            <div>
              <h2 class="app-modal-title">Account Settings</h2>
              <div class="app-modal-subtitle">Manage your profile, security, and catalog preferences</div>
            </div>
          </div>
          <button class="app-modal-close-btn" id="btn-close-settings-modal">&times;</button>
        </div>

        <div class="app-modal-tabs">
          <button class="app-modal-tab-btn ${currentTab === 'profile' ? 'app-modal-tab-btn--active' : ''}" data-tab="profile">
            👤 Profile & Brand
          </button>
          <button class="app-modal-tab-btn ${currentTab === 'security' ? 'app-modal-tab-btn--active' : ''}" data-tab="security">
            🔒 Security & Password
          </button>
          <button class="app-modal-tab-btn ${currentTab === 'studio' ? 'app-modal-tab-btn--active' : ''}" data-tab="studio">
            🎨 Studio Defaults
          </button>
          <button class="app-modal-tab-btn ${currentTab === 'danger' ? 'app-modal-tab-btn--active' : ''}" data-tab="danger">
            ⚠️ Danger Zone
          </button>
        </div>

        <div class="app-modal-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    // Attach Tab listeners
    modalContainer.querySelectorAll('.app-modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderContent(btn.getAttribute('data-tab'));
      });
    });

    // Close button
    document.getElementById('btn-close-settings-modal')?.addEventListener('click', () => {
      modalContainer.classList.remove('open');
    });

    // Profile form submit
    document.getElementById('form-settings-profile')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-profile');
      const msgEl = document.getElementById('settings-profile-msg');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const newDisplayName = document.getElementById('settings-display-name').value.trim();
        const newBrandName = document.getElementById('settings-brand-name').value.trim();
        const newCurrency = document.getElementById('settings-currency').value;

        const currentPrefs = (appState.user && appState.user.profile && appState.user.profile.preferences) || {};
        const updatedPrefs = { ...currentPrefs, brand_name: newBrandName, currency: newCurrency };

        const res = await apiFetch('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            display_name: newDisplayName,
            preferences: updatedPrefs
          })
        });

        if (res && res.profile) {
          appState.user.profile = res.profile;
        }

        msgEl.style.display = 'block';
        msgEl.style.background = '#dcfce7';
        msgEl.style.color = '#15803d';
        msgEl.textContent = '✓ Profile & Brand settings updated successfully!';
        setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
      } catch (err) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fee2e2';
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = `Failed to update profile: ${err.message}`;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    // Password form submit
    document.getElementById('form-settings-password')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updateBtn = document.getElementById('btn-update-password');
      const msgEl = document.getElementById('settings-password-msg');
      const newPassword = document.getElementById('settings-new-password').value;
      const confirmPassword = document.getElementById('settings-confirm-password').value;

      if (newPassword !== confirmPassword) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fee2e2';
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Passwords do not match. Please re-enter.';
        return;
      }

      updateBtn.disabled = true;
      updateBtn.textContent = 'Updating...';

      try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient.auth) {
          const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
          if (error) throw error;
          msgEl.style.display = 'block';
          msgEl.style.background = '#dcfce7';
          msgEl.style.color = '#15803d';
          msgEl.textContent = '✓ Password successfully changed!';
          document.getElementById('settings-new-password').value = '';
          document.getElementById('settings-confirm-password').value = '';
        }
      } catch (err) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fee2e2';
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = `Password update failed: ${err.message}`;
      } finally {
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Password';
      }
    });

    // Studio Defaults submit
    document.getElementById('form-settings-studio')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-studio');
      const msgEl = document.getElementById('settings-studio-msg');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving Defaults...';

      try {
        const dRatio = document.getElementById('settings-default-ratio').value;
        const dFormat = document.getElementById('settings-default-format').value;
        const dModel = document.getElementById('settings-default-model').value;
        const aEnhance = document.getElementById('settings-auto-enhance').checked;

        const currentPrefs = (appState.user && appState.user.profile && appState.user.profile.preferences) || {};
        const updatedPrefs = {
          ...currentPrefs,
          default_ratio: dRatio,
          default_format: dFormat,
          model_style: dModel,
          auto_enhance: aEnhance
        };

        const res = await apiFetch('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({ preferences: updatedPrefs })
        });

        if (res && res.profile) {
          appState.user.profile = res.profile;
        }

        msgEl.style.display = 'block';
        msgEl.style.background = '#dcfce7';
        msgEl.style.color = '#15803d';
        msgEl.textContent = '✓ Studio defaults saved! They will now automatically pre-fill in new sessions.';
        setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
      } catch (err) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fee2e2';
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = `Failed to save studio defaults: ${err.message}`;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Studio Defaults';
      }
    });

    // Danger Zone actions
    document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
      localStorage.removeItem('cs_recent_prompts');
      localStorage.removeItem('cs_batch_history');
      alert('✓ Studio cache cleared successfully.');
    });

    document.getElementById('btn-delete-account')?.addEventListener('click', () => {
      if (confirm('⚠️ Are you sure you want to delete your account? This action cannot be undone.')) {
        alert('Please contact support@cropstudio.ai to finalize permanent account deletion.');
      }
    });
  };

  renderContent(activeTab);
  modalContainer.classList.add('open');

  modalContainer.onclick = (e) => {
    if (e.target === modalContainer) {
      modalContainer.classList.remove('open');
    }
  };
}

// ─── Help & Support Modal ───
function openHelpSupportModal(activeTab = 'contact') {
  let modalContainer = document.getElementById('help-support-modal-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'help-support-modal-container';
    modalContainer.className = 'app-custom-modal';
    document.body.appendChild(modalContainer);
  }

  const renderContent = (currentTab) => {
    let bodyHtml = '';

    if (currentTab === 'contact') {
      bodyHtml = `
        <div class="modal-form-section">
          <!-- WhatsApp Quick Action Card -->
          <div class="support-whatsapp-card">
            <div>
              <div class="support-whatsapp-title">💬 WhatsApp Studio Helpline</div>
              <div class="support-whatsapp-sub">Instant 1-on-1 assistance for catalogs & batch setup (9 AM – 9 PM IST)</div>
            </div>
            <a href="https://wa.me/919999999999?text=Hi%20CropStudio%20Team%2C%20I%20need%20help%20with%20my%20catalog" target="_blank" rel="noopener noreferrer" class="support-whatsapp-btn">
              <span>Open WhatsApp</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </div>

          <!-- In-App Support Ticket Form -->
          <form id="form-support-ticket" style="display:flex; flex-direction:column; gap:14px;">
            <div class="modal-form-row">
              <div class="modal-form-group">
                <label class="modal-form-label">Inquiry Category</label>
                <select class="modal-form-select" id="ticket-category" required>
                  <option value="generation_quality">🎨 Generation Quality & AI Models</option>
                  <option value="billing_credits">💳 Billing, Invoices & Credits</option>
                  <option value="batch_export">⚡ Batch Processing & ZIP Export</option>
                  <option value="technical_bug">🐛 Technical Issue or Error</option>
                  <option value="feature_request">💡 Custom Feature Request</option>
                </select>
              </div>
              <div class="modal-form-group">
                <label class="modal-form-label">Subject</label>
                <input type="text" class="modal-form-input" id="ticket-subject" placeholder="Brief summary of your question" required />
              </div>
            </div>

            <div class="modal-form-group">
              <label class="modal-form-label">Detailed Description</label>
              <textarea class="modal-form-textarea" id="ticket-message" rows="4" placeholder="Describe the issue or assistance required in detail..." required></textarea>
            </div>

            <div id="support-ticket-response" style="display:none; font-size:13px; font-weight:600; padding:10px 14px; border-radius:10px;"></div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
              <div style="font-size:12px; color:#64748b;">
                📧 Direct Email: <a href="mailto:support@cropstudio.ai" style="color:#4f46e5; font-weight:600; text-decoration:none;">support@cropstudio.ai</a>
              </div>
              <button type="submit" class="modal-btn-primary" id="btn-submit-ticket">Submit Ticket</button>
            </div>
          </form>
        </div>
      `;
    } else if (currentTab === 'faqs') {
      bodyHtml = `
        <div class="faq-accordion">
          <div class="faq-card open">
            <div class="faq-question">
              <span>How are credits deducted for single vs batch operations?</span>
              <span class="faq-chevron">▼</span>
            </div>
            <div class="faq-answer">
              Each AI generated studio visual consumes 1 credit. Batch operations deduct 1 credit per successfully generated SKU visual. Add-on top-up credits come with Lifetime Validity and never expire.
            </div>
          </div>

          <div class="faq-card">
            <div class="faq-question">
              <span>How do I get optimal results from flat-lay and ghost mannequin photos?</span>
              <span class="faq-chevron">▼</span>
            </div>
            <div class="faq-answer">
              For best results, upload clean, well-lit frontal photos with the apparel laid flat on a neutral or solid background. CropStudio AI automatically isolates the garment and maps it onto human studio models with realistic folds and lighting.
            </div>
          </div>

          <div class="faq-card">
            <div class="faq-question">
              <span>How do monthly plan renewals and top-up rollovers work?</span>
              <span class="faq-chevron">▼</span>
            </div>
            <div class="faq-answer">
              Your monthly plan renews automatically every 30 days, refreshing your quota. Any purchased Add-On Top-Up credits remain untouched in your lifetime balance and roll over seamlessly.
            </div>
          </div>

          <div class="faq-card">
            <div class="faq-question">
              <span>Where can I download GST/Tax invoices for accounting?</span>
              <span class="faq-chevron">▼</span>
            </div>
            <div class="faq-answer">
              Click on <strong>Upgrade & Billing</strong> in your profile dropdown. Scroll down to the <em>Billing History & Invoices</em> table, where you can view and download branded GST receipts for every purchase with one click.
            </div>
          </div>

          <div class="faq-card">
            <div class="faq-question">
              <span>Are CropStudio visuals compliant with Amazon & Flipkart guidelines?</span>
              <span class="faq-chevron">▼</span>
            </div>
            <div class="faq-answer">
              Yes! Our export presets adhere strictly to marketplace standards: Flipkart uses 3:4 (768×1024 / 2K), Amazon uses 1:1 (1000×1000 pure white background), and Instagram uses 4:5 (1080×1350).
            </div>
          </div>
        </div>
      `;
    } else if (currentTab === 'status') {
      bodyHtml = `
        <div class="modal-form-section">
          <div class="system-status-box">
            <div class="system-status-left">
              <div class="system-status-dot"></div>
              <div>
                <div style="font-size:14px; font-weight:700; color:#15803d;">All AI Generation Clusters Operational</div>
                <div style="font-size:12px; color:#166534;">99.98% uptime in the last 30 days • Average generation latency: 3.4s</div>
              </div>
            </div>
            <span style="font-size:12px; font-weight:700; color:#15803d; background:#dcfce7; padding:4px 10px; border-radius:100px;">Healthy</span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:8px;">
            <div style="padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc;">
              <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase;">Primary Vision Engine</div>
              <div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px;">Gemini 2.5 Flash / Flux 4K</div>
              <div style="font-size:11px; color:#22c55e; margin-top:4px;">● Connected & Serving</div>
            </div>
            <div style="padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc;">
              <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase;">Razorpay Payment Gateway</div>
              <div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px;">UPI, Cards & NetBanking</div>
              <div style="font-size:11px; color:#22c55e; margin-top:4px;">● 100% Instant Settlement</div>
            </div>
          </div>
        </div>
      `;
    }

    modalContainer.innerHTML = `
      <div class="app-modal-card">
        <div class="app-modal-header">
          <div class="app-modal-header-left">
            <div class="app-modal-icon-badge">💬</div>
            <div>
              <h2 class="app-modal-title">Help & Support Center</h2>
              <div class="app-modal-subtitle">Direct contact channels, catalog guides, and FAQs</div>
            </div>
          </div>
          <button class="app-modal-close-btn" id="btn-close-support-modal">&times;</button>
        </div>

        <div class="app-modal-tabs">
          <button class="app-modal-tab-btn ${currentTab === 'contact' ? 'app-modal-tab-btn--active' : ''}" data-tab="contact">
            ✉️ Contact & Support Ticket
          </button>
          <button class="app-modal-tab-btn ${currentTab === 'faqs' ? 'app-modal-tab-btn--active' : ''}" data-tab="faqs">
            ❓ Interactive FAQs
          </button>
          <button class="app-modal-tab-btn ${currentTab === 'status' ? 'app-modal-tab-btn--active' : ''}" data-tab="status">
            ⚡ System Health & Status
          </button>
        </div>

        <div class="app-modal-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    // Attach Tab listeners
    modalContainer.querySelectorAll('.app-modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderContent(btn.getAttribute('data-tab'));
      });
    });

    // Close button
    document.getElementById('btn-close-support-modal')?.addEventListener('click', () => {
      modalContainer.classList.remove('open');
    });

    // FAQ Accordion toggles
    modalContainer.querySelectorAll('.faq-question').forEach(q => {
      q.addEventListener('click', () => {
        const card = q.closest('.faq-card');
        card.classList.toggle('open');
      });
    });

    // Support ticket submit
    document.getElementById('form-support-ticket')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-ticket');
      const respEl = document.getElementById('support-ticket-response');
      const category = document.getElementById('ticket-category').value;
      const subject = document.getElementById('ticket-subject').value.trim();
      const message = document.getElementById('ticket-message').value.trim();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting Ticket...';

      try {
        const res = await apiFetch('/users/support-ticket', {
          method: 'POST',
          body: JSON.stringify({ category, subject, message })
        });

        respEl.style.display = 'block';
        respEl.style.background = '#dcfce7';
        respEl.style.color = '#15803d';
        respEl.innerHTML = `
          🎉 <strong>Ticket Submitted Successfully!</strong><br/>
          Ticket ID: <code>${escapeHtml(res.ticket_id || 'TICK-NEW')}</code><br/>
          <span style="font-size:12px; font-weight:500;">Our catalog team will review your inquiry and email you within 2 hours.</span>
        `;
        document.getElementById('ticket-subject').value = '';
        document.getElementById('ticket-message').value = '';
      } catch (err) {
        respEl.style.display = 'block';
        respEl.style.background = '#fee2e2';
        respEl.style.color = '#b91c1c';
        respEl.textContent = `Failed to submit ticket: ${err.message}`;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Ticket';
      }
    });
  };

  renderContent(activeTab);
  modalContainer.classList.add('open');

  modalContainer.onclick = (e) => {
    if (e.target === modalContainer) {
      modalContainer.classList.remove('open');
    }
  };
}

function initProfileDropdownAndPricing() {
  const profileBtn = document.getElementById('btn-profile');
  const dropdown = document.getElementById('profile-dropdown');

  if (profileBtn && dropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!profileBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    document.getElementById('dropdown-btn-upgrade')?.addEventListener('click', () => {
      dropdown.classList.remove('open');
      openPricingModal();
    });

    document.getElementById('dropdown-btn-settings')?.addEventListener('click', () => {
      dropdown.classList.remove('open');
      openAccountSettingsModal('profile');
    });

    document.getElementById('dropdown-btn-support')?.addEventListener('click', () => {
      dropdown.classList.remove('open');
      openHelpSupportModal('contact');
    });

    document.getElementById('btn-signout')?.addEventListener('click', async () => {
      dropdown.classList.remove('open');
      await supabaseClient.auth.signOut();
      appState.token = '';
      appState.user = null;
      localStorage.removeItem('cs_token');
      renderAuth();
    });
  }
}


export async function navigateToRoute(navId, pushToHistory = true) {
  const sidebar = document.getElementById('sidebar');
  const pageContent = document.getElementById('page-content');
  const breadcrumb = document.querySelector('.topbar__breadcrumb');

  // Normalize navId
  let route = navId || 'home';
  if (route.startsWith('#')) route = route.slice(1);
  if (!route) route = 'home';
  if (route === 'fc-batch' || route === 'qe-batch') route = 'batch';
  if (route === 'fc-onmodel' || route === 'qe-onmodel') route = 'on-model';
  if (route === 'fc-generate' || route === 'qe-ai-bg') route = 'generate';
  if (route === 'fc-removebg' || route === 'qe-removebg') route = 'removebg';
  if (route === 'fc-upscale' || route === 'qe-upscale') route = 'upscale';
  if (route === 'fc-edit' || route === 'qe-prompt-edit') route = 'edit';

  // Clear batch polling if navigating away
  if (appState.batchState.pollingInterval) {
    clearInterval(appState.batchState.pollingInterval);
    appState.batchState.pollingInterval = null;
  }

  // Update active sidebar item
  if (sidebar) {
    sidebar.querySelectorAll('.sidebar__item--active').forEach(el => {
      el.classList.remove('sidebar__item--active');
    });
    const activeItem = document.getElementById('nav-' + route) || document.querySelector(`.sidebar__item[data-nav="${route}"]`);
    if (activeItem) {
      activeItem.classList.add('sidebar__item--active');
    }
  }

  // Route metadata and content rendering
  const routeMeta = {
    'home': {
      label: 'Home',
      class: 'content',
      render: () => {
        appState.batchState.view = 'upload';
        uploadedFiles = [];
        appState.onModelState = { clothImages: [], selectedModel: null };
        return renderHome();
      }
    },
    'on-model': {
      label: 'On Model',
      class: 'content content--onmodel',
      render: renderOnModel
    },
    'generate': {
      label: 'Generate',
      class: 'content content--generate',
      render: renderGenerate
    },
    'batch': {
      label: 'Batch Studio',
      class: 'content content--batch',
      render: () => {
        appState.batchState.view = 'upload';
        uploadedFiles = [];
        return renderBatch();
      }
    },
    'edit': {
      label: 'Edit Canvas',
      class: 'content content--edit',
      render: renderEdit
    },
    'removebg': {
      label: 'Remove Background',
      class: 'content content--removebg',
      render: renderRemoveBg
    },
    'upscale': {
      label: 'Upscale',
      class: 'content content--upscale',
      render: renderUpscale
    },
    'admin': {
      label: 'Admin Panel',
      class: 'content content--admin',
      asyncRender: renderAdminDashboard
    },
    'assets': {
      label: 'Assets Library',
      class: 'content content--assets',
      asyncRender: async () => {
        appState.assetsState.view = 'folders';
        appState.assetsState.selectedDate = null;
        if (pageContent) {
          pageContent.innerHTML = `
            <div class="cs-loading-screen">
              <div class="cs-spinner cs-spinner--lg"></div>
              <div>
                <p class="cs-loading-screen__title">Loading Asset Library...</p>
                <p class="cs-loading-screen__desc">Organizing your uploads and AI outputs</p>
              </div>
            </div>
          `;
        }
        try {
          const uploads = await apiFetch('/uploads/');
          const processed = await apiFetch('/uploads/processed');
          appState.assetsState.uploads = uploads;
          appState.assetsState.processed = processed;
          if (pageContent) pageContent.innerHTML = renderAssets();
        } catch (err) {
          console.error('Failed to load assets:', err);
          if (pageContent) {
            pageContent.innerHTML = `
              <div style="display:flex; align-items:center; justify-content:center; height:400px; color:var(--color-error);">
                <span>Failed to load assets: ${err.message}</span>
              </div>
            `;
          }
        }
      }
    },
    'billing': {
      label: 'Billing & Usage',
      class: 'content content--billing',
      asyncRender: async () => {
        if (pageContent) {
          pageContent.innerHTML = `
            <div class="cs-loading-screen">
              <div class="cs-spinner cs-spinner--lg"></div>
              <div>
                <p class="cs-loading-screen__title">Loading Billing & Usage...</p>
                <p class="cs-loading-screen__desc">Fetching your credit consumption and payment records</p>
              </div>
            </div>
          `;
        }
        try {
          const billingData = await apiFetch('/billing/usage-history');
          appState.billingState = { activeTab: 'usage', data: billingData };
          if (pageContent) pageContent.innerHTML = renderBilling();
        } catch (err) {
          console.error('Failed to load billing history:', err);
          if (pageContent) {
            pageContent.innerHTML = `
              <div style="display:flex; align-items:center; justify-content:center; height:400px; color:var(--color-error);">
                <span>Failed to load billing data: ${err.message}</span>
              </div>
            `;
          }
        }
      }
    }
  };

  const currentRouteMeta = routeMeta[route] || routeMeta['home'];

  if (breadcrumb) {
    breadcrumb.textContent = currentRouteMeta.label;
  }

  if (pageContent) {
    pageContent.className = currentRouteMeta.class;
    if (currentRouteMeta.asyncRender) {
      await currentRouteMeta.asyncRender();
    } else if (currentRouteMeta.render) {
      pageContent.innerHTML = currentRouteMeta.render();
    }
  }

  // Update browser history (so back/forward buttons work seamlessly without leaving the app)
  if (pushToHistory) {
    const hash = route === 'home' ? '' : '#' + route;
    const url = window.location.pathname + window.location.search + hash;
    if (window.location.hash !== hash) {
      history.pushState({ route: route }, '', url || window.location.pathname);
    }
  }
}

function initNavigation() {
  const sidebar = document.getElementById('sidebar');

  if (sidebar) {
    sidebar.addEventListener('click', async (e) => {
      const item = e.target.closest('.sidebar__item');
      if (!item) return;

      const navId = item.getAttribute('data-nav');
      if (navId) {
        await navigateToRoute(navId, true);
      }
    });
  }

  // Handle browser Back & Forward buttons
  window.addEventListener('popstate', (e) => {
    const route = e.state?.route || window.location.hash.replace('#', '') || 'home';
    navigateToRoute(route, false);
  });
}

function initFeatureCards() {
  const app = document.getElementById('app');
  app.addEventListener('click', async (e) => {
    const card = e.target.closest('.feature-card');
    const quickCard = e.target.closest('.quick-card');

    if (!card && !quickCard) return;

    if (card) {
      const cardId = card.id;
      if (cardId === 'fc-batch') navigateToRoute('batch', true);
      else if (cardId === 'fc-generate') navigateToRoute('generate', true);
      else if (cardId === 'fc-onmodel') navigateToRoute('on-model', true);
      else if (cardId === 'fc-removebg') navigateToRoute('removebg', true);
      else if (cardId === 'fc-upscale') navigateToRoute('upscale', true);
      else if (cardId === 'fc-edit') navigateToRoute('edit', true);
    } else if (quickCard) {
      const cardId = quickCard.id;
      if (cardId === 'qe-removebg') navigateToRoute('removebg', true);
      else if (cardId === 'qe-onmodel') navigateToRoute('on-model', true);
      else if (cardId === 'qe-ai-bg') navigateToRoute('generate', true);
      else if (cardId === 'qe-upscale') navigateToRoute('upscale', true);
      else if (cardId === 'qe-batch') navigateToRoute('batch', true);
      else if (cardId === 'qe-prompt-edit') navigateToRoute('edit', true);
    }
  });
}

function initSearch() {
  const searchInput = document.getElementById('sidebar-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = document.querySelectorAll('.sidebar__item');

      items.forEach(item => {
        const label = item.querySelector('span:last-child').textContent.toLowerCase();
        item.style.display = label.includes(query) || query === '' ? '' : 'none';
      });
    });
  }
}

// ─── Generate Screen Interactivity ───
function initGenerateEvents() {
  const app = document.getElementById('app');

  app.addEventListener('click', async (e) => {
    if (e.target.classList.contains('prompt-pill')) {
      const promptInput = document.getElementById('generate-prompt');
      if (promptInput) {
        promptInput.value = e.target.textContent;
        promptInput.focus();
      }
      return;
    }

    const refBtn = e.target.closest('#btn-reference-upload');
    if (refBtn) {
      const hiddenInput = document.getElementById('reference-upload-hidden');
      if (hiddenInput) hiddenInput.click();
      return;
    }

    const ratioToggle = e.target.closest('#btn-ratio-toggle');
    if (ratioToggle) {
      const dropdown = document.getElementById('ratio-dropdown');
      if (dropdown) dropdown.classList.toggle('open');
      return;
    }

    const removeRefBtn = e.target.closest('#btn-prompt-ref-remove');
    if (removeRefBtn) {
      e.stopPropagation();
      const hiddenInput = document.getElementById('reference-upload-hidden');
      const previewContainer = document.getElementById('prompt-ref-preview-container');
      const thumbImg = document.getElementById('prompt-ref-thumbnail-img');
      if (hiddenInput) hiddenInput.value = '';
      if (previewContainer) previewContainer.style.display = 'none';
      if (thumbImg) thumbImg.src = '';
      return;
    }

    const ratioItem = e.target.closest('.ratio-dropdown__item');
    if (ratioItem) {
      const dropdown = document.getElementById('ratio-dropdown');
      const ratioToggle = document.getElementById('btn-ratio-toggle');
      const ratioLabel = document.getElementById('ratio-label');
      
      const ratioVal = ratioItem.getAttribute('data-ratio');
      const ratioId = ratioItem.getAttribute('data-id');
      
      if (ratioLabel) ratioLabel.textContent = ratioVal;
      
      const iconEl = ratioToggle ? ratioToggle.querySelector('.ratio-icon') : null;
      if (iconEl) {
        iconEl.className = 'ratio-icon';
        const formattedClass = 'ratio-' + ratioVal.replace(':', '-');
        iconEl.classList.add(formattedClass);
      }
      
      if (dropdown) {
        dropdown.querySelectorAll('.ratio-dropdown__item').forEach(item => {
          item.classList.remove('active');
        });
        ratioItem.classList.add('active');
        dropdown.classList.remove('open');
      }
      
      appState.generateState = appState.generateState || {};
      appState.generateState.selectedRatio = ratioId;
      appState.generateState.selectedRatioVal = ratioVal;
      return;
    }

    // Process single text generation
    const genSubmit = e.target.closest('#btn-generate-submit');
    if (genSubmit) {
      const promptText = document.getElementById('generate-prompt').value.trim();
      if (!promptText) {
        alert('Please write a prompt before generating.');
        return;
      }

      // Check if reference image is selected
      const refHidden = document.getElementById('reference-upload-hidden');
      const hasImage = refHidden && refHidden.files.length > 0;

      const resultsPanel = document.getElementById('generate-results-panel');
      resultsPanel.innerHTML = `
        <div class="cs-loading-screen">
          <div class="cs-spinner cs-spinner--lg"></div>
          <div>
            <p class="cs-loading-screen__title">Launching Generation...</p>
            <p class="cs-loading-screen__desc">Uploading image inputs to AI studio</p>
          </div>
        </div>
      `;

      try {
        let imageIds = [];
        if (hasImage) {
          const file = refHidden.files[0];
          const uploadRes = await apiUpload(file);
          imageIds.push(uploadRes.id);
        } else {
          // If no image, we upload a transparent mock pixel as a placeholder for text-only generation
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          const file = new File([blob], 'placeholder.png', { type: 'image/png' });
          const uploadRes = await apiUpload(file);
          imageIds.push(uploadRes.id);
        }

        // Determine selected aspect ratio (default to flipkart -> 3:4 -> portrait)
        const selectedRatioVal = (appState.generateState && appState.generateState.selectedRatioVal) || '3:4';
        let aspect_ratio = 'portrait';
        if (selectedRatioVal === '1:1') {
          aspect_ratio = 'square';
        } else {
          const parts = selectedRatioVal.split(':');
          if (parts.length === 2) {
            const w = parseFloat(parts[0]);
            const h = parseFloat(parts[1]);
            if (!isNaN(w) && !isNaN(h)) {
              if (w === h) aspect_ratio = 'square';
              else if (w > h) aspect_ratio = 'landscape';
              else aspect_ratio = 'portrait';
            }
          }
        }

        const batchRes = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: `Generate - ${promptText.substring(0, 20)}`,
            image_ids: imageIds,
            generation_mode: 'lifestyle', // Default text-to-lifestyle photo
            config: {
              aspect_ratio: aspect_ratio,
              prompt: promptText
            }
          })
        });

        startPollingBatch(batchRes.id);

      } catch (err) {
        alert(`Generation launch failed: ${err.message}`);
        resultsPanel.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--color-error);">
            <span>Generation failed: ${err.message}</span>
          </div>
        `;
      }
      return;
    }

    // Modal Close
    const modalCloseBtn = e.target.closest('#modal-close');
    const isModalBg = e.target.id === 'image-modal';
    if (modalCloseBtn || isModalBg) {
      const modal = document.getElementById('image-modal');
      if (modal) modal.classList.remove('active');
    }
  });

  app.addEventListener('change', async (e) => {
    if (e.target.id === 'reference-upload-hidden') {
      const file = e.target.files[0];
      const previewContainer = document.getElementById('prompt-ref-preview-container');
      const thumbImg = document.getElementById('prompt-ref-thumbnail-img');

      if (file && previewContainer && thumbImg) {
        const reader = new FileReader();
        reader.onload = (event) => {
          thumbImg.src = event.target.result;
          previewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    }
  });
}

// ─── Batch Screen Interactivity ───
function initBatchEvents() {
  const pageContent = document.getElementById('page-content');

  async function handleFiles(files) {
    const dropZone = document.getElementById('batch-drop-zone');
    let completedCount = 0;
    const totalCount = files.length;

    function updateProgress() {
      if (dropZone) {
        dropZone.innerHTML = `
          <div class="cs-spinner cs-spinner--lg" style="margin-bottom:16px;"></div>
          <h2 style="font-size:16px; font-weight:600; color:var(--color-gray-900); margin:0 0 8px 0;">Uploading batch images... (${completedCount}/${totalCount})</h2>
          <div style="width: 240px; height: 6px; background: var(--color-gray-200); border-radius: 999px; overflow: hidden; margin-top: 10px;">
            <div style="width: ${Math.round((completedCount / totalCount) * 100)}%; height: 100%; background: linear-gradient(90deg, #7c3aed, #4f46e5); transition: width 0.3s ease;"></div>
          </div>
        `;
      }
    }

    try {
      updateProgress();
      const uploadPromises = Array.from(files).map(async file => {
        try {
          const uploadRes = await apiUpload(file);
          completedCount++;
          updateProgress();
          return {
            id: uploadRes.id,
            name: uploadRes.original_filename,
            url: uploadRes.url,
            size: `${Math.round(uploadRes.file_size_bytes / 1024)} KB`,
            selected: false,
            model: null
          };
        } catch (err) {
          completedCount++;
          updateProgress();
          throw err;
        }
      });

      const newFiles = await Promise.all(uploadPromises);
      uploadedFiles = [...uploadedFiles, ...newFiles];

      if (uploadedFiles.length > 0) {
        appState.batchState.view = 'workspace';
        pageContent.innerHTML = renderBatch();
      }
    } catch (err) {
      alert(`Batch upload failed: ${err.message}`);
      appState.batchState.view = 'upload';
      pageContent.innerHTML = renderBatch();
    }
  }

  pageContent.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-trigger-upload') || e.target.closest('#btn-add-more')) {
      document.getElementById('file-input-hidden')?.click();
      return;
    }

    // Thumbnail selection in progress split screen
    const thumbCard = e.target.closest('.batch-thumb-card');
    if (thumbCard) {
      const jobId = thumbCard.getAttribute('data-job-id');
      appState.batchState.selectedJobId = jobId;
      pageContent.innerHTML = renderBatchProgress();
      return;
    }

    // Single Download Action
    const dlSingleBtn = e.target.closest('.btn-download-selected');
    if (dlSingleBtn) {
      const url = dlSingleBtn.getAttribute('data-url');
      const filename = dlSingleBtn.getAttribute('data-filename');
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'download.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      return;
    }

    // Edit In Editor Action
    const editBtn = e.target.closest('.btn-edit-selected');
    if (editBtn) {
      const jobId = editBtn.getAttribute('data-job-id');
      if (batchDetailData && batchDetailData.jobs) {
        const job = batchDetailData.jobs.find(j => j.id === jobId);
        if (job && job.status === 'completed') {
          const originalFile = uploadedFiles.find(f => f.id === job.image_id);
          switchToEditView({
            id: job.image_id,
            url: job.result_url,
            name: originalFile ? originalFile.name : 'processed.png'
          });
        }
      }
      return;
    }

    // View Fullscreen Action
    const fsBtn = e.target.closest('.btn-fullscreen-selected');
    if (fsBtn) {
      const url = fsBtn.getAttribute('data-url');
      if (url) {
        window.open(url, '_blank');
      }
      return;
    }

    // Download All Completed Action
    const dlAllBtn = e.target.closest('#btn-batch-download-all');
    if (dlAllBtn) {
      if (batchDetailData && batchDetailData.jobs) {
        const completedJobs = batchDetailData.jobs.filter(j => j.status === 'completed');
        if (completedJobs.length === 0) {
          alert('No completed images to download yet.');
          return;
        }
        completedJobs.forEach((job, index) => {
          setTimeout(() => {
            const originalFile = uploadedFiles.find(f => f.id === job.image_id);
            const filename = originalFile ? originalFile.name.replace(/\.[^/.]+$/, "") : `image_${index + 1}`;
            const link = document.createElement('a');
            link.href = job.result_url;
            link.download = `${filename}_processed.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }, index * 300);
        });
      }
      return;
    }

    const delBtn = e.target.closest('.batch-thumb__delete');
    if (delBtn) {
      e.stopPropagation();
      const idx = parseInt(delBtn.getAttribute('data-index'));
      uploadedFiles.splice(idx, 1);
      if (uploadedFiles.length === 0) {
        appState.batchState.view = 'upload';
        pageContent.innerHTML = renderBatch();
      } else {
        pageContent.innerHTML = renderBatchWorkspace();
      }
      return;
    }

    if (e.target.classList.contains('batch-thumb__checkbox')) {
      e.stopPropagation();
      const idx = parseInt(e.target.getAttribute('data-index'));
      uploadedFiles[idx].selected = e.target.checked;
      pageContent.innerHTML = renderBatchWorkspace();
      return;
    }

    if (e.target.closest('#btn-assign-model')) {
      const modal = document.getElementById('avatar-modal');
      if (modal && uploadedFiles.some(f => f.selected)) {
        selectedAvatar = null;
        modal.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
        document.getElementById('btn-apply-avatar').disabled = true;
        modal.classList.add('active');
      }
      return;
    }

    const avatarCard = e.target.closest('.avatar-card');
    if (avatarCard) {
      document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
      avatarCard.classList.add('selected');
      selectedAvatar = avatarCard.getAttribute('data-avatar');
      document.getElementById('btn-apply-avatar').disabled = false;
      return;
    }

    if (e.target.closest('#btn-apply-avatar')) {
      if (selectedAvatar) {
        uploadedFiles.forEach(f => {
          if (f.selected) f.model = selectedAvatar;
        });
      }
      const modal = document.getElementById('avatar-modal');
      if (modal) modal.classList.remove('active');
      uploadedFiles.forEach(f => f.selected = false);
      pageContent.innerHTML = renderBatchWorkspace();
      return;
    }

    if (e.target.closest('#avatar-modal-close') || e.target.id === 'avatar-modal') {
      const modal = document.getElementById('avatar-modal');
      if (modal) modal.classList.remove('active');
      return;
    }

    const thumb = e.target.closest('.batch-thumb');
    if (thumb && !e.target.closest('.batch-thumb__checkbox')) {
      const idx = parseInt(thumb.getAttribute('data-index'));
      const modal = document.getElementById('image-modal');
      const modalImg = document.getElementById('modal-img');
      if (modal && modalImg) {
        modalImg.src = uploadedFiles[idx].url;
        modal.classList.add('active');
      }
      return;
    }

    // Launch processing of batch
    if (e.target.closest('#btn-process-batch')) {
      const checkedOpts = batchOptions.filter(o => o.checked);
      if (checkedOpts.length === 0) {
        alert('Please choose at least one processing option.');
        return;
      }

      const processBtn = document.getElementById('btn-process-batch');
      processBtn.disabled = true;
      processBtn.innerHTML = `<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></span> Launching Batch...`;

      try {
        const generationModes = checkedOpts.map(o => o.mode);
        const nameSuffix = checkedOpts.map(o => o.title).join(', ');

        let modelDesc = null;
        let modelBase64 = null;
        if (generationModes.includes('try_on') && selectedAvatar) {
          const selectedModelObj = onModelAvatars.find(a => a.id === selectedAvatar);
          const isMale = selectedModelObj ? selectedModelObj.tag === 'Male' : true;
          modelDesc = isMale ? 'professional male' : 'professional female';

          try {
            modelBase64 = await getBase64FromUrl(selectedAvatar);
          } catch (err) {
            console.error('Failed to encode model image to base64:', err);
          }
        }

        const activeRes = getDefaultResolutionForUser();
        const userTier = (appState.user && appState.user.profile) ? appState.user.profile.subscription_tier : 'free';

        const batchResponse = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: `Batch - ${nameSuffix}`,
            image_ids: uploadedFiles.map(f => f.id),
            generation_mode: generationModes,
            config: {
              model_description: modelDesc,
              clothing_item: 'clothing',
              model_image_base64: modelBase64,
              resolution_tier: activeRes,
              quality: (activeRes === '4k' || activeRes === '2k') ? 'high' : 'medium',
              subscription_tier: userTier
            }
          })
        });

        // Deduct credits in frontend state immediately
        if (appState.user && appState.user.profile) {
          const paidCount = generationModes.filter(m => m !== 'background_removal' && m !== 'white_background').length;
          const deducted = uploadedFiles.length * paidCount * 10;
          appState.user.profile.credit_balance = Math.max(0, (appState.user.profile.credit_balance || 0) - deducted);
          updateCreditsDisplay();
        }

        startPollingBatch(batchResponse.id);
      } catch (err) {
        alert(`Failed to launch batch processing: ${err.message}`);
        processBtn.disabled = false;
        processBtn.textContent = `✨ Process ${uploadedFiles.length} Images`;
      }
      return;
    }

    // Top-up / Upgrade from workspace
    if (e.target.closest('#btn-batch-buy-credits')) {
      openPricingModal('topup');
      return;
    }

    // Back to workspace button in progress view
    if (e.target.closest('#btn-batch-back-workspace')) {
      appState.batchState.view = 'upload';
      uploadedFiles = [];
      batchDetailData = null;
      appState.batchState.selectedJobId = null;
      pageContent.innerHTML = renderBatch();
      return;
    }

    // Workspace: Select Marketplace Preset
    const mktCard = e.target.closest('.marketplace-card');
    if (mktCard) {
      const platformId = mktCard.getAttribute('data-platform');
      appState.batchState.targetPlatform = platformId;
      pageContent.innerHTML = renderBatchWorkspace();
      return;
    }

    // Workspace: Select Resolution Tier
    const resPill = e.target.closest('.resolution-pill');
    if (resPill) {
      const resId = resPill.getAttribute('data-resolution');
      const allowed = getUserAllowedResolutions();
      if (!allowed.includes(resId)) {
        openPricingModal();
        return;
      }
      appState.batchState.targetResolution = resId;
      pageContent.innerHTML = renderBatchWorkspace();
      return;
    }

    // Progress Hub: Switch Export Marketplace Tab
    const exportTab = e.target.closest('.export-platform-tab');
    if (exportTab) {
      const platformId = exportTab.getAttribute('data-export-platform');
      appState.batchState.exportPlatform = platformId;
      pageContent.innerHTML = renderBatchProgress();
      return;
    }

    // Progress Hub: Upgrade Button Click
    if (e.target.closest('.btn-plan-upgrade-cta')) {
      openPricingModal();
      return;
    }

    // Progress Hub: Switch Mode Filter Tab
    const modeFilterTab = e.target.closest('.results-filter-tab');
    if (modeFilterTab) {
      appState.batchState.modeFilter = modeFilterTab.getAttribute('data-mode-filter');
      pageContent.innerHTML = renderBatchProgress();
      return;
    }

    // Progress Hub: Toggle Before/After Garment Compare
    const compareBtn = e.target.closest('.btn-toggle-compare');
    if (compareBtn) {
      const cardWrapper = compareBtn.closest('.job-card-wrapper');
      if (cardWrapper) {
        cardWrapper.classList.toggle('show-before');
      }
      return;
    }

    // Progress Hub: Clear Bulk Selection
    if (e.target.closest('#btn-clear-bulk-selected')) {
      appState.batchState.selectedJobIds = [];
      pageContent.innerHTML = renderBatchProgress();
      return;
    }

    // Progress Hub: Download Bulk Selected as ZIP
    if (e.target.closest('#btn-download-bulk-selected')) {
      if (!batchDetailData || !batchDetailData.jobs) return;
      const selectedIds = appState.batchState.selectedJobIds || [];
      const targetJobs = batchDetailData.jobs.filter(j => selectedIds.includes(j.id) && j.status === 'completed' && j.result_url);
      if (targetJobs.length === 0) {
        alert('No completed images selected to download.');
        return;
      }

      const btn = e.target.closest('#btn-download-bulk-selected');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:6px;"></span> Zipping ${targetJobs.length}...`;

      const platformId = appState.batchState.exportPlatform || 'flipkart';
      const resId = getDefaultResolutionForUser();
      const platformObj = marketplacePlatforms.find(p => p.id === platformId) || marketplacePlatforms[0];

      try {
        const zip = new JSZip();
        const promises = targetJobs.map(async (job, idx) => {
          const originalFile = uploadedFiles.find(f => f.id === job.image_id);
          const baseName = (originalFile ? originalFile.name : `selected_sku_${idx + 1}`).replace(/\.[^/.]+$/, '');
          const filename = `${baseName}_${platformObj.id}_${resId}.png`;

          try {
            const blob = await processImageForMarketplace(job.result_url, platformId, resId);
            zip.file(filename, blob);
          } catch (e) {
            try {
              if (job.result_url) {
                const response = await fetch(job.result_url);
                const rawBlob = await response.blob();
                zip.file(filename, rawBlob);
              } else if (originalFile && originalFile.file) {
                zip.file(filename, originalFile.file);
              }
            } catch (err) {
              if (originalFile && originalFile.file) {
                zip.file(filename, originalFile.file);
              }
            }
          }
        });

        await Promise.all(promises);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `Selected_${targetJobs.length}_Items_${platformObj.id}_${resId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (err) {
        console.error('Failed to create selected ZIP:', err);
        alert('Failed to generate ZIP archive for selected items.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      return;
    }

    // Close Image Preview Modal
    if (e.target.closest('#modal-close') || e.target.id === 'image-modal') {
      const modal = document.getElementById('image-modal');
      if (modal) modal.classList.remove('active');
      return;
    }

    // High-Res Image Preview Modal from Job Card
    const previewBtn = e.target.closest('.btn-job-preview');
    if (previewBtn) {
      const url = previewBtn.getAttribute('data-url');
      const title = previewBtn.getAttribute('data-title');
      const modal = document.getElementById('image-modal');
      const modalImg = document.getElementById('modal-img');
      if (modal && modalImg && url) {
        modalImg.src = url;
        modalImg.alt = title || 'High-res Preview';
        modal.classList.add('active');
      }
      return;
    }

    // Individual download button (formatted to selected platform)
    if (e.target.closest('.btn-download-selected')) {
      const btn = e.target.closest('.btn-download-selected');
      const url = btn.getAttribute('data-url');
      const filename = btn.getAttribute('data-filename') || 'processed_image.png';
      if (url) {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Formatting...';

        const platformId = appState.batchState.exportPlatform || 'flipkart';
        const resId = getDefaultResolutionForUser();

        processImageForMarketplace(url, platformId, resId)
          .then((blob) => {
            const cleanName = filename.replace(/\.[^/.]+$/, '');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${cleanName}_${platformId}_${resId}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
          })
          .catch((err) => {
            console.error('Format download failed, fallback to raw url:', err);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          })
          .finally(() => {
            btn.disabled = false;
            btn.textContent = originalText;
          });
      }
      return;
    }

    // Download Platform-Specific ZIP Button
    if (e.target.closest('#btn-export-platform-zip') || e.target.closest('#btn-export-platform-zip-hero')) {
      if (!batchDetailData || !batchDetailData.jobs) return;

      const completedJobs = batchDetailData.jobs.filter(j => j.status === 'completed' && j.result_url);
      if (completedJobs.length === 0) {
        alert('No completed images to download.');
        return;
      }

      const btn = e.target.closest('#btn-export-platform-zip') || e.target.closest('#btn-export-platform-zip-hero');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:6px;"></span> Formatting & Zipping...`;

      const platformId = appState.batchState.exportPlatform || 'flipkart';
      const resId = getDefaultResolutionForUser();
      const platformObj = marketplacePlatforms.find(p => p.id === platformId) || marketplacePlatforms[0];

      try {
        const zip = new JSZip();

        const promises = completedJobs.map(async (job, idx) => {
          const originalFile = uploadedFiles.find(f => f.id === job.image_id);
          const baseName = (originalFile ? originalFile.name : `catalog_sku_${idx + 1}`).replace(/\.[^/.]+$/, '');
          const filename = `${baseName}_${platformObj.id}_${resId}.png`;

          try {
            const blob = await processImageForMarketplace(job.result_url, platformId, resId);
            zip.file(filename, blob);
          } catch (e) {
            const response = await fetch(job.result_url);
            const rawBlob = await response.blob();
            zip.file(filename, rawBlob);
          }
        });

        await Promise.all(promises);

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `${batchDetailData.name || 'catalog'}_${platformObj.id}_${resId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (err) {
        console.error('Failed to create ZIP:', err);
        alert('Failed to generate ZIP archive. Some images might not be accessible.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      return;
    }

    // Download Multi-Marketplace Bundle ZIP (Flipkart, Amazon, Meesho, Myntra folders)
    if (e.target.closest('#btn-export-bundle-zip')) {
      if (!batchDetailData || !batchDetailData.jobs) return;

      const completedJobs = batchDetailData.jobs.filter(j => j.status === 'completed' && j.result_url);
      if (completedJobs.length === 0) {
        alert('No completed images to download.');
        return;
      }

      const btn = document.getElementById('btn-export-bundle-zip');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:6px;"></span> Generating Bundle...`;

      const resId = getDefaultResolutionForUser();
      const targetExportPlatforms = marketplacePlatforms;

      try {
        const zip = new JSZip();

        // 1. Add Platform Guide Readme
        zip.file('README_Marketplace_Guidelines.txt', 
`=== CropStudio Multi-Platform Catalog Guidelines ===
Generated on: ${new Date().toLocaleString()}
Resolution Master Quality: ${resId.toUpperCase()}

Subfolder Specifications:
1. 01_Flipkart_Myntra (3:4 Portrait) -> Best for Flipkart, Myntra, Ajio fashion catalog listings.
2. 02_Amazon_India (1:1 Square) -> Standard Amazon India white background & lifestyle zoom requirements.
3. 03_Meesho (1:1 Square Mobile) -> Lightweight, high-contrast mobile-optimized catalog for Meesho sellers.
4. 04_Instagram_Social (4:5 Vertical) -> High-resolution lifestyle portrait for Instagram Reels, Posts & Paid Ads.

Thank you for creating with CropStudio AI!
`
        );

        // 2. Process each platform into its own formatted subfolder
        const folderPrefixes = {
          'flipkart': '01_Flipkart_Myntra',
          'amazon': '02_Amazon_India',
          'meesho': '03_Meesho',
          'instagram': '04_Instagram_Social'
        };

        for (const platform of targetExportPlatforms) {
          const folderName = `${folderPrefixes[platform.id] || platform.name}_(${platform.ratio.replace(':', 'x')})`;
          const folder = zip.folder(folderName);

          const platformPromises = completedJobs.map(async (job, idx) => {
            const originalFile = uploadedFiles.find(f => f.id === job.image_id);
            const baseName = (originalFile ? originalFile.name : `sku_${idx + 1}`).replace(/\.[^/.]+$/, '');
            const filename = `${baseName}_${platform.id}.png`;

            try {
              const blob = await processImageForMarketplace(job.result_url, platform.id, resId);
              folder.file(filename, blob);
            } catch (e) {
              const response = await fetch(job.result_url);
              const rawBlob = await response.blob();
              folder.file(filename, rawBlob);
            }
          });

          await Promise.all(platformPromises);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `${batchDetailData.name || 'catalog'}_MultiPlatform_Bundle_${resId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (err) {
        console.error('Failed to create bundle ZIP:', err);
        alert('Failed to generate Multi-Platform Bundle ZIP.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      return;
    }
  });

  pageContent.addEventListener('change', (e) => {
    // Handle job card selection checkbox
    if (e.target.classList.contains('job-card-checkbox')) {
      const jobId = e.target.getAttribute('data-job-id');
      if (!appState.batchState.selectedJobIds) appState.batchState.selectedJobIds = [];
      if (e.target.checked) {
        if (!appState.batchState.selectedJobIds.includes(jobId)) {
          appState.batchState.selectedJobIds.push(jobId);
        }
      } else {
        appState.batchState.selectedJobIds = appState.batchState.selectedJobIds.filter(id => id !== jobId);
      }

      const bar = document.getElementById('results-floating-bar');
      if (bar) {
        if (appState.batchState.selectedJobIds.length > 0) {
          bar.classList.add('visible');
          const badge = bar.querySelector('.floating-bar-badge');
          if (badge) badge.textContent = appState.batchState.selectedJobIds.length;
        } else {
          bar.classList.remove('visible');
        }
      }
      return;
    }

    if (e.target.id === 'file-input-hidden') {
      handleFiles(e.target.files);
      e.target.value = '';
      return;
    }

    if (e.target.id === 'check-select-all') {
      const isChecked = e.target.checked;
      uploadedFiles.forEach(f => f.selected = isChecked);
      pageContent.innerHTML = renderBatchWorkspace();
      return;
    }

    if (e.target.name === 'batch-opt') {
      const checkedId = e.target.value;
      const opt = batchOptions.find(o => o.id === checkedId);
      if (opt) {
        opt.checked = e.target.checked;
      }
      pageContent.innerHTML = renderBatchWorkspace();
    }
  });

  pageContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    const zone = document.getElementById('batch-drop-zone');
    if (zone) zone.classList.add('drag-over');
  });

  pageContent.addEventListener('dragleave', (e) => {
    const zone = document.getElementById('batch-drop-zone');
    if (zone) zone.classList.remove('drag-over');
  });

  pageContent.addEventListener('drop', (e) => {
    e.preventDefault();
    const zone = document.getElementById('batch-drop-zone');
    if (zone) zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

// ─── On Model Screen Interactivity ───
function initOnModelEvents() {
  const pageContent = document.getElementById('page-content');

  function openModelPicker() {
    let existing = document.getElementById('model-picker-overlay');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', renderModelPickerModal());

    requestAnimationFrame(() => {
      const overlay = document.getElementById('model-picker-overlay');
      if (overlay) overlay.classList.add('open');
    });

    document.getElementById('btn-model-picker-close')?.addEventListener('click', closeModelPicker);

    document.getElementById('model-picker-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'model-picker-overlay') closeModelPicker();
    });

    document.querySelectorAll('[data-model-pick]').forEach(card => {
      card.addEventListener('click', () => {
        appState.onModelState.selectedModel = card.getAttribute('data-model-pick');
        closeModelPicker();
        pageContent.innerHTML = renderOnModel();
      });
    });
  }

  function closeModelPicker() {
    const overlay = document.getElementById('model-picker-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }
  }

  pageContent.addEventListener('click', async (e) => {
    if (!pageContent.classList.contains('content--onmodel')) return;

    if (e.target.closest('#btn-open-model-picker')) {
      openModelPicker();
      return;
    }

    const uploadBtn = e.target.closest('#btn-onmodel-upload');
    if (uploadBtn && !uploadBtn.disabled) {
      document.getElementById('onmodel-upload-hidden')?.click();
      return;
    }

    const removeBtn = e.target.closest('.onmodel-slot__remove');
    if (removeBtn) {
      const idx = parseInt(removeBtn.getAttribute('data-index'));
      appState.onModelState.clothImages.splice(idx, 1);
      pageContent.innerHTML = renderOnModel();
      return;
    }

    // Launch On-Model processing
    if (e.target.closest('#btn-onmodel-process')) {
      const processBtn = document.getElementById('btn-onmodel-process');
      processBtn.disabled = true;
      processBtn.innerHTML = `<span class="cs-spinner cs-spinner--sm cs-spinner--white" style="margin-right:8px;"></span> Processing On Model...`;

      try {
        const selectedModelObj = onModelAvatars.find(a => a.id === appState.onModelState.selectedModel);
        const isMale = selectedModelObj ? selectedModelObj.tag === 'Male' : true;
        const modelDesc = isMale ? 'professional male' : 'professional female';



        let modelBase64 = null;
        if (appState.onModelState.selectedModel) {
          try {
            modelBase64 = await getBase64FromUrl(appState.onModelState.selectedModel);
          } catch (err) {
            console.error('Failed to encode model image to base64:', err);
          }
        }

        const batchResponse = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: `On Model try-on`,
            image_ids: appState.onModelState.clothImages.map(f => f.id),
            generation_mode: 'try_on',
            config: {
              model_description: modelDesc,
              clothing_item: 'clothing',
              model_image_base64: modelBase64
            }
          })
        });

        startPollingBatch(batchResponse.id);
      } catch (err) {
        alert(`Failed to launch on-model: ${err.message}`);
        processBtn.disabled = false;
        processBtn.textContent = '✨ Process On Model';
      }
    }
  });

  pageContent.addEventListener('change', async (e) => {
    if (e.target.id === 'onmodel-upload-hidden') {
      const files = e.target.files;
      if (files && files.length > 0) {
        const slotsPanel = document.getElementById('onmodel-slots-panel');
        if (slotsPanel) {
          slotsPanel.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:160px; gap:8px;">
              <div class="cs-spinner"></div>
              <p style="font-size:12px; font-weight:500; color:var(--color-gray-600); margin:0;">Uploading garment...</p>
            </div>
          `;
        }

        try {
          const remainingSlots = 3 - appState.onModelState.clothImages.length;
          const filesToAdd = Array.from(files).slice(0, remainingSlots);

          const uploadPromises = filesToAdd.map(async file => {
            const uploadRes = await apiUpload(file);
            return {
              id: uploadRes.id,
              name: uploadRes.original_filename,
              url: uploadRes.url
            };
          });

          const newImages = await Promise.all(uploadPromises);
          appState.onModelState.clothImages = [...appState.onModelState.clothImages, ...newImages];
        } catch (err) {
          alert(`Upload failed: ${err.message}`);
        }

        pageContent.innerHTML = renderOnModel();
      }
      e.target.value = '';
    }
  });
}

// ─── Generic Tools Screen Interactivity (Edit, Remove BG, Upscale) ───
function initToolEvents() {
  const pageContent = document.getElementById('page-content');

  async function handleImageUpload(file, stateObj, canvasId, processBtnId) {
    if (!file) return;
    const canvas = document.getElementById(canvasId);
    if (canvas) {
      canvas.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;">
          <div class="cs-spinner"></div>
          <p style="font-size:12px; font-weight:500; color:var(--color-gray-600); margin:0;">Uploading image...</p>
        </div>
      `;
    }

    try {
      const res = await apiUpload(file);
      stateObj.image = {
        id: res.id,
        url: res.url,
        name: res.original_filename
      };
    } catch (err) {
      alert(`File upload failed: ${err.message}`);
      stateObj.image = null;
    }

    // Refresh layout
    if (canvasId.includes('removebg')) pageContent.innerHTML = renderRemoveBg();
    else if (canvasId.includes('upscale')) pageContent.innerHTML = renderUpscale();
    else if (canvasId.includes('edit')) pageContent.innerHTML = renderEdit();
  }

  pageContent.addEventListener('click', async (e) => {
    // 1. Trigger Hidden File pickers
    if (e.target.closest('#btn-removebg-upload')) {
      document.getElementById('removebg-upload-hidden')?.click();
      return;
    }
    if (e.target.closest('#btn-upscale-upload')) {
      document.getElementById('upscale-upload-hidden')?.click();
      return;
    }
    if (e.target.closest('#btn-edit-upload')) {
      document.getElementById('edit-upload-hidden')?.click();
      return;
    }

    // 2. Launch Strategy Executions
    if (e.target.id === 'btn-removebg-process') {
      appState.removeBgState.processing = true;
      pageContent.innerHTML = renderRemoveBg();

      try {
        const batchResponse = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Remove Background',
            image_ids: [appState.removeBgState.image.id],
            generation_mode: 'background_removal'
          })
        });
        startPollingBatch(batchResponse.id);
        appState.removeBgState.image = null; // Reset
      } catch (err) {
        alert(`Background removal failed: ${err.message}`);
      }
      appState.removeBgState.processing = false;
      return;
    }

    if (e.target.id === 'btn-upscale-process') {
      appState.upscaleState.processing = true;
      pageContent.innerHTML = renderUpscale();

      try {
        const batchResponse = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Upscale Image',
            image_ids: [appState.upscaleState.image.id],
            generation_mode: 'upscale'
          })
        });
        startPollingBatch(batchResponse.id);
        appState.upscaleState.image = null; // Reset
      } catch (err) {
        alert(`Upscaling failed: ${err.message}`);
      }
      appState.upscaleState.processing = false;
      return;
    }

    if (e.target.id === 'btn-edit-process') {
      const promptText = document.getElementById('edit-prompt-text').value.trim();
      if (!promptText) {
        alert('Please specify an edit instruction prompt.');
        return;
      }

      appState.editState.processing = true;
      pageContent.innerHTML = renderEdit();

      try {
        const batchResponse = await apiFetch('/batches/', {
          method: 'POST',
          body: JSON.stringify({
            name: `Edit - ${promptText.substring(0, 15)}`,
            image_ids: [appState.editState.image.id],
            generation_mode: 'studio_lighting', // Default image edit mode
            config: {
              prompt: promptText
            }
          })
        });
        startPollingBatch(batchResponse.id);
        appState.editState.image = null;
      } catch (err) {
        alert(`Editing failed: ${err.message}`);
      }
      appState.editState.processing = false;
    }
  });

  pageContent.addEventListener('change', async (e) => {
    if (e.target.id === 'removebg-upload-hidden') {
      await handleImageUpload(e.target.files[0], appState.removeBgState, 'removebg-canvas', '#btn-removebg-process');
    } else if (e.target.id === 'upscale-upload-hidden') {
      await handleImageUpload(e.target.files[0], appState.upscaleState, 'upscale-canvas', '#btn-upscale-process');
    } else if (e.target.id === 'edit-upload-hidden') {
      await handleImageUpload(e.target.files[0], appState.editState, 'edit-canvas', '#btn-edit-process');
    }
  });
}

// ─── Billing Developer Simulator Widget ───
function initDevSimulator() {
  let existing = document.getElementById('dev-simulator-fab');
  if (existing) existing.remove();
  let existingPanel = document.getElementById('dev-simulator-panel');
  if (existingPanel) existingPanel.remove();

  // Create FAB (Floating Action Button)
  const fab = document.createElement('button');
  fab.id = 'dev-simulator-fab';
  fab.style = 'position:fixed;bottom:20px;left:20px;z-index:9999;width:48px;height:48px;border-radius:50%;background:#1E293B;color:#F8FAFC;border:none;box-shadow:0 10px 25px rgba(0,0,0,0.3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;transition:all 0.2s;';
  fab.innerHTML = '🔧';
  fab.title = 'Open Billing Developer Simulator';

  fab.addEventListener('mouseenter', () => {
    fab.style.transform = 'scale(1.1)';
    fab.style.background = '#0F172A';
  });
  fab.addEventListener('mouseleave', () => {
    fab.style.transform = 'scale(1)';
    fab.style.background = '#1E293B';
  });

  // Create Control Panel
  const panel = document.createElement('div');
  panel.id = 'dev-simulator-panel';
  panel.style = 'position:fixed;bottom:80px;left:20px;z-index:9999;width:300px;background:white;border-radius:16px;box-shadow:0 15px 35px rgba(0,0,0,0.25);border:1px solid #E2E8F0;font-family:var(--font-family);display:none;flex-direction:column;overflow:hidden;transition:all 0.3s;';

  const updatePanelContent = () => {
    const profile = appState.user && appState.user.profile ? appState.user.profile : null;
    const startStr = profile && profile.subscription_period_start ? new Date(profile.subscription_period_start).toLocaleString() : 'N/A';
    const endStr = profile && profile.subscription_period_end ? new Date(profile.subscription_period_end).toLocaleString() : 'N/A';
    const tier = profile ? profile.subscription_tier : 'free';
    const pending = profile ? profile.pending_downgrade_tier || 'None' : 'None';

    panel.innerHTML = `
      <div style="background:#1E293B;color:white;padding:14px 16px;font-size:14px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
        <span>🔧 Billing Dev Simulator</span>
        <button id="dev-sim-close" style="background:none;border:none;color:white;cursor:pointer;font-size:16px;">×</button>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px;font-size:12px;color:#334155;">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px;">
          <strong>Active Tier:</strong>
          <span style="font-weight:700;text-transform:uppercase;color:#7C3AED;">${tier}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #F1F5F9;padding-bottom:6px;">
          <strong>Pending Downgrade:</strong>
          <span style="font-weight:700;color:#E11D48;">${pending}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;border-bottom:1px solid #F1F5F9;padding-bottom:6px;">
          <strong>Billing Start:</strong>
          <span style="font-family:monospace;color:#64748B;">${startStr}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;border-bottom:1px solid #F1F5F9;padding-bottom:6px;">
          <strong>Billing End (Expiry):</strong>
          <span style="font-family:monospace;color:#64748B;">${endStr}</span>
        </div>
        
        <div style="margin-top:4px;">
          <label style="font-weight:700;display:block;margin-bottom:6px;">Fast-Forward Time:</label>
          <div style="display:flex;gap:6px;">
            <button class="dev-sim-shift-btn" data-days="1" style="flex:1;padding:8px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;cursor:pointer;font-weight:600;">+1 Day</button>
            <button class="dev-sim-shift-btn" data-days="10" style="flex:1;padding:8px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;cursor:pointer;font-weight:600;">+10 Days</button>
            <button class="dev-sim-shift-btn" data-days="30" style="flex:1;padding:8px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;cursor:pointer;font-weight:600;">+30 Days</button>
          </div>
        </div>
      </div>
    `;

    panel.querySelector('#dev-sim-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    panel.querySelectorAll('.dev-sim-shift-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const days = parseInt(btn.getAttribute('data-days'));
        btn.disabled = true;
        btn.textContent = 'Shifting...';
        try {
          await apiFetch('/billing/simulate-time', {
            method: 'POST',
            body: JSON.stringify({ days })
          });
          // Refresh user profile (triggers passive expiration check on /users/me backend)
          await syncUserProfile();
          initApp();

          // Show quick alert
          const end = appState.user && appState.user.profile ? appState.user.profile.subscription_period_end : null;
          alert(`Successfully fast-forwarded time by ${days} days!\n\nNew end date: ${end ? new Date(end).toLocaleString() : 'N/A'}`);
        } catch (err) {
          alert(`Simulation failed: ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = `+${days} Day${days > 1 ? 's' : ''}`;
          updatePanelContent();
        }
      });
    });
  };

  fab.addEventListener('click', () => {
    if (panel.style.display === 'none') {
      updatePanelContent();
      panel.style.display = 'flex';
    } else {
      panel.style.display = 'none';
    }
  });

  document.body.appendChild(fab);
  document.body.appendChild(panel);
}

// ─── Boot Flow ───
async function bootApp() {
  // Check if Supabase client has an active OAuth session (e.g. after Google redirect)
  if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.auth) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data?.session?.access_token) {
        appState.token = data.session.access_token;
        localStorage.setItem('cs_token', appState.token);
      }
    } catch (sessionErr) {
      console.warn('Failed to retrieve Supabase session:', sessionErr);
    }
  }

  if (appState.token === 'null' || appState.token === 'undefined') {
    appState.token = '';
    appState.user = null;
    localStorage.removeItem('cs_token');
  }

  if (appState.token) {
    try {
      await syncUserProfile();
      initApp();
      initToolEvents();
    } catch (err) {
      console.error('Session boot failed, redirecting to auth', err);
      appState.token = '';
      appState.user = null;
      localStorage.removeItem('cs_token');
      renderAuth();
    }
  } else {
    renderAuth();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootApp();
});
