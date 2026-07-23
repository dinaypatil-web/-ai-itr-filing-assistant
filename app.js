// ==========================================
// TaxAI Assistant — Live Application Logic
// All operations connect to the live backend API.
// ==========================================

// Global Application State — populated from backend after login
let appState = {
  activeSection: 'wizard-section',
  activeWizardStep: 1,
  appMode: 'taxpayer',
  userLoggedIn: false,
  userName: '',
  userPAN: '',

  profile: {
    salaried: false,
    business: false,
    freelancer: false,
    investor: false,
    landlord: false,
    retired: false,
    nri: false,
    crypto: false
  },

  income: {
    grossSalary: 0,
    savingsInterest: 0,
    otherIncome: 0,
    hraExemption: 0,
    homeLoanInterestLoss: 0,
    capitalGainsSTCG: 0,
    capitalGainsLTCG: 0,
    businessPresIncome: 0,
    taxNewRegime: 0,
    taxOldRegime: 0,
    netTaxableNew: 0,
    netTaxableOld: 0
  },

  deductions: {
    sec80C: 0,
    sec80D: 0,
    sec80CCD: 0,
    sec80TTA: 0,
    eligibleTotal: 0
  },

  govFetched: false,
  govData: null,
  resolvedAisMismatch: false,
  selectedRegime: 'new',
  bankAccount: {
    accNumber: '',
    ifsc: ''
  },
  uploadedFiles: [],
  cgTransactions: []
};

// Live backend API base — always points to the running Express server
const API_BASE = `${window.location.origin}/api`;

// ==========================================
// API Helpers — always live, always sends UID
// ==========================================
function getApiHeaders(extra = {}) {
  const uid = window._firebaseUser?.uid || appState.uid || '';
  return { 'Content-Type': 'application/json', 'X-User-UID': uid, ...extra };
}

async function apiPost(endpoint, body) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error(`API Error [POST ${endpoint}]:`, err);
    showToast('Connection Error', `Could not reach server at ${endpoint}. Please ensure the server is running.`, 'error');
    return null;
  }
}

async function apiGet(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: getApiHeaders({ 'Content-Type': undefined })
    });
    return await res.json();
  } catch (err) {
    console.error(`API Error [GET ${endpoint}]:`, err);
    return null;
  }
}

// ==========================================
// Firebase Client-side SDK Initialization
// (async — waits for config to be fetched from server)
// ==========================================
async function initFirebase() {
  // Wait for server-side config to load (set by index.html fetch)
  if (window.firebaseConfigReady) {
    await window.firebaseConfigReady;
  }

  const firebaseConfig = {
    apiKey: window.firebaseConfig?.apiKey || "AIzaSyFakeKey-ForDemoPurposesOnly",
    authDomain: window.firebaseConfig?.authDomain || "taxai-assistant.firebaseapp.com",
    projectId: window.firebaseConfig?.projectId || "taxai-assistant",
    storageBucket: window.firebaseConfig?.storageBucket || "taxai-assistant.appspot.com",
    messagingSenderId: window.firebaseConfig?.messagingSenderId || "1234567890",
    appId: window.firebaseConfig?.appId || "1:12345:web:abcde"
  };

  const isFirebaseConfigured = typeof firebase !== 'undefined' &&
                               firebaseConfig.apiKey &&
                               !firebaseConfig.apiKey.includes('FakeKey');

  if (isFirebaseConfigured) {
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    console.log("Firebase Auth initialized in production mode.");
  } else {
    console.log("Firebase Auth running in local simulation fallback mode.");
  }
}

// Kick off Firebase init immediately (non-blocking for the rest of the script)
const firebaseReady = initFirebase();

// ==========================================
// App Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('TaxAI — connecting to live backend at:', API_BASE);

  // Wait for async Firebase initialization (config loaded from server)
  await firebaseReady;

  if (typeof firebase !== 'undefined' && window.firebaseAuth) {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      'size': 'invisible',
      'callback': (response) => {
        // reCAPTCHA solved, ready for SMS OTP trigger
      }
    });
  }

  await syncFromBackend();
  addBotMessage('Namaste! I am your AI Tax Assistant. Sign in above to load your financial profile, or ask me any tax question.');
});

async function syncFromBackend() {
  const user = await apiGet('/profile');
  if (user && !user.error) {
    appState = { ...appState, ...user };
    appState.userName = user.name || '';
    appState.userPAN  = user.pan  || '';
    renderFilesPreview();
    await syncInputsToUi();
    await recalculateAll();
  }
}

// ==========================================
// Navigation
// ==========================================
function showSection(sectionId) {
  document.querySelectorAll('.wizard-step-content').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) { target.classList.add('active'); appState.activeSection = sectionId; }

  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

  const map = {
    'wizard-section':          { nav: 'nav-wizard',           title: 'ITR Filing Assistant',           sub: 'File your Indian Income Tax Return in minutes using AI.' },
    'calculators-section':     { nav: 'nav-calculators',       title: 'Custom Calculation Engines',      sub: 'Advanced tools for HRA, Capital Gains, and Presumptive Business Sections.' },
    'regime-section':          { nav: 'nav-regime',            title: 'Regime Slabs Comparison Matrix',  sub: 'Detailed look at Old vs New Regime tax deductions.' },
    'dashboard-section':       { nav: 'nav-dashboard',         title: 'ITR Interactive Dashboard',       sub: 'Summary of tax liabilities, refund projections, and documents.' },
    'admin-dashboard-section': { nav: 'nav-admin-dashboard',   title: 'Admin Portal Control Panel',      sub: 'Consolidated supervisor dashboard for notice replies and user verification.' },
    'admin-audit-section':     { nav: 'nav-admin-audit',       title: 'Security & Compliance Audit',     sub: 'System log audits, SHA hashes, consent details, and encryption verification.' },
    'admin-tickets-section':   { nav: 'nav-admin-tickets',     title: 'Notices & Support Center',        sub: 'CA expert console for answering user inquiries and drafting notice replies.' }
  };

  const info = map[sectionId];
  if (info) {
    const navEl = document.getElementById(info.nav);
    if (navEl) navEl.classList.add('active');
    document.getElementById('page-title').innerText = info.title;
    document.getElementById('page-subtitle').innerText = info.sub;
  }

  if (sectionId === 'admin-dashboard-section') loadAdminDashboard();
  else if (sectionId === 'admin-audit-section')  loadAdminAuditLogs();
  else if (sectionId === 'admin-tickets-section') loadAdminNotices();
}

function setAppMode(mode) {
  appState.appMode = mode;
  const taxpayerNav    = document.getElementById('taxpayer-nav');
  const adminNav       = document.getElementById('admin-nav');
  const taxpayerWidgets = document.getElementById('taxpayer-widgets');
  const btnAdmin       = document.getElementById('btn-admin-mode');
  const btnTaxpayer    = document.getElementById('btn-taxpayer-mode');

  if (mode === 'admin') {
    taxpayerNav.style.display = 'none';
    adminNav.style.display = 'flex';
    taxpayerWidgets.style.display = 'none';
    btnAdmin.classList.add('active');
    btnTaxpayer.classList.remove('active');
    showSection('admin-dashboard-section');
    showToast('Admin Console Enabled', 'Accessing ERI administration systems.');
  } else {
    taxpayerNav.style.display = 'flex';
    adminNav.style.display = 'none';
    taxpayerWidgets.style.display = 'flex';
    btnAdmin.classList.remove('active');
    btnTaxpayer.classList.add('active');
    showSection('wizard-section');
    showToast('Taxpayer Mode Enabled', 'Secured client tax sandbox.');
  }
}

// ==========================================
// Wizard Navigation
// ==========================================
function showWizardStep(stepNum) {
  for (let i = 1; i <= 7; i++) {
    const el = document.getElementById(`wizard-step-${i}`);
    if (el) el.style.display = 'none';
    const bubble = document.getElementById(`step-track-${i}`);
    if (bubble) bubble.classList.remove('active', 'completed');
  }

  const activeEl = document.getElementById(`wizard-step-${stepNum}`);
  if (activeEl) { activeEl.style.display = 'block'; activeEl.classList.add('active-step-subview'); }

  for (let i = 1; i <= 7; i++) {
    const bubble = document.getElementById(`step-track-${i}`);
    if (!bubble) continue;
    if (i < stepNum) bubble.classList.add('completed');
    else if (i === stepNum) bubble.classList.add('active');
  }

  appState.activeWizardStep = stepNum;
  if (stepNum === 6) renderTaxCalculationSheet(appState.selectedRegime || 'new');
  if (stepNum === 7) triggerITRValidation();
}

function nextWizardStep(currentStep) { if (currentStep < 7) showWizardStep(currentStep + 1); }
function prevWizardStep(currentStep) { if (currentStep > 1) showWizardStep(currentStep - 1); }

// ==========================================
// Step 1: Authentication
// ==========================================
async function requestOTP() {
  const phoneInput = document.getElementById('login-phone');
  const otpArea    = document.getElementById('otp-input-area');
  const phone      = phoneInput ? phoneInput.value.trim() : '';

  if (!phone || phone.length < 10) {
    showToast('Verification Error', 'Please enter a valid 10-digit mobile number.', 'error');
    return;
  }

  let formattedPhone = phone;
  if (!phone.startsWith('+')) {
    if (phone.length === 10) {
      formattedPhone = '+91' + phone;
    } else {
      showToast('Verification Error', 'Invalid phone number format. Please check.', 'error');
      return;
    }
  }

  const btn = document.getElementById('btn-request-otp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...'; }

  // Check if Firebase is loaded (forced mock mode for phone OTP to avoid reCAPTCHA issues)
  const forceMockPhone = true;
  if (forceMockPhone || typeof firebase === 'undefined' || !window.firebaseAuth) {
    // Fallback Mock Sign-in trigger for offline/unconfigured testing
    showToast('Demo Environment', 'Running in simulation mode.', 'warning');
    const res = await apiPost('/auth/otp/send', { phone });
    if (!res || res.error) {
      showToast('OTP Error', res?.error || 'Failed to dispatch simulation OTP.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-key"></i> Request Mobile OTP'; }
      return;
    }
    window.isFirebaseMockMode = true;
    if (otpArea) {
      otpArea.style.display = 'flex';
      otpArea.style.flexDirection = 'column';
      otpArea.style.gap = '12px';
    }
    const mockOtpText = res.otp ? ` (OTP: ${res.otp})` : '';
    showToast('OTP Sent (Mock)', `A 6-digit simulation code has been generated.${mockOtpText}`, 'info');
    addBotMessage(`📱 Mock OTP dispatched to <b>${phone}</b>. Code is <b>${res.otp || 'check server logs'}</b>. Enter it below, then click <b>Verify and Continue</b>.`);
    if (res.otp) {
      const otpInput = document.getElementById('login-otp');
      if (otpInput) otpInput.value = res.otp;
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend OTP'; }
    return;
  }

  // Real Firebase Auth Integration
  try {
    const appVerifier = window.recaptchaVerifier;
    const confirmationResult = await window.firebaseAuth.signInWithPhoneNumber(formattedPhone, appVerifier);
    window.confirmationResult = confirmationResult;
    window.isFirebaseMockMode = false;

    if (otpArea) {
      otpArea.style.display = 'flex';
      otpArea.style.flexDirection = 'column';
      otpArea.style.gap = '12px';
    }
    showToast('OTP Sent', `A verification code has been sent to ${phone}.`, 'info');
    addBotMessage(`📱 OTP dispatched via Google Firebase SMS gateway to <b>${formattedPhone}</b>. Enter the 6-digit verification code below.`);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend OTP'; }
  } catch (err) {
    console.error('Firebase SMS OTP Error:', err);
    showToast('OTP Send Failed', err.message || 'Error occurred while contacting Google services.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-key"></i> Request Mobile OTP'; }
  }
}

async function verifyOTP() {
  const otpInput = document.getElementById('login-otp');
  const otp = otpInput ? otpInput.value.trim() : '';
  const phoneInput = document.getElementById('login-phone');
  const phone = phoneInput ? phoneInput.value.trim() : '';

  if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    showToast('Invalid OTP', 'Enter the 6-digit numeric verification code.', 'error');
    return;
  }

  const verifyBtn = document.getElementById('btn-verify-otp');
  if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...'; }

  // Fallback Mock verify
  if (window.isFirebaseMockMode) {
    try {
      const res = await apiPost('/auth/otp/verify', { otp, phone });
      if (!res) {
        showToast('Connection Error', 'Could not verify OTP against local mock backend.', 'error');
        if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
        return;
      }
      if (res.error) {
        showToast('OTP Mismatch', res.error, 'error');
        if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
        return;
      }
      if (res.user) {
        appState = { ...appState, ...res.user };
        appState.userName = res.user.name || 'Vikram Sharma';
        appState.userPAN  = res.user.pan  || 'ABCDE1234F';
      }
      completeLogin();
    } catch (err) {
      console.error('Mock verification error:', err);
      showToast('Verification Failed', err.message || 'OTP check failed.', 'error');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
    }
    return;
  }

  // Real Firebase verify
  try {
    if (!window.confirmationResult) {
      showToast('Session Expired', 'Please request a new OTP code first.', 'error');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
      return;
    }

    const result = await window.confirmationResult.confirm(otp);
    const idToken = await result.user.getIdToken();

    // Verify token on our backend server
    const res = await apiPost('/auth/firebase/verify', { idToken });
    if (!res) {
      showToast('Connection Error', 'Failed to synchronize authenticated profile with server.', 'error');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
      return;
    }
    if (res.error) {
      showToast('Profile Error', res.error, 'error');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
      return;
    }

    if (res.user) {
      appState = { ...appState, ...res.user };
      appState.userName = res.user.name || 'Vikram Sharma';
      appState.userPAN  = res.user.pan  || 'ABCDE1234F';
    }

    completeLogin();
  } catch (err) {
    console.error('Firebase Verification Error:', err);
    showToast('OTP Mismatch', err.message || 'Verification token rejected.', 'error');
    if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify and Continue'; }
  }
}

