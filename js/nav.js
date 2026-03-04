fetch('/pages/nav.html')
  .then(response => response.text())
  .then(data => {
    document.getElementById('nav-placeholder').innerHTML = data;

    // Attach mobile menu toggle AFTER nav is injected
    const menuToggle = document.getElementById('mobile-menu');
    const navMenu    = document.getElementById('nav-menu');
    if (menuToggle && navMenu) {
      menuToggle.addEventListener('click', () => navMenu.classList.toggle('active'));
    }

    // Render auth state in nav
    updateNavAuth();
  });

// ── Auth state rendering ────────────────────────────────────
function updateNavAuth() {
  const area = document.getElementById('navAuth');
  if (!area) return;
  const user = getUser(); // from auth.js
  if (user) {
    area.innerHTML = `
      <span class="nav-user-badge">
        <i class="fas fa-user-circle"></i> ${user.username}
        <button class="nav-logout-btn" onclick="navLogout()" title="Sign out">
          <i class="fas fa-sign-out-alt"></i>
        </button>
      </span>`;
  } else {
    area.innerHTML = `
      <button class="nav-login-btn" onclick="openLoginModal()">
        <i class="fas fa-lock"></i> Sign In
      </button>`;
  }
}

function navLogout() {
  clearToken(); // from auth.js
  window.location.reload();
}

// ── Login modal ─────────────────────────────────────────────
let _loginSelectedUser = 'zq1';

function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (!modal) return;
  // Reset state
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').style.display = 'none';
  // Default to first user button active
  document.querySelectorAll('#loginModal .room-sel-btn').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });
  _loginSelectedUser = 'zq1';
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('loginPassword').focus(), 50);
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.add('hidden');
}

function selectLoginUser(btn) {
  document.querySelectorAll('#loginModal .room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _loginSelectedUser = btn.dataset.user;
}

async function submitLogin() {
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: _loginSelectedUser, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token); // from auth.js
    closeLoginModal();
    window.location.reload();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  }
}

// ── Forgot password ─────────────────────────────────────────
function showForgotForm() {
  document.getElementById('forgotForm').style.display = '';
  document.getElementById('forgotStatus').innerHTML = '';
  document.getElementById('forgotSendBtn').disabled = false;
}

function hideForgotForm() {
  document.getElementById('forgotForm').style.display = 'none';
}

async function submitForgot() {
  const btn    = document.getElementById('forgotSendBtn');
  const status = document.getElementById('forgotStatus');
  btn.disabled = true;
  status.innerHTML = '';
  try {
    const res = await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: _loginSelectedUser }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    status.innerHTML = `<p style="color:#66bb6a;font-size:0.85rem">
      <i class="fas fa-check-circle"></i> Link sent! Check ${_loginSelectedUser}'s email.
    </p>`;
  } catch (e) {
    status.innerHTML = `<p class="login-error">${e.message}</p>`;
    btn.disabled = false;
  }
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  const modal = document.getElementById('loginModal');
  if (modal && e.target === modal) closeLoginModal();
});