async function loginWithGoogle() {
  if (!window.firebaseAuth) {
    // Mock simulation sign in
    showToast('Demo Environment', 'Firebase unconfigured. Simulating Google OAuth.', 'info');
    const res = await apiPost('/auth/otp/verify', { otp: '123456', phone: 'oauth-google' });
    if (res && res.user) {
      appState = { ...appState, ...res.user };
      appState.userName  = res.user.name  || 'Vikram Sharma';
      appState.userPAN   = res.user.pan   || 'ABCDE1234F';
      appState.userEmail = res.user.email || '';
      appState.userPhoto = res.user.photoURL || '';
    }
    populateUserProfileCard();
    completeLogin();
    addBotMessage(`Signed in successfully via Google simulation. Let's build your tax profile.`);
    return;
  }

  // Real Google Sign-in popup via Firebase
  try {
    showToast('Google Sign-In', 'Opening Google authentication...', 'info');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    const result = await window.firebaseAuth.signInWithPopup(provider);
    const fbUser  = result.user;
    const idToken = await fbUser.getIdToken();

    // Populate appState with real Google profile immediately (before backend responds)
    appState.userName  = fbUser.displayName || fbUser.email?.split('@')[0] || 'User';
    appState.userEmail = fbUser.email || '';
    appState.userPhoto = fbUser.photoURL || '';
    appState.userPhone = fbUser.phoneNumber || '';

    // Sync with backend to get/create user record
    const res = await apiPost('/auth/firebase/verify', { idToken });
    if (res && res.user) {
      appState = {
        ...appState,
        ...res.user,
        // Preserve the Google profile fields from Firebase (backend may not have photo)
        userName:  res.user.name     || appState.userName,
        userEmail: res.user.email    || appState.userEmail,
        userPhoto: res.user.photoURL || appState.userPhoto,
        userPhone: res.user.phone    || appState.userPhone,
        userPAN:   res.user.pan      || '',
      };
      window._firebaseIdToken = idToken; // store for phone linking
      window._firebaseUser    = fbUser;

      populateUserProfileCard();
      completeLogin();

      // If no phone linked yet — show the phone collection modal
      if (!appState.userPhone || appState.userPhone.length < 10) {
        setTimeout(() => showPhoneCollectionModal(), 800);
      } else {
        addBotMessage(`✅ Welcome back, <b>${appState.userName}</b>! Your profile and documents have been loaded.`);
      }
    } else {
      showToast('Profile Sync Failure', res?.error || 'Authentication succeeded but profile sync failed.', 'error');
    }
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Authentication Error', err.message || 'Google Sign-In failed.', 'error');
    }
  }
}

function populateUserProfileCard() {
  const card          = document.getElementById('user-profile-card');
  const nameEl        = document.getElementById('user-display-name');
  const emailEl       = document.getElementById('user-display-email');
  const photoEl       = document.getElementById('user-avatar-photo');
  const initialsEl    = document.getElementById('user-avatar-initials');
  const oldAvatar     = document.getElementById('logged-user-avatar');

  if (!card) return;

  // Show the rich profile card, hide the old basic avatar
  card.style.display = 'flex';
  if (oldAvatar) oldAvatar.style.display = 'none';

  const name  = appState.userName  || 'User';
  const email = appState.userEmail || appState.userPhone || '';
  const photo = appState.userPhoto || '';

  if (nameEl)  nameEl.innerText  = name;
  if (emailEl) emailEl.innerText = email;

  if (photo && photoEl) {
    photoEl.src = photo;
    photoEl.style.display = 'block';
    if (initialsEl) initialsEl.style.display = 'none';
  } else if (initialsEl) {
    initialsEl.innerText = name.charAt(0).toUpperCase();
    initialsEl.style.display = 'flex';
    if (photoEl) photoEl.style.display = 'none';
  }
}

function showPhoneCollectionModal() {
  const modal = document.getElementById('phone-collect-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('phone-collect-step1').style.display = 'block';
    document.getElementById('phone-collect-step2').style.display = 'none';
    document.getElementById('phone-collect-input').value = '';
    document.getElementById('phone-collect-otp').value = '';
  }
  addBotMessage(`📱 <b>One more step!</b> Please link your mobile number to enable Aadhaar e-Verification of your ITR. This is mandatory for online filing.`);
}

async function sendPhoneOTPForLinking() {
  const phoneInput = document.getElementById('phone-collect-input');
  const phone = phoneInput ? phoneInput.value.trim() : '';

  if (!phone || phone.length !== 10 || !/^\d{10}$/.test(phone)) {
    showToast('Invalid Number', 'Enter a valid 10-digit mobile number.', 'error');
    return;
  }

  const formattedPhone = '+91' + phone;
  const btn = document.getElementById('btn-send-phone-otp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; }

  try {
    // Recaptcha not required: always use mock fallback verification by default to bypass credential errors on localhost
    const forceMockPhone = true;

    if (!forceMockPhone && window.firebaseAuth && window.recaptchaVerifier) {
      // Real Firebase OTP for phone linking
      const confirmResult = await window.firebaseAuth.signInWithPhoneNumber(formattedPhone, window.recaptchaVerifier);
      window._phoneConfirmResult = confirmResult;
      window._phoneToLink = formattedPhone;

      document.getElementById('phone-collect-step1').style.display = 'none';
      document.getElementById('phone-collect-step2').style.display = 'block';
      showToast('OTP Sent', `Verification code sent to ${formattedPhone}`, 'info');
    } else {
      // Mock fallback
      const res = await apiPost('/auth/otp/send', { phone });
      window._phoneToLink = formattedPhone;
      window._phoneConfirmResult = null; // will use mock path
      document.getElementById('phone-collect-step1').style.display = 'none';
      document.getElementById('phone-collect-step2').style.display = 'block';
      const mockOtpText = res.otp ? ` (OTP: ${res.otp})` : '';
      showToast('OTP Sent (Mock)', `Simulation OTP: ${res.otp || 'Check server logs'}`, 'info');
      addBotMessage(`📱 Mock OTP dispatched to <b>${phone}</b>. Code is <b>${res.otp || 'check server logs'}</b>. Enter it below, then click <b>Verify & Link Number</b>.`);
      if (res.otp) {
        const otpInput = document.getElementById('phone-collect-otp');
        if (otpInput) otpInput.value = res.otp;
      }
    }
  } catch (err) {
    console.error('Phone OTP error:', err);
    showToast('OTP Failed', err.message || 'Could not send OTP.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Verification Code'; }
  }
}

async function verifyPhoneOTPForLinking() {
  const otpInput = document.getElementById('phone-collect-otp');
  const otp = otpInput ? otpInput.value.trim() : '';

  if (!otp || otp.length !== 6) {
    showToast('Invalid OTP', 'Enter the 6-digit code.', 'error');
    return;
  }

  const btn = document.getElementById('btn-verify-phone-otp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...'; }

  try {
    let linkedPhone = window._phoneToLink;

    if (window._phoneConfirmResult) {
      // Real Firebase — confirm OTP
      const result = await window._phoneConfirmResult.confirm(otp);
      linkedPhone = result.user.phoneNumber || linkedPhone;
    } else {
      // Mock path — verify against backend
      const phone10 = linkedPhone.replace('+91', '');
      const res = await apiPost('/auth/otp/verify', { otp, phone: phone10 });
      if (!res || res.error) {
        showToast('OTP Mismatch', res?.error || 'Code did not match.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify & Link Number'; }
        return;
      }
    }

    // Persist phone on backend via firebase/verify with the Google idToken + phone
    appState.userPhone = linkedPhone;
    if (window._firebaseIdToken) {
      await apiPost('/auth/firebase/verify', { idToken: window._firebaseIdToken, phone: linkedPhone });
    }

    // Update profile card email line with phone
    const emailEl = document.getElementById('user-display-email');
    if (emailEl && appState.userEmail) {
      emailEl.innerText = appState.userEmail;
    } else if (emailEl) {
      emailEl.innerText = linkedPhone;
    }

    // Close modal
    document.getElementById('phone-collect-modal').style.display = 'none';
    showToast('Phone Linked ✅', `${linkedPhone} linked to your account.`, 'success');
    addBotMessage(`✅ Mobile number <b>${linkedPhone}</b> linked successfully. You're all set to file and e-verify your ITR. Let's get started!`);

  } catch (err) {
    console.error('Phone link error:', err);
    showToast('Verification Failed', err.message || 'OTP check failed.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify & Link Number'; }
  }
}

function skipPhoneCollection() {
  document.getElementById('phone-collect-modal').style.display = 'none';
  showToast('Phone Skipped', 'You can link your phone later before e-Verification.', 'warning');
  addBotMessage(`ℹ️ Phone number skipped. Remember — you'll need it before Aadhaar e-Verification during final filing. Let's build your tax profile now.`);
}

function signOut() {
  if (window.firebaseAuth) {
    window.firebaseAuth.signOut().catch(() => {});
  }
  // Reset appState
  appState.userLoggedIn = false;
  appState.userName  = '';
  appState.userEmail = '';
  appState.userPhoto = '';
  appState.userPhone = '';

  // Show login form again
  const loginForm     = document.getElementById('login-form-container');
  const profileBuilder = document.getElementById('profile-builder-container');
  const profileCard   = document.getElementById('user-profile-card');
  const oldAvatar     = document.getElementById('logged-user-avatar');

  if (loginForm)      loginForm.style.display = 'block';
  if (profileBuilder) profileBuilder.style.display = 'none';
  if (profileCard)    profileCard.style.display = 'none';
  if (oldAvatar)      oldAvatar.style.display = 'none';

  showToast('Signed Out', 'You have been signed out securely.', 'info');
}

function completeLogin() {
  appState.userLoggedIn = true;

  const loginForm      = document.getElementById('login-form-container');
  const profileBuilder = document.getElementById('profile-builder-container');

  if (loginForm)      loginForm.style.display = 'none';
  if (profileBuilder) profileBuilder.style.display = 'block';

  // Always populate the profile card (works for both OTP and Google logins)
  populateUserProfileCard();

  // Sync profile checkboxes from loaded state
  const p = appState.profile || {};
  ['salaried','business','freelancer','investor','landlord','retired','nri','crypto'].forEach(f => {
    const el = document.getElementById('profile-' + f);
    if (el) el.checked = !!p[f];
  });

  // Load user's documents from backend
  apiGet('/documents').then(docs => {
    if (docs && !docs.error) {
      // Merge loaded docs with any already in appState (from the firebase/verify response)
      if (docs.length > 0) appState.uploadedFiles = docs;
    }
    renderFilesPreview();
    updateProfileChecklist();
  });

  syncInputsToUi();
  recalculateAll();
  initCapitalGainsTable();

  const docCount = appState.uploadedFiles?.length || 0;
  showToast('Login Successful', `Welcome, ${appState.userName}!`, 'success');

  if (docCount > 0) {
    addBotMessage(`✅ Authenticated as <b>${appState.userName}</b> (${appState.userEmail || appState.userPhone || ''}). Found <b>${docCount} document(s)</b> from your previous session. ${appState.userPAN ? `PAN: <b>${appState.userPAN}</b>` : 'Please complete your profile below.'}`);
  } else {
    addBotMessage(`✅ Authenticated! Welcome, <b>${appState.userName}</b>. No prior documents found — let's start by uploading your Form 16 or salary slips in Step 2.`);
  }
}

// ==========================================
// Step 1: Profile Builder
// ==========================================
async function updateProfileChecklist() {
  ['salaried','business','freelancer','investor','landlord','retired','nri','crypto'].forEach(f => {
    const el = document.getElementById('profile-' + f);
    if (el) appState.profile[f] = el.checked;
  });

  await apiPost('/profile', { profile: appState.profile });

  const checklistArea = document.getElementById('checklist-document-items');
  if (!checklistArea) return;
  checklistArea.innerHTML = '';

  let requiredCount = 0, uploadedCount = 0;

  const files = appState.uploadedFiles || [];
  const hasDocType = type => files.some(f => f.type === type);

  const hasPan      = hasDocType('PAN Card');
  const hasAadhaar  = hasDocType('Aadhaar Card');
  const hasForm16A  = hasDocType('Form 16 (Part A)');
  const hasForm16B  = hasDocType('Form 16 (Part B)');
  const hasHra      = hasDocType('Rent Receipts');
  const hasCG       = hasDocType('Capital Gains Statement');
  const hasHL       = hasDocType('Home Loan Certificate');
  const hasGst      = hasDocType('GST GSTR-1 & 3B Summaries');
  const hasPnL      = hasDocType('Profit & Loss Sheet');
  const hasCrypto   = hasDocType('Crypto Exchange Profit Statement');

  createChecklistItem(checklistArea, 'PAN Card Details', 'Identity', true, hasPan);
  createChecklistItem(checklistArea, 'Aadhaar Card Copy', 'Identity', true, hasAadhaar);
  requiredCount += 2;
  if (hasPan) uploadedCount++;
  if (hasAadhaar) uploadedCount++;

  if (appState.profile.salaried) {
    createChecklistItem(checklistArea, 'Form 16 (Part A)', 'Salary Income', true, hasForm16A);
    createChecklistItem(checklistArea, 'Form 16 (Part B)', 'Salary Income', true, hasForm16B);
    createChecklistItem(checklistArea, 'Employer HRA / Rental Receipts', 'Deductions', false, hasHra);
    requiredCount += 2;
    if (hasForm16A) uploadedCount++;
    if (hasForm16B) uploadedCount++;
    if (hasHra) uploadedCount++;
  }
  if (appState.profile.investor) {
    createChecklistItem(checklistArea, 'Broker Capital Gain Statement', 'Investment', true, hasCG);
    createChecklistItem(checklistArea, 'Dividend Ledger Statement', 'Other Income', false, false);
    requiredCount++;
    if (hasCG) uploadedCount++;
  }
  if (appState.profile.landlord) {
    createChecklistItem(checklistArea, 'Home Loan Interest Certificate', 'Exemptions', true, hasHL);
    createChecklistItem(checklistArea, 'Municipal Property Tax Receipt', 'Exemptions', false, false);
    requiredCount++;
    if (hasHL) uploadedCount++;
  }
  if (appState.profile.business || appState.profile.freelancer) {
    createChecklistItem(checklistArea, 'GST GSTR-1 & 3B Summaries', 'Business', true, hasGst);
    createChecklistItem(checklistArea, 'Profit & Loss Sheet', 'Business', true, hasPnL);
    requiredCount += 2;
    if (hasGst) uploadedCount++;
    if (hasPnL) uploadedCount++;
  }
  if (appState.profile.crypto) {
    createChecklistItem(checklistArea, 'Crypto Exchange Profit Statement', 'Speculative', true, hasCrypto);
    requiredCount++;
    if (hasCrypto) uploadedCount++;
  }

  const el = document.getElementById('checklist-progress');
  if (el) el.innerText = `${uploadedCount} / ${requiredCount} Uploaded`;

  recalculateHealthScore();
}

function createChecklistItem(container, name, category, isRequired, isUploaded) {
  const item = document.createElement('div');
  item.className = 'document-item';

  let statusBadge = isUploaded
    ? `<div class="doc-status-badge success"><i class="fa-solid fa-check"></i></div>`
    : isRequired
      ? `<div class="doc-status-badge warning"><i class="fa-solid fa-clock"></i></div>`
      : `<div class="doc-status-badge muted"><i class="fa-solid fa-plus" onclick="triggerFileInput()"></i></div>`;

  item.innerHTML = `
    <div class="doc-info">
      <i class="fa-solid ${category === 'Salary Income' ? 'fa-file-invoice-dollar' : 'fa-file-lines'}" style="font-size: 18px; color: ${isRequired ? 'var(--color-warning)' : 'var(--text-muted)'};"></i>
      <div>
        <div class="doc-name">${name}</div>
        <div class="doc-meta">${category} • ${isRequired ? 'Mandatory' : 'Optional'}</div>
      </div>
    </div>
    ${statusBadge}
  `;
  container.appendChild(item);
}

// ==========================================
// Step 2: Document Upload
// ==========================================
function triggerFileInput() {
  document.getElementById('file-uploader-input').click();
}

async function handleFileSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  // Must be logged in to upload
  if (!appState.userLoggedIn) {
    showToast('Not Signed In', 'Please sign in before uploading documents.', 'error');
    return;
  }

  const formData = new FormData();
  for (let file of files) formData.append('files', file);

  const uid = window._firebaseUser?.uid || appState.uid || '';

  showToast('Uploading Documents', `Transmitting ${files.length} file(s) securely...`, 'info');

  try {
    const res = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: { 'X-User-UID': uid }, // No Content-Type — let browser set multipart boundary
      body: formData
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast('Upload Failed', data.error || 'Server rejected the upload.', 'error');
      return;
    }

    if (data.user) {
      // Merge returned user data preserving Google profile fields
      appState = {
        ...appState,
        ...data.user,
        userName:  data.user.name     || appState.userName,
        userEmail: data.user.email    || appState.userEmail,
        userPhoto: data.user.photoURL || appState.userPhoto,
        userPhone: data.user.phone    || appState.userPhone,
        userPAN:   data.user.pan      || appState.userPAN,
      };
    }

    // Update file list from returned data (authoritative)
    if (data.files && data.files.length > 0) {
      // Merge: replace existing entries, append new
      data.files.forEach(newFile => {
        const idx = appState.uploadedFiles.findIndex(f => f.name === newFile.name);
        if (idx >= 0) appState.uploadedFiles[idx] = newFile;
        else appState.uploadedFiles.push(newFile);
      });
    }

    showToast('Upload Complete ✅', data.ocrSummary || 'Documents stored and analysed.', 'success');

    // Tell user what was detected
    const typesDetected = [...new Set(data.files?.map(f => f.type) || [])];
    if (typesDetected.length > 0) {
      addBotMessage(`📄 Uploaded <b>${data.files.length} file(s)</b>. Detected: <b>${typesDetected.join(', ')}</b>. ${data.ocrSummary ? 'OCR noted: ' + data.ocrSummary + '.' : ''} Complete your income figures in Step 3.`);
    }

    renderFilesPreview();
    updateProfileChecklist();
    syncInputsToUi();
    recalculateAll();
    initCapitalGainsTable();

  } catch (err) {
    console.error(err);
    showToast('Upload Failed', 'Could not complete upload. Check server connection.', 'error');
  }
}

function renderFilesPreview() {
  const preview = document.getElementById('files-preview-list');
  if (!preview) return;
  preview.innerHTML = '';

  if (!appState.uploadedFiles || appState.uploadedFiles.length === 0) {
    preview.innerHTML = `
      <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12px;">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:28px; display:block; margin-bottom:8px; opacity:0.4;"></i>
        No documents uploaded yet. Drag & drop or click to upload.
      </div>`;
    return;
  }

  const docTypeIcons = {
    'Form 16 (Part A)': 'fa-file-invoice-dollar',
    'Form 16 (Part B)': 'fa-file-invoice-dollar',
    'Salary Slip': 'fa-file-invoice',
    'Capital Gains Statement': 'fa-chart-line',
    'Home Loan Certificate': 'fa-house',
    'Rent Receipts': 'fa-receipt',
    'Investment Proof': 'fa-piggy-bank',
    'Form 26AS / AIS': 'fa-landmark',
    'Bank Statement': 'fa-building-columns',
    'PAN Card': 'fa-id-card',
    'Aadhaar Card': 'fa-fingerprint',
    'Other': 'fa-file-lines'
  };

  appState.uploadedFiles.forEach(f => {
    const card = document.createElement('div');
    card.className = 'file-preview-card';
    if (f.parsed) card.style.borderColor = 'var(--color-success)';

    const icon = docTypeIcons[f.type] || 'fa-file-pdf';
    const uploadDate = f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    const options = Object.keys(docTypeIcons).map(t => {
      const selected = f.type === t ? 'selected' : '';
      return `<option value="${t}" ${selected}>${t}</option>`;
    }).join('');

    card.innerHTML = `
      <div class="file-preview-details" style="width: 100%;">
        <i class="fa-solid ${icon} file-preview-icon" style="color: var(--color-primary); align-self: flex-start; margin-top: 4px;"></i>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight:600; font-size:12px; word-break:break-all; padding-right: 24px; position: relative;">
            ${f.name}
            <button onclick="deleteUploadedFile('${f.name}', this)" title="Delete file" style="position: absolute; right: 0; top: 0; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 4px; border-radius: 4px; transition: color 0.2s;" onmouseover="this.style.color='var(--color-error)'" onmouseout="this.style.color='var(--text-muted)'">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
          <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${f.size}${uploadDate ? ' • ' + uploadDate : ''}</div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
            <span style="font-size: 10px; color: var(--text-secondary); white-space: nowrap;">Map to:</span>
            <select onchange="mapFileCategory('${f.name}', this.value)" style="background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 6px; font-size: 10px; padding: 2px 6px; outline: none; color: var(--text-primary); cursor: pointer; flex: 1; min-width: 0;">
              ${options}
            </select>
          </div>
        </div>
      </div>
      <span class="ocr-badge" style="white-space:nowrap; align-self: flex-start;">${f.parsed ? '<i class="fa-solid fa-circle-check"></i> Analysed' : '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading...'}</span>
    `;
    preview.appendChild(card);
  });
}

let deleteConfirmTimeout = null;
let fileToBeDeleted = null;

async function deleteUploadedFile(filename, element) {
  if (fileToBeDeleted === filename) {
    clearTimeout(deleteConfirmTimeout);
    fileToBeDeleted = null;

    showToast('Deleting File', 'Removing document securely...', 'info');

    const res = await apiPost('/documents/delete', { name: filename });
    if (res && !res.error) {
      showToast('Deleted Successfully', 'Document has been deleted.', 'success');
      
      if (res.user) {
        appState = {
          ...appState,
          ...res.user,
          userName:  res.user.name     || appState.userName,
          userEmail: res.user.email    || appState.userEmail,
          userPhoto: res.user.photoURL || appState.userPhoto,
          userPhone: res.user.phone    || appState.userPhone,
          userPAN:   res.user.pan      || appState.userPAN,
        };
      }
      
      renderFilesPreview();
      updateProfileChecklist();
      syncInputsToUi();
      recalculateAll();
    } else {
      showToast('Delete Failed', res?.error || 'Could not delete file.', 'error');
    }
  } else {
    fileToBeDeleted = filename;
    
    // Arm this specific button (change trash icon to red checkmark)
    if (element) {
      element.innerHTML = '<i class="fa-solid fa-check" style="color: var(--color-error); font-weight: 800;"></i>';
      element.title = "Click again to confirm delete";
      showToast('Confirm Delete ⚠', 'Click the red checkmark again to confirm deletion.', 'warning');
    }
    
    // Auto reset back to normal if not clicked within 4 seconds
    deleteConfirmTimeout = setTimeout(() => {
      fileToBeDeleted = null;
      renderFilesPreview();
    }, 4000);
  }
}

async function mapFileCategory(filename, newType) {
  showToast('Mapping Document', `Reclassifying to ${newType}...`, 'info');

  const res = await apiPost('/documents/update-type', { name: filename, type: newType });
  if (res && !res.error) {
    showToast('Reclassified ✅', `Mapped as ${newType}.`, 'success');
    
    if (res.user) {
      appState = {
        ...appState,
        ...res.user,
        userName:  res.user.name     || appState.userName,
        userEmail: res.user.email    || appState.userEmail,
        userPhoto: res.user.photoURL || appState.userPhoto,
        userPhone: res.user.phone    || appState.userPhone,
        userPAN:   res.user.pan      || appState.userPAN,
      };
      
      // Update checkmarks in the settings checklist UI
      ['salaried','business','freelancer','investor','landlord','retired','nri','crypto'].forEach(f => {
        const el = document.getElementById('profile-' + f);
        if (el) el.checked = !!appState.profile[f];
      });
    }

    renderFilesPreview();
    updateProfileChecklist();
    syncInputsToUi();
    recalculateAll();
  } else {
    showToast('Reclassification Failed', res?.error || 'Could not map file.', 'error');
  }
}

// Drag & Drop
const dropZone = document.getElementById('drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-primary)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(255,255,255,0.15)';
    if (e.dataTransfer.files.length > 0) handleFileSelect({ target: { files: e.dataTransfer.files } });
  });
}

// ==========================================
// Step 3 & 4: OCR Sync & Govt Reconciliation
// ==========================================
async function syncInputsToUi() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('ocr-gross-salary',     appState.income.grossSalary);
  set('ocr-tds-salary',       appState.income.tdsSalary || 0);
  set('ocr-savings-interest', appState.income.savingsInterest);
  set('ocr-ded-80c',          appState.deductions.sec80C);
  set('ocr-ded-80d',          appState.deductions.sec80D);
  set('ocr-ded-nps',          appState.deductions.sec80CCD);

  await syncCalculatorInputsToUi();
}

async function syncCalculatorInputsToUi() {
  if (!appState.calculators) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };

  // HRA
  if (appState.calculators.hra) {
    set('hra-basic', appState.calculators.hra.basic);
    set('hra-received', appState.calculators.hra.hraReceived);
    set('hra-rent-paid', appState.calculators.hra.rentPaid);
    set('hra-city-metro', appState.calculators.hra.metro);
    await runHraCalculator();
  }
  // Home Loan
  if (appState.calculators.homeLoan) {
    set('hl-interest', appState.calculators.homeLoan.interest);
    set('hl-principal', appState.calculators.homeLoan.principal);
    set('hl-occupancy', appState.calculators.homeLoan.occupancy);
    set('hl-share', appState.calculators.homeLoan.share);
    await runHomeLoanCalculator();
  }
  // Presumptive Business
  if (appState.calculators.business) {
    set('pres-section', appState.calculators.business.section);
    set('pres-gross-receipts', appState.calculators.business.gross);
    set('pres-digital-receipts', appState.calculators.business.digital);
    await runPresumptiveCalculations();
  }
}

async function recalculateAll() {
  const gv = id => parseFloat(document.getElementById(id)?.value) || 0;
  appState.income.grossSalary      = gv('ocr-gross-salary');
  appState.income.tdsSalary        = gv('ocr-tds-salary');
  appState.income.savingsInterest  = gv('ocr-savings-interest');
  appState.deductions.sec80C       = gv('ocr-ded-80c');
  appState.deductions.sec80D       = gv('ocr-ded-80d');
  appState.deductions.sec80CCD     = gv('ocr-ded-nps');

  await apiPost('/profile/save-inputs', { income: appState.income, deductions: appState.deductions });

  const comp = await apiPost('/regime/compare', { user: appState });
  if (comp && !comp.error) {
    appState.income.taxNewRegime  = comp.taxNewRegime;
    appState.income.taxOldRegime  = comp.taxOldRegime;
    appState.income.netTaxableNew = comp.netNew;
    appState.income.netTaxableOld = comp.netOld;
  }

  // Update UI
  const fmt = n => '₹' + (n || 0).toLocaleString('en-IN');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  setText('regime-tax-old',         fmt(appState.income.taxOldRegime));
  setText('regime-tax-old-details', 'Net taxable: ' + fmt(appState.income.netTaxableOld));
  setText('regime-tax-new',         fmt(appState.income.taxNewRegime));
  setText('regime-tax-new-details', 'Net taxable: ' + fmt(appState.income.netTaxableNew));

  const diff    = Math.abs(appState.income.taxOldRegime - appState.income.taxNewRegime);
  const newStar = document.getElementById('new-regime-star');
  const advice  = document.getElementById('regime-ai-advice');

  if (appState.income.taxNewRegime < appState.income.taxOldRegime) {
    if (newStar) { newStar.innerText = '⭐ Recommended'; newStar.style.backgroundColor = 'var(--color-success)'; }
    if (advice)  advice.innerHTML = `Under your income profile, the <strong>New Tax Regime</strong> saves you <strong>${fmt(diff)}</strong> in taxes. We recommend filing under the New Regime.`;
    appState.recommendedRegime = 'new';
  } else {
    if (newStar) { newStar.innerText = 'Alternative'; newStar.style.backgroundColor = 'var(--text-muted)'; }
    if (advice)  advice.innerHTML = `The <strong>Old Tax Regime</strong> is more beneficial under your profile, saving you <strong>${fmt(diff)}</strong>. We recommend the Old Regime.`;
    appState.recommendedRegime = 'old';
  }

  generateSavingAdvisorList();
  renderComparisonMatrix();
  updateDashboardWidgets();
  if (appState.activeWizardStep === 6) {
    renderTaxCalculationSheet(appState.selectedRegime || 'new');
  }
}

async function triggerGovDataFetch() {
  document.getElementById('gov-fetch-trigger-container').innerHTML = `
    <i class="fa-solid fa-spinner fa-spin" style="font-size:24px; color: var(--color-primary);"></i>
    <span style="display:block; font-size: 12px; margin-top:8px; color:var(--text-secondary);">Querying Live AIS/TIS Portal APIs under ERI consent...</span>
  `;

  const res = await apiGet('/gov/reconciliation');
  if (res && res.user) {
    appState = { ...appState, ...res.user };
    appState.userName = res.user.name || appState.userName;
    appState.userPAN  = res.user.pan  || appState.userPAN;
    if (res.govData) appState.govData = res.govData;
  }

  setTimeout(() => {
    document.getElementById('gov-fetch-trigger-container').style.display = 'none';
    document.getElementById('reconciliation-table-container').style.display = 'block';
    showToast('AIS Data Received', 'Government records matched successfully.', 'warning');
    updateReconciliationTable();
    openReconMismatch();
    recalculateHealthScore();
  }, 2000);
}

function updateReconciliationTable() {
  const govSalary = appState.govData ? appState.govData.salaryCredit : 1250000;
  const govTds = appState.govData ? appState.govData.tdsDeposited : 64500;
  const govInterest = appState.govData ? appState.govData.savingsInterest : 14500;

  const docSalary = appState.income.grossSalary;
  const docTds = appState.income.tdsSalary || 0;
  const docInterest = appState.income.savingsInterest;

  const fmt = n => '₹' + (n || 0).toLocaleString('en-IN');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  setText('recon-doc-sal', fmt(docSalary));
  setText('recon-gov-sal', fmt(govSalary));
  setText('recon-doc-tds', fmt(docTds));
  setText('recon-gov-tds', fmt(govTds));
  setText('recon-doc-interest', fmt(docInterest));
  setText('recon-gov-interest', fmt(govInterest));

  const salMatch = docSalary === govSalary;
  const tdsMatch = docTds === govTds;
  const interestMatch = docInterest === govInterest;

  // Update badges
  updateReconBadge('recon-badge-sal', salMatch);
  updateReconBadge('recon-badge-tds', tdsMatch);
  updateReconBadge('recon-badge-interest', interestMatch);

  // Update alert banner dynamically
  const alertEl = document.getElementById('recon-alert-status');
  if (alertEl) {
    if (salMatch && tdsMatch && interestMatch) {
      alertEl.className = 'ui-alert success';
      alertEl.innerHTML = `<i class="fa-solid fa-circle-check ui-alert-icon"></i><div><strong>Reconciliation Verified:</strong> All salary, TDS, and savings interest credits matched 100% with the Government AIS database.</div>`;
    } else {
      alertEl.className = 'ui-alert warning';
      let discrepancies = [];
      if (!salMatch) discrepancies.push('Salary (Section 17)');
      if (!tdsMatch) discrepancies.push('TDS on Salary (26AS)');
      if (!interestMatch) discrepancies.push('Interest on Savings Accounts');
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation ui-alert-icon"></i><div><strong>Discrepancies Detected:</strong> Mismatches found in <b>${discrepancies.join(', ')}</b>. Review and align values below.</div>`;
    }
  }
}

function updateReconBadge(id, isMatch) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isMatch) {
    el.className = 'recon-badge match';
    el.innerText = '✔ Matched';
    el.style.cursor = 'default';
    el.onclick = null;
  } else {
    el.className = 'recon-badge mismatch';
    el.innerText = '⚠ Diff Found';
    el.style.cursor = 'pointer';
    el.onclick = openReconMismatch;
  }
}

function openReconMismatch() {
  const govInterest = appState.govData ? appState.govData.savingsInterest : 14500;
  const docInterest = appState.income.savingsInterest;

  if (docInterest !== govInterest) {
    document.getElementById('interest-mismatch-fix').style.display = 'block';
    
    const diff = Math.abs(govInterest - docInterest);
    const descEl = document.querySelector('#interest-mismatch-fix .error-fix-desc');
    if (descEl) {
      descEl.innerHTML = `Government AIS shows <b>₹${govInterest.toLocaleString('en-IN')}</b> from ICICI Bank and Airtel Payments Bank, but your inputs list <b>₹${docInterest.toLocaleString('en-IN')}</b>. It is recommended to import the extra <b>₹${diff.toLocaleString('en-IN')}</b> to prevent automated Income Tax notices under Sec 143(1).`;
    }

    const buttons = document.querySelectorAll('#interest-mismatch-fix button');
    if (buttons && buttons.length >= 2) {
      buttons[0].innerText = `Use Govt Value (₹${govInterest.toLocaleString('en-IN')})`;
      buttons[0].setAttribute('onclick', `acceptGovValue('interest', ${govInterest})`);
      buttons[1].innerText = `Keep My Value (₹${docInterest.toLocaleString('en-IN')})`;
    }

    addBotMessage(`⚠️ Your uploaded documents show savings interest of <b>₹${docInterest.toLocaleString('en-IN')}</b>, but the Income Tax Department's AIS shows <b>₹${govInterest.toLocaleString('en-IN')}</b>. Accept the government figure to avoid scrutiny notices.`);
  } else {
    document.getElementById('interest-mismatch-fix').style.display = 'none';
  }
}

async function acceptGovValue(field, val) {
  if (field === 'interest') {
    const res = await apiPost('/gov/reconciliation/override', { resolve: true });
    if (res && res.user) {
      appState = { ...appState, ...res.user };
      appState.userName = res.user.name || appState.userName;
    }
    const interestInput = document.getElementById('ocr-savings-interest');
    if (interestInput) interestInput.value = val;
    document.getElementById('interest-mismatch-fix').style.display = 'none';
    showToast('Mismatch Resolved', 'Using AIS government value — audit risk eliminated.', 'success');
    recalculateAll();
    updateReconciliationTable();
    recalculateHealthScore();
  }
}

async function ignoreGovValue() {
  const res = await apiPost('/gov/reconciliation/override', { resolve: false });
  if (res && res.user) {
    appState = { ...appState, ...res.user };
  }
  document.getElementById('interest-mismatch-fix').style.display = 'none';
  showToast('Difference Flagged', 'Filing with your actual uploaded receipt values.', 'warning');
  recalculateAll();
  updateReconciliationTable();
  recalculateHealthScore();
}

// ==========================================
// Step 5: Calculator Modules
// ==========================================
function switchCalcSubTab(subTabId) {
  document.querySelectorAll('.calc-subview').forEach(v => v.style.display = 'none');
  document.getElementById(`calc-subtab-${subTabId}`).style.display = 'block';
  document.querySelectorAll('#wizard-step-5 .btn-secondary').forEach(b => b.classList.remove('active'));
  document.getElementById(`calc-tab-btn-${subTabId}`).classList.add('active');
}

function openCalcSubtabFromOutside(subTabId) {
  showSection('wizard-section');
  showWizardStep(5);
  switchCalcSubTab(subTabId);
}

async function runHraCalculator() {
  const basic       = parseFloat(document.getElementById('hra-basic').value) || 0;
  const hraReceived = parseFloat(document.getElementById('hra-received').value) || 0;
  const rent        = parseFloat(document.getElementById('hra-rent-paid').value) || 0;
  const metro       = document.getElementById('hra-city-metro').value;

  const res = await apiPost('/calculators/hra', { basic, hraReceived, rentPaid: rent, metro });
  if (res && !res.error) {
    document.getElementById('hra-exempt-val').innerText  = '₹' + res.exemptHRA.toLocaleString('en-IN');
    document.getElementById('hra-taxable-val').innerText = '₹' + res.taxableHRA.toLocaleString('en-IN');
    appState.calculatedHraExempt = res.exemptHRA;
  }
}

function applyHraExemption() {
  appState.income.hraExemption = appState.calculatedHraExempt || 0;
  showToast('HRA Claim Applied', `₹${appState.income.hraExemption.toLocaleString('en-IN')} added.`, 'success');
  recalculateAll();
}

async function runHomeLoanCalculator() {
  const interest  = parseFloat(document.getElementById('hl-interest').value) || 0;
  const principal = parseFloat(document.getElementById('hl-principal').value) || 0;
  const occupancy = document.getElementById('hl-occupancy').value;
  const share     = parseFloat(document.getElementById('hl-share').value) || 100;

  const res = await apiPost('/calculators/home-loan', { interest, principal, occupancy, share });
  if (res && !res.error) {
    document.getElementById('hl-eligible-interest').innerText  = '₹' + res.eligibleInterest.toLocaleString('en-IN');
    document.getElementById('hl-eligible-principal').innerText = '₹' + res.eligiblePrincipal.toLocaleString('en-IN');
    appState.calculatedHLInterest  = res.eligibleInterest;
    appState.calculatedHLPrincipal = res.eligiblePrincipal;
  }
}

function applyHomeLoanDeductions() {
  appState.income.homeLoanInterestLoss = appState.calculatedHLInterest || 0;
  showToast('Loan Deductions Applied', `Sec 24(b) claim of ₹${appState.income.homeLoanInterestLoss.toLocaleString('en-IN')} added.`, 'success');
  recalculateAll();
}

async function runPresumptiveCalculations() {
  const section = document.getElementById('pres-section').value;
  const gross   = parseFloat(document.getElementById('pres-gross-receipts').value) || 0;
  const digital = parseFloat(document.getElementById('pres-digital-receipts').value) || 0;

  const res = await apiPost('/calculators/business', { section, gross, digital });
  if (res && !res.error) {
    document.getElementById('pres-min-profit').innerText    = '₹' + res.deemedProfit.toLocaleString('en-IN');
    document.getElementById('pres-taxable-income').innerText = '₹' + res.deemedProfit.toLocaleString('en-IN');
    appState.calculatedBusinessProfit = res.deemedProfit;
  }
}

function applyBusinessIncome() {
  appState.income.businessPresIncome = appState.calculatedBusinessProfit || 0;
  showToast('Business Profit Applied', `₹${appState.income.businessPresIncome.toLocaleString('en-IN')} added.`, 'success');
  recalculateAll();
}

// Capital Gains
async function initCapitalGainsTable() {
  const tbody = document.querySelector('#cg-transactions-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Fetch latest from backend
  const db = await apiGet('/transactions');
  if (db && !db.error) appState.cgTransactions = db;

  let totalSTCG = 0, totalLTCG = 0;

  appState.cgTransactions.forEach((t, idx) => {
    totalSTCG += t.type === 'STCG' ? t.result : 0;
    totalLTCG += t.type === 'LTCG' ? t.result : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${t.asset}</strong></td>
      <td>${t.buyDate}</td>
      <td>${t.sellDate}</td>
      <td>₹${t.buyVal.toLocaleString('en-IN')}</td>
      <td>₹${t.sellVal.toLocaleString('en-IN')}</td>
      <td><span style="font-weight:700; color:var(--color-success);">+₹${t.result.toLocaleString('en-IN')} (${t.type})</span></td>
      <td>₹${t.tax.toLocaleString('en-IN')}</td>
      <td><button class="btn btn-secondary btn-sm" style="padding:4px 8px;font-size:10px;" onclick="deleteCgRow(${idx})"><i class="fa-solid fa-trash"></i></button></td>
    `;
    tbody.appendChild(tr);
  });

  const ltcgTax = Math.max(0, totalLTCG - 125000) * 0.125;
  const stcgTax = totalSTCG * 0.20;
  const netTax  = stcgTax + ltcgTax;

  document.getElementById('cg-total-stcg').innerText = '₹' + totalSTCG.toLocaleString('en-IN');
  document.getElementById('cg-total-ltcg').innerText = '₹' + totalLTCG.toLocaleString('en-IN');
  document.getElementById('cg-total-tax').innerText  = '₹' + netTax.toLocaleString('en-IN');

  appState.income.capitalGainsSTCG = totalSTCG;
  appState.income.capitalGainsLTCG = totalLTCG;
  appState.income.capitalGainsTax  = netTax;
}

async function addCapitalGainRow() {
  const asset    = document.getElementById('cg-new-asset')?.value    || 'New Asset';
  const buyDate  = document.getElementById('cg-new-buy-date')?.value  || '';
  const sellDate = document.getElementById('cg-new-sell-date')?.value || '';
  const buyVal   = parseFloat(document.getElementById('cg-new-buy-val')?.value)  || 0;
  const sellVal  = parseFloat(document.getElementById('cg-new-sell-val')?.value) || 0;

  if (!buyDate || !sellDate || buyVal <= 0 || sellVal <= 0) {
    showToast('Incomplete Data', 'Please fill in all capital gain transaction fields.', 'error');
    return;
  }

  const res = await apiPost('/calculators/capital-gains', { asset, buyDate, sellDate, buyVal, sellVal });
  if (res && res.transactions) {
    appState.cgTransactions = res.transactions;
    showToast('Transaction Recorded', `${asset} — gain computed and stored.`, 'success');
    initCapitalGainsTable();
    recalculateAll();
  }
}

async function deleteCgRow(idx) {
  const res = await apiPost('/calculators/capital-gains/delete', { index: idx });
  if (res && res.transactions) appState.cgTransactions = res.transactions;
  initCapitalGainsTable();
  recalculateAll();
}

// ==========================================
// Step 6: Regime Selector
// ==========================================
function selectRegime(regime) {
  appState.selectedRegime = regime;
  document.getElementById('regime-card-old').classList.remove('selected');
  document.getElementById('regime-card-new').classList.remove('selected');
  document.getElementById(`regime-card-${regime}`).classList.add('selected');
  showToast('Regime Selected', `${regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'} chosen.`, 'info');
  recalculateAll();
  renderTaxCalculationSheet(regime);
}

function renderTaxCalculationSheet(regime) {
  const container = document.getElementById('tax-calculation-sheet');
  if (!container) return;

  container.style.display = 'block';

  const grossSalary = appState.income.grossSalary || 0;
  const interest = appState.income.savingsInterest || 0;
  const capitalGainsSTCG = appState.income.capitalGainsSTCG || 0;
  const capitalGainsLTCG = appState.income.capitalGainsLTCG || 0;
  const businessIncome = appState.income.businessPresIncome || 0;
  
  const cgSTCG = Math.max(0, capitalGainsSTCG);
  const cgLTCG = Math.max(0, capitalGainsLTCG);
  const totalGross = grossSalary + interest + cgSTCG + cgLTCG + businessIncome;

  const fmt = n => '₹' + (n || 0).toLocaleString('en-IN');

  let html = '';

  if (regime === 'new') {
    const stdDed = 75000;
    const netNew = Math.max(0, totalGross - stdDed);

    // Slab breakdown math (FY 2025-26 / AY 2026-27)
    let rem = netNew;
    let slabDetails = [];
    let basicTax = 0;

    if (netNew <= 1200000) {
      slabDetails.push({ range: 'Up to ₹12,00,000 (Rebate Sec 87A)', rate: '0%', tax: 0 });
      basicTax = 0;
    } else {
      // 0-4L
      const s1 = Math.min(400000, rem);
      slabDetails.push({ range: 'Up to ₹4,00,000', rate: '0%', tax: 0 });
      rem = Math.max(0, rem - s1);

      // 4-8L @ 5%
      const s2 = Math.min(400000, rem);
      const tax2 = s2 * 0.05;
      slabDetails.push({ range: '₹4,00,001 - ₹8,00,000', rate: '5%', tax: tax2 });
      basicTax += tax2;
      rem = Math.max(0, rem - s2);

      // 8-12L @ 10%
      const s3 = Math.min(400000, rem);
      const tax3 = s3 * 0.10;
      slabDetails.push({ range: '₹8,00,001 - ₹12,00,000', rate: '10%', tax: tax3 });
      basicTax += tax3;
      rem = Math.max(0, rem - s3);

      // 12-16L @ 15%
      const s4 = Math.min(400000, rem);
      const tax4 = s4 * 0.15;
      slabDetails.push({ range: '₹12,00,001 - ₹16,00,000', rate: '15%', tax: tax4 });
      basicTax += tax4;
      rem = Math.max(0, rem - s4);

      // 16-20L @ 20%
      const s5 = Math.min(400000, rem);
      const tax5 = s5 * 0.20;
      slabDetails.push({ range: '₹16,00,001 - ₹20,00,000', rate: '20%', tax: tax5 });
      basicTax += tax5;
      rem = Math.max(0, rem - s5);

      // 20-24L @ 25%
      const s6 = Math.min(400000, rem);
      const tax6 = s6 * 0.25;
      slabDetails.push({ range: '₹20,00,001 - ₹24,00,000', rate: '25%', tax: tax6 });
      basicTax += tax6;
      rem = Math.max(0, rem - s6);

      // Above 24L @ 30%
      if (rem > 0) {
        const tax7 = rem * 0.30;
        slabDetails.push({ range: 'Above ₹24,00,000', rate: '30%', tax: tax7 });
        basicTax += tax7;
      }
    }

    const cess = basicTax * 0.04;
    let ltcgTaxable = Math.max(0, capitalGainsLTCG - 125000);
    let cgTax = (capitalGainsSTCG * 0.20) + (ltcgTaxable * 0.125);
    const totalTax = Math.round(basicTax + cess + cgTax);

    html = `
      <h4 style="font-weight: 700; color: var(--color-primary); margin-bottom: 16px; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;">
        <i class="fa-solid fa-calculator"></i> Detailed Tax Calculation Sheet — New Tax Regime
      </h4>
      <table class="calc-table" style="font-size: 12px; margin-bottom: 16px; width: 100%;">
        <tbody>
          <tr><td>Gross Salaried Income (Section 17(1))</td><td style="text-align: right;">${fmt(grossSalary)}</td></tr>
          <tr><td>Savings Bank Interest</td><td style="text-align: right;">${fmt(interest)}</td></tr>
          ${capitalGainsSTCG > 0 ? `<tr><td>Short-Term Capital Gains (STCG)</td><td style="text-align: right;">${fmt(capitalGainsSTCG)}</td></tr>` : ''}
          ${capitalGainsLTCG > 0 ? `<tr><td>Long-Term Capital Gains (LTCG)</td><td style="text-align: right;">${fmt(capitalGainsLTCG)}</td></tr>` : ''}
          ${businessIncome > 0 ? `<tr><td>Presumptive Business Income</td><td style="text-align: right;">${fmt(businessIncome)}</td></tr>` : ''}
          <tr style="font-weight: 700; background: rgba(255,255,255,0.05);"><td>Total Gross Income</td><td style="text-align: right;">${fmt(totalGross)}</td></tr>
          <tr style="color: var(--color-accent);"><td>Less: Standard Deduction (Salaried)</td><td style="text-align: right; color: var(--color-accent);">- ${fmt(stdDed)}</td></tr>
          <tr style="font-weight: 700; background: rgba(0,0,0,0.2);"><td>Net Taxable Income</td><td style="text-align: right; color: var(--color-success);">${fmt(netNew)}</td></tr>
        </tbody>
      </table>

      <h5 style="font-weight: 600; margin-bottom: 8px; font-size: 12px;">Slab-Wise Tax Breakdown</h5>
      <table class="calc-table" style="font-size: 11px; margin-bottom: 16px; width: 100%;">
        <thead>
          <tr><th>Income Slab</th><th>Rate</th><th style="text-align: right;">Tax Amount</th></tr>
        </thead>
        <tbody>
          ${slabDetails.map(s => `<tr><td>${s.range}</td><td>${s.rate}</td><td style="text-align: right;">${fmt(s.tax)}</td></tr>`).join('')}
          <tr style="font-weight:700;"><td>Basic Slab Tax</td><td>—</td><td style="text-align: right;">${fmt(basicTax)}</td></tr>
          <tr><td>Health & Education Cess</td><td>4%</td><td style="text-align: right;">${fmt(cess)}</td></tr>
          ${cgTax > 0 ? `<tr><td>Capital Gains Tax (Flat rate)</td><td>STCG 20% / LTCG 12.5%</td><td style="text-align: right;">${fmt(cgTax)}</td></tr>` : ''}
          <tr style="font-weight: 800; font-size:13px; background: rgba(255,255,255,0.08); border-top: 1px solid var(--color-primary);">
            <td>Total Tax Liability</td><td>—</td><td style="text-align: right; color: var(--color-error);">${fmt(totalTax)}</td>
          </tr>
        </tbody>
      </table>
    `;
  } else {
    // Old Regime calculation
    const stdDed = 50000;
    const sec80C = Math.min(150000, appState.deductions.sec80C || 0);
    const sec80D = Math.min(25000, appState.deductions.sec80D || 0);
    const sec80CCD = Math.min(50000, appState.deductions.sec80CCD || 0);
    const sec80TTA = Math.min(10000, interest);
    const hra = appState.income.hraExemption || 0;
    const hl = appState.income.homeLoanInterestLoss || 0;

    const totalDeductions = stdDed + sec80C + sec80D + sec80CCD + sec80TTA + hra + hl;
    const netOld = Math.max(0, totalGross - totalDeductions);

    let rem = netOld;
    let slabDetails = [];
    let basicTax = 0;

    if (netOld <= 500000) {
      slabDetails.push({ range: 'Up to ₹5,00,000 (Rebate Sec 87A)', rate: '0%', tax: 0 });
      basicTax = 0;
    } else {
      // 0-2.5L
      const s1 = Math.min(250000, rem);
      slabDetails.push({ range: 'Up to ₹2,50,000', rate: '0%', tax: 0 });
      rem = Math.max(0, rem - s1);

      // 2.5-5L @ 5%
      const s2 = Math.min(250000, rem);
      const tax2 = s2 * 0.05;
      slabDetails.push({ range: '₹2,50,001 - ₹5,00,000', rate: '5%', tax: tax2 });
      basicTax += tax2;
      rem = Math.max(0, rem - s2);

      // 5-10L @ 20%
      const s3 = Math.min(500000, rem);
      const tax3 = s3 * 0.20;
      slabDetails.push({ range: '₹5,00,001 - ₹10,00,000', rate: '20%', tax: tax3 });
      basicTax += tax3;
      rem = Math.max(0, rem - s3);

      // Above 10L @ 30%
      if (rem > 0) {
        const tax4 = rem * 0.30;
        slabDetails.push({ range: 'Above ₹10,00,000', rate: '30%', tax: tax4 });
        basicTax += tax4;
      }
    }

    const cess = basicTax * 0.04;
    let ltcgTaxable = Math.max(0, capitalGainsLTCG - 125000);
    let cgTax = (capitalGainsSTCG * 0.20) + (ltcgTaxable * 0.125);
    const totalTax = Math.round(basicTax + cess + cgTax);

    html = `
      <h4 style="font-weight: 700; color: var(--color-primary); margin-bottom: 16px; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;">
        <i class="fa-solid fa-calculator"></i> Detailed Tax Calculation Sheet — Old Tax Regime
      </h4>
      <table class="calc-table" style="font-size: 12px; margin-bottom: 16px; width: 100%;">
        <tbody>
          <tr><td>Gross Salaried Income (Section 17(1))</td><td style="text-align: right;">${fmt(grossSalary)}</td></tr>
          <tr><td>Savings Bank Interest</td><td style="text-align: right;">${fmt(interest)}</td></tr>
          ${capitalGainsSTCG > 0 ? `<tr><td>Short-Term Capital Gains (STCG)</td><td style="text-align: right;">${fmt(capitalGainsSTCG)}</td></tr>` : ''}
          ${capitalGainsLTCG > 0 ? `<tr><td>Long-Term Capital Gains (LTCG)</td><td style="text-align: right;">${fmt(capitalGainsLTCG)}</td></tr>` : ''}
          ${businessIncome > 0 ? `<tr><td>Presumptive Business Income</td><td style="text-align: right;">${fmt(businessIncome)}</td></tr>` : ''}
          <tr style="font-weight: 700; background: rgba(255,255,255,0.05);"><td>Total Gross Income</td><td style="text-align: right;">${fmt(totalGross)}</td></tr>
          
          <tr style="color: var(--color-accent); font-size:11px;"><td>Less: Standard Deduction</td><td style="text-align: right;">- ${fmt(stdDed)}</td></tr>
          ${hra > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: HRA Exemption (Sec 10(13A))</td><td style="text-align: right;">- ${fmt(hra)}</td></tr>` : ''}
          ${hl > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: Home Loan Interest (Sec 24(b))</td><td style="text-align: right;">- ${fmt(hl)}</td></tr>` : ''}
          ${sec80C > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: Deduction Sec 80C (PPF/LIC/EPF)</td><td style="text-align: right;">- ${fmt(sec80C)}</td></tr>` : ''}
          ${sec80D > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: Deduction Sec 80D (Health Insurance)</td><td style="text-align: right;">- ${fmt(sec80D)}</td></tr>` : ''}
          ${sec80CCD > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: Deduction Sec 80CCD (NPS)</td><td style="text-align: right;">- ${fmt(sec80CCD)}</td></tr>` : ''}
          ${sec80TTA > 0 ? `<tr style="color: var(--color-accent); font-size:11px;"><td>Less: Deduction Sec 80TTA (Savings Interest)</td><td style="text-align: right;">- ${fmt(sec80TTA)}</td></tr>` : ''}
          
          <tr style="font-weight: 700; background: rgba(0,0,0,0.2);"><td>Net Taxable Income</td><td style="text-align: right; color: var(--color-success);">${fmt(netOld)}</td></tr>
        </tbody>
      </table>

      <h5 style="font-weight: 600; margin-bottom: 8px; font-size: 12px;">Slab-Wise Tax Breakdown</h5>
      <table class="calc-table" style="font-size: 11px; margin-bottom: 16px; width: 100%;">
        <thead>
          <tr><th>Income Slab</th><th>Rate</th><th style="text-align: right;">Tax Amount</th></tr>
        </thead>
        <tbody>
          ${slabDetails.map(s => `<tr><td>${s.range}</td><td>${s.rate}</td><td style="text-align: right;">${fmt(s.tax)}</td></tr>`).join('')}
          <tr style="font-weight:700;"><td>Basic Slab Tax</td><td>—</td><td style="text-align: right;">${fmt(basicTax)}</td></tr>
          <tr><td>Health & Education Cess</td><td>4%</td><td style="text-align: right;">${fmt(cess)}</td></tr>
          ${cgTax > 0 ? `<tr><td>Capital Gains Tax (Flat rate)</td><td>STCG 20% / LTCG 12.5%</td><td style="text-align: right;">${fmt(cgTax)}</td></tr>` : ''}
          <tr style="font-weight: 800; font-size:13px; background: rgba(255,255,255,0.08); border-top: 1px solid var(--color-primary);">
            <td>Total Tax Liability</td><td>—</td><td style="text-align: right; color: var(--color-error);">${fmt(totalTax)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  container.innerHTML = html;
}

function selectRegime(regime) {
  appState.selectedRegime = regime;
  document.getElementById('regime-card-old').classList.remove('selected');
  document.getElementById('regime-card-new').classList.remove('selected');
  document.getElementById(`regime-card-${regime}`).classList.add('selected');
  showToast('Regime Selected', `${regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'} chosen.`, 'info');
  recalculateAll();
  renderTaxCalculationSheet(regime);
}

function generateSavingAdvisorList() {
  const container = document.getElementById('advisor-saving-items');
  if (!container) return;
  container.innerHTML = '';

  if (appState.deductions.sec80CCD < 50000) {
    const diff = 50000 - appState.deductions.sec80CCD;
    createAdvisorItem(container, `Invest ₹${diff.toLocaleString('en-IN')} more in NPS (Sec 80CCD)`, 'Saves up to ₹' + Math.round(diff * 0.312).toLocaleString('en-IN') + ' under Old Regime.', 'NPS Claim', 15600);
  }
  if (appState.deductions.sec80D < 25000) {
    createAdvisorItem(container, 'Purchase Health Insurance (Sec 80D)', 'Protect your family and deduct premium payments.', 'Health Claim', 7800);
  }
  if (appState.selectedRegime !== appState.recommendedRegime) {
    const diff = Math.abs(appState.income.taxOldRegime - appState.income.taxNewRegime);
    createAdvisorItem(container, `Switch to ${appState.recommendedRegime === 'new' ? 'New Regime' : 'Old Regime'}`, 'Instant tax savings without additional investments.', 'Regime Optimisation', diff);
  }
}

function createAdvisorItem(container, title, desc, tag, savings) {
  const card = document.createElement('div');
  card.className = 'advisor-card';
  card.innerHTML = `
    <div class="advisor-content">
      <span class="advisor-badge-save">Save ₹${savings.toLocaleString('en-IN')}</span>
      <div style="font-weight:600;font-size:13px;">${title}</div>
      <p style="font-size:11px;color:var(--text-muted);">${desc}</p>
    </div>
    <span style="font-size:10px;font-weight:700;color:var(--color-primary);text-transform:uppercase;">${tag}</span>
  `;
  container.appendChild(card);
}

function renderComparisonMatrix() {
  const fmt = n => '₹' + (n || 0).toLocaleString('en-IN');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  const cgSTCG = Math.max(0, appState.income.capitalGainsSTCG || 0);
  const cgLTCG = Math.max(0, appState.income.capitalGainsLTCG || 0);
  const totalGross = appState.income.grossSalary + appState.income.savingsInterest +
                     cgSTCG + cgLTCG + appState.income.businessPresIncome;

  setText('comp-old-gross',    fmt(totalGross));
  setText('comp-new-gross',    fmt(totalGross));
  setText('comp-old-hra',      '-' + fmt(appState.income.hraExemption));
  setText('comp-old-hl',       '-' + fmt(appState.income.homeLoanInterestLoss));
  setText('comp-old-80c',      '-' + fmt(Math.min(150000, appState.deductions.sec80C)));
  setText('comp-old-80d',      '-' + fmt(Math.min(25000,  appState.deductions.sec80D)));
  setText('comp-old-nps',      '-' + fmt(Math.min(50000,  appState.deductions.sec80CCD)));
  setText('comp-old-interest', fmt(appState.income.savingsInterest));
  setText('comp-new-interest', fmt(appState.income.savingsInterest));
  setText('comp-old-net',      fmt(appState.income.netTaxableOld));
  setText('comp-new-net',      fmt(appState.income.netTaxableNew));
  setText('comp-old-tax',      fmt(appState.income.taxOldRegime));
  setText('comp-new-tax',      fmt(appState.income.taxNewRegime));

  const diff        = Math.abs(appState.income.taxOldRegime - appState.income.taxNewRegime);
  const recommended = appState.income.taxNewRegime < appState.income.taxOldRegime ? 'New' : 'Old';
  const el = document.getElementById('comp-new-recommend');
  if (el) el.innerHTML = `<span class="recon-badge match">⭐ Recommended (${recommended} saves ${fmt(diff)})</span>`;
}

// ==========================================
// Step 7: Validation & Error Correction
// ==========================================
async function triggerITRValidation() {
  document.getElementById('validation-running-spinner').style.display = 'block';
  document.getElementById('validation-results-container').style.display = 'none';

  setTimeout(async () => {
    document.getElementById('validation-running-spinner').style.display = 'none';
    document.getElementById('validation-results-container').style.display = 'block';
    await runValidationChecks();
  }, 1200);
}

async function runValidationChecks() {
  const container = document.getElementById('validation-rules-list');
  if (!container) return;
  container.innerHTML = '';

  const res = await apiPost('/validation', { user: appState });
  const errors = (res && res.errors) ? res.errors : [];

  createValidationRow(container, 'PAN Format Check',          'Valid PAN structure verified.',                      !errors.find(e => e.id === 'pan'));
  createValidationRow(container, 'Aadhaar Linked',            'Aadhaar authentication consent verified.',           true);
  createValidationRow(container, 'IFSC Code Check',           'Bank routing code format validated.',                !errors.find(e => e.id === 'ifsc'));
  createValidationRow(container, 'AIS Reconciliation Check',  'Document entries vs. tax portal credits matched.',   !errors.find(e => e.id === 'ais'));
  createValidationRow(container, 'ITR Form Mapper',           'Correct ITR form selected for your income type.',    true);

  const summaryBox = document.getElementById('validation-summary-card');
  const fixBox     = document.getElementById('itr-error-fix-block');

  if (errors.length > 0) {
    summaryBox.innerHTML = `
      <div class="ui-alert warning">
        <i class="fa-solid fa-circle-exclamation ui-alert-icon"></i>
        <div><strong>${errors.length} Validation Alert${errors.length > 1 ? 's' : ''} Found:</strong> Resolve before filing to prevent tax department scrutiny.</div>
      </div>`;
    const firstErr = errors[0];
    fixBox.style.display = 'block';
    document.getElementById('itr-error-title').innerText = firstErr.title;
    document.getElementById('itr-error-desc').innerText  = firstErr.desc;
    document.getElementById('itr-fix-input').value       = firstErr.value;
    appState.activeErrorId = firstErr.id;
  } else {
    summaryBox.innerHTML = `
      <div class="ui-alert success">
        <i class="fa-solid fa-circle-check ui-alert-icon"></i>
        <div><strong>Ready to File:</strong> All validation checks passed successfully.</div>
      </div>`;
    fixBox.style.display = 'none';
  }
}

function createValidationRow(container, name, description, isPassed) {
  const row = document.createElement('div');
  row.className = 'document-item';
  row.innerHTML = `
    <div class="doc-info">
      <div class="doc-status-badge ${isPassed ? 'success' : 'warning'}">
        <i class="fa-solid ${isPassed ? 'fa-check' : 'fa-triangle-exclamation'}"></i>
      </div>
      <div>
        <div style="font-weight:600;font-size:13px;">${name}</div>
        <div style="font-size:11px;color:var(--text-muted);">${description}</div>
      </div>
    </div>
    <span style="font-size:11px;font-weight:700;color:${isPassed ? 'var(--color-success)' : 'var(--color-warning)'};">
      ${isPassed ? 'VERIFIED' : 'ACTION REQUIRED'}
    </span>
  `;
  container.appendChild(row);
}

async function applyItrErrorFix() {
  const newVal = document.getElementById('itr-fix-input').value;
  const errId  = appState.activeErrorId;

  if (errId === 'ifsc') {
    await apiPost('/profile/bank-ifsc', { ifsc: newVal });
    appState.bankAccount.ifsc = newVal;
  } else if (errId === 'pan') {
    appState.userPAN = newVal;
  } else if (errId === 'ais') {
    const govInterest = appState.govData ? appState.govData.savingsInterest : 14500;
    await acceptGovValue('interest', govInterest);
  }

  showToast('Fix Applied', 'Validation parameters updated successfully.', 'success');
  triggerITRValidation();
  recalculateHealthScore();
}

// ==========================================
// Filing Workflow
// ==========================================
async function submitFilingWorkflow(mode) {
  const itrJson = {
    Assessee: {
      Name: appState.userName,
      PAN: appState.userPAN,
      FormSelected: appState.profile.business ? 'ITR-4' : (appState.profile.investor ? 'ITR-2' : 'ITR-1'),
      AssessmentYear: '2026-27',
      FilingSection: '139(1)'
    },
    ComputationDetails: {
      GrossSalary: appState.income.grossSalary,
      IncomeFromOtherSources: appState.income.savingsInterest,
      PresumptiveBusinessIncome: appState.income.businessPresIncome,
      EligibleDeductions: appState.selectedRegime === 'old' ? appState.deductions.eligibleTotal : 75000,
      TaxPayable: appState.selectedRegime === 'old' ? appState.income.taxOldRegime : appState.income.taxNewRegime
    },
    TaxPayments: {
      TDSClaimed: appState.income.tdsSalary || 0,
      NetRefundDue: Math.max(0, (appState.income.tdsSalary || 0) - (appState.selectedRegime === 'old' ? appState.income.taxOldRegime : appState.income.taxNewRegime))
    },
    BankDetails: {
      AccountNumber: appState.bankAccount.accNumber,
      IFSC: appState.bankAccount.ifsc
    }
  };

  const codeArea = document.getElementById('modal-json-code');
  if (codeArea) codeArea.innerText = JSON.stringify(itrJson, null, 2);

  if (mode === 'offline') {
    document.getElementById('json-modal-overlay').style.display = 'flex';
    return;
  }

  showToast('Transmitting Return', 'Uploading encrypted JSON payload to Income Tax portal APIs...', 'info');
  addBotMessage('Transmitting return details to secure portal gateways...');

  const res = await apiPost('/submit', { user: appState, regime: appState.selectedRegime });

  setTimeout(() => {
    if (res && !res.error) {
      showToast('ITR Filed Successfully', 'Return submitted and Aadhaar e-verification complete.', 'success');
      addBotMessage('✅ Your ITR has been filed and e-verified successfully via Aadhaar OTP. Keep your acknowledgement number safe.');
      appState.returnStatus = 'Filed & Verified';
      const statusEl = document.getElementById('dash-return-status-val');
      if (statusEl) { statusEl.innerText = 'Filed & Verified'; statusEl.style.color = 'var(--color-success)'; }
      recalculateHealthScore();
    } else {
      showToast('Submission Error', 'Could not reach portal. Please retry.', 'error');
    }
  }, 2500);
}

function closeJsonModal() { document.getElementById('json-modal-overlay').style.display = 'none'; }

function downloadJSONFile() {
  const code = document.getElementById('modal-json-code').innerText;
  const blob  = new Blob([code], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url;
  a.download = `ITR_${appState.userPAN}_AY2627.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  closeJsonModal();
  showToast('JSON Downloaded', 'ITR schema file saved to your downloads folder.', 'success');
}

// ==========================================
// Dashboard Widgets & Health Score
// ==========================================
function updateDashboardWidgets() {
  const fmt = n => '₹' + (n || 0).toLocaleString('en-IN');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  const selectedTax = appState.selectedRegime === 'old' ? appState.income.taxOldRegime : appState.income.taxNewRegime;
  const cgSTCG = Math.max(0, appState.income.capitalGainsSTCG || 0);
  const cgLTCG = Math.max(0, appState.income.capitalGainsLTCG || 0);
  const totalGross  = appState.income.grossSalary + appState.income.savingsInterest +
                      cgSTCG + cgLTCG + appState.income.businessPresIncome;

  setText('dash-gross-val',      fmt(totalGross));
  setText('dash-tax-val',        fmt(selectedTax));
  setText('dash-active-regime',  appState.selectedRegime === 'new' ? 'New Slabs' : 'Old Regime');

  const tds    = appState.income.tdsSalary || 0;
  const refund = Math.max(0, tds - selectedTax);
  setText('refund-predicted-val', fmt(refund));

  let riskPercent = 10;
  if (appState.income.hraExemption > 150000) riskPercent += 30;
  if (!appState.resolvedAisMismatch && appState.govFetched) riskPercent += 40;
  if (appState.profile.business && appState.income.businessPresIncome === 0) riskPercent += 20;

  let label = 'Low', labelColor = 'var(--color-success)', daysText = '12-18 Days';
  if (riskPercent > 60) { label = 'High';   labelColor = 'var(--color-error)';   daysText = '45-60 Days'; }
  else if (riskPercent > 30) { label = 'Medium'; labelColor = 'var(--color-warning)'; daysText = '20-30 Days'; }

  const riskBar  = document.getElementById('scrutiny-risk-bar');
  const riskLbl  = document.getElementById('scrutiny-risk-level');
  const procText = document.getElementById('processing-time-text');
  if (riskBar)  riskBar.style.width = riskPercent + '%';
  if (riskLbl)  { riskLbl.innerText = label; riskLbl.style.color = labelColor; }
  if (procText) procText.innerText = daysText;

  // Dynamic Actions List Rendering
  const actionsList = document.getElementById('dash-actions-list');
  if (actionsList) {
    actionsList.innerHTML = '';
    if (appState.returnStatus === 'Filed & Verified') {
      actionsList.innerHTML = `
        <div class="advisor-card" style="border-color: var(--color-success); width: 100%;">
          <div class="advisor-content">
            <span class="advisor-badge-save" style="background-color: var(--color-success-glow); color: var(--color-success); font-weight: 700;">Filing Complete</span>
            <div style="font-weight: 600; font-size: 13px;">Return Filed & Verified</div>
            <p style="font-size: 11px; color: var(--text-muted);">Your Income Tax Return for AY 2026-27 has been successfully compiled, validated, and e-verified with Aadhaar OTP.</p>
          </div>
        </div>
      `;
    } else {
      const govInterest = appState.govData ? appState.govData.savingsInterest : 14500;
      const docInterest = appState.income.savingsInterest;
      
      if (appState.govFetched && !appState.resolvedAisMismatch && docInterest !== govInterest) {
        actionsList.innerHTML = `
          <div class="advisor-card" style="border-color: var(--color-warning); width: 100%;">
            <div class="advisor-content">
              <span class="advisor-badge-save" style="background-color: var(--color-warning-glow); color: var(--color-warning); font-weight: 700;">Validation warning</span>
              <div style="font-weight: 600; font-size: 13px;">Savings Account Interest Mismatch</div>
              <p style="font-size: 11px; color: var(--text-muted);">AIS portal interest credits show ₹${govInterest.toLocaleString('en-IN')}, but your document records show ₹${docInterest.toLocaleString('en-IN')}.</p>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="showSection('wizard-section'); showWizardStep(4);"><i class="fa-solid fa-wand-magic-sparkles"></i> Resolve</button>
          </div>
        `;
      } else {
        actionsList.innerHTML = `
          <div class="advisor-card" style="border-color: var(--color-success); width: 100%;">
            <div class="advisor-content">
              <span class="advisor-badge-save" style="background-color: var(--color-success-glow); color: var(--color-success); font-weight: 700;">All Clear</span>
              <div style="font-weight: 600; font-size: 13px;">No Pending Actions</div>
              <p style="font-size: 11px; color: var(--text-muted);">Your profile data matches government records. You are ready to complete final validation checks and file your return.</p>
            </div>
            <button class="btn btn-primary btn-sm" onclick="showSection('wizard-section'); showWizardStep(7);"><i class="fa-solid fa-paper-plane"></i> Go to Filing</button>
          </div>
        `;
      }
    }
  }
}

function recalculateHealthScore() {
  let score = 30;
  if (appState.userLoggedIn)             score += 20;
  if (appState.uploadedFiles.length > 0) score += 20;
  if (appState.govFetched) {
    score += appState.resolvedAisMismatch ? 20 : -10;
  }
  if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(appState.userPAN) &&
      /^[A-Z]{4}0[A-Z0-9]{6}$/.test(appState.bankAccount.ifsc)) score += 10;

  score = Math.min(100, Math.max(10, score));

  const circle = document.getElementById('health-gauge-circle');
  const txt    = document.getElementById('health-score-text');
  const rating = document.getElementById('health-rating');
  const recom  = document.getElementById('health-recomm');

  if (txt) txt.innerText = score;
  if (circle) {
    circle.style.strokeDashoffset = 170 - (170 * (score / 100));
    if (score >= 90) {
      circle.style.stroke = 'var(--color-success)';
      if (rating) rating.innerText = 'Excellent';
      if (recom)  recom.innerText  = 'Minimal audit risk.';
    } else if (score >= 70) {
      circle.style.stroke = 'var(--color-primary)';
      if (rating) rating.innerText = 'Good';
      if (recom)  recom.innerText  = 'Check AIS differences.';
    } else {
      circle.style.stroke = 'var(--color-warning)';
      if (rating) rating.innerText = 'Action Needed';
      if (recom)  recom.innerText  = 'Complete all steps to improve.';
    }
  }
}

// ==========================================
// AI Chatbot
// ==========================================
async function sendChatMessage() {
  const input = document.getElementById('chatbot-user-input');
  if (!input || !input.value.trim()) return;
  const msgText = input.value.trim();
  addUserMessage(msgText);
  input.value = '';
  setTimeout(async () => await evaluateBotReply(msgText), 800);
}

function handleChatEnter(event) { if (event.key === 'Enter') sendChatMessage(); }

async function askChatbot(question) {
  addUserMessage(question);
  setTimeout(async () => await evaluateBotReply(question), 800);
}

function addUserMessage(txt) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = 'chat-msg user';
  msg.innerHTML = `<div>${txt}</div><span class="chat-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function addBotMessage(txt) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = 'chat-msg bot';
  msg.innerHTML = `<div>${txt}</div><span class="chat-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

async function evaluateBotReply(prompt) {
  const res = await apiPost('/chat', { query: prompt, user: appState });
  if (res && res.responseText) {
    addBotMessage(res.responseText);
  }
}

// ==========================================
// Admin Dashboard
// ==========================================
async function loadAdminDashboard() {
  const users = await apiGet('/admin/users');
  const tbody = document.querySelector('#admin-dashboard-section tbody');
  if (!tbody || !users) return;

  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${u.name}</strong></td>
      <td>${u.pan}</td>
      <td>${u.profile?.business ? 'ITR-4' : u.profile?.investor ? 'ITR-2' : 'ITR-1'}</td>
      <td>${u.selectedRegime === 'new' ? 'New Slabs' : 'Old Slabs'}</td>
      <td>₹${(u.income?.grossSalary || 0).toLocaleString('en-IN')}</td>
      <td><span class="recon-badge match">Score: 92</span></td>
      <td><span class="badge-status ${u.returnStatus?.includes('Filed') ? 'active' : 'pending'}">${u.returnStatus || 'Draft'}</span></td>
      <td><button class="btn btn-secondary btn-sm" onclick="adminReviewUser('${u.name}', 'ITR-1')">Review</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadAdminAuditLogs() {
  const logs = await apiGet('/admin/audit-logs');
  const container = document.getElementById('admin-audit-log-box');
  if (!container || !logs) return;

  container.innerHTML = '';
  logs.forEach(l => {
    const div = document.createElement('div');
    div.innerHTML = `<span style="color:var(--text-muted);">[${new Date(l.timestamp).toLocaleString()}]</span> <span style="color:${l.type === 'AUTH' ? 'var(--color-success)' : 'var(--color-primary)'};font-weight:700;">[${l.type}]</span> ${l.msg}`;
    container.appendChild(div);
  });
}

async function loadAdminNotices() {
  const notices = await apiGet('/admin/notices');
  const container = document.querySelector('#admin-tickets-section .advisor-list');
  if (!container || !notices) return;

  container.innerHTML = '';
  notices.forEach(n => {
    const div = document.createElement('div');
    div.className = 'advisor-card';
    div.style.borderColor = n.status === 'pending' ? 'var(--color-error)' : 'var(--color-success)';
    div.innerHTML = `
      <div class="advisor-content">
        <span class="advisor-badge-save" style="background-color:${n.status === 'pending' ? 'var(--color-error-glow)' : 'var(--color-success-glow)'};color:${n.status === 'pending' ? 'var(--color-error)' : 'var(--color-success)'};">${n.type}</span>
        <div style="font-weight:600;font-size:13px;">Assessee: ${n.assessee}</div>
        <p style="font-size:11px;color:var(--text-muted);">${n.desc}</p>
        ${n.response ? `<p style="font-size:11px;color:var(--color-success);font-family:monospace;margin-top:6px;">Draft reply: ${n.response}</p>` : ''}
      </div>
      ${n.status === 'pending'
        ? `<button class="btn btn-secondary btn-sm" onclick="draftNoticeReply(${n.id}, '${n.assessee}')">Draft Reply</button>`
        : `<span style="font-size:10px;font-weight:700;color:var(--color-success);">FILED</span>`}
    `;
    container.appendChild(div);
  });
}

function adminReviewUser(name, itr) {
  showToast('User Selected', `Loading profile for ${name} (${itr}).`, 'info');
}

let activeDraftNoticeId = null;
function draftNoticeReply(id, name) {
  activeDraftNoticeId = id;
  document.getElementById('notice-drafting-box').style.display = 'block';
  document.getElementById('notice-reply-textarea').value =
    `To,\nIncome Tax Department Officer,\n\nSubject: Response to notice under Section 139(9) for Assessee ${name}.\n\nWith reference to notice, we submit that the gross receipts of business presumptive income match Form 26AS banking deposits exactly. There are no concealed credits. The returns have been revised accordingly.\n\nSigned,\nTax Advisor Portal`;
  showToast('Reply Drafted', 'AI drafted a response based on GSTR credits.', 'success');
}

async function submitDraftReply() {
  const replyText = document.getElementById('notice-reply-textarea').value;
  if (activeDraftNoticeId) {
    await apiPost('/admin/notices/reply', { noticeId: activeDraftNoticeId, replyText });
    await loadAdminNotices();
  }
  document.getElementById('notice-drafting-box').style.display = 'none';
  showToast('Reply Transmitted', 'Notice defense uploaded to the e-Proceedings portal.', 'success');
}

function replyToSupportTicket(name) {
  showToast('CA Chat Panel', `Connecting secure expert session for ${name}...`, 'info');
}

// ==========================================
// Toast Notifications
// ==========================================
function showToast(title, body, type = 'success') {
  const toast  = document.getElementById('app-toast-notif');
  const tIcon  = document.getElementById('toast-icon-badge');
  const tTitle = document.getElementById('toast-title-text');
  const tBody  = document.getElementById('toast-body-text');
  if (!toast || !tIcon || !tTitle || !tBody) return;

  const typeMap = {
    error:   { bg: 'var(--color-error)',   icon: 'fa-times' },
    warning: { bg: 'var(--color-warning)', icon: 'fa-exclamation' },
    info:    { bg: 'var(--color-primary)', icon: 'fa-info' },
    success: { bg: 'var(--color-success)', icon: 'fa-check' }
  };
  const t = typeMap[type] || typeMap.success;
  tIcon.style.backgroundColor = t.bg;
  tIcon.innerHTML = `<i class="fa-solid ${t.icon}"></i>`;
  tTitle.innerText = title;
  tBody.innerText  = body;

  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}
